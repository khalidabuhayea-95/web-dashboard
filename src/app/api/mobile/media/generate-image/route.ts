import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";
import { getMobileAppSettings } from "@/lib/settings/mobileAppSettings.server.js";
import { resolveMobileImageGenerationModel } from "@/lib/settings/mobileAppSettings.js";
import { MEDIA_CREDIT_FEATURES, resolveCreditCost } from "@/lib/media/credits/config.js";
import { enforceMediaCredits, recordMediaUsage, creditBalanceHeaders} from "@/lib/media/credits/index.server";
import {
  ImageGenerationError,
  generateImage,
  normalizePrompt,
} from "@/lib/media/imageGeneration/index.server";
import {
  IMAGE_GENERATION_ASPECT_RATIOS,
  normalizeImageGenerationModelId,
} from "@/lib/media/imageGeneration/models.js";
import {
  checkRateLimit,
  createRateLimitResponse,
} from "@/lib/security/rateLimit.server";

export const runtime = "nodejs";
// The model answers in 4–6s; this is headroom for a slow queue, not a target.
export const maxDuration = 180;

const logger = createLogger("api.mobile.media.generate-image");
// Generation is cheap and people iterate on wording, so the window is wider
// than the image-editing routes' — but it still has to stop a runaway loop.
const GENERATE_LIMIT = {
  limit: 20,
  windowMs: 5 * 60_000,
};

function jsonResponse(
  requestId: string,
  payload: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {}
) {
  return attachRequestIdHeader(NextResponse.json(payload, { status, headers }), requestId);
}

export async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));
  const startedAt = Date.now();

  try {
    const auth = await resolveMobileBearerUser(request);
    if (!auth.ok) {
      return jsonResponse(requestId, { error: auth.error }, auth.status, {
        "Cache-Control": "no-store",
      });
    }
    const mobileUser = auth.mobileUser;

    const rateLimitState = checkRateLimit({
      scope: "api:mobile:media:generate-image",
      identifier: mobileUser.id,
      limit: GENERATE_LIMIT.limit,
      windowMs: GENERATE_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return attachRequestIdHeader(
        createRateLimitResponse(
          "Too many image requests. Please retry shortly.",
          rateLimitState
        ),
        requestId
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonResponse(requestId, { error: "Invalid JSON body." }, 400, {
        "Cache-Control": "no-store",
      });
    }

    const prompt = normalizePrompt((body as { prompt?: unknown }).prompt);
    const aspectRatio = String((body as { aspectRatio?: unknown }).aspectRatio || "").trim();
    if (aspectRatio && !IMAGE_GENERATION_ASPECT_RATIOS.includes(aspectRatio)) {
      return jsonResponse(
        requestId,
        { error: "Unsupported aspect ratio.", code: "bad_aspect_ratio" },
        400,
        { "Cache-Control": "no-store" }
      );
    }
    // Precedence: an explicit (valid) model on the request, else whatever the
    // admin picked on the AI settings page, else the registry default. An
    // unknown id from a stale build falls through instead of failing the call.
    const settings = await getMobileAppSettings();
    const modelId =
      normalizeImageGenerationModelId((body as { model?: unknown }).model) ||
      resolveMobileImageGenerationModel(settings);

    const insufficientCredits = await enforceMediaCredits({
      mobileUserId: mobileUser.id,
      feature: MEDIA_CREDIT_FEATURES.IMAGE_GENERATION,
    });
    if (insufficientCredits) {
      requestLogger.info("Image generation rejected: insufficient credits", {
        mobileUserId: mobileUser.id,
      });
      return attachRequestIdHeader(insufficientCredits, requestId);
    }

    const result = await generateImage({ prompt, aspectRatio, modelId });

    // The app shows "N credits used" from this header, same as the AI Tools run
    // route. Read the configured cost rather than hard-coding the default.
    const chargedCredits = resolveCreditCost(
      settings,
      MEDIA_CREDIT_FEATURES.IMAGE_GENERATION
    );

    await recordMediaUsage({
      mobileUserId: mobileUser.id,
      feature: MEDIA_CREDIT_FEATURES.IMAGE_GENERATION,
      provider: result.provider,
      model: result.model,
    });

    // The wallet AFTER this run, so the app updates its shared balance from this very
    // response instead of asking again (2026-09-08 direction).
    const creditHeaders = await creditBalanceHeaders({
      mobileUserId: mobileUser.id,
      feature: MEDIA_CREDIT_FEATURES.IMAGE_GENERATION,
    });

    requestLogger.info("Image generation completed", {
      mobileUserId: mobileUser.id,
      model: result.model,
      aspectRatio: result.aspectRatio,
      translated: result.translated,
      promptChars: prompt.length,
      outputBytes: result.buffer.length,
      durationMs: Date.now() - startedAt,
    });

    return attachRequestIdHeader(
      new NextResponse(new Uint8Array(result.buffer), {
        status: 200,
        headers: {
          ...creditHeaders,

          "Content-Type": result.mimeType,
          "Content-Disposition": 'inline; filename="generated.png"',
          "Cache-Control": "no-store",
          "X-Generation-Model": result.model,
          "X-Generation-Aspect-Ratio": result.aspectRatio,
          "X-Credits-Charged": String(chargedCredits),
        },
      }),
      requestId
    );
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      requestLogger.warn("Image generation rejected", { code: error.code, error: error.message });
      return jsonResponse(requestId, { error: error.message, code: error.code }, error.status, {
        "Cache-Control": "no-store",
      });
    }
    requestLogger.error("Image generation failed", {
      error: error instanceof Error ? error.message : String(error || ""),
    });
    return jsonResponse(requestId, { error: "Image generation failed." }, 500, {
      "Cache-Control": "no-store",
    });
  }
}
