-- Inlay text effects (gold rim + diamond pavé inside): the inlay's material image.
-- Additive only; effects without an inlay are unchanged.

-- AlterTable
ALTER TABLE "TextEffect" ADD COLUMN "inlayTextureUrl" TEXT;
