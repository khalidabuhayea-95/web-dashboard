import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";
import { MEDIA_CREDIT_FEATURES } from "@/lib/media/credits/config.js";
import { enforceMediaCredits, recordMediaUsage } from "@/lib/media/credits/index.server";
import {
  checkRateLimit,
  createRateLimitResponse,
} from "@/lib/security/rateLimit.server";
import {
  TashkeelError,
  diacritizeArabicText,
  normalizeTashkeelInput,
} from "@/lib/text/tashkeel/index.server";

export const runtime = "nodejs";
export const maxDuration = 60;

const logger = createLogger("api.mobile.text.tashkeel");
// Text is cheap to run but a user can hammer it while typing, so the window is
// wider than the image tools'.
const TASHKEEL_LIMIT = {
  limit: 30,
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
      scope: "api:mobile:text:tashkeel",
      identifier: mobileUser.id,
      limit: TASHKEEL_LIMIT.limit,
      windowMs: TASHKEEL_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return attachRequestIdHeader(
        createRateLimitResponse(
          "Too many diacritization requests. Please retry shortly.",
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

    const text = normalizeTashkeelInput((body as { text?: unknown }).text);

    const insufficientCredits = await enforceMediaCredits({
      mobileUserId: mobileUser.id,
      feature: MEDIA_CREDIT_FEATURES.TASHKEEL,
    });
    if (insufficientCredits) {
      return attachRequestIdHeader(insufficientCredits, requestId);
    }

    const result = await diacritizeArabicText(text);

    await recordMediaUsage({
      mobileUserId: mobileUser.id,
      feature: MEDIA_CREDIT_FEATURES.TASHKEEL,
      provider: result.provider,
      model: `selfhost/${result.model}`,
    });

    requestLogger.info("Diacritization completed", {
      mobileUserId: mobileUser.id,
      inputChars: text.length,
      outputChars: result.text.length,
      model: result.model,
      durationMs: Date.now() - startedAt,
    });

    return jsonResponse(requestId, { text: result.text }, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    if (error instanceof TashkeelError) {
      requestLogger.warn("Diacritization rejected", { code: error.code, error: error.message });
      return jsonResponse(requestId, { error: error.message, code: error.code }, error.status, {
        "Cache-Control": "no-store",
      });
    }
    requestLogger.error("Diacritization failed", {
      error: error instanceof Error ? error.message : String(error || ""),
    });
    return jsonResponse(requestId, { error: "Diacritization failed." }, 500, {
      "Cache-Control": "no-store",
    });
  }
}
