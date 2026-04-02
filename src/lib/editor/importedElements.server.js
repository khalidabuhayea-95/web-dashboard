import { randomUUID } from "node:crypto";

import prisma from "@/lib/prisma";

const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 120;
const DEFAULT_SOURCE = "freepik";
const SEARCH_TOKEN_LIMIT = 6;
const ARABIC_VARIANT_SOURCE = "أإآٱؤئىة";
const ARABIC_VARIANT_TARGET = "ااااوياه";
let ensureSchemaPromise = null;

const IMPORTED_ELEMENTS_SCHEMA_STATEMENTS = [
  `
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
      category_value TEXT,
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
    )
  `,
  `
    ALTER TABLE editor_element_assets
    ADD COLUMN IF NOT EXISTS category_value TEXT
  `,
  `
    CREATE INDEX IF NOT EXISTS editor_element_assets_source_kind_updated_idx
      ON editor_element_assets(source, kind, updated_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS editor_element_assets_title_en_idx
      ON editor_element_assets (LOWER(title_en))
  `,
  `
    CREATE INDEX IF NOT EXISTS editor_element_assets_title_ar_idx
      ON editor_element_assets (LOWER(title_ar))
  `,
  `
    CREATE INDEX IF NOT EXISTS editor_element_assets_tags_en_gin_idx
      ON editor_element_assets USING GIN (tags_en)
  `,
  `
    CREATE INDEX IF NOT EXISTS editor_element_assets_tags_ar_gin_idx
      ON editor_element_assets USING GIN (tags_ar)
  `,
];

async function ensureImportedElementsSchema() {
  if (ensureSchemaPromise) {
    return ensureSchemaPromise;
  }

  ensureSchemaPromise = (async () => {
    for (const statement of IMPORTED_ELEMENTS_SCHEMA_STATEMENTS) {
      await prisma.$executeRawUnsafe(statement);
    }
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

function sanitizeUrl(value) {
  const source = sanitizeText(value);
  if (!source) return "";
  try {
    const parsed = new URL(source);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
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
  if (kind === "icon" || kind === "vector" || kind === "image") return kind;
  return "icon";
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

function normalizeSearchTerm(value) {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ي")
    .replace(/[ى]/g, "ي")
    .replace(/[ة]/g, "ه")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFuzzyLikePattern(value) {
  const normalized = normalizeSearchTerm(value).replace(/\s+/g, "");
  if (!normalized) return "%%";
  if (normalized.length < 4) return `%${normalized}%`;
  return `%${normalized.split("").join("%")}%`;
}

function sqlNormalizeExpression(expression) {
  return `LOWER(TRANSLATE(COALESCE(${expression}, ''), '${ARABIC_VARIANT_SOURCE}', '${ARABIC_VARIANT_TARGET}'))`;
}

function buildSearchFieldsSql(rawLikeToken, normalizedLikeToken, fuzzyLikeToken) {
  const titleEnNormalized = sqlNormalizeExpression("title_en");
  const titleArNormalized = sqlNormalizeExpression("title_ar");
  const tagEnNormalized = sqlNormalizeExpression("tag_en");
  const tagArNormalized = sqlNormalizeExpression("tag_ar");
  const labelEnNormalized = sqlNormalizeExpression("label_en");
  const labelArNormalized = sqlNormalizeExpression("label_ar");

  return `
    LOWER(COALESCE(title_en, '')) LIKE ${rawLikeToken}
    OR LOWER(COALESCE(title_ar, '')) LIKE ${rawLikeToken}
    OR ${titleEnNormalized} LIKE ${normalizedLikeToken}
    OR ${titleArNormalized} LIKE ${normalizedLikeToken}
    OR ${titleEnNormalized} LIKE ${fuzzyLikeToken}
    OR ${titleArNormalized} LIKE ${fuzzyLikeToken}
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(tags_en) AS tag_en
      WHERE
        LOWER(tag_en) LIKE ${rawLikeToken}
        OR ${tagEnNormalized} LIKE ${normalizedLikeToken}
        OR ${tagEnNormalized} LIKE ${fuzzyLikeToken}
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(tags_ar) AS tag_ar
      WHERE
        LOWER(tag_ar) LIKE ${rawLikeToken}
        OR ${tagArNormalized} LIKE ${normalizedLikeToken}
        OR ${tagArNormalized} LIKE ${fuzzyLikeToken}
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(labels_en) AS label_en
      WHERE
        LOWER(label_en) LIKE ${rawLikeToken}
        OR ${labelEnNormalized} LIKE ${normalizedLikeToken}
        OR ${labelEnNormalized} LIKE ${fuzzyLikeToken}
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(labels_ar) AS label_ar
      WHERE
        LOWER(label_ar) LIKE ${rawLikeToken}
        OR ${labelArNormalized} LIKE ${normalizedLikeToken}
        OR ${labelArNormalized} LIKE ${fuzzyLikeToken}
    )
  `;
}

function parseDateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function extractAnimatedVideoUrl(sourcePayload) {
  const payload =
    sourcePayload && typeof sourcePayload === "object" && !Array.isArray(sourcePayload)
      ? sourcePayload
      : null;
  if (!payload) return "";

  const directUrl = sanitizeUrl(payload.videoUrl || payload.animatedVideoUrl);
  if (directUrl && /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(directUrl)) {
    return directUrl;
  }

  const thumbnails = Array.isArray(payload.thumbnails) ? payload.thumbnails : [];
  for (const thumb of thumbnails) {
    const url = sanitizeUrl(thumb?.url);
    if (url && /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(url)) {
      return url;
    }
  }

  const gifLikeSource = sanitizeUrl(payload.assetUrl || payload.thumbnailUrl);
  if (gifLikeSource) {
    try {
      const parsed = new URL(gifLikeSource);
      const isGifHost =
        parsed.hostname === "cdn-icons-gif.freepik.com" ||
        parsed.hostname === "cdn-icons-png.freepik.com";
      if (isGifHost) {
        const parts = parsed.pathname.split("/").filter(Boolean);
        const filePart = parts[parts.length - 1] || "";
        const idPart = filePart.replace(/\.(gif|png|webp)$/i, "");
        if (/^\d+$/.test(idPart)) {
          const folderPart =
            parts.length >= 2
              ? /^\d+$/.test(parts[parts.length - 2])
                ? parts[parts.length - 2]
                : String(Math.floor(Number(idPart) / 1000))
              : String(Math.floor(Number(idPart) / 1000));
          return `https://cdn-icons-mp4.freepik.com/512/${folderPart}/${idPart}.mp4`;
        }
      }
    } catch {
      // ignore malformed urls
    }
  }

  const idLike = sanitizeText(payload.id || payload.sourceAssetId);
  if (/^\d+$/.test(idLike)) {
    const folder = String(Math.floor(Number(idLike) / 1000));
    return `https://cdn-icons-mp4.freepik.com/512/${folder}/${idLike}.mp4`;
  }
  return "";
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
  const tags =
    resolvedLocale === "ar"
      ? tagsAr.length > 0
        ? tagsAr
        : tagsEn
      : tagsEn.length > 0
        ? tagsEn
        : tagsAr;
  const labels =
    resolvedLocale === "ar"
      ? labelsAr.length > 0
        ? labelsAr
        : labelsEn
      : labelsEn.length > 0
        ? labelsEn
        : labelsAr;
  const sourcePayload =
    row.source_payload && typeof row.source_payload === "object" && !Array.isArray(row.source_payload)
      ? row.source_payload
      : {};

  return {
    id: String(row.id || ""),
    source: sanitizeSource(row.source),
    sourceAssetId: sanitizeText(row.source_asset_id),
    kind: sanitizeKind(row.kind),
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
    styleId: Number.isFinite(Number(row.style_id)) ? Number(row.style_id) : null,
    styleName: sanitizeText(row.style_name),
    familyId: Number.isFinite(Number(row.family_id)) ? Number(row.family_id) : null,
    familyName: sanitizeText(row.family_name),
    authorId: Number.isFinite(Number(row.author_id)) ? Number(row.author_id) : null,
    authorName: sanitizeText(row.author_name),
    categoryValue: sanitizeText(row.category_value),
    assetUrl: sanitizeText(row.asset_url),
    thumbnailUrl: sanitizeText(row.thumbnail_url),
    animatedVideoUrl: extractAnimatedVideoUrl(row.source_payload),
    width: Number.isFinite(Number(row.width)) ? Number(row.width) : null,
    height: Number.isFinite(Number(row.height)) ? Number(row.height) : null,
    freeSvg: Boolean(row.free_svg),
    sourcePayload,
    translationStatus: sanitizeText(row.translation_status) || "fallback",
    createdSourceAt: row.created_source_at ? new Date(row.created_source_at).toISOString() : "",
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : "",
  };
}

export async function upsertImportedElementAsset(input) {
  await ensureImportedElementsSchema();

  const id = sanitizeText(input?.id) || randomUUID();
  const source = sanitizeSource(input?.source);
  const sourceAssetId = sanitizeText(input?.sourceAssetId || input?.source_asset_id);
  if (!sourceAssetId) {
    throw new Error("Missing sourceAssetId for imported element.");
  }

  const ownerId = sanitizeText(input?.ownerId || input?.owner_id) || null;
  const kind = sanitizeKind(input?.kind);
  const titleEn = sanitizeText(input?.titleEn || input?.title_en || input?.title);
  const titleAr = sanitizeText(input?.titleAr || input?.title_ar || input?.title);
  const tagsEn = sanitizeArray(input?.tagsEn || input?.tags_en || input?.tags);
  const tagsAr = sanitizeArray(input?.tagsAr || input?.tags_ar || input?.tags);
  const labelsEn = sanitizeArray(input?.labelsEn || input?.labels_en || input?.labels);
  const labelsAr = sanitizeArray(input?.labelsAr || input?.labels_ar || input?.labels);
  const slug = sanitizeText(input?.slug);
  const styleId = Number.isFinite(Number(input?.styleId)) ? Number(input.styleId) : null;
  const styleName = sanitizeText(input?.styleName);
  const familyId = Number.isFinite(Number(input?.familyId)) ? Number(input.familyId) : null;
  const familyName = sanitizeText(input?.familyName);
  const authorId = Number.isFinite(Number(input?.authorId)) ? Number(input.authorId) : null;
  const authorName = sanitizeText(input?.authorName);
  const categoryValue = sanitizeText(input?.categoryValue || input?.category || input?.category_value).toLowerCase();
  const assetUrl = sanitizeText(input?.assetUrl || input?.asset_url);
  const thumbnailUrl = sanitizeText(input?.thumbnailUrl || input?.thumbnail_url || assetUrl);
  if (!assetUrl || !thumbnailUrl) {
    throw new Error("Imported element requires asset and thumbnail URLs.");
  }

  const width = Number.isFinite(Number(input?.width)) ? Math.max(1, Math.round(Number(input.width))) : null;
  const height = Number.isFinite(Number(input?.height)) ? Math.max(1, Math.round(Number(input.height))) : null;
  const freeSvg = Boolean(input?.freeSvg || input?.free_svg);
  const sourcePayload = input?.sourcePayload && typeof input.sourcePayload === "object" ? input.sourcePayload : {};
  const translationStatus = ["translated", "fallback", "failed"].includes(String(input?.translationStatus || "").toLowerCase())
    ? String(input.translationStatus).toLowerCase()
    : "fallback";
  const createdSourceAt = parseDateValue(input?.createdSourceAt || input?.created_source_at);

  const rows = await prisma.$queryRaw`
    INSERT INTO editor_element_assets (
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
      style_id,
      style_name,
      family_id,
      family_name,
      author_id,
      author_name,
      category_value,
      asset_url,
      thumbnail_url,
      width,
      height,
      free_svg,
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
      ${kind},
      ${titleEn || sourceAssetId},
      ${titleAr || titleEn || sourceAssetId},
      ${JSON.stringify(tagsEn)}::jsonb,
      ${JSON.stringify(tagsAr.length > 0 ? tagsAr : tagsEn)}::jsonb,
      ${JSON.stringify(labelsEn)}::jsonb,
      ${JSON.stringify(labelsAr.length > 0 ? labelsAr : labelsEn)}::jsonb,
      ${slug || null},
      ${styleId},
      ${styleName || null},
      ${familyId},
      ${familyName || null},
      ${authorId},
      ${authorName || null},
      ${categoryValue || null},
      ${assetUrl},
      ${thumbnailUrl},
      ${width},
      ${height},
      ${freeSvg},
      ${JSON.stringify(sourcePayload)}::jsonb,
      ${translationStatus},
      ${createdSourceAt ? new Date(createdSourceAt) : null},
      NOW(),
      NOW()
    )
    ON CONFLICT (source, source_asset_id)
    DO UPDATE SET
      owner_id = COALESCE(EXCLUDED.owner_id, editor_element_assets.owner_id),
      kind = EXCLUDED.kind,
      title_en = EXCLUDED.title_en,
      title_ar = EXCLUDED.title_ar,
      tags_en = EXCLUDED.tags_en,
      tags_ar = EXCLUDED.tags_ar,
      labels_en = EXCLUDED.labels_en,
      labels_ar = EXCLUDED.labels_ar,
      slug = EXCLUDED.slug,
      style_id = EXCLUDED.style_id,
      style_name = EXCLUDED.style_name,
      family_id = EXCLUDED.family_id,
      family_name = EXCLUDED.family_name,
      author_id = EXCLUDED.author_id,
      author_name = EXCLUDED.author_name,
      category_value = EXCLUDED.category_value,
      asset_url = EXCLUDED.asset_url,
      thumbnail_url = EXCLUDED.thumbnail_url,
      width = EXCLUDED.width,
      height = EXCLUDED.height,
      free_svg = EXCLUDED.free_svg,
      source_payload = EXCLUDED.source_payload,
      translation_status = EXCLUDED.translation_status,
      created_source_at = COALESCE(EXCLUDED.created_source_at, editor_element_assets.created_source_at),
      updated_at = NOW()
    RETURNING *
  `;

  return normalizeRow(Array.isArray(rows) ? rows[0] : null);
}

function buildSearchCondition(queryValue, nextParam) {
  const rawQuery = sanitizeText(queryValue).toLowerCase();
  const normalizedQuery = normalizeSearchTerm(queryValue);
  const effectiveQuery = normalizedQuery || rawQuery;
  if (!effectiveQuery) return "";

  const rawLikeToken = nextParam(`%${rawQuery || effectiveQuery}%`);
  const normalizedLikeToken = nextParam(`%${effectiveQuery}%`);
  const fuzzyLikeToken = nextParam(buildFuzzyLikePattern(effectiveQuery));
  const primarySearchSql = buildSearchFieldsSql(
    rawLikeToken,
    normalizedLikeToken,
    fuzzyLikeToken
  );

  const tokenClauses = normalizedQuery
    .split(" ")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, SEARCH_TOKEN_LIMIT)
    .map((token) => {
      const tokenRaw = nextParam(`%${token}%`);
      const tokenNormalized = nextParam(`%${token}%`);
      const tokenFuzzy = nextParam(buildFuzzyLikePattern(token));
      return `(${buildSearchFieldsSql(tokenRaw, tokenNormalized, tokenFuzzy)})`;
    });

  return `
    AND (
      ${primarySearchSql}
      ${tokenClauses.length > 0 ? `OR (${tokenClauses.join(" AND ")})` : ""}
    )
  `;
}

export async function listImportedElementAssets(options = {}) {
  await ensureImportedElementsSchema();

  const source = sanitizeSourceFilter(options.source);
  const categoryValue = sanitizeCategoryFilter(options.categoryValue || options.category);
  const kindRaw = sanitizeText(options.kind).toLowerCase();
  const kind = kindRaw === "all" || !kindRaw ? "" : sanitizeKind(kindRaw);
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
  const kindSql = kind ? `AND kind = ${nextParam(kind)}` : "";
  const searchSql = buildSearchCondition(options.query, nextParam);

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM editor_element_assets
    WHERE ${sourceSql}
    ${categorySql}
    ${kindSql}
    ${searchSql}
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
    FROM editor_element_assets
    WHERE ${sourceSql}
    ${categorySql}
    ${kindSql}
    ${searchSql}
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

export async function deleteImportedElementAsset(options = {}) {
  await ensureImportedElementsSchema();

  const id = sanitizeText(options.id);
  if (!id) {
    throw new Error("Imported element id is required.");
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
      DELETE FROM editor_element_assets
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
