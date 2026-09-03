// Apple side of the billing pipeline: verifies StoreKit 2 signed transactions
// (the JWS the app posts to /subscriptions/verify) and App Store Server
// Notifications V2, then flattens both into NormalizedStoreState.
//
// Verification uses Apple's official library with the pinned root CAs from
// appleRootCerts.ts. In APPLE_IAP_ENVIRONMENT=xcode the library itself skips
// the chain check (StoreKit-test transactions are signed by a local Xcode
// certificate that Apple's roots can never vouch for) — that mode exists for
// the simulator dev lane and must never be set in production.

import {
  Environment,
  SignedDataVerifier,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";

import { createLogger } from "@/lib/logging/logger";

import { appleAppAppleId, appleBundleId, appleEnvironment } from "./billingEnv.server";
import { APPLE_ROOT_CA_BASE64 } from "./appleRootCerts";
import { planKeyFromAppleProductId } from "./products";
import type { NormalizedStoreState, StoreEnvironment, SubscriptionStatus } from "./subscriptionState.server";

const logger = createLogger("billing.apple");

let cachedVerifier: SignedDataVerifier | null = null;

function verifier(): SignedDataVerifier {
  if (cachedVerifier) return cachedVerifier;
  const environment =
    appleEnvironment() === "production"
      ? Environment.PRODUCTION
      : appleEnvironment() === "xcode"
        ? Environment.XCODE
        : Environment.SANDBOX;
  const roots = APPLE_ROOT_CA_BASE64.map((cert) => Buffer.from(cert, "base64"));
  // Online (OCSP) checks need outbound reach to Apple on every verify; the
  // certs rotate rarely, so offline chain validation is the sane default.
  cachedVerifier = new SignedDataVerifier(roots, false, environment, appleBundleId(), appleAppAppleId());
  return cachedVerifier;
}

function toEnvironment(value: string | undefined): StoreEnvironment {
  if (value === "Production") return "production";
  if (value === "Xcode" || value === "LocalTesting") return "xcode-test";
  return "sandbox";
}

function isTrial(transaction: JWSTransactionDecodedPayload): boolean {
  const discountType = (transaction as { offerDiscountType?: string }).offerDiscountType;
  if (discountType) return discountType === "FREE_TRIAL";
  // Older payloads only carry offerType; 1 = introductory offer, which for
  // Nayroz Pro is exclusively the yearly free trial.
  return transaction.offerType === 1;
}

function deriveState(
  transaction: JWSTransactionDecodedPayload,
  renewalInfo: JWSRenewalInfoDecodedPayload | null,
  notificationType: string | null,
): NormalizedStoreState {
  const now = Date.now();
  const expiresAt = transaction.expiresDate ? new Date(transaction.expiresDate) : null;
  const graceUntil = renewalInfo?.gracePeriodExpiresDate ? new Date(renewalInfo.gracePeriodExpiresDate) : null;
  const trial = isTrial(transaction);

  let status: SubscriptionStatus;
  let currentPeriodEnd = expiresAt;
  if (transaction.revocationDate || notificationType === "REFUND" || notificationType === "REVOKE") {
    status = "revoked";
  } else if (graceUntil && graceUntil.getTime() > now) {
    status = "grace";
    currentPeriodEnd = graceUntil;
  } else if (expiresAt && expiresAt.getTime() > now) {
    status = renewalInfo && renewalInfo.autoRenewStatus === 0 ? "cancelled" : trial ? "trialing" : "active";
  } else {
    status = "expired";
  }

  return {
    platform: "apple",
    storeKey: String(transaction.originalTransactionId ?? transaction.transactionId ?? ""),
    productId: transaction.productId ?? "",
    planKey: planKeyFromAppleProductId(transaction.productId) ?? "unknown",
    status,
    periodType: trial ? "trial" : "normal",
    currentPeriodEnd,
    autoRenewing: renewalInfo ? renewalInfo.autoRenewStatus === 1 : status !== "expired" && status !== "revoked",
    environment: toEnvironment(transaction.environment as string | undefined),
    userHint: transaction.appAccountToken ?? null,
    notificationType,
    raw: { transaction, renewalInfo },
  };
}

export class AppleVerificationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AppleVerificationError";
  }
}

/** Verifies the signed transaction the mobile app posted and normalizes it. */
export async function verifyAppleTransactionJws(signedTransaction: string): Promise<NormalizedStoreState> {
  let transaction: JWSTransactionDecodedPayload;
  try {
    transaction = await verifier().verifyAndDecodeTransaction(signedTransaction);
  } catch (error) {
    throw new AppleVerificationError("App Store transaction failed verification", error);
  }
  if (!transaction.originalTransactionId && !transaction.transactionId) {
    throw new AppleVerificationError("App Store transaction is missing its transaction id");
  }
  return deriveState(transaction, null, null);
}

export type DecodedAppleNotification = {
  notificationUUID: string;
  notificationType: string;
  subtype: string | null;
  state: NormalizedStoreState | null;
  payload: ResponseBodyV2DecodedPayload;
};

/** Verifies an App Store Server Notification V2 signedPayload and normalizes it. */
export async function decodeAppleNotification(signedPayload: string): Promise<DecodedAppleNotification> {
  let payload: ResponseBodyV2DecodedPayload;
  try {
    payload = await verifier().verifyAndDecodeNotification(signedPayload);
  } catch (error) {
    throw new AppleVerificationError("App Store notification failed verification", error);
  }

  const notificationType = String(payload.notificationType ?? "UNKNOWN");
  let state: NormalizedStoreState | null = null;
  const signedTransactionInfo = payload.data?.signedTransactionInfo;
  if (signedTransactionInfo) {
    try {
      const transaction = await verifier().verifyAndDecodeTransaction(signedTransactionInfo);
      const renewalInfo = payload.data?.signedRenewalInfo
        ? await verifier().verifyAndDecodeRenewalInfo(payload.data.signedRenewalInfo)
        : null;
      state = deriveState(transaction, renewalInfo, notificationType);
    } catch (error) {
      // The outer payload verified, so this is Apple sending something newer
      // than we parse — record the notification, skip the state change.
      logger.warn("Apple notification transaction could not be decoded", {
        notificationType,
        error: String(error),
      });
    }
  }

  return {
    notificationUUID: String(payload.notificationUUID ?? ""),
    notificationType,
    subtype: payload.subtype ? String(payload.subtype) : null,
    state,
    payload,
  };
}
