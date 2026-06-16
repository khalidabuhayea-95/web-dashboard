import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";
import { editImageWithPrompt } from "@/lib/media/editImageByPrompt/index.server";
import {
  createFileTooLargeError,
  isEditImageError,
} from "@/lib/media/editImageByPrompt/errors";
import { normalizeEditImageModelId } from "@/lib/media/editImageByPrompt/models.js";
import {
  assertReplicateEditImageConfigured,
  getReplicateDefaultEditImageModelId,
} from "@/lib/media/editImageByPrompt/providers/replicate.server";
import {
  getMobileAppSettings,
  resolveMobileEditImageModel,
} from "@/lib/settings/mobileAppSettings.server";
import {
  checkRateLimit,
  createRateLimitResponse,
} from "@/lib/security/rateLimit.server";

export const runtime = "nodejs";
export const maxDuration = 300;

const logger = createLogger("api.mobile.media.edit-image");
const EDIT_IMAGE_LIMIT = {
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
      requestLogger.warn("Image edit rejected: unauthenticated", {
        reason: auth.reason,
      });
      return jsonResponse(requestId, { error: auth.error }, auth.status, {
        "Cache-Control": "no-store",
      });
    }
    const mobileUser = auth.mobileUser;

    const rateLimitState = checkRateLimit({
      scope: "api:mobile:media:edit-image",
      identifier: mobileUser.id,
      limit: EDIT_IMAGE_LIMIT.limit,
      windowMs: EDIT_IMAGE_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return attachRequestIdHeader(
        createRateLimitResponse(
          "Too many image edit requests. Please retry shortly.",
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

    // Per-request `model` (the selector) wins; otherwise use the admin-configured
    // model from mobile app settings, falling back to the env/default model.
    const requestedModel = normalizeEditImageModelId(formData.get("model"));
    const adminModel = resolveMobileEditImageModel(await getMobileAppSettings(), {
      defaultEditImageModel: getReplicateDefaultEditImageModelId(),
    });
    const configuredModel = requestedModel || adminModel;

    assertReplicateEditImageConfigured(configuredModel);

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

    const promptValue = formData.get("prompt");
    const prompt = typeof promptValue === "string" ? promptValue : "";
    if (!prompt.trim()) {
      return jsonResponse(
        requestId,
        { error: "A text prompt describing the edit is required." },
        400,
        { "Cache-Control": "no-store" }
      );
    }

    const imageBytes = await imageFile.arrayBuffer().then((value) => Buffer.from(value));

    const result = await editImageWithPrompt({
      imageBytes,
      imageMimeType: imageFile.type,
      imageFileName: imageFile.name,
      prompt,
      modelId: configuredModel,
    });

    requestLogger.info("Image edit completed", {
      mobileUserId: mobileUser.id,
      inputMimeType: String(imageFile.type || "").trim().toLowerCase() || null,
      inputBytes: imageBytes.length,
      inputWidth: result.inputWidth || null,
      inputHeight: result.inputHeight || null,
      promptLength: result.prompt.length,
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
          "Content-Disposition": `inline; filename="${result.fileName || "edited-image.png"}"`,
          "Cache-Control": "no-store",
          "X-Output-Width": String(result.width || ""),
          "X-Output-Height": String(result.height || ""),
          "X-Image-Edit-Provider": String(result.provider || ""),
          "X-Image-Edit-Model": String(result.model || ""),
        },
      }),
      requestId
    );
  } catch (error) {
    const statusCode =
      isEditImageError(error) && Number.isFinite(Number(error.statusCode))
        ? Number(error.statusCode)
        : 500;
    const message =
      isEditImageError(error) && error.expose !== false
        ? error.message
        : "Failed to edit the image.";

    requestLogger.error("Image edit failed", error, {
      statusCode,
      durationMs: Date.now() - startedAt,
    });

    return jsonResponse(requestId, { error: message }, statusCode, {
      "Cache-Control": "no-store",
    });
  }
}
