-- Internal dashboard image library (first consumer: AI template "before"
-- inputs). storageKey retained so a row delete can clean up its R2 object.

-- CreateTable
CREATE TABLE "GalleryImage" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" INTEGER,
    "mimeType" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GalleryImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GalleryImage_createdAt_idx" ON "GalleryImage"("createdAt" DESC);
