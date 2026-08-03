-- Lets admins disable a mobile app account from the dashboard.
-- Mirrors DashboardUser.bannedUntil: NULL means active, a future timestamp
-- means blocked. Indefinite bans use the far-future sentinel written by
-- lib/mobile/mobileUsers.server.js, so a temporary ban can be added later
-- without another migration.

-- AlterTable
ALTER TABLE "MobileUser" ADD COLUMN "bannedUntil" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "MobileUser_bannedUntil_idx" ON "MobileUser"("bannedUntil");
