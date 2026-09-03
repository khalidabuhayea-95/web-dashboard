import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { playRtdnAuthToken } from "@/lib/billing/billingEnv.server";
import {
  GoogleVerificationError,
  decodeRtdnMessage,
  fetchGoogleSubscriptionState,
} from "@/lib/billing/googleVerifier.server";
import { processStoreNotification } from "@/lib/billing/notificationLedger.server";
import {
  UnattributableReceiptError,
  applyStoreState,
} from "@/lib/billing/subscriptionState.server";
import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";

export const runtime = "nodejs";

const logger = createLogger("api.webhooks.playstore");

function tokenMatches(candidate: string | null): boolean {
  const expected = playRtdnAuthToken();
  if (!expected || !candidate) return false;
  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);
  if (expectedBuffer.length !== candidateBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, candidateBuffer);
}

/**
 * Google Play Real-time Developer Notifications, delivered as a Cloud Pub/Sub
 * push. The push subscription URL carries ?token=<PLAY_RTDN_AUTH> — compared
 * timing-safe here (same pattern as the import-jobs worker route). RTDN bodies
 * carry no purchase state, only a purchase token; the processor refetches the
 * authoritative state from the Play Developer API before applying it.
 *
 * Pub/Sub redelivers on non-2xx; the notification ledger (keyed by messageId)
 * dedupes and retries.
 */
export async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));

  if (!tokenMatches(request.nextUrl.searchParams.get("token"))) {
    requestLogger.warn("Rejected Play RTDN push with a bad or missing token");
    return attachRequestIdHeader(NextResponse.json({ error: "Unauthorized." }, { status: 401 }), requestId);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return attachRequestIdHeader(NextResponse.json({ error: "Body must be JSON." }, { status: 400 }), requestId);
  }

  let message;
  try {
    message = decodeRtdnMessage(body);
  } catch (error) {
    if (error instanceof GoogleVerificationError) {
      requestLogger.warn("Undecodable RTDN push", { reason: error.message });
      // Malformed will stay malformed — acknowledge so Pub/Sub stops resending.
      return attachRequestIdHeader(NextResponse.json({ ok: false, reason: "undecodable" }, { status: 200 }), requestId);
    }
    throw error;
  }

  try {
    const result = await processStoreNotification({
      id: message.messageId,
      platform: "google",
      type:
        message.notificationType !== null
          ? `SUBSCRIPTION_NOTIFICATION_${message.notificationType}`
          : message.isTestNotification
            ? "TEST"
            : "UNKNOWN",
      payload: message.payload,
      process: async () => {
        if (!message.purchaseToken) return "skipped"; // test pings, non-subscription events
        const state = await fetchGoogleSubscriptionState(message.purchaseToken);
        try {
          await applyStoreState(state);
          return "processed";
        } catch (error) {
          if (error instanceof UnattributableReceiptError) {
            requestLogger.info("Play notification had no attributable account yet");
            return "skipped";
          }
          throw error;
        }
      },
    });

    requestLogger.info("Play RTDN handled", {
      notificationType: message.notificationType,
      outcome: result.outcome,
    });
    return attachRequestIdHeader(NextResponse.json({ ok: result.httpStatus === 200 }, { status: result.httpStatus }), requestId);
  } catch (error) {
    requestLogger.error("Play RTDN handling crashed", error);
    return attachRequestIdHeader(NextResponse.json({ error: "Internal error." }, { status: 500 }), requestId);
  }
}
