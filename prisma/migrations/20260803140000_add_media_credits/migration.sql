-- Credit wallet: each user gets one monthly credit balance instead of per-feature
-- request quotas. Each run deducts a per-feature credit cost (configured in the
-- dashboard), so users spend their allowance however they like.

-- AlterTable: credits charged for each recorded run.
ALTER TABLE "MediaUsage" ADD COLUMN "credits" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: optional per-user allowance override (NULL = use the global default).
ALTER TABLE "MobileUser" ADD COLUMN "creditAllowance" INTEGER;

-- The image-to-layers feature was removed; drop any rows it left behind so they
-- do not count against the wallet or show up in the spend report.
DELETE FROM "MediaUsage" WHERE "feature" = 'image-to-layers';
