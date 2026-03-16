import { randomUUID } from "node:crypto";

import prisma from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertImportedElementAsset } from "@/lib/editor/importedElements.server";
import { translateBatchToArabic } from "@/lib/tools/arabicTranslate.server";
import { convertGifWhiteToTransparent } from "@/lib/media/gifChromaKey.server";

const FREEPIK_SETTINGS_KEY = "freepik_import_settings_v1";
const FREEPIK_ICONS_API_URL = "https://api.freepik.com/v1/icons";
const DEFAULT_BUCKET = process.env.EDITOR_MEDIA_BUCKET || "editor-media";
const DOWNLOAD_TIMEOUT_MS = 20_000;
const PREVIEW_PAGE_SIZE_MAX = 100;
const IMPORT_BATCH_LIMIT = 300;

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
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

function isVideoAssetUrl(value) {
  const source = String(value || "").trim().toLowerCase();
  if (!source) return false;
  if (source.startsWith("data:video/")) return true;
  return /\.(mp4|webm|mov|m4v|avi)(?:$|[?#])/i.test(source);
}

function isGifAssetUrl(value) {
  const source = String(value || "").trim().toLowerCase();
  if (!source) return false;
  if (source.startsWith("data:image/gif")) return true;
  return /\.gif(?:$|[?#])/i.test(source);
}

function sanitizeOrder(value) {
  const normalized = sanitizeText(value).toLowerCase();
  const aliases = {
    relevant: "relevance",
    latest: "recent",
    popular: "recent",
  };
  if (aliases[normalized]) return aliases[normalized];
  const allowed = new Set(["relevance", "recent"]);
  if (allowed.has(normalized)) return normalized;
  return "relevance";
}

function sanitizeThumbnailSize(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const allowed = new Set(["64", "128", "256", "512", "1024"]);
  if (allowed.has(normalized)) return normalized;
  return "512";
}

function sanitizeFilters(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sanitizeApiKey(value) {
  return String(value || "").trim();
}

function maskApiKey(value) {
  const source = sanitizeApiKey(value);
  if (!source) return "";
  if (source.length <= 8) return "*".repeat(source.length);
  return `${source.slice(0, 4)}${"*".repeat(Math.max(4, source.length - 8))}${source.slice(-4)}`;
}

export function normalizeFreepikQueryInput(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    term: sanitizeText(source.term),
    slug: sanitizeText(source.slug),
    page: clampInt(source.page, 1, 1, 10_000),
    perPage: clampInt(source.perPage || source.per_page, 100, 1, PREVIEW_PAGE_SIZE_MAX),
    familyId: clampInt(source.familyId || source["family-id"], 0, 0, Number.MAX_SAFE_INTEGER),
    order: sanitizeOrder(source.order),
    thumbnailSize: sanitizeThumbnailSize(source.thumbnailSize || source.thumbnail_size),
    acceptLanguage: sanitizeText(source.acceptLanguage || source.accept_language || source.language),
    filters: sanitizeFilters(source.filters),
  };
}

function toStoredSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    apiKey: sanitizeApiKey(source.apiKey),
    defaults: normalizeFreepikQueryInput(source.defaults || {}),
    updatedAt: sanitizeText(source.updatedAt) || new Date().toISOString(),
  };
}

export async function getFreepikImportSettings() {
  try {
    const record = await prisma.appSetting.findUnique({
      where: { key: FREEPIK_SETTINGS_KEY },
      select: { value: true },
    });
    if (!record?.value) {
      return toStoredSettings({ defaults: {} });
    }
    return toStoredSettings(record.value);
  } catch {
    return toStoredSettings({ defaults: {} });
  }
}

export async function saveFreepikImportSettings(input = {}) {
  const current = await getFreepikImportSettings();
  const nextApiKey = sanitizeApiKey(input.apiKey);
  const nextDefaults = normalizeFreepikQueryInput(input.defaults || current.defaults);

  const next = {
    apiKey: nextApiKey || current.apiKey,
    defaults: nextDefaults,
    updatedAt: new Date().toISOString(),
  };

  await prisma.appSetting.upsert({
    where: { key: FREEPIK_SETTINGS_KEY },
    create: {
      key: FREEPIK_SETTINGS_KEY,
      value: next,
    },
    update: {
      value: next,
    },
  });

  return {
    ...next,
    apiKeyMasked: maskApiKey(next.apiKey),
    apiKeyConfigured: Boolean(next.apiKey),
  };
}

function buildFreepikSearchParams(query) {
  const normalized = normalizeFreepikQueryInput(query);
  const params = new URLSearchParams();
  if (normalized.term) params.set("term", normalized.term);
  if (normalized.slug) params.set("slug", normalized.slug);
  params.set("page", String(normalized.page));
  params.set("per_page", String(normalized.perPage));
  if (normalized.familyId > 0) params.set("family-id", String(normalized.familyId));
  if (normalized.order) params.set("order", normalized.order);
  if (normalized.thumbnailSize) params.set("thumbnail_size", normalized.thumbnailSize);
  if (normalized.filters && Object.keys(normalized.filters).length > 0) {
    Object.entries(normalized.filters).forEach(([key, rawValue]) => {
      const safeKey = sanitizeText(key);
      if (!safeKey) return;

      if (Array.isArray(rawValue)) {
        rawValue.forEach((entry, index) => {
          const value = sanitizeText(entry);
          if (!value) return;
          params.append(`filters[${safeKey}][${index}]`, value);
        });
        return;
      }

      if (rawValue === null || rawValue === undefined) return;
      const value = sanitizeText(rawValue);
      if (!value) return;
      params.append(`filters[${safeKey}]`, value);
    });
  }
  return {
    normalized,
    params,
  };
}

function normalizeFreepikItem(item) {
  const source = item && typeof item === "object" ? item : {};
  const sourcePayload =
    source.sourcePayload && typeof source.sourcePayload === "object" ? source.sourcePayload : null;
  const tags = Array.isArray(source.tags)
    ? source.tags
        .map((entry) =>
          sanitizeText(
            typeof entry === "string" ? entry : entry?.name || entry?.slug
          )
        )
        .filter(Boolean)
    : [];

  const thumbnails = Array.isArray(source.thumbnails)
    ? source.thumbnails
    : Array.isArray(sourcePayload?.thumbnails)
    ? sourcePayload.thumbnails
    : [];

  const normalizedThumbs = thumbnails
    .map((entry) => ({
      width: Number.isFinite(Number(entry?.width)) ? Number(entry.width) : null,
      height: Number.isFinite(Number(entry?.height)) ? Number(entry.height) : null,
      url: sanitizeUrl(entry?.url),
    }))
    .filter((entry) => entry.url);

  const nonVideoThumbs = normalizedThumbs.filter((entry) => !isVideoAssetUrl(entry.url));
  const gifThumb = nonVideoThumbs.find((entry) => isGifAssetUrl(entry.url)) || null;
  const videoThumb = normalizedThumbs.find((entry) => isVideoAssetUrl(entry.url)) || null;
  const defaultThumb =
    nonVideoThumbs.find((entry) => Number(entry.width || 0) >= 512) ||
    nonVideoThumbs[0] ||
    normalizedThumbs[0] ||
    null;

  const selectedThumb = gifThumb || defaultThumb;

  const sourceThumbnailUrl = sanitizeUrl(source.thumbnailUrl || sourcePayload?.thumbnailUrl);
  const sourceAssetUrl = sanitizeUrl(source.assetUrl || sourcePayload?.assetUrl);
  const sourceVideoUrl = sanitizeUrl(source.videoUrl || source.animatedVideoUrl || sourcePayload?.videoUrl || sourcePayload?.animatedVideoUrl);

  const thumbnailUrl =
    sourceThumbnailUrl ||
    sanitizeUrl(selectedThumb?.url) ||
    sanitizeUrl(defaultThumb?.url) ||
    sourceAssetUrl;
  const assetUrl =
    sourceAssetUrl ||
    sanitizeUrl(gifThumb?.url) ||
    sanitizeUrl(defaultThumb?.url) ||
    thumbnailUrl;
  const videoUrl =
    sourceVideoUrl ||
    sanitizeUrl(videoThumb?.url) ||
    "";

  return {
    id: String(source.id || ""),
    name: sanitizeText(source.name),
    slug: sanitizeText(source.slug),
    created: sanitizeText(source.created),
    style: {
      id: Number.isFinite(Number(source?.style?.id)) ? Number(source.style.id) : null,
      name: sanitizeText(source?.style?.name),
    },
    family: {
      id: Number.isFinite(Number(source?.family?.id)) ? Number(source.family.id) : null,
      name: sanitizeText(source?.family?.name),
      total: Number.isFinite(Number(source?.family?.total)) ? Number(source.family.total) : null,
    },
    freeSvg: Boolean(source.free_svg),
    author: {
      id: Number.isFinite(Number(source?.author?.id)) ? Number(source.author.id) : null,
      name: sanitizeText(source?.author?.name),
      slug: sanitizeText(source?.author?.slug),
      avatar: sanitizeUrl(source?.author?.avatar),
      assets: Number.isFinite(Number(source?.author?.assets)) ? Number(source.author.assets) : null,
    },
    tags,
    thumbnailUrl,
    assetUrl,
    videoUrl,
    width: Number.isFinite(Number(selectedThumb?.width))
      ? Number(selectedThumb.width)
      : Number.isFinite(Number(source.width))
      ? Number(source.width)
      : null,
    height: Number.isFinite(Number(selectedThumb?.height))
      ? Number(selectedThumb.height)
      : Number.isFinite(Number(source.height))
      ? Number(source.height)
      : null,
    sourcePayload: sourcePayload || source,
  };
}

export async function previewFreepikIcons({ query = {}, apiKey = "" } = {}) {
  const key = sanitizeApiKey(apiKey);
  if (!key) {
    throw new Error("Freepik API key is not configured.");
  }

  const { normalized, params } = buildFreepikSearchParams(query);
  const url = `${FREEPIK_ICONS_API_URL}?${params.toString()}`;

  const headers = {
    "x-freepik-api-key": key,
    Accept: "application/json",
  };
  if (normalized.acceptLanguage) {
    headers["Accept-Language"] = normalized.acceptLanguage;
  }

  const curlLines = [
    "curl --request GET \\",
    `  --url '${url}' \\`,
    `  --header 'x-freepik-api-key: ${maskApiKey(key) || "YOUR_API_KEY"}'`,
  ];
  if (normalized.acceptLanguage) {
    curlLines.splice(
      2,
      0,
      `  --header 'Accept-Language: ${normalized.acceptLanguage}' \\`
    );
  }
  const debugCurl = curlLines.join("\n");

  const response = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      String(payload?.message || payload?.error || `Freepik request failed (${response.status}).`)
    );
  }

  const items = Array.isArray(payload?.data)
    ? payload.data.map(normalizeFreepikItem).filter((item) => item.id && item.thumbnailUrl)
    : [];

  const pagination = payload?.meta?.pagination || {};
  return {
    query: normalized,
    items,
    pagination: {
      total: Number.isFinite(Number(pagination.total)) ? Number(pagination.total) : items.length,
      lastPage: Number.isFinite(Number(pagination.last_page)) ? Number(pagination.last_page) : 1,
      perPage: Number.isFinite(Number(pagination.per_page)) ? Number(pagination.per_page) : normalized.perPage,
      currentPage: Number.isFinite(Number(pagination.current_page))
        ? Number(pagination.current_page)
        : normalized.page,
    },
    debug: {
      url,
      curl: debugCurl,
    },
  };
}

function sanitizeSelectedItems(value) {
  if (!Array.isArray(value)) return [];
  const uniqueById = new Map();

  value.slice(0, IMPORT_BATCH_LIMIT).forEach((item) => {
    const normalized = normalizeFreepikItem(item);
    if (!normalized.id || !normalized.thumbnailUrl) return;
    uniqueById.set(normalized.id, normalized);
  });

  return Array.from(uniqueById.values());
}

function inferContentType(url, headerValue) {
  const normalizedHeader = sanitizeText(headerValue).toLowerCase();
  if (normalizedHeader) {
    return normalizedHeader.split(";")[0].trim();
  }
  const source = String(url || "").toLowerCase();
  if (/\.png(?:$|[?#])/i.test(source)) return "image/png";
  if (/\.jpe?g(?:$|[?#])/i.test(source)) return "image/jpeg";
  if (/\.webp(?:$|[?#])/i.test(source)) return "image/webp";
  if (/\.gif(?:$|[?#])/i.test(source)) return "image/gif";
  if (/\.svg(?:$|[?#])/i.test(source)) return "image/svg+xml";
  if (/\.mp4(?:$|[?#])/i.test(source)) return "video/mp4";
  if (/\.webm(?:$|[?#])/i.test(source)) return "video/webm";
  if (/\.mov(?:$|[?#])/i.test(source)) return "video/quicktime";
  if (/\.m4v(?:$|[?#])/i.test(source)) return "video/mp4";
  return "application/octet-stream";
}

async function ensurePublicBucket(admin) {
  const { data, error } = await admin.storage.getBucket(DEFAULT_BUCKET);
  if (error) {
    const created = await admin.storage.createBucket(DEFAULT_BUCKET, {
      public: true,
      fileSizeLimit: "104857600",
    });
    if (created.error && !String(created.error.message || "").toLowerCase().includes("exists")) {
      throw created.error;
    }
    return;
  }

  if (data && data.public === false) {
    await admin.storage.updateBucket(DEFAULT_BUCKET, {
      public: true,
      fileSizeLimit: "104857600",
    });
  }
}

async function downloadAsset(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "image/*,application/octet-stream,*/*",
      },
    });
    if (!response.ok) {
      throw new Error(`Download failed (${response.status}).`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      bytes,
      mimeType: inferContentType(url, response.headers.get("content-type")),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extensionFromMimeType(mimeType) {
  const source = sanitizeText(mimeType).toLowerCase();
  if (source.includes("png")) return "png";
  if (source.includes("jpeg") || source.includes("jpg")) return "jpg";
  if (source.includes("webp")) return "webp";
  if (source.includes("gif")) return "gif";
  if (source.includes("svg")) return "svg";
  if (source.includes("mp4")) return "mp4";
  if (source.includes("webm")) return "webm";
  if (source.includes("quicktime")) return "mov";
  return "bin";
}

async function uploadAssetToStorage({ ownerId, sourceAssetId, bytes, mimeType }) {
  const extension = extensionFromMimeType(mimeType);
  const objectPath = [
    "users",
    sanitizeText(ownerId),
    "elements",
    "freepik",
    `${sanitizeText(sourceAssetId) || randomUUID()}-${randomUUID()}.${extension}`,
  ].join("/");

  const admin = createAdminClient();
  await ensurePublicBucket(admin);

  const { error } = await admin.storage.from(DEFAULT_BUCKET).upload(objectPath, bytes, {
    contentType: mimeType || "application/octet-stream",
    upsert: false,
    cacheControl: "31536000",
  });
  if (error) {
    throw new Error(error.message || "Failed to upload imported asset.");
  }

  const { data } = admin.storage.from(DEFAULT_BUCKET).getPublicUrl(objectPath);
  const publicUrl = sanitizeUrl(data?.publicUrl);
  if (!publicUrl) {
    throw new Error("Imported asset URL is unavailable.");
  }
  return publicUrl;
}

function buildLabelsEn(item) {
  const labels = [];
  if (item?.style?.name) labels.push(item.style.name);
  if (item?.family?.name) labels.push(item.family.name);
  if (item?.author?.name) labels.push(item.author.name);
  return Array.from(new Set(labels.map((value) => sanitizeText(value)).filter(Boolean))).slice(0, 40);
}

function resolveTranslationStatus({ titleEn, titleAr, tagsEn, tagsAr }) {
  const hasTitleTranslation = titleAr && titleAr !== titleEn;
  const hasTagTranslation = tagsAr.some((value, index) => value && value !== tagsEn[index]);
  if (hasTitleTranslation || hasTagTranslation) return "translated";
  return "fallback";
}

function asProgressText(current, total) {
  return `Importing Freepik icons (${current}/${total})...`;
}

export async function runFreepikImportForOwner({ ownerId, selectedItems = [], onProgress } = {}) {
  const safeOwnerId = sanitizeText(ownerId);
  if (!safeOwnerId) {
    throw new Error("Owner id is required for Freepik import.");
  }

  const items = sanitizeSelectedItems(selectedItems);
  if (items.length === 0) {
    throw new Error("No icons selected to import.");
  }

  const translationInputs = new Set();
  items.forEach((item) => {
    translationInputs.add(item.name);
    item.tags.forEach((tag) => translationInputs.add(tag));
    buildLabelsEn(item).forEach((label) => translationInputs.add(label));
  });
  const translationMap = await translateBatchToArabic(Array.from(translationInputs));

  const result = {
    imported: 0,
    skipped: 0,
    failed: 0,
    totalRequested: items.length,
    errors: [],
  };

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (typeof onProgress === "function") {
      await onProgress(asProgressText(index + 1, items.length));
    }

    try {
      const downloadUrl = item.assetUrl || item.videoUrl || item.thumbnailUrl;
      const downloaded = await downloadAsset(downloadUrl);
      let uploadBytes = downloaded.bytes;
      let uploadMimeType = downloaded.mimeType;

      const shouldProcessGif =
        isGifAssetUrl(downloadUrl) || String(downloaded.mimeType || "").toLowerCase().includes("gif");
      if (shouldProcessGif) {
        try {
          const converted = await convertGifWhiteToTransparent(downloaded.bytes, {
            threshold: 242,
            chromaTolerance: 24,
            softness: 16,
            minWhiteRatio: 0.08,
            fringeThreshold: 220,
            fringeTolerance: 42,
            fringeBrightThreshold: 196,
            fringeBrightSpreadTolerance: 96,
            edgeDematteDistance: 2,
            edgeDematteRadius: 5,
            edgeDematteMinBrightnessDelta: 6,
            edgeDematteMinWhitenessDelta: 12,
            edgeDematteMinColorDelta: 12,
            edgeDematteSpreadSlack: 64,
            edgeRecolorRadius: 3,
            edgeRecolorLumaThreshold: 150,
            edgeRecolorSpreadThreshold: 58,
            edgeRecolorMinDelta: 34,
          });
          if (converted?.bytes?.length) {
            uploadBytes = converted.bytes;
            uploadMimeType = converted.mimeType || "image/gif";
          }
        } catch (error) {
          console.warn(
            `[freepik-import] GIF transparency processing failed for ${item.id}: ${
              error instanceof Error ? error.message : "unknown error"
            }`
          );
        }
      }

      const storedUrl = await uploadAssetToStorage({
        ownerId: safeOwnerId,
        sourceAssetId: item.id,
        bytes: uploadBytes,
        mimeType: uploadMimeType,
      });

      const titleEn = item.name || item.slug || `Freepik ${item.id}`;
      const titleAr = translationMap.get(titleEn) || titleEn;
      const tagsEn = item.tags;
      const tagsAr = tagsEn.map((value) => translationMap.get(value) || value);
      const labelsEn = buildLabelsEn(item);
      const labelsAr = labelsEn.map((value) => translationMap.get(value) || value);

      await upsertImportedElementAsset({
        source: "freepik",
        sourceAssetId: item.id,
        ownerId: safeOwnerId,
        kind: "icon",
        titleEn,
        titleAr,
        tagsEn,
        tagsAr,
        labelsEn,
        labelsAr,
        slug: item.slug,
        styleId: item.style.id,
        styleName: item.style.name,
        familyId: item.family.id,
        familyName: item.family.name,
        authorId: item.author.id,
        authorName: item.author.name,
        assetUrl: storedUrl,
        thumbnailUrl: storedUrl,
        width: item.width,
        height: item.height,
        freeSvg: item.freeSvg,
        sourcePayload: item.sourcePayload,
        translationStatus: resolveTranslationStatus({
          titleEn,
          titleAr,
          tagsEn,
          tagsAr,
        }),
        createdSourceAt: item.created,
      });

      result.imported += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        id: item.id,
        message: error instanceof Error ? error.message : "Failed to import icon.",
      });
    }
  }

  return result;
}
