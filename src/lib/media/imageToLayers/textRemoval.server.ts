import {
  createProcessingFailedError,
  createProviderUnavailableError,
} from "./errors";
import type { OcrTextBlock } from "./ocr.server";

const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_WAIT_TIMEOUT_MS = 180_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CANCEL_AFTER = "5m";

// LaMa inpainting (reconstructive, no prompt) — same model objectRemoval uses.
// Community model, so it runs version-pinned. Mask convention: white = remove.
const DEFAULT_LAMA_MODEL = "allenhooo/lama";
const DEFAULT_LAMA_VERSION =
  "cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72";

let canvasLibPromise: Promise<{ createCanvas: any } | null> | null = null;

async function getCanvasLib() {
  if (canvasLibPromise) return canvasLibPromise;
  canvasLibPromise = import("canvas")
    .then((module) => ({ createCanvas: module.createCanvas }))
    .catch(() => null);
  return canvasLibPromise;
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function resolveLamaConfig() {
  return {
    apiToken: normalizeText(process.env.REPLICATE_API_TOKEN),
    model: normalizeText(process.env.IMAGE_TO_LAYERS_LAMA_MODEL) || DEFAULT_LAMA_MODEL,
    version: normalizeText(process.env.IMAGE_TO_LAYERS_LAMA_VERSION) || DEFAULT_LAMA_VERSION,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Black canvas with white (dilated) rectangles over each text box.
async function buildTextMask(
  blocks: OcrTextBlock[],
  width: number,
  height: number
): Promise<Buffer | null> {
  const canvasLib = await getCanvasLib();
  if (!canvasLib?.createCanvas) return null;

  const canvas = canvasLib.createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  for (const block of blocks) {
    const padX = Math.max(6, Math.round((block.x2 - block.x1) * 0.04));
    const padY = Math.max(6, Math.round((block.y2 - block.y1) * 0.12));
    const x = Math.max(0, block.x1 - padX);
    const y = Math.max(0, block.y1 - padY);
    const w = Math.min(width - x, block.x2 - block.x1 + padX * 2);
    const h = Math.min(height - y, block.y2 - block.y1 + padY * 2);
    ctx.fillRect(x, y, w, h);
  }
  return canvas.toBuffer("image/png");
}

async function lamaRequest<T = any>(
  path: string,
  { method = "GET", body }: { method?: string; body?: unknown } = {}
): Promise<T> {
  const config = resolveLamaConfig();
  if (!config.apiToken || !config.version) {
    throw createProviderUnavailableError("Replicate text removal is not configured.");
  }

  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const lastAttempt = attempt === MAX_ATTEMPTS - 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${REPLICATE_API_BASE}${path}`, {
        method,
        signal: controller.signal,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "web-dashboard/image-to-layers-textremoval",
          "Cancel-After": DEFAULT_CANCEL_AFTER,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok) {
        return payload as T;
      }
      const transient = response.status === 429 || response.status >= 500;
      if (transient && !lastAttempt) {
        await delay((attempt + 1) * 2_000);
        continue;
      }
      if (response.status === 401 || response.status === 403 || response.status >= 500) {
        throw createProviderUnavailableError(`Replicate text removal failed (${response.status}).`);
      }
      throw createProcessingFailedError(`Replicate text removal failed (${response.status}).`);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (!lastAttempt) {
          await delay((attempt + 1) * 2_000);
          continue;
        }
        throw createProviderUnavailableError("Replicate text removal request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  // Unreachable: the loop either returns or throws on the last attempt.
  throw createProviderUnavailableError("Replicate text removal failed.");
}

function firstOutputUrl(output: unknown): string {
  if (typeof output === "string") return output.trim();
  if (Array.isArray(output)) {
    for (const entry of output) {
      if (typeof entry === "string" && entry.trim()) return entry.trim();
      if (entry && typeof entry === "object" && typeof (entry as any).url === "string") {
        return String((entry as any).url).trim();
      }
    }
  }
  if (output && typeof output === "object" && typeof (output as any).url === "string") {
    return String((output as any).url).trim();
  }
  return "";
}

// Inpaint the text regions out of the image so the decomposed raster layers do
// not duplicate text that we re-add as editable layers. Returns the cleaned
// image bytes, or the original bytes unchanged if there is no text / no runtime.
export async function removeTextRegions({
  imageBytes,
  imageMimeType,
  blocks,
  width,
  height,
}: {
  imageBytes: Buffer;
  imageMimeType: string;
  blocks: OcrTextBlock[];
  width: number;
  height: number;
}): Promise<{ bytes: Buffer; mimeType: string; removed: boolean }> {
  if (!blocks.length) {
    return { bytes: imageBytes, mimeType: imageMimeType, removed: false };
  }

  const maskBytes = await buildTextMask(blocks, width, height);
  if (!maskBytes) {
    return { bytes: imageBytes, mimeType: imageMimeType, removed: false };
  }

  const imageUri = `data:${imageMimeType || "image/png"};base64,${imageBytes.toString("base64")}`;
  const maskUri = `data:image/png;base64,${maskBytes.toString("base64")}`;
  const config = resolveLamaConfig();

  const prediction = await lamaRequest<{ id: string }>("/predictions", {
    method: "POST",
    body: { version: config.version, input: { image: imageUri, mask: maskUri } },
  });
  if (!prediction?.id) {
    throw createProcessingFailedError("Replicate text removal did not return a prediction id.");
  }

  const startedAt = Date.now();
  let outputUrl = "";
  while (Date.now() - startedAt <= DEFAULT_WAIT_TIMEOUT_MS) {
    const current = await lamaRequest<{ status: string; output?: unknown; error?: unknown }>(
      `/predictions/${prediction.id}`
    );
    const status = normalizeText(current?.status).toLowerCase();
    if (["succeeded", "failed", "canceled", "cancelled"].includes(status)) {
      if (status !== "succeeded") {
        throw createProcessingFailedError(
          normalizeText(current?.error) || "Replicate text removal failed."
        );
      }
      outputUrl = firstOutputUrl(current?.output);
      break;
    }
    await delay(DEFAULT_POLL_INTERVAL_MS);
  }
  if (!outputUrl) {
    throw createProviderUnavailableError("Replicate text removal timed out.");
  }

  const downloadController = new AbortController();
  const downloadTimeout = setTimeout(() => downloadController.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(outputUrl, {
      signal: downloadController.signal,
      cache: "no-store",
      headers: { Accept: "image/*,*/*", "User-Agent": "web-dashboard/image-to-layers-textremoval" },
    });
    if (!response.ok) {
      throw createProviderUnavailableError(`Failed to download text-removed image (${response.status}).`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) {
      throw createProcessingFailedError("Text-removed image is empty.");
    }
    const mimeType = response.headers.get("content-type")?.includes("png")
      ? "image/png"
      : imageMimeType || "image/png";
    return { bytes, mimeType, removed: true };
  } finally {
    clearTimeout(downloadTimeout);
  }
}
