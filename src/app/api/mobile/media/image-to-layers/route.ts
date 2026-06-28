import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";
import { imageToEditableLayers } from "@/lib/media/imageToLayers/pipeline.server";
import {
  createFileTooLargeError,
  isImageToLayersError,
} from "@/lib/media/imageToLayers/errors";
import {
  assertReplicateImageToLayersConfigured,
  getReplicateDefaultImageToLayersModelId,
} from "@/lib/media/imageToLayers/providers/replicate.server";
import { normalizeImageToLayersModelId } from "@/lib/media/imageToLayers/models.js";
import {
  checkRateLimit,
  createRateLimitResponse,
} from "@/lib/security/rateLimit.server";

export const runtime = "nodejs";
export const maxDuration = 300;

const logger = createLogger("api.mobile.media.image-to-layers");
const IMAGE_TO_LAYERS_LIMIT = {
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
      requestLogger.warn("Image layering rejected: unauthenticated", {
        reason: auth.reason,
      });
      return jsonResponse(requestId, { error: auth.error }, auth.status, {
        "Cache-Control": "no-store",
      });
    }
    const mobileUser = auth.mobileUser;

    const rateLimitState = checkRateLimit({
      scope: "api:mobile:media:image-to-layers",
      identifier: mobileUser.id,
      limit: IMAGE_TO_LAYERS_LIMIT.limit,
      windowMs: IMAGE_TO_LAYERS_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return attachRequestIdHeader(
        createRateLimitResponse(
          "Too many image layering requests. Please retry shortly.",
          rateLimitState
        ),
        requestId
      );
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return jsonResponse(requestId, { error: "Invalid multipart form data." }, 400, {
        "Cache-Control": "no-store",
      });
    }

    const requestedModel = normalizeImageToLayersModelId(formData.get("model"));
    const selectedModel = requestedModel || getReplicateDefaultImageToLayersModelId();
    assertReplicateImageToLayersConfigured(selectedModel);

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

    // Default on; clients can pass includeText=false for movable-only layers.
    const includeTextRaw = formData.get("includeText");
    const includeText =
      includeTextRaw === null
        ? true
        : !["false", "0", "no", "off"].includes(String(includeTextRaw).trim().toLowerCase());

    const imageBytes = Buffer.from(await imageFile.arrayBuffer());

    const { canvasWidth, canvasHeight, sourceWidth, sourceHeight, layers, meta } =
      await imageToEditableLayers({
        imageBytes,
        imageMimeType: imageFile.type,
        imageFileName: imageFile.name,
        modelId: selectedModel,
        includeText,
      });

    requestLogger.info("Image layering completed", {
      mobileUserId: mobileUser.id,
      inputMimeType: String(imageFile.type || "").trim().toLowerCase() || null,
      inputBytes: imageBytes.length,
      layerCount: meta.layerCount,
      canvasWidth,
      canvasHeight,
      textBlockCount: meta.textBlockCount,
      textRemoved: meta.textRemoved,
      provider: meta.provider,
      model: meta.model,
      predictionId: meta.predictionId,
      durationMs: Date.now() - startedAt,
    });

    return jsonResponse(
      requestId,
      { canvasWidth, canvasHeight, sourceWidth, sourceHeight, layers, meta },
      200,
      { "Cache-Control": "no-store" }
    );
  } catch (error) {
    const statusCode =
      isImageToLayersError(error) && Number.isFinite(Number(error.statusCode))
        ? Number(error.statusCode)
        : 500;
    const message =
      isImageToLayersError(error) && error.expose !== false
        ? error.message
        : "Failed to decompose the image into layers.";
    requestLogger.error("Image layering failed", error, {
      statusCode,
      durationMs: Date.now() - startedAt,
    });

    return jsonResponse(requestId, { error: message }, statusCode, {
      "Cache-Control": "no-store",
    });
  }
}
