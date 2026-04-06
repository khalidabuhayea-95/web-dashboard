import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { verifyMobileRequest } from "@/lib/mobile/auth";
import { removeObjectFromImage } from "@/lib/media/objectRemoval/index.server";
import {
  createFileTooLargeError,
  isObjectRemovalError,
} from "@/lib/media/objectRemoval/errors";
import { assertReplicateObjectRemovalConfigured } from "@/lib/media/objectRemoval/providers/replicate.server";
import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";

export const runtime = "nodejs";
export const maxDuration = 300;

const logger = createLogger("api.mobile.media.object-remove");
const OBJECT_REMOVE_LIMIT = {
  limit: 6,
  windowMs: 5 * 60_000,
};
const MAX_IMAGE_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_MASK_UPLOAD_BYTES = 10 * 1024 * 1024;

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
    const mobileAuth = verifyMobileRequest(request);
    if (!mobileAuth.ok) {
      return jsonResponse(
        requestId,
        { error: mobileAuth.error || "Unauthorized" },
        401,
        { "Cache-Control": "no-store" }
      );
    }

    const rateLimitState = checkRateLimit({
      scope: "api:mobile:media:object-remove",
      identifier: resolveRequestIp(request) || "anonymous",
      limit: OBJECT_REMOVE_LIMIT.limit,
      windowMs: OBJECT_REMOVE_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return attachRequestIdHeader(
        createRateLimitResponse(
          "Too many object removal requests. Please retry shortly.",
          rateLimitState
        ),
        requestId
      );
    }

    assertReplicateObjectRemovalConfigured();

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return jsonResponse(requestId, { error: "Invalid multipart form data." }, 400, {
        "Cache-Control": "no-store",
      });
    }

    const imageFile = formData.get("image");
    const maskFile = formData.get("mask");
    if (!(imageFile instanceof File)) {
      return jsonResponse(requestId, { error: "Missing image upload." }, 400, {
        "Cache-Control": "no-store",
      });
    }
    if (!(maskFile instanceof File)) {
      return jsonResponse(requestId, { error: "Missing mask upload." }, 400, {
        "Cache-Control": "no-store",
      });
    }

    if (Number(imageFile.size || 0) <= 0 || Number(maskFile.size || 0) <= 0) {
      return jsonResponse(
        requestId,
        { error: "Image and mask uploads must not be empty." },
        400,
        { "Cache-Control": "no-store" }
      );
    }
    if (Number(imageFile.size || 0) > MAX_IMAGE_UPLOAD_BYTES) {
      throw createFileTooLargeError("Image upload is too large.");
    }
    if (Number(maskFile.size || 0) > MAX_MASK_UPLOAD_BYTES) {
      throw createFileTooLargeError("Mask upload is too large.");
    }

    const [imageBytes, maskBytes] = await Promise.all([
      imageFile.arrayBuffer().then((value) => Buffer.from(value)),
      maskFile.arrayBuffer().then((value) => Buffer.from(value)),
    ]);

    const result = await removeObjectFromImage({
      imageBytes,
      imageMimeType: imageFile.type,
      imageFileName: imageFile.name,
      maskBytes,
      maskMimeType: maskFile.type,
      maskFileName: maskFile.name,
    });

    requestLogger.info("Object removal completed", {
      inputMimeType: String(imageFile.type || "").trim().toLowerCase() || null,
      inputBytes: imageBytes.length,
      maskBytes: maskBytes.length,
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
          "Content-Disposition": `inline; filename="${result.fileName || "object-removed.png"}"`,
          "Cache-Control": "no-store",
          "X-Output-Width": String(result.width || ""),
          "X-Output-Height": String(result.height || ""),
          "X-Object-Removal-Provider": String(result.provider || ""),
          "X-Object-Removal-Model": String(result.model || ""),
        },
      }),
      requestId
    );
  } catch (error) {
    const statusCode =
      isObjectRemovalError(error) && Number.isFinite(Number(error.statusCode))
        ? Number(error.statusCode)
        : 500;
    const message =
      isObjectRemovalError(error) && error.expose !== false
        ? error.message
        : "Failed to remove the selected object.";
    requestLogger.error("Object removal failed", error, {
      statusCode,
      durationMs: Date.now() - startedAt,
    });

    return jsonResponse(requestId, { error: message }, statusCode, {
      "Cache-Control": "no-store",
    });
  }
}
