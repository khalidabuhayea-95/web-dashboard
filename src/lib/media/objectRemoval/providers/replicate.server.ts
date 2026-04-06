import {
  createProcessingFailedError,
  createProviderUnavailableError,
  createUnprocessableImageError,
} from "../errors";

const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_WAIT_TIMEOUT_MS = 150_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CANCEL_AFTER = "2m";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8];
const WEBP_RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];

type ReplicatePrediction = {
  id: string;
  status: string;
  output?: unknown;
  error?: unknown;
  logs?: string | null;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function getConfig() {
  return {
    apiToken: normalizeText(process.env.REPLICATE_API_TOKEN),
    model: normalizeText(process.env.OBJECT_REMOVE_REPLICATE_MODEL) || "allenhooo/lama",
    version:
      normalizeText(process.env.OBJECT_REMOVE_REPLICATE_VERSION) ||
      "cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72",
  };
}

export function getReplicateObjectRemovalMetadata() {
  const config = getConfig();
  return {
    provider: "replicate",
    model: config.model,
    version: config.version,
  };
}

export function assertReplicateObjectRemovalConfigured() {
  const config = getConfig();
  if (!config.apiToken || !config.version) {
    throw createProviderUnavailableError("Replicate object removal is not configured.");
  }
  return config;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

function buildReplicateError(status: number, payload: unknown) {
  const detailMessage =
    payload && typeof payload === "object" && "detail" in payload
      ? normalizeText((payload as { detail?: unknown }).detail)
      : "";
  const errorMessage =
    payload && typeof payload === "object" && "error" in payload
      ? normalizeText((payload as { error?: unknown }).error)
      : "";
  const message = detailMessage || errorMessage || `Replicate request failed (${status}).`;

  if (status === 400 || status === 422) {
    return createUnprocessableImageError(message);
  }

  if (status === 401 || status === 403 || status === 429 || status >= 500) {
    return createProviderUnavailableError(message);
  }

  return createProcessingFailedError(message, {
    transient: isRetryableStatus(status),
  });
}

async function parseResponsePayload(response: Response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }
  return response.text().catch(() => "");
}

async function replicateRequest<T = any>(
  path: string,
  {
    method = "GET",
    body,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    headers = {},
    retryTransient = true,
  }: {
    method?: string;
    body?: unknown;
    timeoutMs?: number;
    headers?: Record<string, string>;
    retryTransient?: boolean;
  } = {}
): Promise<T> {
  const config = assertReplicateObjectRemovalConfigured();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${REPLICATE_API_BASE}${path}`, {
      method,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "web-dashboard/object-remove",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const payload = await parseResponsePayload(response);
    if (!response.ok) {
      if (retryTransient && isRetryableStatus(response.status)) {
        await delay(1_000);
        return replicateRequest<T>(path, {
          method,
          body,
          timeoutMs,
          headers,
          retryTransient: false,
        });
      }
      throw buildReplicateError(response.status, payload);
    }

    return payload as T;
  } catch (error) {
    if (retryTransient) {
      const message = error instanceof Error ? error.message : String(error || "");
      const isNetworkFailure =
        message.toLowerCase().includes("fetch failed") ||
        message.toLowerCase().includes("network") ||
        message.toLowerCase().includes("timeout") ||
        message.toLowerCase().includes("abort");
      if (isNetworkFailure) {
        await delay(1_000);
        return replicateRequest<T>(path, {
          method,
          body,
          timeoutMs,
          headers,
          retryTransient: false,
        });
      }
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw createProviderUnavailableError("Replicate request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePredictionStatus(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function isTerminalStatus(status: string) {
  return ["succeeded", "successful", "completed", "failed", "canceled", "cancelled"].includes(status);
}

function isSuccessStatus(status: string) {
  return ["succeeded", "successful", "completed"].includes(status);
}

function outputUrlFromPredictionOutput(output: unknown): string {
  if (typeof output === "string" && output.trim()) {
    return output.trim();
  }
  if (Array.isArray(output)) {
    for (const entry of output) {
      if (typeof entry === "string" && entry.trim()) return entry.trim();
      if (entry && typeof entry === "object" && "url" in entry && String((entry as any).url || "").trim()) {
        return String((entry as any).url).trim();
      }
    }
  }
  if (output && typeof output === "object" && "url" in output && String((output as any).url || "").trim()) {
    return String((output as any).url).trim();
  }
  return "";
}

export async function createReplicateObjectRemovalPrediction({
  imageUrl,
  maskUrl,
}: {
  imageUrl: string;
  maskUrl: string;
}): Promise<ReplicatePrediction> {
  const config = assertReplicateObjectRemovalConfigured();
  const prediction = await replicateRequest<ReplicatePrediction>("/predictions", {
    method: "POST",
    headers: {
      "Cancel-After": DEFAULT_CANCEL_AFTER,
    },
    body: {
      version: config.version,
      input: {
        image: imageUrl,
        mask: maskUrl,
      },
    },
  });

  if (!prediction?.id) {
    throw createProcessingFailedError("Replicate did not return a prediction id.");
  }

  return prediction;
}

export async function getReplicatePrediction(predictionId: string): Promise<ReplicatePrediction> {
  const safePredictionId = normalizeText(predictionId);
  if (!safePredictionId) {
    throw createProcessingFailedError("Missing Replicate prediction id.");
  }
  return replicateRequest<ReplicatePrediction>(`/predictions/${safePredictionId}`, {
    method: "GET",
  });
}

export async function waitForReplicatePrediction({
  predictionId,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  onStatus,
}: {
  predictionId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onStatus?: (prediction: ReplicatePrediction) => Promise<void> | void;
}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const prediction = await getReplicatePrediction(predictionId);
    if (onStatus) {
      await onStatus(prediction);
    }

    const status = normalizePredictionStatus(prediction?.status);
    if (isTerminalStatus(status)) {
      if (!isSuccessStatus(status)) {
        throw createProcessingFailedError(
          normalizeText(prediction?.error) || "Replicate object removal failed."
        );
      }

      const outputUrl = outputUrlFromPredictionOutput(prediction?.output);
      if (!outputUrl) {
        throw createProcessingFailedError("Replicate did not return an output image.");
      }

      return {
        ...prediction,
        outputUrl,
      };
    }

    await delay(Math.max(500, Math.round(Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS)));
  }

  throw createProviderUnavailableError("Replicate object removal timed out.");
}

function matchesSignature(bytes: Uint8Array, signature: number[], offset = 0) {
  if (!(bytes instanceof Uint8Array) || bytes.length < signature.length + offset) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false;
  }
  return true;
}

function detectMimeType(bytes: Buffer, fallbackMimeType = "") {
  if (matchesSignature(bytes, PNG_SIGNATURE)) return "image/png";
  if (matchesSignature(bytes, JPEG_SIGNATURE)) return "image/jpeg";
  if (matchesSignature(bytes, WEBP_RIFF_SIGNATURE) && matchesSignature(bytes, WEBP_WEBP_SIGNATURE, 8)) {
    return "image/webp";
  }
  return normalizeText(fallbackMimeType).toLowerCase() || "application/octet-stream";
}

function extensionFromMimeType(mimeType: string) {
  const normalized = normalizeText(mimeType).toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  return "png";
}

function sanitizeOutputFileName(value: string, mimeType: string) {
  const safeBase = normalizeText(value)
    .replace(/^.*[\\/]/, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `${safeBase || "object-removed"}.${extensionFromMimeType(mimeType)}`;
}

function readPngDimensions(bytes: Buffer) {
  if (!matchesSignature(bytes, PNG_SIGNATURE) || bytes.length < 24) {
    return { width: 0, height: 0 };
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

export async function downloadReplicateOutput({
  outputUrl,
  fileName,
}: {
  outputUrl: string;
  fileName: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(outputUrl, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "image/*,application/octet-stream,*/*",
        "User-Agent": "web-dashboard/object-remove",
      },
    });

    if (!response.ok) {
      throw createProviderUnavailableError(`Failed to download Replicate output (${response.status}).`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) {
      throw createProcessingFailedError("Replicate output image is empty.");
    }

    const mimeType = detectMimeType(bytes, response.headers.get("content-type") || "");
    const dimensions = mimeType === "image/png" ? readPngDimensions(bytes) : { width: 0, height: 0 };

    return {
      bytes,
      mimeType,
      fileName: sanitizeOutputFileName(fileName, mimeType),
      width: dimensions.width,
      height: dimensions.height,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw createProviderUnavailableError("Timed out while downloading Replicate output.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
