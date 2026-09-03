// Google side of the billing pipeline. A Play purchase reaches us as a purchase
// token (from the app's /subscriptions/verify call or an RTDN nudge); the token
// itself proves nothing, so the server always asks the Play Developer API for
// the authoritative state (purchases.subscriptionsv2.get) and normalizes that.
// RTDN messages deliberately carry no state — every notification type funnels
// into the same refetch.
//
// Auth is a service-account JWT (google-auth-library) with the androidpublisher
// scope. Acknowledgement: Google refunds unacknowledged purchases after 3 days,
// so after granting entitlement we acknowledge server-side (the v1 endpoint —
// v2 has no acknowledge method).

import { JWT } from "google-auth-library";

import { createLogger } from "@/lib/logging/logger";

import { playPackageName, playServiceAccount } from "./billingEnv.server";
import { PLAY_TRIAL_OFFER_TAG, planKeyFromPlayBasePlan, playCanonicalProductId } from "./products";
import type { NormalizedStoreState, SubscriptionStatus } from "./subscriptionState.server";

const logger = createLogger("billing.google");

const ANDROID_PUBLISHER_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";

let cachedClient: JWT | null = null;

export class GoogleVerificationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "GoogleVerificationError";
  }
}

function client(): JWT {
  if (cachedClient) return cachedClient;
  const account = playServiceAccount();
  if (!account) {
    throw new GoogleVerificationError("PLAY_SERVICE_ACCOUNT_JSON is not configured");
  }
  cachedClient = new JWT({
    email: account.client_email,
    key: account.private_key,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  return cachedClient;
}

type SubscriptionPurchaseV2 = {
  subscriptionState?: string;
  linkedPurchaseToken?: string;
  acknowledgementState?: string;
  testPurchase?: object;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
    offerDetails?: { basePlanId?: string; offerId?: string; offerTags?: string[] };
  }>;
};

function mapStatus(subscriptionState: string | undefined, trial: boolean): SubscriptionStatus {
  switch (subscriptionState) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      return trial ? "trialing" : "active";
    case "SUBSCRIPTION_STATE_CANCELED":
      return "cancelled";
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      return "grace";
    case "SUBSCRIPTION_STATE_ON_HOLD":
      return "hold";
    case "SUBSCRIPTION_STATE_PAUSED":
      return "paused";
    case "SUBSCRIPTION_STATE_EXPIRED":
      return "expired";
    // PENDING = payment not completed yet (e.g. pending cash payment). No
    // access yet, may still complete — hold is the closest non-entitled state.
    case "SUBSCRIPTION_STATE_PENDING":
      return "hold";
    default:
      return "expired";
  }
}

type PlayLineItem = NonNullable<SubscriptionPurchaseV2["lineItems"]>[number];

function normalize(purchaseToken: string, purchase: SubscriptionPurchaseV2): NormalizedStoreState {
  // A plan change can leave two line items; the one expiring last is current.
  const lineItem = (purchase.lineItems ?? []).reduce<PlayLineItem | null>((latest, item) => {
    if (!latest) return item;
    const a = latest.expiryTime ? Date.parse(latest.expiryTime) : 0;
    const b = item.expiryTime ? Date.parse(item.expiryTime) : 0;
    return b > a ? item : latest;
  }, null);
  const offer = lineItem?.offerDetails;
  const trial = Boolean(offer?.offerTags?.includes(PLAY_TRIAL_OFFER_TAG));
  const status = mapStatus(purchase.subscriptionState, trial);
  const expiryTime = lineItem?.expiryTime ? new Date(lineItem.expiryTime) : null;

  return {
    platform: "google",
    storeKey: purchaseToken,
    linkedPurchaseToken: purchase.linkedPurchaseToken ?? null,
    productId: playCanonicalProductId(lineItem?.productId ?? "", offer?.basePlanId),
    planKey: planKeyFromPlayBasePlan(offer?.basePlanId) ?? "unknown",
    status,
    periodType: trial ? "trial" : "normal",
    currentPeriodEnd: expiryTime && !Number.isNaN(expiryTime.getTime()) ? expiryTime : null,
    autoRenewing: lineItem?.autoRenewingPlan?.autoRenewEnabled ?? status === "active",
    environment: purchase.testPurchase ? "sandbox" : "production",
    userHint: purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    notificationType: null,
    raw: purchase,
  };
}

/**
 * Fetches and normalizes the authoritative state for a purchase token, then
 * acknowledges the purchase when Google is still waiting for it. Acknowledge
 * failures are logged, not thrown — RTDN retries land here again.
 */
export async function fetchGoogleSubscriptionState(purchaseToken: string): Promise<NormalizedStoreState> {
  const packageName = playPackageName();
  const url = `${ANDROID_PUBLISHER_BASE}/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  let purchase: SubscriptionPurchaseV2;
  try {
    const response = await client().request<SubscriptionPurchaseV2>({ url });
    purchase = response.data ?? {};
  } catch (error) {
    throw new GoogleVerificationError("Play subscription lookup failed", error);
  }

  const state = normalize(purchaseToken, purchase);

  if (purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
    const subscriptionId = state.productId.split(":")[0];
    if (subscriptionId) {
      try {
        await client().request({
          url: `${ANDROID_PUBLISHER_BASE}/applications/${encodeURIComponent(packageName)}/purchases/subscriptions/${encodeURIComponent(subscriptionId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
          method: "POST",
          data: {},
        });
      } catch (error) {
        logger.warn("Play acknowledge failed; will retry on next notification", {
          subscriptionId,
          error: String(error),
        });
      }
    }
  }

  return state;
}

export type DecodedRtdnMessage = {
  messageId: string;
  purchaseToken: string | null;
  subscriptionId: string | null;
  notificationType: number | null;
  isTestNotification: boolean;
  payload: unknown;
};

/**
 * Unwraps a Pub/Sub push envelope into the developer notification inside it.
 * Throws on envelopes that are not RTDN at all; returns purchaseToken null for
 * RTDN types we do not act on (test pings, voided-purchase, one-time products).
 */
export function decodeRtdnMessage(body: unknown): DecodedRtdnMessage {
  const envelope = body as { message?: { data?: string; messageId?: string } } | null;
  const data = envelope?.message?.data;
  if (!data) throw new GoogleVerificationError("Pub/Sub envelope has no message data");
  let decoded: {
    packageName?: string;
    subscriptionNotification?: { purchaseToken?: string; subscriptionId?: string; notificationType?: number };
    testNotification?: object;
  };
  try {
    decoded = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch (error) {
    throw new GoogleVerificationError("RTDN payload is not valid base64 JSON", error);
  }
  if (decoded.packageName && decoded.packageName !== playPackageName()) {
    throw new GoogleVerificationError(`RTDN is for another package: ${decoded.packageName}`);
  }
  return {
    messageId: String(envelope?.message?.messageId ?? ""),
    purchaseToken: decoded.subscriptionNotification?.purchaseToken ?? null,
    subscriptionId: decoded.subscriptionNotification?.subscriptionId ?? null,
    notificationType: decoded.subscriptionNotification?.notificationType ?? null,
    isTestNotification: Boolean(decoded.testNotification),
    payload: decoded,
  };
}
