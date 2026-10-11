import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { serviceUnavailableResponseFor } from "@/lib/api/infrastructureErrors";
import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";
import { MEDIA_CREDIT_FEATURES } from "@/lib/media/credits/config.js";
import { runPaidMediaOperation } from "@/lib/media/credits/paidRun.server";
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
// Refund and give up a little before the platform would kill the request.
const RUN_TIMEOUT_MS = (maxDuration - 5) * 1000;

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
      return jsonResponse(requestId, { error: auth.error, ...(auth.code ? { code: auth.code } : {}) }, auth.status, {
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

    // Credits are reserved atomically before the worker runs and refunded if it fails, times out,
    // or the client leaves before the text is delivered; an Idempotency-Key retry replays instead
    // of charging again (production audit H-13). The wallet AFTER this run rides the response as
    // X-Credits-* (2026-09-08 direction).
    const response = await runPaidMediaOperation({
      request,
      logger: requestLogger,
      mobileUserId: mobileUser.id,
      feature: MEDIA_CREDIT_FEATURES.TASHKEEL,
      idempotencyScope: "text:tashkeel",
      // The text is what was asked for; only its digest is kept.
      fingerprint: createHash("sha256").update(text).digest("hex").slice(0, 16),
      timeoutMs: RUN_TIMEOUT_MS,
      execute: () => diacritizeArabicText(text),
      respond: (result) => {
        requestLogger.info("Diacritization completed", {
          mobileUserId: mobileUser.id,
          inputChars: text.length,
          outputChars: result.text.length,
          model: result.model,
          durationMs: Date.now() - startedAt,
        });
        return {
          usage: { provider: result.provider, model: `selfhost/${result.model}` },
          headers: { "Content-Type": "application/json" },
          body: new TextEncoder().encode(JSON.stringify({ text: result.text })),
        };
      },
    });
    return attachRequestIdHeader(response, requestId);
  } catch (error) {
    const unavailable = serviceUnavailableResponseFor(error);
    if (unavailable) {
      requestLogger.error("Diacritization failed: service unavailable", error, {
        durationMs: Date.now() - startedAt,
      });
      return attachRequestIdHeader(unavailable, requestId);
    }
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
