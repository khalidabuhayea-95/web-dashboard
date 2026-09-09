// Text-to-image generation: a sentence in, one picture out.
//
// The Arabic step is the whole reason this file exists. Every model cheap
// enough to make generation feel free has an English-only text encoder, so an
// Arabic prompt goes through Google's free translate endpoint first. Failure
// there is not fatal — translatePromptToEnglish hands back the original — so a
// translator outage degrades the result instead of taking the feature down.

import {
  DEFAULT_IMAGE_GENERATION_MODEL_ID,
  buildImageGenerationInput,
  getImageGenerationModelDefinition,
  normalizeImageGenerationModelId,
  resolveAspectRatio,
} from "./models.js";
import { translatePromptToEnglish } from "@/lib/tools/arabicTranslate.server";

const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const POLL_INTERVAL_MS = 1_500;
// Budget for the WHOLE call, `prefer: wait` included. Measured 2026-09-03:
// flux-schnell runs in 4–6s and normally queues for under a tenth of a second,
// but one request sat in a 181s queue — so the ceiling is real and has to be
// bounded, not open-ended.
const TOTAL_TIMEOUT_MS = 90_000;

// Long enough for a paragraph of scene description, short enough that nobody
// pastes a novel into a model that charges per call.
export const MAX_PROMPT_CHARS = 600;

export class ImageGenerationError extends Error {
  status: number;
  code: string;
  constructor(message: string, { status = 500, code = "generation_failed" } = {}) {
    super(message);
    this.name = "ImageGenerationError";
    this.status = status;
    this.code = code;
  }
}

export function normalizePrompt(value: unknown): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    throw new ImageGenerationError("Describe the image you want.", {
      status: 400,
      code: "prompt_required",
    });
  }
  if (text.length > MAX_PROMPT_CHARS) {
    throw new ImageGenerationError(`Keep the description under ${MAX_PROMPT_CHARS} characters.`, {
      status: 400,
      code: "prompt_too_long",
    });
  }
  return text;
}

async function replicateRequest(pathname: string, token: string, init: RequestInit = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${REPLICATE_API_BASE}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    });
    // Replicate throttles back-to-back creates on a low balance; a short wait
    // clears it, and giving up here would surface as a random user-facing error.
    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ImageGenerationError(
        payload?.detail || payload?.title || `Image generation failed (${response.status}).`,
        { status: 502, code: "provider_failed" }
      );
    }
    return payload;
  }
}

async function cancelPrediction(id: string, token: string) {
  try {
    await replicateRequest(`/predictions/${id}/cancel`, token, { method: "POST" });
  } catch {
    // Best-effort: an abandoned prediction still bills for an image nobody gets.
  }
}

export type GeneratedImage = {
  buffer: Buffer;
  mimeType: string;
  model: string;
  provider: string;
  aspectRatio: string;
  promptUsed: string;
  translated: boolean;
  predictionId: string | null;
};

export async function generateImage({
  prompt,
  aspectRatio,
  modelId,
}: {
  prompt: string;
  aspectRatio?: string;
  modelId?: string;
}): Promise<GeneratedImage> {
  const definition =
    getImageGenerationModelDefinition(normalizeImageGenerationModelId(modelId)) ||
    getImageGenerationModelDefinition(DEFAULT_IMAGE_GENERATION_MODEL_ID);
  if (!definition) {
    throw new ImageGenerationError("No image generation model is configured.", {
      status: 500,
      code: "model_unavailable",
    });
  }

  const token = String(process.env.REPLICATE_API_TOKEN || "").trim();
  if (!token) {
    throw new ImageGenerationError("Image generation is not configured.", {
      status: 503,
      code: "provider_unavailable",
    });
  }

  const promptUsed = await translatePromptToEnglish(prompt);
  const resolvedRatio = resolveAspectRatio(definition, aspectRatio);
  const input = buildImageGenerationInput(definition, promptUsed, resolvedRatio);

  // ★Start the clock BEFORE the create. `prefer: wait` holds the connection for
  // up to 60s on its own, so a deadline computed afterwards let a single call
  // run 60 + 120 = 180s — which is exactly what the first end-to-end test hit.
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  const created = await replicateRequest(`/models/${definition.id}/predictions`, token, {
    method: "POST",
    headers: { prefer: "wait" },
    body: JSON.stringify({ input }),
  });

  let current = created;
  while (current.status !== "succeeded") {
    if (current.status === "failed" || current.status === "canceled") {
      throw new ImageGenerationError(current.error || `Prediction ${current.status}.`, {
        status: 502,
        code: "provider_failed",
      });
    }
    if (Date.now() > deadline) {
      await cancelPrediction(current.id, token);
      throw new ImageGenerationError("The model is busy. Please try again.", {
        status: 504,
        code: "provider_timeout",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    current = await replicateRequest(`/predictions/${current.id}`, token);
  }

  const outputUrl = Array.isArray(current.output) ? current.output[0] : current.output;
  if (typeof outputUrl !== "string" || !outputUrl) {
    throw new ImageGenerationError("The model returned no image.", {
      status: 502,
      code: "provider_empty",
    });
  }

  const imageResponse = await fetch(outputUrl);
  if (!imageResponse.ok) {
    throw new ImageGenerationError("Could not download the generated image.", {
      status: 502,
      code: "download_failed",
    });
  }

  return {
    buffer: Buffer.from(await imageResponse.arrayBuffer()),
    mimeType: imageResponse.headers.get("content-type") || "image/png",
    model: definition.id,
    provider: definition.provider,
    aspectRatio: resolvedRatio,
    promptUsed,
    translated: promptUsed !== prompt,
    predictionId: current.id || null,
  };
}
