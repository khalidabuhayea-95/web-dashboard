import { NextRequest, NextResponse } from "next/server";

import { AppleVerificationError, verifyAppleTransactionJws } from "@/lib/billing/appleVerifier.server";
import { GoogleVerificationError, fetchGoogleSubscriptionState } from "@/lib/billing/googleVerifier.server";
import {
  ReceiptOwnedByAnotherUserError,
  applyStoreState,
  getSubscriptionStatus,
  type NormalizedStoreState,
} from "@/lib/billing/subscriptionState.server";
import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";
import { checkRateLimit, createRateLimitResponse } from "@/lib/security/rateLimit.server";

export const runtime = "nodejs";

const logger = createLogger("api.mobile.subscriptions.verify");

// Purchases and restores are rare per user; anything past this is a probe.
const VERIFY_LIMIT = { limit: 12, windowMs: 5 * 60_000 };

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Registers a store purchase with the backend. The app calls this right after a
 * StoreKit/Play purchase or restore, posting the store's proof:
 *   { platform: "apple",  payload: <signed transaction JWS> }
 *   { platform: "google", payload: <purchase token> }
 * The server re-verifies with the store (never trusts the client), links the
 * subscription to the calling account, updates the denormalized tier, and
 * returns the same body as GET /subscriptions/status.
 */
export async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));

  try {
    const auth = await resolveMobileBearerUser(request);
    if (!auth.ok) {
      return attachRequestIdHeader(
        NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE }),
        requestId
      );
    }
    const mobileUser = auth.mobileUser;

    const rateLimitState = checkRateLimit({
      scope: "api:mobile:subscriptions:verify",
      identifier: mobileUser.id,
      limit: VERIFY_LIMIT.limit,
      windowMs: VERIFY_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return attachRequestIdHeader(
        createRateLimitResponse("Too many verification attempts. Please retry shortly.", rateLimitState),
        requestId
      );
    }

    let body: { platform?: string; payload?: string };
    try {
      body = await request.json();
    } catch {
      return attachRequestIdHeader(
        NextResponse.json({ error: "Body must be JSON." }, { status: 400, headers: NO_STORE }),
        requestId
      );
    }
    const platform = String(body?.platform ?? "");
    const payload = String(body?.payload ?? "").trim();
    if ((platform !== "apple" && platform !== "google") || !payload) {
      return attachRequestIdHeader(
        NextResponse.json(
          { error: "Expected { platform: \"apple\"|\"google\", payload: string }." },
          { status: 400, headers: NO_STORE }
        ),
        requestId
      );
    }

    let state: NormalizedStoreState;
    try {
      state =
        platform === "apple"
          ? await verifyAppleTransactionJws(payload)
          : await fetchGoogleSubscriptionState(payload);
    } catch (error) {
      if (error instanceof AppleVerificationError || error instanceof GoogleVerificationError) {
        requestLogger.info("Receipt failed store verification", {
          mobileUserId: mobileUser.id,
          platform,
          reason: error.message,
        });
        return attachRequestIdHeader(
          NextResponse.json(
            { error: "The purchase could not be verified with the store.", code: "invalid_receipt" },
            { status: 422, headers: NO_STORE }
          ),
          requestId
        );
      }
      throw error;
    }

    // The store echoes back the account id the purchase was made under
    // (appAccountToken / obfuscatedExternalAccountId). A mismatch means the
    // receipt was minted for a different Nayroz account.
    if (state.userHint && state.userHint.toLowerCase() !== mobileUser.id.toLowerCase()) {
      requestLogger.warn("Receipt carries another account id", {
        mobileUserId: mobileUser.id,
        platform,
      });
      return attachRequestIdHeader(
        NextResponse.json(
          { error: "This purchase belongs to a different account.", code: "receipt_conflict" },
          { status: 409, headers: NO_STORE }
        ),
        requestId
      );
    }

    try {
      const result = await applyStoreState(state, { mobileUserId: mobileUser.id });
      requestLogger.info("Receipt verified", {
        mobileUserId: mobileUser.id,
        platform,
        status: state.status,
        tier: result.tier,
        environment: state.environment,
      });
    } catch (error) {
      if (error instanceof ReceiptOwnedByAnotherUserError) {
        return attachRequestIdHeader(
          NextResponse.json(
            { error: "This purchase belongs to a different account.", code: "receipt_conflict" },
            { status: 409, headers: NO_STORE }
          ),
          requestId
        );
      }
      throw error;
    }

    const status = await getSubscriptionStatus(mobileUser.id);
    return attachRequestIdHeader(NextResponse.json(status, { headers: NO_STORE }), requestId);
  } catch (error) {
    requestLogger.error("Failed to verify purchase", error);
    return attachRequestIdHeader(
      NextResponse.json(
        { error: "Failed to verify the purchase." },
        { status: 500, headers: NO_STORE }
      ),
      requestId
    );
  }
}
