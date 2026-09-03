// Read + admin-write side of subscriptions for the dashboard.
//
// Deliberately thin: it reports what the billing pipeline already decided and
// offers exactly one write — a MANUAL grant/revoke. It never edits Subscription
// rows, because those mirror the stores and are owned by applyStoreState; a
// dashboard that rewrote them would be overwritten by the next webhook and
// would make the ledger disagree with Apple and Google.
//
// A manual grant therefore writes only MobileUser.subscriptionTier/-ExpiresAt,
// which resolveUserTier honors when no store row exists — the same "lifetime /
// support grant" path the tier resolver already documents.

import prisma from "@/lib/prisma";
import { getMobileAppSettings } from "@/lib/settings/mobileAppSettings.server";
import { normalizeMediaCreditSettings } from "@/lib/media/credits/config";
import { SUBSCRIPTION_TIERS } from "@/lib/billing/subscriptionTier.server";
import { entitlementForProductId } from "@/lib/billing/products";

export const MANUAL_GRANT_TIERS = [SUBSCRIPTION_TIERS.PLUS, SUBSCRIPTION_TIERS.PRO] as const;
export type ManualGrantTier = (typeof MANUAL_GRANT_TIERS)[number];

/** Provider dollars a single credit is allowed to buy — the pricing anchor. */
const CREDIT_COST_USD = 0.0005;
/** The most provider-expensive credit in the catalog (the nano-banana class). */
const WORST_USD_PER_CREDIT = 0.0004;
/** Both stores' small-business commission. */
const STORE_COMMISSION = 0.15;

export type SubscriptionRow = {
  mobileUserId: string;
  email: string | null;
  name: string | null;
  tier: string;
  source: "store" | "manual";
  platform: string | null;
  productId: string | null;
  planKey: string | null;
  status: string | null;
  periodType: string | null;
  environment: string | null;
  autoRenewing: boolean;
  expiresAt: string | null;
  creditAllowance: number | null;
};

/**
 * Everyone with a paid tier, store-backed or manually granted. Sorted by
 * expiry so the ones about to lapse surface first — the rows an admin is
 * usually looking for.
 */
export async function listSubscribers({ limit = 200 } = {}): Promise<SubscriptionRow[]> {
  const users = await prisma.mobileUser.findMany({
    where: { subscriptionTier: { in: [...MANUAL_GRANT_TIERS] } },
    select: {
      id: true,
      email: true,
      name: true,
      subscriptionTier: true,
      subscriptionExpiresAt: true,
      creditAllowance: true,
      subscriptions: {
        select: {
          platform: true,
          productId: true,
          planKey: true,
          status: true,
          periodType: true,
          environment: true,
          autoRenewing: true,
          currentPeriodEnd: true,
        },
        orderBy: { currentPeriodEnd: "desc" },
      },
    },
    orderBy: { subscriptionExpiresAt: "asc" },
    take: limit,
  });

  return users.map((user: any) => {
    // Prefer the row that grants the highest tier, matching how
    // recomputeUserEntitlement picks a winner during an upgrade.
    const rows = user.subscriptions ?? [];
    const active =
      rows.find((row: any) => entitlementForProductId(row.productId) === SUBSCRIPTION_TIERS.PRO) ??
      rows[0] ??
      null;
    return {
      mobileUserId: user.id,
      email: user.email,
      name: user.name,
      tier: user.subscriptionTier,
      source: active ? "store" : "manual",
      platform: active?.platform ?? null,
      productId: active?.productId ?? null,
      planKey: active?.planKey ?? null,
      status: active?.status ?? null,
      periodType: active?.periodType ?? null,
      environment: active?.environment ?? null,
      autoRenewing: active?.autoRenewing ?? false,
      expiresAt: user.subscriptionExpiresAt?.toISOString() ?? null,
      creditAllowance: user.creditAllowance,
    };
  });
}

export type SubscriptionSummary = {
  counts: { free: number; plus: number; pro: number; manual: number };
  allowances: { free: number; plus: number; pro: number };
  /** Credits used this period across every user, for load context. */
  creditsUsedThisPeriod: number;
};

export async function getSubscriptionSummary(periodKey: string): Promise<SubscriptionSummary> {
  const settings = await getMobileAppSettings();
  const credits = normalizeMediaCreditSettings((settings as any)?.mediaCredits);

  const [byTier, manual, usage] = await Promise.all([
    prisma.mobileUser.groupBy({ by: ["subscriptionTier"], _count: true }),
    // A paid tier with no Subscription row at all is a manual grant.
    prisma.mobileUser.count({
      where: {
        subscriptionTier: { in: [...MANUAL_GRANT_TIERS] },
        subscriptions: { none: {} },
      },
    }),
    prisma.mediaUsage.aggregate({ where: { periodKey }, _sum: { credits: true } }),
  ]);

  const countFor = (tier: string) =>
    byTier.find((row: any) => row.subscriptionTier === tier)?._count ?? 0;

  return {
    counts: {
      free: countFor("free"),
      plus: countFor(SUBSCRIPTION_TIERS.PLUS),
      pro: countFor(SUBSCRIPTION_TIERS.PRO),
      manual,
    },
    allowances: {
      free: credits.monthlyAllowance,
      plus: credits.plusMonthlyAllowance,
      pro: credits.proMonthlyAllowance,
    },
    creditsUsedThisPeriod: Number(usage._sum.credits ?? 0),
  };
}

/**
 * Worst-case monthly economics for one package: what the allowance could cost
 * us if a subscriber spent every credit on the priciest tool, against the
 * revenue left after the store's cut.
 *
 * Worst case on purpose — a tier that survives this cannot be sold at a loss
 * no matter how it is used. `priceUsd` is the reference price an admin
 * recorded; the stores remain the source of truth for what is charged.
 */
export function packageEconomics(allowance: number, priceUsd: number | null) {
  const worstCostUsd = allowance * WORST_USD_PER_CREDIT;
  const budgetUsd = allowance * CREDIT_COST_USD;
  if (!priceUsd || priceUsd <= 0) {
    return { worstCostUsd, budgetUsd, netRevenueUsd: null, marginUsd: null, profitable: null };
  }
  const netRevenueUsd = priceUsd * (1 - STORE_COMMISSION);
  return {
    worstCostUsd,
    budgetUsd,
    netRevenueUsd,
    marginUsd: netRevenueUsd - worstCostUsd,
    profitable: netRevenueUsd > worstCostUsd,
  };
}

export class SubscriptionAdminError extends Error {}

/**
 * Grants or revokes a paid tier by hand (support fixes, comps, testing).
 *
 * ★Only touches the denormalized fields. If the user has a live store row the
 * next webhook recomputes from it and overwrites this, so a grant is a stopgap
 * for accounts WITHOUT a store subscription — the UI says so.
 */
export async function setManualSubscription({
  mobileUserId,
  tier,
  expiresAt,
}: {
  mobileUserId: string;
  tier: ManualGrantTier | "free";
  expiresAt: Date | null;
}) {
  const user = await prisma.mobileUser.findUnique({
    where: { id: mobileUserId },
    select: { id: true, subscriptions: { select: { id: true }, take: 1 } },
  });
  if (!user) throw new SubscriptionAdminError("No such mobile user");

  const hasStoreRow = user.subscriptions.length > 0;
  await prisma.mobileUser.update({
    where: { id: mobileUserId },
    data: {
      subscriptionTier: tier,
      subscriptionExpiresAt: tier === "free" ? null : expiresAt,
    },
  });
  return { hasStoreRow };
}
