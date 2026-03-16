CREATE TABLE IF NOT EXISTS editor_element_assets (
  id UUID NOT NULL PRIMARY KEY,
  source TEXT NOT NULL,
  source_asset_id TEXT NOT NULL,
  owner_id UUID,
  kind TEXT NOT NULL DEFAULT 'icon',
  title_en TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  tags_en JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags_ar JSONB NOT NULL DEFAULT '[]'::jsonb,
  labels_en JSONB NOT NULL DEFAULT '[]'::jsonb,
  labels_ar JSONB NOT NULL DEFAULT '[]'::jsonb,
  slug TEXT,
  style_id INTEGER,
  style_name TEXT,
  family_id INTEGER,
  family_name TEXT,
  author_id INTEGER,
  author_name TEXT,
  asset_url TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  free_svg BOOLEAN NOT NULL DEFAULT FALSE,
  source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  translation_status TEXT NOT NULL DEFAULT 'fallback',
  created_source_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT editor_element_assets_source_asset_unique UNIQUE (source, source_asset_id)
);

CREATE INDEX IF NOT EXISTS editor_element_assets_source_kind_updated_idx
  ON editor_element_assets(source, kind, updated_at DESC);

CREATE INDEX IF NOT EXISTS editor_element_assets_title_en_idx
  ON editor_element_assets (LOWER(title_en));

CREATE INDEX IF NOT EXISTS editor_element_assets_title_ar_idx
  ON editor_element_assets (LOWER(title_ar));

CREATE INDEX IF NOT EXISTS editor_element_assets_tags_en_gin_idx
  ON editor_element_assets USING GIN (tags_en);

CREATE INDEX IF NOT EXISTS editor_element_assets_tags_ar_gin_idx
  ON editor_element_assets USING GIN (tags_ar);
