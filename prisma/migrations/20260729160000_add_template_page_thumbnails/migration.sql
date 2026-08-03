-- Per-page preview images for multi-page designs, stored as { [pageId]: publicUrl }.
-- Page 1 keeps falling back to Template.thumbnailDataUrl (every template already has one),
-- so this column only carries pages 2..N.

-- AlterTable
ALTER TABLE "Template" ADD COLUMN "pageThumbnails" JSONB;
