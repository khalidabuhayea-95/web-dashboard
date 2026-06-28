import {
  createProcessingFailedError,
  createProviderUnavailableError,
} from "./errors";

const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_WAIT_TIMEOUT_MS = 180_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CANCEL_AFTER = "5m";

// Surya OCR: detects text lines with axis-aligned bounding boxes across 90
// languages including Arabic (RTL). Community model, so it runs version-pinned.
const DEFAULT_OCR_MODEL = "datalab-to/ocr";
const DEFAULT_OCR_VERSION =
  "3e6db0d5311d6fdc232eea333c1e26055ba4e542180043f12acb2967e5c77f4a";

export type OcrTextBlock = {
  text: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function resolveOcrConfig() {
  return {
    apiToken: normalizeText(process.env.REPLICATE_API_TOKEN),
    model: normalizeText(process.env.IMAGE_TO_LAYERS_OCR_MODEL) || DEFAULT_OCR_MODEL,
    version: normalizeText(process.env.IMAGE_TO_LAYERS_OCR_VERSION) || DEFAULT_OCR_VERSION,
  };
}

export function assertOcrConfigured() {
  const config = resolveOcrConfig();
  if (!config.apiToken || !config.version) {
    throw createProviderUnavailableError("Replicate OCR is not configured.");
  }
  return config;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ocrRequest<T = any>(
  path: string,
  { method = "GET", body }: { method?: string; body?: unknown } = {}
): Promise<T> {
  const config = assertOcrConfigured();

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
          "User-Agent": "web-dashboard/image-to-layers-ocr",
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
        throw createProviderUnavailableError(`Replicate OCR request failed (${response.status}).`);
      }
      throw createProcessingFailedError(`Replicate OCR request failed (${response.status}).`);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (!lastAttempt) {
          await delay((attempt + 1) * 2_000);
          continue;
        }
        throw createProviderUnavailableError("Replicate OCR request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  // Unreachable: the loop either returns or throws on the last attempt.
  throw createProviderUnavailableError("Replicate OCR request failed.");
}

function isTerminal(status: string) {
  return ["succeeded", "failed", "canceled", "cancelled"].includes(status);
}

// Surya returns pages[].text_lines[] with bbox=[x1,y1,x2,y2]. Keep only lines
// with real content and a usable box.
function parseSuryaOutput(output: unknown): OcrTextBlock[] {
  const pages = (output as { pages?: unknown })?.pages;
  if (!Array.isArray(pages)) return [];
  const blocks: OcrTextBlock[] = [];
  for (const page of pages) {
    const lines = (page as { text_lines?: unknown })?.text_lines;
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      const text = normalizeText((line as { text?: unknown })?.text);
      const bbox = (line as { bbox?: unknown })?.bbox;
      if (!text || !Array.isArray(bbox) || bbox.length < 4) continue;
      const [x1, y1, x2, y2] = bbox.map((n) => Number(n));
      if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) continue;
      blocks.push({
        text,
        x1,
        y1,
        x2,
        y2,
        confidence: Number((line as { confidence?: unknown })?.confidence) || 0,
      });
    }
  }
  return blocks;
}

export async function extractTextBlocks({
  imageUrl,
}: {
  imageUrl: string;
}): Promise<OcrTextBlock[]> {
  const config = assertOcrConfigured();

  const prediction = await ocrRequest<{ id: string }>("/predictions", {
    method: "POST",
    body: {
      version: config.version,
      input: { file: imageUrl, return_pages: true },
    },
  });
  if (!prediction?.id) {
    throw createProcessingFailedError("Replicate OCR did not return a prediction id.");
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt <= DEFAULT_WAIT_TIMEOUT_MS) {
    const current = await ocrRequest<{ status: string; output?: unknown; error?: unknown }>(
      `/predictions/${prediction.id}`
    );
    const status = normalizeText(current?.status).toLowerCase();
    if (isTerminal(status)) {
      if (status !== "succeeded") {
        throw createProcessingFailedError(normalizeText(current?.error) || "Replicate OCR failed.");
      }
      return parseSuryaOutput(current?.output);
    }
    await delay(DEFAULT_POLL_INTERVAL_MS);
  }

  throw createProviderUnavailableError("Replicate OCR timed out.");
}
