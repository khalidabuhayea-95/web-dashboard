-- Tier rename: Pro -> Plus, Pro Max -> Pro (2026-08-31).
--
-- ★The whole hazard of this rename is that the string "pro" CHANGES MEANING.
-- It named the ENTRY tier before and names the TOP tier after, so a naive
-- two-statement update ("pro"->"plus" then "pro_max"->"pro") would run the
-- second statement over rows the first had just written and promote every
-- entry-tier subscriber to the top tier. Every remap below is therefore a
-- single CASE over the ORIGINAL value — each row is read once and written once.
--
-- Store product ids move the same way (nayroz_pro_* -> nayroz_plus_*,
-- nayroz_pro_max_* -> nayroz_pro_*) and carry the same collision.

-- 1. Denormalized tier on the account.
UPDATE "MobileUser"
SET "subscriptionTier" = CASE "subscriptionTier"
  WHEN 'pro'     THEN 'plus'
  WHEN 'pro_max' THEN 'pro'
  ELSE "subscriptionTier"
END
WHERE "subscriptionTier" IN ('pro', 'pro_max');

-- 2. Store product ids on subscription rows. entitlementForProductId() derives
--    the tier from these, so leaving them stale would silently re-grade every
--    subscriber on the next webhook.
-- ★LEFT(), not LIKE: '_' is a single-character WILDCARD in SQL LIKE, so
--    'nayroz_pro_max%' would also match ids that merely resemble ours. These
--    comparisons are exact.
UPDATE "Subscription"
SET "productId" = CASE
  WHEN LEFT("productId", 14) = 'nayroz_pro_max' THEN 'nayroz_pro'  || substring("productId" from 15)
  WHEN LEFT("productId", 10) = 'nayroz_pro'     THEN 'nayroz_plus' || substring("productId" from 11)
  ELSE "productId"
END
WHERE LEFT("productId", 10) = 'nayroz_pro';

-- 3. Admin settings blob: allowance keys and reference-price keys shift by one
--    tier exactly like the tier strings do. Built in one jsonb_build_object so
--    the old values are read before any of the new keys are written.
UPDATE "AppSetting"
SET "value" = jsonb_set(
  "value"::jsonb,
  '{mediaCredits}',
  (("value"::jsonb -> 'mediaCredits') - 'proMaxMonthlyAllowance')
    || jsonb_build_object(
      'plusMonthlyAllowance',
      COALESCE(("value"::jsonb -> 'mediaCredits' ->> 'proMonthlyAllowance')::int, 10000),
      'proMonthlyAllowance',
      COALESCE(("value"::jsonb -> 'mediaCredits' ->> 'proMaxMonthlyAllowance')::int, 50000)
    )
)::json
WHERE "key" = 'mobile_app_settings_v1'
  AND ("value"::jsonb ? 'mediaCredits');

UPDATE "AppSetting"
SET "value" = jsonb_set(
  "value"::jsonb,
  '{mediaCredits,referencePrices}',
  (("value"::jsonb -> 'mediaCredits' -> 'referencePrices')
     - 'pro_max_monthly' - 'pro_max_yearly')
    || jsonb_build_object(
      'plus_monthly',
      COALESCE(("value"::jsonb -> 'mediaCredits' -> 'referencePrices' ->> 'pro_monthly')::int, 499),
      'plus_yearly',
      COALESCE(("value"::jsonb -> 'mediaCredits' -> 'referencePrices' ->> 'pro_yearly')::int, 3999),
      'pro_monthly',
      COALESCE(("value"::jsonb -> 'mediaCredits' -> 'referencePrices' ->> 'pro_max_monthly')::int, 2499),
      'pro_yearly',
      COALESCE(("value"::jsonb -> 'mediaCredits' -> 'referencePrices' ->> 'pro_max_yearly')::int, 24999)
    )
)::json
WHERE "key" = 'mobile_app_settings_v1'
  AND ("value"::jsonb -> 'mediaCredits' ? 'referencePrices');
