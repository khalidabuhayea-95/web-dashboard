-- CreateTable
CREATE TABLE "MobileDeviceToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mobileUserId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'android',
    "appVersion" TEXT,
    "disabledAt" TIMESTAMPTZ,
    "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileDeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MobileDeviceToken_token_key" ON "MobileDeviceToken"("token");

-- CreateIndex
CREATE INDEX "MobileDeviceToken_mobileUserId_idx" ON "MobileDeviceToken"("mobileUserId");

-- CreateIndex
CREATE INDEX "MobileDeviceToken_disabledAt_idx" ON "MobileDeviceToken"("disabledAt");

-- AddForeignKey
ALTER TABLE "MobileDeviceToken" ADD CONSTRAINT "MobileDeviceToken_mobileUserId_fkey" FOREIGN KEY ("mobileUserId") REFERENCES "MobileUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PushCampaign" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audienceType" TEXT NOT NULL,
    "audienceRef" JSONB NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'notification',
    "payload" JSONB NOT NULL,
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "error" TEXT,
    "sentByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushCampaign_createdAt_idx" ON "PushCampaign"("createdAt" DESC);
