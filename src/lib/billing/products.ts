// The Nayroz Plus / Nayroz Pro product catalog — the one place that knows the store product
// identifiers. Pure module (no server imports) so both the webhook processor
// and tests can use it, and so the mobile OpenAPI schema can echo the ids.
//
// App Store: two auto-renewable products in one subscription group.
// Play: one subscription with two base plans; our canonical productId is
// "subscriptionId:basePlanId", the same shape Play uses in offer references.

export const PLUS_ENTITLEMENT = "plus" as const;
export const PRO_ENTITLEMENT = "pro" as const;

export const APPLE_PLUS_PRODUCT_IDS = {
  monthly: "nayroz_plus_monthly",
  yearly: "nayroz_plus_yearly",
} as const;

// Nayroz Pro — same two periods, 5x the AI allowance. Separate subscription
// group member on the App Store, separate subscription on Play, so upgrade and
// downgrade run through the stores' own flows. ★Its YEARLY plan carries the
// same 3-day intro offer as Plus's: the paywall advertises a trial on both, so
// both must exist in the consoles or the app promises one the store won't give.
export const APPLE_PRO_PRODUCT_IDS = {
  monthly: "nayroz_pro_monthly",
  yearly: "nayroz_pro_yearly",
} as const;

export const PLAY_PLUS_SUBSCRIPTION_ID = "nayroz_plus" as const;
export const PLAY_PRO_SUBSCRIPTION_ID = "nayroz_pro" as const;

export const PLAY_BASE_PLAN_IDS = {
  monthly: "monthly",
  yearly: "yearly",
} as const;

/** Offer tag set on the Play yearly free-trial offer so the server can label trials. */
export const PLAY_TRIAL_OFFER_TAG = "free-trial" as const;

export type PlanKey = "monthly" | "yearly";

export type PaidEntitlement = typeof PLUS_ENTITLEMENT | typeof PRO_ENTITLEMENT;

export function planKeyFromAppleProductId(productId: string | null | undefined): PlanKey | null {
  if (productId === APPLE_PLUS_PRODUCT_IDS.monthly || productId === APPLE_PRO_PRODUCT_IDS.monthly) return "monthly";
  if (productId === APPLE_PLUS_PRODUCT_IDS.yearly || productId === APPLE_PRO_PRODUCT_IDS.yearly) return "yearly";
  return null;
}

export function planKeyFromPlayBasePlan(basePlanId: string | null | undefined): PlanKey | null {
  if (basePlanId === PLAY_BASE_PLAN_IDS.monthly) return "monthly";
  if (basePlanId === PLAY_BASE_PLAN_IDS.yearly) return "yearly";
  return null;
}

/**
 * Which paid tier a store product grants. Canonical Play ids arrive as
 * "subscriptionId:basePlanId", so the Play half matches on the prefix.
 * Unknown products default to PLUS, the entry tier: a mis-mapped product must
 * never grant MORE than the buyer paid for.
 */
export function entitlementForProductId(productId: string | null | undefined): PaidEntitlement {
  const id = String(productId || "");
  if (
    id === APPLE_PRO_PRODUCT_IDS.monthly ||
    id === APPLE_PRO_PRODUCT_IDS.yearly ||
    id === PLAY_PRO_SUBSCRIPTION_ID ||
    id.startsWith(`${PLAY_PRO_SUBSCRIPTION_ID}:`)
  ) {
    return PRO_ENTITLEMENT;
  }
  return PLUS_ENTITLEMENT;
}

export function playCanonicalProductId(subscriptionId: string, basePlanId: string | null | undefined): string {
  return basePlanId ? `${subscriptionId}:${basePlanId}` : subscriptionId;
}
