CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "DashboardUser" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'designer',
    "isSystemAdmin" BOOLEAN NOT NULL DEFAULT false,
    "bannedUntil" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DashboardUser_normalizedEmail_key" ON "DashboardUser"("normalizedEmail");
CREATE UNIQUE INDEX "DashboardUser_email_key" ON "DashboardUser"("email");
CREATE INDEX "DashboardUser_role_idx" ON "DashboardUser"("role");
CREATE INDEX "DashboardUser_createdAt_idx" ON "DashboardUser"("createdAt");

CREATE TABLE "DashboardInviteToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'designer',
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "consumedAt" TIMESTAMPTZ,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardInviteToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DashboardInviteToken_tokenHash_key" ON "DashboardInviteToken"("tokenHash");
CREATE INDEX "DashboardInviteToken_normalizedEmail_idx" ON "DashboardInviteToken"("normalizedEmail");
CREATE INDEX "DashboardInviteToken_expiresAt_idx" ON "DashboardInviteToken"("expiresAt");

ALTER TABLE "DashboardInviteToken"
ADD CONSTRAINT "DashboardInviteToken_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "DashboardUser"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MobileUser" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT,
    "email" TEXT,
    "normalizedEmail" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileUser_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MobileUser_normalizedEmail_idx" ON "MobileUser"("normalizedEmail");
CREATE INDEX "MobileUser_createdAt_idx" ON "MobileUser"("createdAt");

CREATE TABLE "MobileIdentity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mobileUserId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "email" TEXT,
    "normalizedEmail" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT,
    "profile" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobileIdentity_provider_providerUserId_key" ON "MobileIdentity"("provider", "providerUserId");
CREATE INDEX "MobileIdentity_mobileUserId_idx" ON "MobileIdentity"("mobileUserId");
CREATE INDEX "MobileIdentity_normalizedEmail_idx" ON "MobileIdentity"("normalizedEmail");

ALTER TABLE "MobileIdentity"
ADD CONSTRAINT "MobileIdentity_mobileUserId_fkey"
FOREIGN KEY ("mobileUserId") REFERENCES "MobileUser"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MobileRefreshToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mobileUserId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "lastUsedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileRefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobileRefreshToken_tokenHash_key" ON "MobileRefreshToken"("tokenHash");
CREATE INDEX "MobileRefreshToken_mobileUserId_idx" ON "MobileRefreshToken"("mobileUserId");
CREATE INDEX "MobileRefreshToken_expiresAt_idx" ON "MobileRefreshToken"("expiresAt");

ALTER TABLE "MobileRefreshToken"
ADD CONSTRAINT "MobileRefreshToken_mobileUserId_fkey"
FOREIGN KEY ("mobileUserId") REFERENCES "MobileUser"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
