-- Dashboard-managed material styles for text layers (gold, diamond, glitter…).
-- `spec` is a declarative fill description rendered natively by both the web
-- editor and the mobile app — no image generation, no per-use cost.

-- CreateTable
CREATE TABLE "TextEffect" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "previewUrl" TEXT,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TextEffect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TextEffect_slug_key" ON "TextEffect"("slug");

-- CreateIndex
CREATE INDEX "TextEffect_published_sortOrder_idx" ON "TextEffect"("published", "sortOrder");
