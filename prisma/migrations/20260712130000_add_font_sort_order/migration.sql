-- AlterTable
ALTER TABLE "FontFamily" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "FontFamily_sortOrder_idx" ON "FontFamily"("sortOrder");
