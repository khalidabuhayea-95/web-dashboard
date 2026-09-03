-- Credit economy inflation + rebase (2026-08-31).
--
-- 1) Perception: every credit figure is multiplied by 10 — allowances, per-run
--    costs, ledger history — because "١٠٬٠٠٠ نقطة" reads as generous where
--    "١٠٠٠" read as stingy. Purchasing power is unchanged.
-- 2) Profitability: per-run costs are simultaneously REBASED from measured
--    provider prices at the new $0.0005/credit anchor, so every tool charges
--    more than it costs (the old table sold nano-banana-pro at a 70% loss).
-- Ledger rows are multiplied so current-period "used" scales with the new
-- allowances and historical months stay comparable in reports.

UPDATE "MediaUsage" SET "credits" = "credits" * 10;

UPDATE "MobileUser"
SET "creditAllowance" = "creditAllowance" * 10
WHERE "creditAllowance" IS NOT NULL;

-- Magic tools: rebased per model (provider price -> credits at >=28% margin).
UPDATE "MagicTool" SET "creditCost" = CASE "model"
  WHEN 'google/nano-banana'            THEN 100
  WHEN 'flux-kontext-apps/restore-image' THEN 100
  WHEN 'arielreplicate/deoldify_image' THEN 40
  WHEN 'nightmareai/real-esrgan'       THEN 20
  WHEN 'local/background-remover'      THEN 20
  ELSE "creditCost" * 10
END;

-- AI templates: same rebase; nano-banana-pro was the money-loser (charged the
-- 8-credit flat rate against a $0.134/run model).
UPDATE "AiTemplate" SET "creditCost" = CASE "model"
  WHEN 'google/nano-banana-pro'        THEN 400
  WHEN 'google/nano-banana'            THEN 100
  WHEN 'ideogram-ai/ideogram-v4-balanced' THEN 160
  WHEN 'bytedance/seedream-4.5'        THEN 100
  WHEN 'ideogram-ai/ideogram-v4-turbo' THEN 80
  WHEN 'qwen/qwen-image-edit-plus'     THEN 80
  WHEN 'qwen/qwen-image'               THEN 60
  ELSE "creditCost" * 10
END;

ALTER TABLE "MagicTool" ALTER COLUMN "creditCost" SET DEFAULT 100;
ALTER TABLE "AiTemplate" ALTER COLUMN "creditCost" SET DEFAULT 100;

-- Saved admin settings blob, when one exists: allowances are the admin's own
-- numbers so they inflate x10; feature costs are derived from provider prices,
-- so they are overwritten with the rebased defaults rather than multiplied.
UPDATE "AppSetting"
SET "value" = jsonb_set(
  "value"::jsonb,
  '{mediaCredits}',
  ("value"::jsonb -> 'mediaCredits')
    || jsonb_build_object(
      'monthlyAllowance',
      COALESCE((("value"::jsonb -> 'mediaCredits' ->> 'monthlyAllowance')::int * 10), 1000),
      'proMonthlyAllowance',
      COALESCE((("value"::jsonb -> 'mediaCredits' ->> 'proMonthlyAllowance')::int * 10), 10000),
      'proMaxMonthlyAllowance', 50000,
      'costs', jsonb_build_object(
        'edit-image', 100, 'ai-expand', 100, 'upscale', 20,
        'object-removal', 10, 'ai-tools', 100
      )
    )
)::json
WHERE "key" = 'mobile_app_settings_v1'
  AND ("value"::jsonb ? 'mediaCredits');
