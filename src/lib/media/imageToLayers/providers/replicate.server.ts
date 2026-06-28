import {
  createProcessingFailedError,
  createProviderUnavailableError,
  createUnprocessableImageError,
} from "../errors";
import {
  DEFAULT_IMAGE_TO_LAYERS_MODEL_ID,
  getImageToLayersModelDefinition,
  normalizeImageToLayersModelId,
  normalizeLayerCount,
} from "../models.js";

const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const DEFAULT_POLL_INTERVAL_MS = 2_000;
// Layered decomposition runs ~10-15s but can sit in Replicate's queue much
// longer, so wait well past running time. Kept under the route's maxDuration
// (300s) with headroom for downloading several layer images.
const DEFAULT_WAIT_TIMEOUT_MS = 240_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
// Backstop so Replicate cancels (stops billing) a prediction we've abandoned;
// must exceed the wait timeout above so queue spikes aren't cancelled early.
const DEFAULT_CANCEL_AFTER = "5m";
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

type ImageToLayersModelConfig = {
  apiToken: string;
  model: string;
  version: string;
  inputImageKey: string;
  layerCountKey: string;
  extraInput: Record<string, unknown>;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function getLegacyDefaultModelId() {
  return (
    normalizeImageToLayersModelId(process.env.IMAGE_TO_LAYERS_REPLICATE_MODEL) ||
    DEFAULT_IMAGE_TO_LAYERS_MODEL_ID
  );
}

export function getReplicateDefaultImageToLayersModelId() {
  return getLegacyDefaultModelId();
}

function resolveModelRuntimeConfig(modelId?: string): ImageToLayersModelConfig {
  const normalizedModelId = normalizeImageToLayersModelId(modelId) || getLegacyDefaultModelId();
  const definition = getImageToLayersModelDefinition(normalizedModelId);
  if (!definition) {
    throw createProviderUnavailableError(`Unsupported image layering model: ${normalizedModelId}`);
  }

  const legacyDefaultModelId = getLegacyDefaultModelId();
  const legacyVersionOverride = normalizeText(process.env.IMAGE_TO_LAYERS_REPLICATE_VERSION);

  return {
    apiToken: normalizeText(process.env.REPLICATE_API_TOKEN),
    model: definition.id,
    version:
      normalizedModelId === legacyDefaultModelId && legacyVersionOverride
        ? legacyVersionOverride
        : normalizeText(definition.defaultVersion),
    inputImageKey: definition.inputImageKey || "image",
    layerCountKey: definition.layerCountKey || "num_layers",
    extraInput:
      definition.extraInput && typeof definition.extraInput === "object"
        ? definition.extraInput
        : {},
  };
}

export function getReplicateImageToLayersMetadata(modelId?: string) {
  const config = resolveModelRuntimeConfig(modelId);
  return {
    provider: "replicate",
    model: config.model,
    version: config.version,
  };
}

export function assertReplicateImageToLayersConfigured(modelId?: string) {
  const config = resolveModelRuntimeConfig(modelId);
  // Official always-on models run by bare slug, so a pinned version is optional;
  // only the API token and a resolvable model slug are strictly required.
  if (!config.apiToken || !config.model) {
    throw createProviderUnavailableError("Replicate image layering is not configured.");
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

// Capped exponential backoff: ~1s, 2s, 4s (max 8s).
function backoffMs(attempt: number) {
  return Math.min(1_000 * 2 ** attempt, 8_000);
}

// Prefer Replicate's Retry-After (seconds) on 429s; otherwise back off. Capped
// so a single attempt can't eat the whole request budget.
function retryDelayMs(response: Response, attempt: number) {
  const seconds = Number(response.headers.get("retry-after"));
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(Math.round(seconds * 1_000), 15_000);
  }
  return backoffMs(attempt);
}

function isNetworkFailureMessage(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error || "")).toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("abort")
  );
}

const MAX_REPLICATE_ATTEMPTS = 4;

async function replicateRequest<T = any>(
  path: string,
  {
    method = "GET",
    body,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    headers = {},
  }: {
    method?: string;
    body?: unknown;
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {}
): Promise<T> {
  const config = assertReplicateImageToLayersConfigured();

  for (let attempt = 0; attempt < MAX_REPLICATE_ATTEMPTS; attempt += 1) {
    const lastAttempt = attempt === MAX_REPLICATE_ATTEMPTS - 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    // -1 = don't retry; >=0 = retry after this delay.
    let retryWaitMs = -1;

    try {
      const response = await fetch(`${REPLICATE_API_BASE}${path}`, {
        method,
        signal: controller.signal,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "web-dashboard/image-to-layers",
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      const payload = await parseResponsePayload(response);
      if (response.ok) {
        return payload as T;
      }
      // Honor Retry-After on 429s (and back off on 5xx) before giving up.
      if (isRetryableStatus(response.status) && !lastAttempt) {
        retryWaitMs = retryDelayMs(response, attempt);
      } else {
        throw buildReplicateError(response.status, payload);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (lastAttempt) {
          throw createProviderUnavailableError("Replicate request timed out.");
        }
        retryWaitMs = backoffMs(attempt);
      } else if (isNetworkFailureMessage(error) && !lastAttempt) {
        retryWaitMs = backoffMs(attempt);
      } else {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }

    if (retryWaitMs >= 0) {
      await delay(retryWaitMs);
    }
  }

  // Exhausted all attempts on a transient failure.
  throw createProviderUnavailableError("Replicate request failed after multiple retries.");
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

// qwen-image-layered returns an ARRAY of layer URLs (one per layer), so collect
// every URL in order rather than just the first like single-output models.
function outputUrlsFromPredictionOutput(output: unknown): string[] {
  const urls: string[] = [];
  const collect = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) urls.push(trimmed);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (typeof value === "object") {
      const maybeUrl = (value as { url?: unknown }).url;
      if (typeof maybeUrl === "string" && maybeUrl.trim()) {
        urls.push(maybeUrl.trim());
        return;
      }
      Object.values(value as Record<string, unknown>).forEach(collect);
    }
  };
  collect(output);
  return urls;
}

function buildModelInput(
  config: ImageToLayersModelConfig,
  { imageUrl, numLayers }: { imageUrl: string; numLayers?: number }
): Record<string, unknown> {
  return {
    [config.inputImageKey]: imageUrl,
    [config.layerCountKey]: normalizeLayerCount(numLayers),
    ...config.extraInput,
  };
}

export async function createReplicateImageToLayersPrediction({
  imageUrl,
  numLayers,
  modelId,
}: {
  imageUrl: string;
  numLayers?: number;
  modelId?: string;
}): Promise<ReplicatePrediction> {
  const config = assertReplicateImageToLayersConfigured(modelId);
  const input = buildModelInput(config, { imageUrl, numLayers });

  // With a pinned version, use the global predictions endpoint; otherwise run
  // the official model by slug via the model-scoped predictions endpoint.
  const usingVersion = Boolean(config.version);
  const path = usingVersion ? "/predictions" : `/models/${config.model}/predictions`;
  const body = usingVersion ? { version: config.version, input } : { input };

  const prediction = await replicateRequest<ReplicatePrediction>(path, {
    method: "POST",
    headers: {
      "Cancel-After": DEFAULT_CANCEL_AFTER,
    },
    body,
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
}: {
  predictionId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const prediction = await getReplicatePrediction(predictionId);
    const status = normalizePredictionStatus(prediction?.status);
    if (isTerminalStatus(status)) {
      if (!isSuccessStatus(status)) {
        throw createProcessingFailedError(
          normalizeText(prediction?.error) || "Replicate image layering failed."
        );
      }

      const outputUrls = outputUrlsFromPredictionOutput(prediction?.output);
      if (!outputUrls.length) {
        throw createProcessingFailedError("Replicate did not return any layer images.");
      }

      return {
        ...prediction,
        outputUrls,
      };
    }

    await delay(Math.max(500, Math.round(Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS)));
  }

  throw createProviderUnavailableError("Replicate image layering timed out.");
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
  return `${safeBase || "layer"}.${extensionFromMimeType(mimeType)}`;
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
        "User-Agent": "web-dashboard/image-to-layers",
      },
    });

    if (!response.ok) {
      throw createProviderUnavailableError(`Failed to download Replicate output (${response.status}).`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) {
      throw createProcessingFailedError("Replicate layer image is empty.");
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
