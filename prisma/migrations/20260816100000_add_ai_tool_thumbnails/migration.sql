-- Grid-sized card art for the mobile AI Tools tab. The full-size after images
-- average ~140 KB, so listing 228 tools costs ~30 MB; the app lists thumbUrl
-- and only loads afterUrl when a tool is opened.

-- AlterTable
ALTER TABLE "AiTemplate" ADD COLUMN "thumbUrl" TEXT;

-- AlterTable
ALTER TABLE "MagicTool" ADD COLUMN "thumbUrl" TEXT;
