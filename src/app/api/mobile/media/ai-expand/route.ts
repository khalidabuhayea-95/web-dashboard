import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";
import { expandImageWithAi } from "@/lib/media/aiExpand/index.server";
import {
  createFileTooLargeError,
  createInvalidInputError,
  isAiExpandError,
} from "@/lib/media/aiExpand/errors";
import {
  assertReplicateAiExpandConfigured,
  getReplicateDefaultAiExpandModelId,
} from "@/lib/media/aiExpand/providers/replicate.server";
import {
  getMobileAppSettings,
  resolveMobileAiExpandModel,
} from "@/lib/settings/mobileAppSettings.server";
import {
  checkRateLimit,
  createRateLimitResponse,
} from "@/lib/security/rateLimit.server";

export const runtime = "nodejs";
export const maxDuration = 300;

const logger = createLogger("api.mobile.media.ai-expand");
const AI_EXPAND_LIMIT = {
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

function parseTargetDimension(value: FormDataEntryValue | null, label: string) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isSafeInteger(parsed)) {
    throw createInvalidInputError(`${label} must be an integer.`);
  }
  return parsed;
}

export async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));
  const startedAt = Date.now();

  try {
    const auth = await resolveMobileBearerUser(request);
    if (!auth.ok) {
      requestLogger.warn("AI Expand rejected: unauthenticated", {
        reason: auth.reason,
      });
      return jsonResponse(requestId, { error: auth.error }, auth.status, {
        "Cache-Control": "no-store",
      });
    }
    const mobileUser = auth.mobileUser;

    const rateLimitState = checkRateLimit({
      scope: "api:mobile:media:ai-expand",
      identifier: mobileUser.id,
      limit: AI_EXPAND_LIMIT.limit,
      windowMs: AI_EXPAND_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return attachRequestIdHeader(
        createRateLimitResponse(
          "Too many AI Expand requests. Please retry shortly.",
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

    const defaultModelId = getReplicateDefaultAiExpandModelId();
    const configuredModel = resolveMobileAiExpandModel(await getMobileAppSettings(), {
      defaultAiExpandModel: defaultModelId,
    });

    assertReplicateAiExpandConfigured(configuredModel);

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

    const targetWidth = parseTargetDimension(formData.get("targetWidth"), "targetWidth");
    const targetHeight = parseTargetDimension(formData.get("targetHeight"), "targetHeight");
    const imageBytes = await imageFile.arrayBuffer().then((value) => Buffer.from(value));

    const result = await expandImageWithAi({
      imageBytes,
      imageMimeType: imageFile.type,
      imageFileName: imageFile.name,
      targetWidth,
      targetHeight,
      modelId: configuredModel,
    });

    requestLogger.info("AI Expand completed", {
      mobileUserId: mobileUser.id,
      inputMimeType: String(imageFile.type || "").trim().toLowerCase() || null,
      inputBytes: imageBytes.length,
      targetWidth,
      targetHeight,
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
          "Content-Disposition": `inline; filename="${result.fileName || "expanded-image.png"}"`,
          "Cache-Control": "no-store",
          "X-Output-Width": String(result.width || ""),
          "X-Output-Height": String(result.height || ""),
          "X-AI-Expand-Provider": String(result.provider || ""),
          "X-AI-Expand-Model": String(result.model || ""),
        },
      }),
      requestId
    );
  } catch (error) {
    const statusCode =
      isAiExpandError(error) && Number.isFinite(Number(error.statusCode))
        ? Number(error.statusCode)
        : 500;
    const message =
      isAiExpandError(error) && error.expose !== false
        ? error.message
        : "Failed to expand the selected image.";

    requestLogger.error("AI Expand failed", error, {
      statusCode,
      durationMs: Date.now() - startedAt,
    });

    return jsonResponse(requestId, { error: message }, statusCode, {
      "Cache-Control": "no-store",
    });
  }
}
