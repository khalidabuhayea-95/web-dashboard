-- Cloud sync, phase 3: resumable multipart uploads for large design media, and the user's installed
-- fonts synced to the account. Additive only.

-- Multipart uploads: storage's upload id while parts arrive, and the part size the device cuts in.
ALTER TABLE "UserMediaObject" ADD COLUMN "uploadId" TEXT;
ALTER TABLE "UserMediaObject" ADD COLUMN "partBytes" INTEGER;

-- One row per installed font FILE; the file itself is a UserMediaObject (counted in storage).
CREATE TABLE "UserFont" (
    "mobileUserId" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "fontName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "changeSeq" BIGINT NOT NULL DEFAULT 0,
    "lastMutationId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFont_pkey" PRIMARY KEY ("mobileUserId","id")
);

CREATE INDEX "UserFont_mobileUserId_changeSeq_idx" ON "UserFont"("mobileUserId", "changeSeq");

ALTER TABLE "UserFont" ADD CONSTRAINT "UserFont_mobileUserId_fkey" FOREIGN KEY ("mobileUserId") REFERENCES "MobileUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
