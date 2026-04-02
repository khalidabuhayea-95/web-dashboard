import { randomUUID } from "node:crypto";

import prisma from "@/lib/prisma";

const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 120;
const DEFAULT_SOURCE = "freepik-background";
let ensureSchemaPromise = null;

const IMPORTED_BACKGROUNDS_SCHEMA_STATEMENTS = [
  `
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
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS editor_background_assets_source_updated_idx
      ON editor_background_assets(source, updated_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS editor_background_assets_category_updated_idx
      ON editor_background_assets(category_value, updated_at DESC)
  `,
];

const LEGACY_BACKGROUND_MIGRATION_SQL = `
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
`;

async function ensureImportedBackgroundsSchema() {
  if (ensureSchemaPromise) return ensureSchemaPromise;

  ensureSchemaPromise = (async () => {
    for (const statement of IMPORTED_BACKGROUNDS_SCHEMA_STATEMENTS) {
      await prisma.$executeRawUnsafe(statement);
    }
    await prisma.$executeRawUnsafe(LEGACY_BACKGROUND_MIGRATION_SQL);
  })().catch((error) => {
    ensureSchemaPromise = null;
    throw error;
  });

  return ensureSchemaPromise;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeSource(value) {
  const source = sanitizeText(value).toLowerCase();
  return source || DEFAULT_SOURCE;
}

function sanitizeSourceFilter(value) {
  const source = sanitizeText(value).toLowerCase();
  if (!source || source === "all" || source === "*") return "";
  return source;
}

function sanitizeCategoryFilter(value) {
  const category = sanitizeText(value).toLowerCase();
  if (!category || category === "all" || category === "*") return "";
  return category;
}

function sanitizeKind(value) {
  const kind = sanitizeText(value).toLowerCase();
  return kind === "image" ? "image" : "image";
}

function sanitizeArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => sanitizeText(item))
        .filter(Boolean)
        .slice(0, 120)
    )
  );
}

function parseDateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeRow(row, locale = "en") {
  if (!row || typeof row !== "object") return null;

  const tagsEn = sanitizeArray(row.tags_en);
  const tagsAr = sanitizeArray(row.tags_ar);
  const labelsEn = sanitizeArray(row.labels_en);
  const labelsAr = sanitizeArray(row.labels_ar);
  const resolvedLocale = String(locale || "en").toLowerCase() === "ar" ? "ar" : "en";
  const titleEn = sanitizeText(row.title_en);
  const titleAr = sanitizeText(row.title_ar);
  const title = resolvedLocale === "ar" ? titleAr || titleEn : titleEn || titleAr;
  const tags = resolvedLocale === "ar" ? (tagsAr.length > 0 ? tagsAr : tagsEn) : (tagsEn.length > 0 ? tagsEn : tagsAr);
  const labels = resolvedLocale === "ar" ? (labelsAr.length > 0 ? labelsAr : labelsEn) : (labelsEn.length > 0 ? labelsEn : labelsAr);
  const sourcePayload =
    row.source_payload && typeof row.source_payload === "object" && !Array.isArray(row.source_payload)
      ? row.source_payload
      : {};

  return {
    id: String(row.id || ""),
    source: sanitizeSource(row.source),
    sourceAssetId: sanitizeText(row.source_asset_id),
    kind: "image",
    title,
    titleEn,
    titleAr,
    tags,
    tagsEn,
    tagsAr,
    labels,
    labelsEn,
    labelsAr,
    slug: sanitizeText(row.slug),
    authorId: Number.isFinite(Number(row.author_id)) ? Number(row.author_id) : null,
    authorName: sanitizeText(row.author_name),
    categoryValue: sanitizeText(row.category_value),
    assetUrl: sanitizeText(row.asset_url),
    thumbnailUrl: sanitizeText(row.thumbnail_url),
    animatedVideoUrl: "",
    width: Number.isFinite(Number(row.width)) ? Number(row.width) : null,
    height: Number.isFinite(Number(row.height)) ? Number(row.height) : null,
    freeSvg: false,
    sourcePayload,
    translationStatus: sanitizeText(row.translation_status) || "fallback",
    createdSourceAt: row.created_source_at ? new Date(row.created_source_at).toISOString() : "",
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : "",
  };
}

export async function upsertImportedBackgroundAsset(input) {
  await ensureImportedBackgroundsSchema();

  const id = sanitizeText(input?.id) || randomUUID();
  const source = sanitizeSource(input?.source);
  const sourceAssetId = sanitizeText(input?.sourceAssetId || input?.source_asset_id);
  if (!sourceAssetId) {
    throw new Error("Missing sourceAssetId for imported background.");
  }

  const ownerId = sanitizeText(input?.ownerId || input?.owner_id) || null;
  const titleEn = sanitizeText(input?.titleEn || input?.title_en || input?.title);
  const titleAr = sanitizeText(input?.titleAr || input?.title_ar || input?.title);
  const tagsEn = sanitizeArray(input?.tagsEn || input?.tags_en || input?.tags);
  const tagsAr = sanitizeArray(input?.tagsAr || input?.tags_ar || input?.tags);
  const labelsEn = sanitizeArray(input?.labelsEn || input?.labels_en || input?.labels);
  const labelsAr = sanitizeArray(input?.labelsAr || input?.labels_ar || input?.labels);
  const slug = sanitizeText(input?.slug);
  const authorId = Number.isFinite(Number(input?.authorId)) ? Number(input.authorId) : null;
  const authorName = sanitizeText(input?.authorName);
  const categoryValue = sanitizeText(input?.categoryValue || input?.category || input?.category_value).toLowerCase();
  const assetUrl = sanitizeText(input?.assetUrl || input?.asset_url);
  const thumbnailUrl = sanitizeText(input?.thumbnailUrl || input?.thumbnail_url || assetUrl);
  if (!assetUrl || !thumbnailUrl) {
    throw new Error("Imported background requires asset and thumbnail URLs.");
  }

  const width = Number.isFinite(Number(input?.width)) ? Math.max(1, Math.round(Number(input.width))) : null;
  const height = Number.isFinite(Number(input?.height)) ? Math.max(1, Math.round(Number(input.height))) : null;
  const sourcePayload = input?.sourcePayload && typeof input.sourcePayload === "object" ? input.sourcePayload : {};
  const translationStatus = ["translated", "fallback", "failed"].includes(String(input?.translationStatus || "").toLowerCase())
    ? String(input.translationStatus).toLowerCase()
    : "fallback";
  const createdSourceAt = parseDateValue(input?.createdSourceAt || input?.created_source_at);

  const rows = await prisma.$queryRaw`
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
    VALUES (
      ${id}::uuid,
      ${source},
      ${sourceAssetId},
      ${ownerId || null}::uuid,
      ${sanitizeKind("image")},
      ${titleEn || sourceAssetId},
      ${titleAr || titleEn || sourceAssetId},
      ${JSON.stringify(tagsEn)}::jsonb,
      ${JSON.stringify(tagsAr.length > 0 ? tagsAr : tagsEn)}::jsonb,
      ${JSON.stringify(labelsEn)}::jsonb,
      ${JSON.stringify(labelsAr.length > 0 ? labelsAr : labelsEn)}::jsonb,
      ${slug || null},
      ${authorId},
      ${authorName || null},
      ${categoryValue || null},
      ${assetUrl},
      ${thumbnailUrl},
      ${width},
      ${height},
      ${JSON.stringify(sourcePayload)}::jsonb,
      ${translationStatus},
      ${createdSourceAt ? new Date(createdSourceAt) : null},
      NOW(),
      NOW()
    )
    ON CONFLICT (source, source_asset_id)
    DO UPDATE SET
      owner_id = COALESCE(EXCLUDED.owner_id, editor_background_assets.owner_id),
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
      updated_at = NOW()
    RETURNING *
  `;

  return normalizeRow(Array.isArray(rows) ? rows[0] : null);
}

export async function listImportedBackgroundAssets(options = {}) {
  await ensureImportedBackgroundsSchema();

  const source = sanitizeSourceFilter(options.source);
  const categoryValue = sanitizeCategoryFilter(options.categoryValue || options.category);
  const page = clampInt(options.page, 1, 1, 10_000);
  const pageSize = clampInt(options.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const locale = String(options.locale || options.lang || "en").toLowerCase() === "ar" ? "ar" : "en";

  const params = [];
  const nextParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const sourceSql = source ? `source = ${nextParam(source)}` : "1=1";
  const categorySql = categoryValue ? `AND category_value = ${nextParam(categoryValue)}` : "";
  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM editor_background_assets
    WHERE ${sourceSql}
    ${categorySql}
  `;

  const totalRows = await prisma.$queryRawUnsafe(countSql, ...params);
  const total = Number(totalRows?.[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;

  const limitParam = nextParam(pageSize);
  const offsetParam = nextParam(offset);
  const listSql = `
    SELECT *
    FROM editor_background_assets
    WHERE ${sourceSql}
    ${categorySql}
    ORDER BY updated_at DESC
    LIMIT ${limitParam}
    OFFSET ${offsetParam}
  `;

  const rows = await prisma.$queryRawUnsafe(listSql, ...params);
  const items = Array.isArray(rows)
    ? rows.map((row) => normalizeRow(row, locale)).filter(Boolean)
    : [];

  return {
    items,
    total,
    page: safePage,
    pageSize,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPrevPage: safePage > 1,
  };
}

export async function deleteImportedBackgroundAsset(options = {}) {
  await ensureImportedBackgroundsSchema();

  const id = sanitizeText(options.id);
  if (!id) {
    throw new Error("Imported background id is required.");
  }

  const ownerId = sanitizeText(options.ownerId || options.owner_id);
  const isAdmin = Boolean(options.isAdmin);

  const params = [id];
  let ownerClause = "";
  if (!isAdmin) {
    if (!ownerId) {
      throw new Error("Owner id is required.");
    }
    params.push(ownerId);
    ownerClause = `AND owner_id = $${params.length}::uuid`;
  }

  const rows = await prisma.$queryRawUnsafe(
    `
      DELETE FROM editor_background_assets
      WHERE id = $1::uuid
      ${ownerClause}
      RETURNING id
    `,
    ...params
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return { deleted: false };
  }

  return {
    deleted: true,
    id: String(rows[0]?.id || id),
  };
}
