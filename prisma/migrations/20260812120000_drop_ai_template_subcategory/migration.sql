-- The AI Tools catalog is a flat list: every grouping in the source prompt
-- library is a top-level AiTemplateCategory, so the second grouping level was
-- never populated. Dropping it rather than leaving a column nothing can set.

-- AlterTable
ALTER TABLE "AiTemplate" DROP COLUMN IF EXISTS "subCategory";
