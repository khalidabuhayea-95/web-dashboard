import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";
import { upscaleImageWithAi } from "@/lib/media/imageUpscale/index.server";
import {
  createFileTooLargeError,
  isImageUpscaleError,
} from "@/lib/media/imageUpscale/errors";
import {
  assertReplicateImageUpscaleConfigured,
  getReplicateDefaultImageUpscaleModelId,
} from "@/lib/media/imageUpscale/providers/replicate.server";
import {
  getMobileAppSettings,
  resolveMobileUpscaleModel,
} from "@/lib/settings/mobileAppSettings.server";
import {
  checkRateLimit,
  createRateLimitResponse,
} from "@/lib/security/rateLimit.server";
import { MEDIA_CREDIT_FEATURES } from "@/lib/media/credits/config.js";
import { enforceMediaCredits, recordMediaUsage } from "@/lib/media/credits/index.server";

export const runtime = "nodejs";
export const maxDuration = 300;

const logger = createLogger("api.mobile.media.upscale");
const UPSCALE_LIMIT = {
  limit: 6,
  windowMs: 5 * 60_000,
};
const MAX_IMAGE_UPLOAD_BYTES = 15 * 1024 * 1024;

function jsonResponse(
  requestId: string,
  payload: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {}
) {
  return attachRequestIdHeader(
    NextResponse.json(payload, {
      status,
      headers,
    }),
    requestId
  );
}

export async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));
  const startedAt = Date.now();

  try {
    const auth = await resolveMobileBearerUser(request);
    if (!auth.ok) {
      requestLogger.warn("Image upscale rejected: unauthenticated", {
        reason: auth.reason,
      });
      return jsonResponse(requestId, { error: auth.error }, auth.status, {
        "Cache-Control": "no-store",
      });
    }
    const mobileUser = auth.mobileUser;

    const rateLimitState = checkRateLimit({
      scope: "api:mobile:media:upscale",
      identifier: mobileUser.id,
      limit: UPSCALE_LIMIT.limit,
      windowMs: UPSCALE_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return attachRequestIdHeader(
        createRateLimitResponse(
          "Too many image upscale requests. Please retry shortly.",
          rateLimitState
        ),
        requestId
      );
    }

    const insufficientCredits = await enforceMediaCredits({
      mobileUserId: mobileUser.id,
      feature: MEDIA_CREDIT_FEATURES.UPSCALE,
    });
    if (insufficientCredits) {
      requestLogger.info("Image upscale rejected: insufficient credits", {
        mobileUserId: mobileUser.id,
      });
      return attachRequestIdHeader(insufficientCredits, requestId);
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return jsonResponse(requestId, { error: "Invalid multipart form data." }, 400, {
        "Cache-Control": "no-store",
      });
    }

    const defaultModelId = getReplicateDefaultImageUpscaleModelId();
    const configuredModel = resolveMobileUpscaleModel(await getMobileAppSettings(), {
      defaultUpscaleModel: defaultModelId,
    });

    assertReplicateImageUpscaleConfigured(configuredModel);

    const imageFile = formData.get("image");
    if (!(imageFile instanceof File)) {
      return jsonResponse(requestId, { error: "Missing image upload." }, 400, {
        "Cache-Control": "no-store",
      });
    }

    if (Number(imageFile.size || 0) <= 0) {
      return jsonResponse(requestId, { error: "Image upload must not be empty." }, 400, {
        "Cache-Control": "no-store",
      });
    }

    if (Number(imageFile.size || 0) > MAX_IMAGE_UPLOAD_BYTES) {
      throw createFileTooLargeError("Image upload is too large.");
    }

    const scaleValue = formData.get("scale");
    const imageBytes = await imageFile.arrayBuffer().then((value) => Buffer.from(value));

    const result = await upscaleImageWithAi({
      imageBytes,
      imageMimeType: imageFile.type,
      imageFileName: imageFile.name,
      scale: scaleValue,
      modelId: configuredModel,
    });

    await recordMediaUsage({
      mobileUserId: mobileUser.id,
      feature: MEDIA_CREDIT_FEATURES.UPSCALE,
      provider: result.provider,
      model: result.model,
    });

    requestLogger.info("Image upscale completed", {
      mobileUserId: mobileUser.id,
      inputMimeType: String(imageFile.type || "").trim().toLowerCase() || null,
      inputBytes: imageBytes.length,
      inputWidth: result.inputWidth || null,
      inputHeight: result.inputHeight || null,
      scale: result.scale,
      outputBytes: result.bytes.length,
      width: result.width || null,
      height: result.height || null,
      provider: result.provider,
      model: result.model,
      durationMs: Date.now() - startedAt,
    });

    return attachRequestIdHeader(
      new NextResponse(result.bytes, {
        status: 200,
        headers: {
          "Content-Type": result.mimeType || "image/png",
          "Content-Disposition": `inline; filename="${result.fileName || "upscaled-image.png"}"`,
          "Cache-Control": "no-store",
          "X-Output-Width": String(result.width || ""),
          "X-Output-Height": String(result.height || ""),
          "X-Upscale-Scale": String(result.scale || ""),
          "X-Upscale-Provider": String(result.provider || ""),
          "X-Upscale-Model": String(result.model || ""),
        },
      }),
      requestId
    );
  } catch (error) {
    const statusCode =
      isImageUpscaleError(error) && Number.isFinite(Number(error.statusCode))
        ? Number(error.statusCode)
        : 500;
    const message =
      isImageUpscaleError(error) && error.expose !== false
        ? error.message
        : "Failed to upscale the selected image.";

    requestLogger.error("Image upscale failed", error, {
      statusCode,
      durationMs: Date.now() - startedAt,
    });

    return jsonResponse(requestId, { error: message }, statusCode, {
      "Cache-Control": "no-store",
    });
  }
}
