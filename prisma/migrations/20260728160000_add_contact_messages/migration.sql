-- Contact-us inbox. One row per message submitted from the marketing site
-- (public/contact.html -> POST /api/contact) or from the mobile app
-- (POST /api/mobile/support/contact). Both carry the same form fields; "source"
-- records which one it came from.
--
-- "mobileUserId" is set only when the mobile caller sent a valid bearer token,
-- so it stays NULL for every web submission and for anonymous app users.
-- ON DELETE SET NULL keeps the message when the account is deleted — the
-- support history must outlive the account. Field lengths and the allowed
-- values for "status"/"topic"/"source" are enforced in
-- lib/support/contactMessageFields.js.

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL DEFAULT 'web',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "topic" TEXT NOT NULL DEFAULT 'general',
    "device" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "mobileUserId" UUID,
    "appVersion" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "handledByUserId" UUID,
    "handledAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactMessage_createdAt_idx" ON "ContactMessage"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "ContactMessage_status_createdAt_idx" ON "ContactMessage"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ContactMessage_source_idx" ON "ContactMessage"("source");

-- CreateIndex
CREATE INDEX "ContactMessage_topic_idx" ON "ContactMessage"("topic");

-- CreateIndex
CREATE INDEX "ContactMessage_mobileUserId_idx" ON "ContactMessage"("mobileUserId");

-- AddForeignKey
ALTER TABLE "ContactMessage" ADD CONSTRAINT "ContactMessage_mobileUserId_fkey" FOREIGN KEY ("mobileUserId") REFERENCES "MobileUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
