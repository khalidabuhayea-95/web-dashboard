-- Smart search (2026-10-19): one stored, folded copy of every searchable field + trigram indexes.
--
-- nayroz_search_fold() is the SQL twin of normalizeSearchText() in src/lib/text/arabicSearch.js
-- (tashkeel/tatweel dropped, أ إ آ ٱ → ا, ة → ه, ى → ي, ؤ → و, ئ → ي, ک → ك, ی → ي, Arabic-Indic
-- digits → ASCII, lowercased) plus one step of its own: every run of non-letters/digits becomes a
-- single space and the result is padded with one space on each side, so a query can ask for a
-- whole word (' word '), a word start (' word') or a substring. src/lib/search/searchFold.test.js
-- checks that the translate() tables below equal the JS tables.
--
-- ★The stored columns are GENERATED from this function. Changing the function body does NOT
-- recompute them: after CREATE OR REPLACE, run
--   UPDATE "Template" SET name = name;  UPDATE editor_element_assets SET title_en = title_en;
-- (inside a transaction that sets nayroz.preserve_updated_at = on for Template).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION nayroz_search_fold(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ' ' || btrim(regexp_replace(
    lower(translate(
      regexp_replace(coalesce(input, ''), '[ً-ٰٟـ]', '', 'g'),
      'أإآٱةىؤئکی٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
      'ااااهيويكي01234567890123456789'
    )),
    '[^[:alnum:]]+', ' ', 'g'
  )) || ' '
$$;

-- Templates: human tags stay as the designer wrote them; machine keywords (the name translated
-- into the other language, see src/lib/search/templateKeywords.server.js) live beside them.
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "searchKeywords" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "searchTitle" TEXT
  GENERATED ALWAYS AS (nayroz_search_fold("name")) STORED;
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "searchTags" TEXT
  GENERATED ALWAYS AS (nayroz_search_fold("tags"::text || ' ' || "searchKeywords"::text)) STORED;
CREATE INDEX IF NOT EXISTS "Template_searchTitle_trgm_idx" ON "Template" USING gin ("searchTitle" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Template_searchTags_trgm_idx" ON "Template" USING gin ("searchTags" gin_trgm_ops);

-- Elements: titles in both languages, then tags, labels and the category slug.
-- category_value was only ever added by the runtime bootstrap (importedElements.server.js); a
-- database built from migrations alone lacks it.
ALTER TABLE editor_element_assets ADD COLUMN IF NOT EXISTS category_value TEXT;
ALTER TABLE editor_element_assets ADD COLUMN IF NOT EXISTS search_title TEXT
  GENERATED ALWAYS AS (nayroz_search_fold(title_en || ' ' || title_ar)) STORED;
ALTER TABLE editor_element_assets ADD COLUMN IF NOT EXISTS search_tags TEXT
  GENERATED ALWAYS AS (nayroz_search_fold(
    tags_en::text || ' ' || tags_ar::text || ' ' || labels_en::text || ' ' || labels_ar::text || ' ' || coalesce(category_value, '')
  )) STORED;
CREATE INDEX IF NOT EXISTS editor_element_assets_search_title_trgm_idx ON editor_element_assets USING gin (search_title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS editor_element_assets_search_tags_trgm_idx ON editor_element_assets USING gin (search_tags gin_trgm_ops);
