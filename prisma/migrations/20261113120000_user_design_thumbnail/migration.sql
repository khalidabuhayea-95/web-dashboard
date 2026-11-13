-- Cloud sync, phase 2: the preview a device rendered with a design's current document, so a new
-- device can list the library before downloading any design. Additive; NULL for existing rows.
ALTER TABLE "UserDesign" ADD COLUMN "thumbnailSha256" TEXT;
