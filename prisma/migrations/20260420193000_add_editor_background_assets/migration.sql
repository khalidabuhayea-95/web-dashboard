CREATE TABLE IF NOT EXISTS editor_background_assets (
  id UUID NOT NULL PRIMARY KEY,
  source TEXT NOT NULL,
  source_asset_id TEXT NOT NULL,
  owner_id UUID,
  kind TEXT NOT NULL DEFAULT 'image',
  title_en TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  tags_en JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags_ar JSONB NOT NULL DEFAULT '[]'::jsonb,
  labels_en JSONB NOT NULL DEFAULT '[]'::jsonb,
  labels_ar JSONB NOT NULL DEFAULT '[]'::jsonb,
  slug TEXT,
  author_id INTEGER,
  author_name TEXT,
  category_value TEXT,
  asset_url TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  translation_status TEXT NOT NULL DEFAULT 'fallback',
  created_source_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT editor_background_assets_source_asset_unique UNIQUE (source, source_asset_id)
);

CREATE INDEX IF NOT EXISTS editor_background_assets_source_updated_idx
  ON editor_background_assets(source, updated_at DESC);

CREATE INDEX IF NOT EXISTS editor_background_assets_category_updated_idx
  ON editor_background_assets(category_value, updated_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'editor_element_assets'
  ) THEN
    INSERT INTO editor_background_assets (
      id,
      source,
      source_asset_id,
      owner_id,
      kind,
      title_en,
      title_ar,
      tags_en,
      tags_ar,
      labels_en,
      labels_ar,
      slug,
      author_id,
      author_name,
      category_value,
      asset_url,
      thumbnail_url,
      width,
      height,
      source_payload,
      translation_status,
      created_source_at,
      created_at,
      updated_at
    )
    SELECT
      id,
      source,
      source_asset_id,
      owner_id,
      'image',
      title_en,
      title_ar,
      tags_en,
      tags_ar,
      labels_en,
      labels_ar,
      slug,
      author_id,
      author_name,
      -- editor_element_assets has no category_value column; backfill as NULL.
      NULL,
      asset_url,
      thumbnail_url,
      width,
      height,
      source_payload,
      translation_status,
      created_source_at,
      created_at,
      updated_at
    FROM editor_element_assets
    WHERE source IN ('freepik-background', 'background-upload')
    ON CONFLICT (source, source_asset_id)
    DO UPDATE SET
      owner_id = EXCLUDED.owner_id,
      kind = EXCLUDED.kind,
      title_en = EXCLUDED.title_en,
      title_ar = EXCLUDED.title_ar,
      tags_en = EXCLUDED.tags_en,
      tags_ar = EXCLUDED.tags_ar,
      labels_en = EXCLUDED.labels_en,
      labels_ar = EXCLUDED.labels_ar,
      slug = EXCLUDED.slug,
      author_id = EXCLUDED.author_id,
      author_name = EXCLUDED.author_name,
      category_value = EXCLUDED.category_value,
      asset_url = EXCLUDED.asset_url,
      thumbnail_url = EXCLUDED.thumbnail_url,
      width = EXCLUDED.width,
      height = EXCLUDED.height,
      source_payload = EXCLUDED.source_payload,
      translation_status = EXCLUDED.translation_status,
      created_source_at = COALESCE(EXCLUDED.created_source_at, editor_background_assets.created_source_at),
      updated_at = GREATEST(editor_background_assets.updated_at, EXCLUDED.updated_at);

    DELETE FROM editor_element_assets
    WHERE source IN ('freepik-background', 'background-upload');
  END IF;
END $$;
