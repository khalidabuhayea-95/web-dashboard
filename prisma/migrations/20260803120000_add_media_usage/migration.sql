-- Per-user monthly quotas for the paid AI media features.
-- The in-memory rate limiter only caps bursts (6 req / 5 min per user), which still
-- allows ~1,700 runs/day per account. This table is the real spend ceiling, and
-- doubles as the per-feature/per-model cost breakdown.

-- CreateTable
CREATE TABLE "MediaUsage" (
    "id" UUID NOT NULL,
    "mobileUserId" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "periodKey" VARCHAR(7) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaUsage_mobileUserId_feature_periodKey_idx" ON "MediaUsage"("mobileUserId", "feature", "periodKey");

-- CreateIndex
CREATE INDEX "MediaUsage_periodKey_idx" ON "MediaUsage"("periodKey");

-- CreateIndex
CREATE INDEX "MediaUsage_createdAt_idx" ON "MediaUsage"("createdAt");

-- AddForeignKey
ALTER TABLE "MediaUsage" ADD CONSTRAINT "MediaUsage_mobileUserId_fkey" FOREIGN KEY ("mobileUserId") REFERENCES "MobileUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
