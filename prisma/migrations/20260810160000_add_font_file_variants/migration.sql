-- A font family can now hold one file per WEIGHT/STYLE it is used at. Existing rows are the
-- family's default face: NULL weight/style reads as 400/normal, so nothing needs backfilling.
ALTER TABLE "FontFile" ADD COLUMN "fontWeight" INTEGER;
ALTER TABLE "FontFile" ADD COLUMN "fontStyle" TEXT;

-- Variant lookups (editor @font-face generation, mobile file selection).
CREATE INDEX "FontFile_fontId_fontWeight_fontStyle_idx" ON "FontFile"("fontId", "fontWeight", "fontStyle");
