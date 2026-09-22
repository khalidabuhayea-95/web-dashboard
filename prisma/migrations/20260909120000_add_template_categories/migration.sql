-- Multi-category templates: a template can now sit under several
-- { category, subCategory } placements at once.
--
-- The scalar "category"/"subCategory" columns stay as the PRIMARY placement so the
-- status+category+subCategory composite index and older mobile builds keep working;
-- "categories" carries the full list, with categories[0] mirroring the scalars.

ALTER TABLE "Template" ADD COLUMN "categories" JSONB;

-- Seed every existing row with its current placement so reads never have to special-case
-- pre-migration rows (resolveTemplateCategoryPairs still falls back, defensively).
UPDATE "Template"
SET "categories" = jsonb_build_array(
  jsonb_build_object('category', "category", 'subCategory', "subCategory")
)
WHERE "categories" IS NULL;
