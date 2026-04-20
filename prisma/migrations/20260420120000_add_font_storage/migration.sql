-- CreateTable
CREATE TABLE "FontFamily" (
    "id" UUID NOT NULL,
    "family" TEXT NOT NULL,
    "normalizedFamily" TEXT NOT NULL,
    "displayName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'custom',
    "sourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "categories" JSONB NOT NULL,
    "previewText" TEXT,
    "previewWeight" INTEGER,
    "cssFontFamily" TEXT,
    "removable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FontFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FontFile" (
    "id" UUID NOT NULL,
    "fontId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileName" TEXT,
    "storageBucket" TEXT,
    "storagePath" TEXT,
    "publicUrl" TEXT,
    "sizeBytes" INTEGER,
    "checksum" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FontFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FontAlias" (
    "id" UUID NOT NULL,
    "fontId" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FontAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FontFamily_normalizedFamily_key" ON "FontFamily"("normalizedFamily");

-- CreateIndex
CREATE INDEX "FontFamily_source_idx" ON "FontFamily"("source");

-- CreateIndex
CREATE INDEX "FontFamily_status_idx" ON "FontFamily"("status");

-- CreateIndex
CREATE INDEX "FontFamily_updatedAt_idx" ON "FontFamily"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FontFile_fontId_kind_key" ON "FontFile"("fontId", "kind");

-- CreateIndex
CREATE INDEX "FontFile_fontId_idx" ON "FontFile"("fontId");

-- CreateIndex
CREATE INDEX "FontFile_kind_idx" ON "FontFile"("kind");

-- CreateIndex
CREATE INDEX "FontFile_status_idx" ON "FontFile"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FontAlias_normalizedAlias_key" ON "FontAlias"("normalizedAlias");

-- CreateIndex
CREATE INDEX "FontAlias_fontId_idx" ON "FontAlias"("fontId");

-- AddForeignKey
ALTER TABLE "FontFile" ADD CONSTRAINT "FontFile_fontId_fkey" FOREIGN KEY ("fontId") REFERENCES "FontFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FontAlias" ADD CONSTRAINT "FontAlias_fontId_fkey" FOREIGN KEY ("fontId") REFERENCES "FontFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;
