import { NextRequest, NextResponse } from "next/server";

import { AppleVerificationError, decodeAppleNotification } from "@/lib/billing/appleVerifier.server";
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

const logger = createLogger("api.webhooks.appstore");

/**
 * App Store Server Notifications V2. Authentication IS the JWS signature: the
 * signedPayload must verify against Apple's certificate chain (pinned roots in
 * appleRootCerts.ts) before anything is read from it, so the endpoint needs no
 * shared secret. Apple redelivers on non-2xx — the notification ledger dedupes
 * and retries accordingly.
 *
 * Lives outside /api/mobile on purpose: server-to-server, no bearer, and the
 * mobile OpenAPI coverage checker must not demand a spec entry for it.
 */
export async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));

  let signedPayload: string;
  try {
    const body = await request.json();
    signedPayload = String(body?.signedPayload ?? "");
  } catch {
    return attachRequestIdHeader(NextResponse.json({ error: "Body must be JSON." }, { status: 400 }), requestId);
  }
  if (!signedPayload) {
    return attachRequestIdHeader(
      NextResponse.json({ error: "Missing signedPayload." }, { status: 400 }),
      requestId
    );
  }

  let decoded;
  try {
    decoded = await decodeAppleNotification(signedPayload);
  } catch (error) {
    if (error instanceof AppleVerificationError) {
      requestLogger.warn("Rejected unverifiable App Store notification", { reason: error.message });
      // 401, not 5xx: an unverifiable payload will never verify on redelivery.
      return attachRequestIdHeader(NextResponse.json({ error: "Unverifiable payload." }, { status: 401 }), requestId);
    }
    throw error;
  }

  try {
    const result = await processStoreNotification({
      id: decoded.notificationUUID,
      platform: "apple",
      type: decoded.notificationType,
      // Store the decoded state, not the JWS — replays re-apply state directly.
      payload: {
        notificationType: decoded.notificationType,
        subtype: decoded.subtype,
        state: decoded.state
          ? { ...decoded.state, currentPeriodEnd: decoded.state.currentPeriodEnd?.toISOString() ?? null, raw: undefined }
          : null,
      },
      process: async () => {
        if (!decoded.state) return "skipped"; // TEST pings and unparsed payloads
        try {
          await applyStoreState(decoded.state);
          return "processed";
        } catch (error) {
          if (error instanceof UnattributableReceiptError) {
            // No account carried in the transaction and no known row — nothing
            // to update yet; the /verify call that links it will catch us up.
            requestLogger.info("App Store notification had no attributable account", {
              notificationType: decoded.notificationType,
            });
            return "skipped";
          }
          throw error;
        }
      },
    });

    requestLogger.info("App Store notification handled", {
      notificationType: decoded.notificationType,
      subtype: decoded.subtype,
      outcome: result.outcome,
    });
    return attachRequestIdHeader(NextResponse.json({ ok: result.httpStatus === 200 }, { status: result.httpStatus }), requestId);
  } catch (error) {
    requestLogger.error("App Store notification handling crashed", error);
    return attachRequestIdHeader(NextResponse.json({ error: "Internal error." }, { status: 500 }), requestId);
  }
}
