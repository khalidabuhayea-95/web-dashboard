import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import prisma from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertImportedElementAsset } from "@/lib/editor/importedElements.server";
import { upsertImportedBackgroundAsset } from "@/lib/editor/importedBackgrounds.server";
import { translateBatchToArabic } from "@/lib/tools/arabicTranslate.server";
import { removeBackground } from "@/lib/media/backgroundRemoval/index.server";
import {
  getBackgroundCategorySettings,
} from "@/lib/backgrounds/categorySettings.server";
import { normalizeBackgroundCategory } from "@/lib/backgrounds/categorySettings";

const FREEPIK_SETTINGS_KEY = "freepik_import_settings_v1";
const FREEPIK_ICONS_API_URL = "https://api.freepik.com/v1/icons";
const FREEPIK_RESOURCES_API_URL = "https://api.freepik.com/v1/resources";
const DEFAULT_BUCKET = process.env.EDITOR_MEDIA_BUCKET || "editor-media";
const DOWNLOAD_TIMEOUT_MS = 20_000;
const PREVIEW_PAGE_SIZE_MAX = 100;
const IMPORT_BATCH_LIMIT = 300;
const MAX_ZIP_LIST_BUFFER = 10 * 1024 * 1024;
const MAX_ZIP_EXTRACT_BUFFER = 100 * 1024 * 1024;
const execFileAsync = promisify(execFile);

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

function sanitizeBackgroundFilters(value) {
  const source = sanitizeFilters(value);
  const next = {};

  Object.entries(source).forEach(([rawKey, rawValue]) => {
    const key = sanitizeText(rawKey);
    if (!key) return;

    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      const nested = {};
      Object.entries(rawValue).forEach(([nestedKey, nestedValue]) => {
        const safeNestedKey = sanitizeText(nestedKey);
        if (!safeNestedKey) return;
        const safeNestedValue = sanitizeText(nestedValue);
        if (!safeNestedValue) return;
        nested[safeNestedKey] = safeNestedValue;
      });
      if (Object.keys(nested).length > 0) {
        next[key] = nested;
      }
      return;
    }

    if (Array.isArray(rawValue)) {
      const values = rawValue.map((entry) => sanitizeText(entry)).filter(Boolean);
      if (values.length > 0) {
        next[key] = values;
      }
      return;
    }

    const value = sanitizeText(rawValue);
    if (value) {
      next[key] = value;
    }
  });

  next.license = {
    freemium: "1",
  };

  return next;
}

function appendFilterParam(params, prefix, rawValue) {
  if (rawValue === null || rawValue === undefined) return;

  if (Array.isArray(rawValue)) {
    rawValue.forEach((entry, index) => {
      appendFilterParam(params, `${prefix}[${index}]`, entry);
    });
    return;
  }

  if (rawValue && typeof rawValue === "object") {
    Object.entries(rawValue).forEach(([nestedKey, nestedValue]) => {
      const safeNestedKey = sanitizeText(nestedKey);
      if (!safeNestedKey) return;
      appendFilterParam(params, `${prefix}[${safeNestedKey}]`, nestedValue);
    });
    return;
  }

  const value = sanitizeText(rawValue);
  if (!value) return;
  params.append(prefix, value);
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
      appendFilterParam(params, `filters[${safeKey}]`, rawValue);
    });
  }
  return {
    normalized,
    params,
  };
}

export function normalizeFreepikBackgroundQueryInput(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    term: sanitizeText(source.term),
    slug: sanitizeText(source.slug),
    page: clampInt(source.page, 1, 1, 100),
    limit: clampInt(source.limit || source.perPage || source.per_page, 40, 1, PREVIEW_PAGE_SIZE_MAX),
    order: sanitizeOrder(source.order),
    acceptLanguage: sanitizeText(source.acceptLanguage || source.accept_language || source.language),
    filters: sanitizeBackgroundFilters(source.filters),
  };
}

function buildFreepikResourceSearchParams(query) {
  const normalized = normalizeFreepikBackgroundQueryInput(query);
  const params = new URLSearchParams();
  if (normalized.term) params.set("term", normalized.term);
  if (normalized.slug) params.set("slug", normalized.slug);
  params.set("page", String(normalized.page));
  params.set("limit", String(normalized.limit));
  if (normalized.order) params.set("order", normalized.order);
  if (normalized.filters && Object.keys(normalized.filters).length > 0) {
    Object.entries(normalized.filters).forEach(([key, rawValue]) => {
      const safeKey = sanitizeText(key);
      if (!safeKey) return;
      appendFilterParam(params, `filters[${safeKey}]`, rawValue);
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

function normalizeRelatedKeywords(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeText(typeof entry === "string" ? entry : entry?.name || entry?.slug))
      .filter(Boolean);
  }
  if (value && typeof value === "object") {
    const single = sanitizeText(value?.name || value?.slug);
    return single ? [single] : [];
  }
  return [];
}

function parseImageSize(value) {
  const source = sanitizeText(value);
  const match = source.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) {
    return { width: null, height: null };
  }
  return {
    width: Number.isFinite(Number(match[1])) ? Number(match[1]) : null,
    height: Number.isFinite(Number(match[2])) ? Number(match[2]) : null,
  };
}

function normalizeFreepikBackgroundItem(item) {
  const source = item && typeof item === "object" ? item : {};
  const sourcePayload =
    source.sourcePayload && typeof source.sourcePayload === "object" ? source.sourcePayload : null;
  const image =
    source.image && typeof source.image === "object"
      ? source.image
      : sourcePayload?.image && typeof sourcePayload.image === "object"
      ? sourcePayload.image
      : {};
  const previewSource =
    image.source && typeof image.source === "object"
      ? image.source
      : sourcePayload?.image?.source && typeof sourcePayload.image.source === "object"
      ? sourcePayload.image.source
      : {};
  const dimensions = parseImageSize(previewSource?.size);
  const tags = normalizeRelatedKeywords(source?.related?.keywords || sourcePayload?.related?.keywords);

  return {
    id: String(source.id || ""),
    title: sanitizeText(source.title || source.name),
    slug: sanitizeText(source.slug),
    type: sanitizeText(source.type || image.type),
    orientation: sanitizeText(image.orientation),
    tags,
    thumbnailUrl: sanitizeUrl(source.thumbnailUrl || previewSource?.url),
    assetUrl: sanitizeUrl(source.assetUrl || previewSource?.url),
    width: Number.isFinite(Number(source.width))
      ? Number(source.width)
      : Number.isFinite(Number(dimensions.width))
      ? Number(dimensions.width)
      : null,
    height: Number.isFinite(Number(source.height))
      ? Number(source.height)
      : Number.isFinite(Number(dimensions.height))
      ? Number(dimensions.height)
      : null,
    created: sanitizeText(source?.meta?.published_at || source.created),
    author: {
      id: Number.isFinite(Number(source?.author?.id)) ? Number(source.author.id) : null,
      name: sanitizeText(source?.author?.name),
      slug: sanitizeText(source?.author?.slug),
      avatar: sanitizeUrl(source?.author?.avatar),
      assets: Number.isFinite(Number(source?.author?.assets)) ? Number(source.author.assets) : null,
    },
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

export async function previewFreepikBackgrounds({ query = {}, apiKey = "" } = {}) {
  const key = sanitizeApiKey(apiKey);
  if (!key) {
    throw new Error("Freepik API key is not configured.");
  }

  const { normalized, params } = buildFreepikResourceSearchParams(query);
  const url = `${FREEPIK_RESOURCES_API_URL}?${params.toString()}`;

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
    ? payload.data
        .map(normalizeFreepikBackgroundItem)
        .filter((item) => item.id && (item.assetUrl || item.thumbnailUrl))
    : [];

  const pagination = payload?.meta || {};
  return {
    query: normalized,
    items,
    pagination: {
      total: Number.isFinite(Number(pagination.total)) ? Number(pagination.total) : items.length,
      lastPage: Number.isFinite(Number(pagination.last_page)) ? Number(pagination.last_page) : 1,
      perPage: Number.isFinite(Number(pagination.per_page)) ? Number(pagination.per_page) : normalized.limit,
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

function sanitizeSelectedBackgroundItems(value) {
  if (!Array.isArray(value)) return [];
  const uniqueById = new Map();

  value.slice(0, IMPORT_BATCH_LIMIT).forEach((item) => {
    const normalized = normalizeFreepikBackgroundItem(item);
    if (!normalized.id || (!normalized.assetUrl && !normalized.thumbnailUrl)) return;
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
  if (/\.zip(?:$|[?#])/i.test(source)) return "application/zip";
  return "application/octet-stream";
}

function isZipMimeType(mimeType) {
  const normalized = sanitizeText(mimeType).toLowerCase();
  return (
    normalized.includes("application/zip") ||
    normalized.includes("application/x-zip") ||
    normalized.includes("application/x-zip-compressed") ||
    normalized.includes("multipart/x-zip") ||
    normalized.includes("compressed")
  );
}

function hasZipSignature(bytes) {
  if (!bytes || bytes.length < 4) return false;
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
  );
}

function isZipAsset({ url = "", mimeType = "", bytes = null } = {}) {
  if (isZipMimeType(mimeType)) return true;
  if (/\.zip(?:$|[?#])/i.test(String(url || "").trim().toLowerCase())) return true;
  return hasZipSignature(bytes);
}

function isSupportedExtractedImageName(fileName) {
  const mimeType = inferContentType(fileName, "");
  return /^image\/(png|jpeg|webp|gif|svg\+xml)$/i.test(mimeType);
}

function scoreZipImageEntry(fileName) {
  const normalized = String(fileName || "").trim();
  const base = basename(normalized).toLowerCase();
  let score = 0;
  if (!normalized) return score;
  if (!normalized.startsWith("__MACOSX/")) score += 100;
  if (!normalized.includes("/")) score += 30;
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(base)) score += 20;
  if (/preview|thumb|thumbnail|small|icon/.test(base)) score -= 40;
  if (/mockup|cover/.test(base)) score -= 10;
  return score;
}

async function extractPrimaryImageFromZip(bytes) {
  if (!bytes?.length) {
    throw new Error("ZIP download was empty.");
  }

  const tempDir = await mkdtemp(join(tmpdir(), "freepik-zip-"));
  const zipPath = join(tempDir, "asset.zip");
  await writeFile(zipPath, bytes);

  try {
    const { stdout: listedEntries } = await execFileAsync(
      "/usr/bin/unzip",
      ["-Z1", zipPath],
      {
        encoding: "utf8",
        maxBuffer: MAX_ZIP_LIST_BUFFER,
      }
    );

    const candidateEntries = String(listedEntries || "")
      .split(/\r?\n/)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .filter((entry) => !entry.endsWith("/"))
      .filter(isSupportedExtractedImageName)
      .sort((left, right) => scoreZipImageEntry(right) - scoreZipImageEntry(left));

    const selectedEntry = candidateEntries[0];
    if (!selectedEntry) {
      throw new Error("No supported image file was found inside the ZIP download.");
    }

    const { stdout: extractedBytes } = await execFileAsync(
      "/usr/bin/unzip",
      ["-p", zipPath, selectedEntry],
      {
        encoding: "buffer",
        maxBuffer: MAX_ZIP_EXTRACT_BUFFER,
      }
    );

    return {
      bytes: Buffer.isBuffer(extractedBytes) ? extractedBytes : Buffer.from(extractedBytes || []),
      mimeType: inferContentType(selectedEntry, ""),
      fileName: selectedEntry,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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

let sharpProbePromise = null;

async function loadSharpProbe() {
  if (sharpProbePromise) return sharpProbePromise;

  sharpProbePromise = import("sharp")
    .then((module) => module?.default || module)
    .catch((error) => {
      sharpProbePromise = null;
      throw error;
    });

  return sharpProbePromise;
}

async function probeImageDimensions(bytes) {
  if (!bytes?.length) {
    return { width: null, height: null };
  }

  try {
    const sharp = await loadSharpProbe();
    const metadata = await sharp(bytes, {
      animated: true,
      pages: -1,
      limitInputPixels: false,
    }).metadata();
    return {
      width: Number.isFinite(Number(metadata?.width)) ? Number(metadata.width) : null,
      height: Number.isFinite(Number(metadata?.height)) ? Number(metadata.height) : null,
    };
  } catch {
    return { width: null, height: null };
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

function buildBackgroundLabelsEn(item, categoryLabelEn = "") {
  const labels = [];
  if (categoryLabelEn) labels.push(categoryLabelEn);
  if (item?.type) labels.push(item.type);
  if (item?.orientation) labels.push(item.orientation);
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

function asBackgroundProgressText(current, total) {
  return `Importing Freepik backgrounds (${current}/${total})...`;
}

function isDirectAssetLikeUrl(value) {
  const source = sanitizeUrl(value);
  if (!source) return false;
  return /\.(png|jpe?g|webp|gif|svg|zip)(?:$|[?#])/i.test(source);
}

async function resolveBackgroundAssetUrl({ item, apiKey = "", acceptLanguage = "" } = {}) {
  const fallbackUrl = sanitizeUrl(item?.assetUrl || item?.thumbnailUrl);
  const resourceId = Number.parseInt(String(item?.id || ""), 10);
  if (!Number.isFinite(resourceId) || resourceId < 1 || !sanitizeApiKey(apiKey)) {
    return fallbackUrl;
  }

  const headers = {
    "x-freepik-api-key": sanitizeApiKey(apiKey),
    Accept: "application/json",
  };
  if (sanitizeText(acceptLanguage)) {
    headers["Accept-Language"] = sanitizeText(acceptLanguage);
  }

  const url = `${FREEPIK_RESOURCES_API_URL}/${resourceId}/download`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return fallbackUrl;
    }

    const candidate = sanitizeUrl(
      payload?.data?.signed_url || payload?.data?.url || payload?.signed_url || payload?.url
    );
    if (candidate && (isDirectAssetLikeUrl(candidate) || !fallbackUrl)) {
      return candidate;
    }
  } catch {
    return fallbackUrl;
  }

  return fallbackUrl;
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
          const converted = await removeBackground({
            bytes: downloaded.bytes,
            mimeType: downloaded.mimeType || "image/gif",
            fileName: `${item.id}.gif`,
            source: "freepik-import",
            strategy: "gif-white-key",
            gifOptions: {
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
            },
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

export async function runFreepikBackgroundImportForOwner({
  ownerId,
  selectedItems = [],
  categoryValue = "",
  query = {},
  onProgress,
} = {}) {
  const safeOwnerId = sanitizeText(ownerId);
  if (!safeOwnerId) {
    throw new Error("Owner id is required for Freepik background import.");
  }

  const items = sanitizeSelectedBackgroundItems(selectedItems);
  if (items.length === 0) {
    throw new Error("No backgrounds selected to import.");
  }

  const categorySettings = await getBackgroundCategorySettings();
  const normalizedCategoryValue = normalizeBackgroundCategory(categoryValue, categorySettings);
  const matchedCategory =
    categorySettings.find((item) => item.value === normalizedCategoryValue) ||
    categorySettings[0] || {
      value: normalizedCategoryValue,
      labelEn: normalizedCategoryValue,
      labelAr: normalizedCategoryValue,
    };
  const categoryLabelEn = sanitizeText(matchedCategory?.labelEn || normalizedCategoryValue);
  const categoryLabelAr = sanitizeText(matchedCategory?.labelAr || categoryLabelEn);
  const importSettings = await getFreepikImportSettings();
  const normalizedQuery = normalizeFreepikBackgroundQueryInput(query);

  const translationInputs = new Set();
  items.forEach((item) => {
    translationInputs.add(item.title);
    item.tags.forEach((tag) => translationInputs.add(tag));
  });
  const translationMap = await translateBatchToArabic(Array.from(translationInputs));

  const result = {
    imported: 0,
    skipped: 0,
    failed: 0,
    totalRequested: items.length,
    categoryValue: normalizedCategoryValue,
    errors: [],
  };

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (typeof onProgress === "function") {
      await onProgress(asBackgroundProgressText(index + 1, items.length));
    }

    try {
      const resolvedAssetUrl = await resolveBackgroundAssetUrl({
        item,
        apiKey: importSettings?.apiKey,
        acceptLanguage: normalizedQuery.acceptLanguage,
      });
      let downloaded = await downloadAsset(resolvedAssetUrl);
      if (isZipAsset({
        url: resolvedAssetUrl,
        mimeType: downloaded.mimeType,
        bytes: downloaded.bytes,
      })) {
        downloaded = await extractPrimaryImageFromZip(downloaded.bytes);
      }

      const downloadedDimensions = await probeImageDimensions(downloaded.bytes);
      const storedUrl = await uploadAssetToStorage({
        ownerId: safeOwnerId,
        sourceAssetId: item.id,
        bytes: downloaded.bytes,
        mimeType: downloaded.mimeType,
      });

      const titleEn = item.title || item.slug || `Freepik background ${item.id}`;
      const titleAr = translationMap.get(titleEn) || titleEn;
      const tagsEn = item.tags;
      const tagsAr = tagsEn.map((value) => translationMap.get(value) || value);
      const labelsEn = buildBackgroundLabelsEn(item, categoryLabelEn);
      const labelsAr = labelsEn.map((value) =>
        value === categoryLabelEn ? categoryLabelAr || value : translationMap.get(value) || value
      );

      await upsertImportedBackgroundAsset({
        source: "freepik-background",
        sourceAssetId: item.id,
        ownerId: safeOwnerId,
        categoryValue: normalizedCategoryValue,
        titleEn,
        titleAr,
        tagsEn,
        tagsAr,
        labelsEn,
        labelsAr,
        slug: item.slug,
        authorId: item.author.id,
        authorName: item.author.name,
        assetUrl: storedUrl,
        thumbnailUrl: storedUrl,
        width: downloadedDimensions.width ?? item.width,
        height: downloadedDimensions.height ?? item.height,
        freeSvg: false,
        sourcePayload: {
          ...(item.sourcePayload && typeof item.sourcePayload === "object" ? item.sourcePayload : {}),
          importedCategoryValue: normalizedCategoryValue,
        },
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
        message: error instanceof Error ? error.message : "Failed to import background.",
      });
    }
  }

  return result;
}
