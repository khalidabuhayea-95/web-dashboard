import { NextResponse } from "next/server";

import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";
import { removeBackground } from "@/lib/media/backgroundRemoval/index.server";
import { isBackgroundRemovalError } from "@/lib/media/backgroundRemoval/errors";
import { removeRasterBackgroundWithRembg } from "@/lib/media/backgroundRemoval/providers/rembg.server";
import {
  checkRateLimit,
  createRateLimitResponse,
} from "@/lib/security/rateLimit.server";

export const runtime = "nodejs";
export const maxDuration = 180;

const logger = createLogger("api.mobile.media.remove-background");
const REMOVE_BACKGROUND_LIMIT = {
  limit: 10,
  windowMs: 5 * 60_000,
};
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function sanitizeFileName(value) {
  return String(value || "")
    .trim()
    .replace(/^.*[\\/]/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function jsonResponse(requestId, payload, status, headers = {}) {
  return attachRequestIdHeader(
    NextResponse.json(payload, {
      status,
      headers,
    }),
    requestId
  );
}

function isLegacyFallbackEligible(error) {
  if (!isBackgroundRemovalError(error)) return true;
  return !["INVALID_INPUT", "UNSUPPORTED_IMAGE_TYPE", "FILE_TOO_LARGE"].includes(
    String(error.code || "").trim().toUpperCase()
  );
}

async function removeBackgroundForMobile({ bytes, mimeType, fileName }) {
  try {
    const primaryResult = await removeRasterBackgroundWithRembg({
      bytes,
      mimeType,
      fileName,
      source: "mobile-upload",
    });
    return {
      ...primaryResult,
      fallbackUsed: false,
      primaryStrategy: "rembg",
      primaryProvider: primaryResult.provider,
    };
  } catch (error) {
    if (!isLegacyFallbackEligible(error)) {
      throw error;
    }

    const fallbackResult = await removeBackground({
      bytes,
      mimeType,
      fileName,
      source: "mobile-upload",
    });
    return {
      ...fallbackResult,
      fallbackUsed: true,
      primaryStrategy: "rembg",
      primaryProvider: "rembg-python",
      fallbackStrategy: fallbackResult.strategy,
      fallbackProvider: fallbackResult.provider,
      fallbackReason:
        error instanceof Error && error.message ? error.message : "Primary rembg background removal failed.",
      fallbackReasonCode:
        isBackgroundRemovalError(error) && error.code ? String(error.code) : "UNKNOWN_PRIMARY_ERROR",
    };
  }
}

export async function POST(request) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));
  const startedAt = Date.now();

  try {
    const auth = await resolveMobileBearerUser(request);
    if (!auth.ok) {
      requestLogger.warn("Background removal rejected: unauthenticated", {
        reason: auth.reason,
      });
      return jsonResponse(requestId, { error: auth.error }, auth.status, {
        "Cache-Control": "no-store",
      });
    }
    const mobileUser = auth.mobileUser;

    const rateLimitState = checkRateLimit({
      scope: "api:mobile:media:remove-background",
      identifier: mobileUser.id,
      limit: REMOVE_BACKGROUND_LIMIT.limit,
      windowMs: REMOVE_BACKGROUND_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return attachRequestIdHeader(
        createRateLimitResponse(
          "Too many background removal requests. Please retry shortly.",
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

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return jsonResponse(requestId, { error: "Missing file upload." }, 400, {
        "Cache-Control": "no-store",
      });
    }

    const fileSize = Number(file.size || 0);
    if (fileSize <= 0) {
      return jsonResponse(requestId, { error: "Uploaded image is empty." }, 400, {
        "Cache-Control": "no-store",
      });
    }

    if (fileSize > MAX_UPLOAD_BYTES) {
      return jsonResponse(requestId, { error: "Image file is too large." }, 413, {
        "Cache-Control": "no-store",
      });
    }

    const inputBytes = Buffer.from(await file.arrayBuffer());
    const safeFileName = sanitizeFileName(file.name) || "image";
    const result = await removeBackgroundForMobile({
      bytes: inputBytes,
      mimeType: file.type,
      fileName: safeFileName,
    });

    const durationMs = Date.now() - startedAt;
    if (result.fallbackUsed) {
      requestLogger.warn("Primary rembg background removal failed; used legacy fallback", {
        inputMimeType: String(file.type || "").trim().toLowerCase() || null,
        inputBytes: inputBytes.length,
        fallbackProvider: result.fallbackProvider || null,
        fallbackStrategy: result.fallbackStrategy || null,
        primaryProvider: result.primaryProvider || null,
        primaryStrategy: result.primaryStrategy || null,
        fallbackReasonCode: result.fallbackReasonCode || null,
        fallbackReason: result.fallbackReason || null,
        durationMs,
      });
    }
    requestLogger.info("Background removal completed", {
      mobileUserId: mobileUser.id,
      inputMimeType: String(file.type || "").trim().toLowerCase() || null,
      inputBytes: inputBytes.length,
      outputBytes: result.bytes.length,
      width: result.width || null,
      height: result.height || null,
      strategy: result.strategy,
      provider: result.provider,
      fallbackUsed: Boolean(result.fallbackUsed),
      durationMs,
    });

    return attachRequestIdHeader(
      new NextResponse(result.bytes, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `inline; filename=\"${result.fileName || "image-no-bg.png"}\"`,
          "Cache-Control": "no-store",
          "X-Output-Width": String(result.width || ""),
          "X-Output-Height": String(result.height || ""),
          "X-Background-Removal-Strategy": String(result.provider || result.strategy || ""),
        },
      }),
      requestId
    );
  } catch (error) {
    const statusCode =
      isBackgroundRemovalError(error) && Number.isFinite(Number(error.statusCode))
        ? Number(error.statusCode)
        : 500;
    const message =
      isBackgroundRemovalError(error) && error.expose !== false
        ? error.message
        : "Failed to remove image background.";
    requestLogger.error("Background removal failed", error, {
      statusCode,
      durationMs: Date.now() - startedAt,
    });
    return jsonResponse(requestId, { error: message }, statusCode, {
      "Cache-Control": "no-store",
    });
  }
}
