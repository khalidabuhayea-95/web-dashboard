// The single writer for subscription state. Both stores' inputs — a client
// receipt posted to /api/mobile/subscriptions/verify, an App Store Server
// Notification, a Play RTDN-triggered refetch — are first normalized into
// NormalizedStoreState by the platform verifier, then flow through
// applyStoreState() so every path shares one upsert, one entitlement rule and
// one denormalization step. Nothing else writes Subscription or the
// subscriptionTier fields on MobileUser.

import { createLogger } from "@/lib/logging/logger";
import prisma from "@/lib/prisma";

import { resolveUserTier } from "@/lib/billing/subscriptionTier.server";
import { PRO_ENTITLEMENT, entitlementForProductId } from "@/lib/billing/products";

import { allowSandboxEntitlements } from "./billingEnv.server";
import type { PlanKey } from "./products";

const logger = createLogger("billing.subscriptionState");

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "cancelled" // auto-renew off, paid until period end
  | "grace" // store billing retry with access
  | "hold" // Play account hold — no access
  | "paused" // Play pause — no access
  | "expired"
  | "revoked"; // refund / revoke — access off immediately

export type StoreEnvironment = "production" | "sandbox" | "xcode-test";

export type NormalizedStoreState = {
  platform: "apple" | "google";
  /** Apple originalTransactionId / Google latest purchaseToken. */
  storeKey: string;
  /** Google: the token this purchase replaces (resubscribe/plan change). */
  linkedPurchaseToken?: string | null;
  productId: string;
  planKey: PlanKey | "unknown";
  status: SubscriptionStatus;
  periodType: "trial" | "normal";
  currentPeriodEnd: Date | null;
  autoRenewing: boolean;
  environment: StoreEnvironment;
  /**
   * The MobileUser.id the store carried back to us (Apple appAccountToken,
   * Google obfuscatedExternalAccountId). Lets webhooks attribute a purchase
   * they see before any /verify call.
   */
  userHint?: string | null;
  notificationType?: string | null;
  /** Latest raw store payload, stored for debugging only. */
  raw?: unknown;
};

/** Statuses that keep the user entitled (while currentPeriodEnd is in the future). */
const ENTITLED_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  "active",
  "trialing",
  "cancelled",
  "grace",
]);

export class ReceiptOwnedByAnotherUserError extends Error {
  constructor() {
    super("This purchase is already linked to a different account");
    this.name = "ReceiptOwnedByAnotherUserError";
  }
}

export class UnattributableReceiptError extends Error {
  constructor() {
    super("No account could be resolved for this purchase");
    this.name = "UnattributableReceiptError";
  }
}

function isUuid(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function subscriptionCountsForEntitlement(
  row: { status: string; currentPeriodEnd: Date | null; environment: string },
  now: Date,
): boolean {
  if (!ENTITLED_STATUSES.has(row.status as SubscriptionStatus)) return false;
  if (row.environment !== "production" && !allowSandboxEntitlements()) return false;
  if (!row.currentPeriodEnd) return true; // open-ended grant
  return row.currentPeriodEnd.getTime() > now.getTime();
}

/**
 * Re-derives MobileUser.subscriptionTier/subscriptionExpiresAt from all of the
 * user's Subscription rows and returns whether entitlement flipped. Kept
 * separate so a webhook that voids one row (Google linkedPurchaseToken) still
 * lands on the right answer when a second, newer row exists.
 */
type EntitlementRow = {
  status: string;
  currentPeriodEnd: Date | null;
  environment: string;
  productId: string;
};

async function recomputeUserEntitlement(mobileUserId: string): Promise<{ tierChanged: boolean; tier: string }> {
  const now = new Date();
  const [user, rows]: [
    { subscriptionTier: string; subscriptionExpiresAt: Date | null } | null,
    EntitlementRow[],
  ] = await Promise.all([
    prisma.mobileUser.findUnique({
      where: { id: mobileUserId },
      select: { subscriptionTier: true, subscriptionExpiresAt: true },
    }),
    prisma.subscription.findMany({
      where: { mobileUserId },
      select: { status: true, currentPeriodEnd: true, environment: true, productId: true },
    }),
  ]);
  if (!user) return { tierChanged: false, tier: "free" };

  const entitled = rows.filter((row) => subscriptionCountsForEntitlement(row, now));
  // Highest entitled product wins: a Pro row outranks a lingering Plus row
  // during an upgrade, and the tier never exceeds what some store row grants.
  const tier =
    entitled.length === 0
      ? "free"
      : entitled.some((row) => entitlementForProductId(row.productId) === PRO_ENTITLEMENT)
        ? PRO_ENTITLEMENT
        : "plus";
  // Longest coverage wins; an open-ended row (null end) means no recorded expiry.
  const expiresAt = entitled.some((row) => !row.currentPeriodEnd)
    ? null
    : entitled.reduce(
        (max: Date | null, row) =>
          !max || (row.currentPeriodEnd && row.currentPeriodEnd.getTime() > max.getTime())
            ? row.currentPeriodEnd
            : max,
        null as Date | null,
      );

  const changed =
    user.subscriptionTier !== tier ||
    (user.subscriptionExpiresAt?.getTime() ?? null) !== (expiresAt?.getTime() ?? null);
  if (changed) {
    await prisma.mobileUser.update({
      where: { id: mobileUserId },
      data: { subscriptionTier: tier, subscriptionExpiresAt: expiresAt },
    });
  }
  return { tierChanged: user.subscriptionTier !== tier, tier };
}

/**
 * Nudges the user's devices to refresh their subscription status. Best-effort:
 * a lost push only delays the client until its next foreground refresh.
 */
async function pushSubscriptionUpdated(mobileUserId: string): Promise<void> {
  try {
    const [{ getActiveTokensForUserIds }, { buildFcmMessage, sendToTokens }] = await Promise.all([
      import("@/lib/push/deviceTokens.server"),
      import("@/lib/push/sendPush.server"),
    ]);
    const entries = await getActiveTokensForUserIds([mobileUserId]);
    if (!entries?.length) return;
    const message = buildFcmMessage({ messageType: "data", data: { type: "subscription_updated" } });
    await sendToTokens(entries, message);
  } catch (error) {
    logger.warn("subscription_updated push failed", { mobileUserId, error: String(error) });
  }
}

export type ApplyStoreStateOptions = {
  /**
   * The authenticated caller (verify endpoint). Webhooks omit it and the user
   * is resolved from the existing row or the state's userHint.
   */
  mobileUserId?: string | null;
};

export type ApplyStoreStateResult = {
  mobileUserId: string;
  tier: string;
  tierChanged: boolean;
};

export async function applyStoreState(
  state: NormalizedStoreState,
  options: ApplyStoreStateOptions = {},
): Promise<ApplyStoreStateResult> {
  const existing = await prisma.subscription.findUnique({
    where: { storeKey: state.storeKey },
    select: { id: true, mobileUserId: true },
  });

  // Attribution: an existing row owns the answer; otherwise the authenticated
  // caller; otherwise whatever account id the store carried back to us.
  let mobileUserId = existing?.mobileUserId ?? null;
  if (options.mobileUserId) {
    if (mobileUserId && mobileUserId !== options.mobileUserId) {
      // One receipt, two accounts — the classic shared-receipt abuse. Keep the
      // original owner and refuse the caller.
      throw new ReceiptOwnedByAnotherUserError();
    }
    mobileUserId = options.mobileUserId;
  }
  if (!mobileUserId && isUuid(state.userHint)) {
    const hinted = await prisma.mobileUser.findUnique({
      where: { id: state.userHint },
      select: { id: true },
    });
    mobileUserId = hinted?.id ?? null;
  }
  // A Google resubscribe/plan change mints a new token; when the store carried
  // no account id back, the superseded token's row still knows the owner.
  if (!mobileUserId && state.linkedPurchaseToken) {
    const linked = await prisma.subscription.findUnique({
      where: { storeKey: state.linkedPurchaseToken },
      select: { mobileUserId: true },
    });
    mobileUserId = linked?.mobileUserId ?? null;
  }
  if (!mobileUserId) throw new UnattributableReceiptError();

  const data = {
    mobileUserId,
    platform: state.platform,
    productId: state.productId,
    planKey: state.planKey,
    linkedPurchaseToken: state.linkedPurchaseToken ?? null,
    status: state.status,
    periodType: state.periodType,
    currentPeriodEnd: state.currentPeriodEnd,
    autoRenewing: state.autoRenewing,
    environment: state.environment,
    lastNotificationType: state.notificationType ?? null,
    lastNotificationAt: state.notificationType ? new Date() : undefined,
    raw: state.raw === undefined ? undefined : (state.raw as object),
  };
  await prisma.subscription.upsert({
    where: { storeKey: state.storeKey },
    create: { ...data, storeKey: state.storeKey, lastNotificationAt: data.lastNotificationAt ?? null, raw: (state.raw as object) ?? undefined },
    update: data,
  });

  // A Google resubscribe/plan change issues a new token that supersedes the
  // old one — retire the row it points at so it stops counting.
  if (state.linkedPurchaseToken) {
    await prisma.subscription.updateMany({
      where: { storeKey: state.linkedPurchaseToken, NOT: { storeKey: state.storeKey } },
      data: { status: "expired", autoRenewing: false },
    });
  }

  const { tierChanged, tier } = await recomputeUserEntitlement(mobileUserId);
  if (tierChanged) {
    logger.info("Subscription tier changed", {
      mobileUserId,
      tier,
      platform: state.platform,
      status: state.status,
      notificationType: state.notificationType ?? null,
    });
    await pushSubscriptionUpdated(mobileUserId);
  }
  return { mobileUserId, tier, tierChanged };
}

/**
 * The user-facing status body shared by /subscriptions/status and /verify.
 */
type StatusRow = EntitlementRow & {
  platform: string;
  productId: string;
  planKey: string;
  periodType: string;
  autoRenewing: boolean;
};

export async function getSubscriptionStatus(mobileUserId: string) {
  const now = new Date();
  const [user, rows]: [
    { subscriptionTier: string; subscriptionExpiresAt: Date | null } | null,
    StatusRow[],
  ] = await Promise.all([
    prisma.mobileUser.findUnique({
      where: { id: mobileUserId },
      select: { subscriptionTier: true, subscriptionExpiresAt: true },
    }),
    prisma.subscription.findMany({
      where: { mobileUserId },
      orderBy: { updatedAt: "desc" },
      select: {
        platform: true,
        productId: true,
        planKey: true,
        status: true,
        periodType: true,
        currentPeriodEnd: true,
        autoRenewing: true,
        environment: true,
      },
    }),
  ]);

  const entitledRows = rows.filter((row) => subscriptionCountsForEntitlement(row, now));
  // A Pro row outranks a Plus one while both are entitled (store upgrade).
  const active =
    entitledRows.find((row) => entitlementForProductId(row.productId) === PRO_ENTITLEMENT) ??
    entitledRows[0] ??
    null;
  // Store rows are the primary truth; resolveUserTier keeps manual grants
  // (admin-set tier with no store row) honored, with its own expiry guard.
  const manualTier = resolveUserTier(user, now);
  const tier = active ? entitlementForProductId(active.productId) : manualTier;
  const isSubscribed = tier !== "free";
  return {
    tier,
    isSubscribed,
    expiresAt: active?.currentPeriodEnd?.toISOString() ?? user?.subscriptionExpiresAt?.toISOString() ?? null,
    store: active?.platform ?? null,
    productId: active?.productId ?? null,
    planKey: active?.planKey ?? null,
    willRenew: active ? active.autoRenewing && active.status !== "cancelled" : false,
    periodType: active?.periodType ?? null,
    environment: active?.environment ?? null,
  };
}
