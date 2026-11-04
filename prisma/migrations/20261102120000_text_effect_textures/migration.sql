-- Texture-based text effects: a material image (or short looping clip) painted
-- inside the glyphs, plus a category for the effects strip. Additive only — every
-- existing effect keeps working with its declarative `spec`.

-- AlterTable
ALTER TABLE "TextEffect" ADD COLUMN "category" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TextEffect" ADD COLUMN "textureUrl" TEXT;
ALTER TABLE "TextEffect" ADD COLUMN "textureVideoUrl" TEXT;
