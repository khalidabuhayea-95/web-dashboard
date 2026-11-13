-- Cloud sync of a mobile user's own designs (src/lib/designSync): the per-user change log head,
-- the designs and folders themselves, and the content-addressed media they reference.
-- Additive only: five new tables, their indexes and foreign keys. Nothing existing is touched.
-- Every table cascades from "MobileUser", so account deletion removes the rows (the objects in
-- storage are removed by deleteMobileUserAccount).

-- CreateTable
CREATE TABLE "UserDesignLibrary" (
    "mobileUserId" UUID NOT NULL,
    "changeSeq" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDesignLibrary_pkey" PRIMARY KEY ("mobileUserId")
);

-- CreateTable
CREATE TABLE "UserDesign" (
    "mobileUserId" UUID NOT NULL,
    "id" VARCHAR(80) NOT NULL,
    "name" TEXT NOT NULL,
    "data" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "contentHash" VARCHAR(64) NOT NULL DEFAULT '',
    "lastMutationId" VARCHAR(64),
    "folderId" VARCHAR(80),
    "clientCreatedAt" BIGINT NOT NULL DEFAULT 0,
    "clientUpdatedAt" BIGINT NOT NULL DEFAULT 0,
    "deletedAt" BIGINT,
    "trashedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "jsonBytes" INTEGER NOT NULL DEFAULT 0,
    "changeSeq" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDesign_pkey" PRIMARY KEY ("mobileUserId","id")
);

-- CreateTable
CREATE TABLE "UserDesignFolder" (
    "mobileUserId" UUID NOT NULL,
    "id" VARCHAR(80) NOT NULL,
    "name" TEXT NOT NULL,
    "colorKey" VARCHAR(24) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "lastMutationId" VARCHAR(64),
    "clientCreatedAt" BIGINT NOT NULL DEFAULT 0,
    "clientUpdatedAt" BIGINT NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "changeSeq" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDesignFolder_pkey" PRIMARY KEY ("mobileUserId","id")
);

-- CreateTable
CREATE TABLE "UserMediaObject" (
    "mobileUserId" UUID NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "contentType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),

    CONSTRAINT "UserMediaObject_pkey" PRIMARY KEY ("mobileUserId","sha256")
);

-- CreateTable
CREATE TABLE "UserDesignMedia" (
    "mobileUserId" UUID NOT NULL,
    "designId" VARCHAR(80) NOT NULL,
    "sha256" CHAR(64) NOT NULL,

    CONSTRAINT "UserDesignMedia_pkey" PRIMARY KEY ("mobileUserId","designId","sha256")
);

-- CreateIndex
CREATE INDEX "UserDesign_mobileUserId_changeSeq_idx" ON "UserDesign"("mobileUserId", "changeSeq");

-- CreateIndex
CREATE INDEX "UserDesign_mobileUserId_trashedAt_idx" ON "UserDesign"("mobileUserId", "trashedAt");

-- CreateIndex
CREATE INDEX "UserDesignFolder_mobileUserId_changeSeq_idx" ON "UserDesignFolder"("mobileUserId", "changeSeq");

-- CreateIndex
CREATE INDEX "UserMediaObject_mobileUserId_status_createdAt_idx" ON "UserMediaObject"("mobileUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "UserDesignMedia_mobileUserId_sha256_idx" ON "UserDesignMedia"("mobileUserId", "sha256");

-- AddForeignKey
ALTER TABLE "UserDesignLibrary" ADD CONSTRAINT "UserDesignLibrary_mobileUserId_fkey" FOREIGN KEY ("mobileUserId") REFERENCES "MobileUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDesign" ADD CONSTRAINT "UserDesign_mobileUserId_fkey" FOREIGN KEY ("mobileUserId") REFERENCES "MobileUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDesignFolder" ADD CONSTRAINT "UserDesignFolder_mobileUserId_fkey" FOREIGN KEY ("mobileUserId") REFERENCES "MobileUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMediaObject" ADD CONSTRAINT "UserMediaObject_mobileUserId_fkey" FOREIGN KEY ("mobileUserId") REFERENCES "MobileUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDesignMedia" ADD CONSTRAINT "UserDesignMedia_mobileUserId_designId_fkey" FOREIGN KEY ("mobileUserId", "designId") REFERENCES "UserDesign"("mobileUserId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
