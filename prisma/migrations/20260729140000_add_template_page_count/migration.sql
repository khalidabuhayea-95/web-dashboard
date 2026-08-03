-- Number of design pages in Template.data (multi-page designs). Maintained by
-- the template save route; lets list endpoints surface page-count badges
-- without selecting the full data payload.

-- AlterTable
ALTER TABLE "Template" ADD COLUMN "pageCount" INTEGER NOT NULL DEFAULT 1;
