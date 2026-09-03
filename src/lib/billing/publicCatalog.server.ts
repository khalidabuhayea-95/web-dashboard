// The subscription catalog the APP reads: packages, allowances, and dashboard
// prices, served publicly so the paywall can render before any store answers.
//
// ★Role of these prices (2026-09-01 decision): the dashboard is the price
// source for every environment where the store has nothing to say — the
// simulator, dev builds, and any storefront hiccup — and the admin keeps it
// mirroring the App Store / Play consoles. The app still prefers the store's
// own localized price whenever the store returns products, because that is the
// amount the user is actually charged, in their own currency; this catalog is
// the fallback that makes pricing editable from the dashboard with no app
// release, not a replacement for store truth.

import {
  APPLE_PLUS_PRODUCT_IDS,
  APPLE_PRO_PRODUCT_IDS,
  PLUS_ENTITLEMENT,
  PRO_ENTITLEMENT,
  type PaidEntitlement,
  type PlanKey,
} from "@/lib/billing/products";
import { normalizeMediaCreditSettings } from "@/lib/media/credits/config";
import { getMobileAppSettings } from "@/lib/settings/mobileAppSettings.server";

export type CatalogPlan = {
  productId: string;
  planKey: PlanKey;
  /** Whole cents, USD — the dashboard's reference currency. */
  priceCents: number;
  currency: "USD";
  /** Both yearly plans carry the 3-day intro offer (see NayrozPro.storekit). */
  hasFreeTrial: boolean;
};

export type CatalogPackage = {
  package: PaidEntitlement;
  monthlyAllowance: number;
  plans: CatalogPlan[];
};

export type SubscriptionCatalog = { packages: CatalogPackage[] };

export async function buildSubscriptionCatalog(): Promise<SubscriptionCatalog> {
  const settings = await getMobileAppSettings();
  // Same normalizer the credits engine uses — clamped integers, defaults
  // filled, so a half-saved blob cannot produce a zero-price catalog. The
  // normalizer is plain JS, hence the local shape assertion.
  const credits = normalizeMediaCreditSettings(
    (settings as { mediaCredits?: object })?.mediaCredits
  );
  // The normalizer types allowances but leaves the price map as {}.
  const prices = credits.referencePrices as Record<string, number>;

  const plan = (
    productId: string,
    planKey: PlanKey,
    priceKey: string,
    fallbackCents: number,
  ): CatalogPlan => ({
    productId,
    planKey,
    priceCents: Number.isFinite(prices[priceKey]) ? Number(prices[priceKey]) : fallbackCents,
    currency: "USD",
    hasFreeTrial: planKey === "yearly",
  });

  return {
    packages: [
      {
        package: PLUS_ENTITLEMENT,
        monthlyAllowance: credits.plusMonthlyAllowance,
        plans: [
          plan(APPLE_PLUS_PRODUCT_IDS.yearly, "yearly", "plus_yearly", 3_999),
          plan(APPLE_PLUS_PRODUCT_IDS.monthly, "monthly", "plus_monthly", 499),
        ],
      },
      {
        package: PRO_ENTITLEMENT,
        monthlyAllowance: credits.proMonthlyAllowance,
        plans: [
          plan(APPLE_PRO_PRODUCT_IDS.yearly, "yearly", "pro_yearly", 24_999),
          plan(APPLE_PRO_PRODUCT_IDS.monthly, "monthly", "pro_monthly", 2_499),
        ],
      },
    ],
  };
}
