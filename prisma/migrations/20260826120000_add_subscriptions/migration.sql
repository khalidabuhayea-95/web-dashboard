-- Premium subscriptions (Nayroz Pro): denormalized tier on MobileUser, per-store
-- Subscription rows, and the StoreNotification webhook dedupe/audit ledger.
-- Hand-written (migrate diff against this DB drags in pre-existing cutover
-- drift — index renames, timestamp precision — that this migration must not touch).

-- AlterTable
ALTER TABLE "MobileUser"
  ADD COLUMN "subscriptionTier" TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN "subscriptionExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Template" ADD COLUMN "isPremium" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "mobileUserId" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "storeKey" TEXT NOT NULL,
    "linkedPurchaseToken" TEXT,
    "status" TEXT NOT NULL,
    "periodType" TEXT NOT NULL DEFAULT 'normal',
    "currentPeriodEnd" TIMESTAMP(3),
    "autoRenewing" BOOLEAN NOT NULL DEFAULT true,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "lastNotificationType" TEXT,
    "lastNotificationAt" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreNotification" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "StoreNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_storeKey_key" ON "Subscription"("storeKey");

-- CreateIndex
CREATE INDEX "Subscription_mobileUserId_idx" ON "Subscription"("mobileUserId");

-- CreateIndex
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "StoreNotification_platform_status_receivedAt_idx" ON "StoreNotification"("platform", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "MobileUser_subscriptionTier_idx" ON "MobileUser"("subscriptionTier");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_mobileUserId_fkey" FOREIGN KEY ("mobileUserId") REFERENCES "MobileUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
