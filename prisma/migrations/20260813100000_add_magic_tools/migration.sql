-- One-tap Magic Tools (image in, image out). Separate from AiTemplate: no
-- category, and several tools run on prompt-less specialist models tuned
-- through per-tool modelOptions instead of prompt wording.

-- CreateTable
CREATE TABLE "MagicTool" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "subtitleAr" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT 'google/nano-banana',
    "modelOptions" JSONB,
    "beforeUrl" TEXT,
    "afterUrl" TEXT,
    "creditCost" INTEGER NOT NULL DEFAULT 8,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MagicTool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MagicTool_slug_key" ON "MagicTool"("slug");

-- CreateIndex
CREATE INDEX "MagicTool_published_sortOrder_idx" ON "MagicTool"("published", "sortOrder");
