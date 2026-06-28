-- CreateTable
CREATE TABLE "MobileFavoriteTemplate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mobileUserId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileFavoriteTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MobileFavoriteTemplate_mobileUserId_templateId_key" ON "MobileFavoriteTemplate"("mobileUserId", "templateId");

-- CreateIndex
CREATE INDEX "MobileFavoriteTemplate_mobileUserId_createdAt_idx" ON "MobileFavoriteTemplate"("mobileUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MobileFavoriteTemplate_templateId_idx" ON "MobileFavoriteTemplate"("templateId");

-- AddForeignKey
ALTER TABLE "MobileFavoriteTemplate" ADD CONSTRAINT "MobileFavoriteTemplate_mobileUserId_fkey" FOREIGN KEY ("mobileUserId") REFERENCES "MobileUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileFavoriteTemplate" ADD CONSTRAINT "MobileFavoriteTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
