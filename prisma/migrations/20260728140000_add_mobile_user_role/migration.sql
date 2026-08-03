-- Mobile account role. "user" is a normal app account; "tester" additionally
-- sees draft templates in the mobile app so designers can review a template
-- before publishing it. Enforced in lib/mobile/templateAudience.server.js.

-- AlterTable
ALTER TABLE "MobileUser" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

-- CreateIndex
CREATE INDEX "MobileUser_role_idx" ON "MobileUser"("role");
