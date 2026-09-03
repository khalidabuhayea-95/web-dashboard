// Reads a user's effective subscription tier from the denormalized fields on
// MobileUser. The billing pipeline (webhooks + /subscriptions/verify) keeps
// those fields current, but webhook delivery is best-effort — Apple and Pub/Sub
// both stop retrying eventually — so an expiry that slipped past us must not
// leave the account entitled forever. Hence the lazy guard: a "plus" row whose
// subscriptionExpiresAt is more than EXPIRY_GRACE_MS in the past counts as free.
//
// The grace window exists for the opposite failure: a renewal that happened on
// the store but whose webhook hasn't landed yet. Store billing retries and our
// webhook lag both fit comfortably inside a day.

export const SUBSCRIPTION_TIERS = {
  FREE: "free",
  PLUS: "plus",
  PRO: "pro",
} as const;

export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[keyof typeof SUBSCRIPTION_TIERS];

const EXPIRY_GRACE_MS = 24 * 60 * 60 * 1000;

export function resolveUserTier(
  user: { subscriptionTier?: string | null; subscriptionExpiresAt?: Date | string | null } | null | undefined,
  now: Date = new Date(),
): SubscriptionTier {
  const stored =
    user?.subscriptionTier === SUBSCRIPTION_TIERS.PLUS || user?.subscriptionTier === SUBSCRIPTION_TIERS.PRO
      ? user.subscriptionTier
      : null;
  if (!stored) return SUBSCRIPTION_TIERS.FREE;
  const expiresAt = user?.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null;
  // No recorded expiry on a paid row means a lifetime/manual grant — honor it.
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return stored;
  return expiresAt.getTime() + EXPIRY_GRACE_MS > now.getTime() ? stored : SUBSCRIPTION_TIERS.FREE;
}
