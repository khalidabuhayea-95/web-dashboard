-- CreateTable
CREATE TABLE "AiTemplateCategory" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "isNew" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTemplateCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTemplate" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,
    "subCategory" TEXT NOT NULL DEFAULT '',
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'google/nano-banana',
    "referenceKind" TEXT NOT NULL DEFAULT 'portrait',
    "beforeUrl" TEXT,
    "afterUrl" TEXT,
    "creditCost" INTEGER NOT NULL DEFAULT 8,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiTemplateCategory_slug_key" ON "AiTemplateCategory"("slug");

-- CreateIndex
CREATE INDEX "AiTemplateCategory_sortOrder_idx" ON "AiTemplateCategory"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AiTemplate_slug_key" ON "AiTemplate"("slug");

-- CreateIndex
CREATE INDEX "AiTemplate_categoryId_sortOrder_idx" ON "AiTemplate"("categoryId", "sortOrder");

-- CreateIndex
CREATE INDEX "AiTemplate_published_categoryId_idx" ON "AiTemplate"("published", "categoryId");

-- AddForeignKey
ALTER TABLE "AiTemplate" ADD CONSTRAINT "AiTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AiTemplateCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
