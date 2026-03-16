import {
  readEditorFontLibraryRaw,
  writeEditorFontLibraryRaw,
} from "@/lib/editor/fontLibraryStore.server";

const FONT_SYNC_SOURCES = {
  google: "google",
  fontsource: "fontsource",
  openfontlibrary: "openfontlibrary",
};

const FONT_SYNC_SOURCE_LABELS = {
  [FONT_SYNC_SOURCES.google]: "Google Fonts",
  [FONT_SYNC_SOURCES.fontsource]: "Fontsource",
  [FONT_SYNC_SOURCES.openfontlibrary]: "Open Font Library",
};

const CATEGORY_EXCLUSIVE = "EXCLUSIVE";
const CATEGORY_ENGLISH = "ENGLISH";
const CATEGORY_ARABIC = "ARABIC";

const MOBILE_SUPPORTED_FORMATS = new Set(["ttf", "otf", "ttc"]);
const MAX_SYNCED_FONT_BYTES = 10 * 1024 * 1024;

const GOOGLE_FONTS_LIST_URL = "https://gwfh.mranftl.com/api/fonts?subsets=latin,arabic&sort=alpha";
const GOOGLE_FONTS_DETAIL_URL = "https://gwfh.mranftl.com/api/fonts/";
const FONTSOURCE_LIST_URL = "https://api.fontsource.org/v1/fonts";
const FONTSOURCE_DETAIL_URL = "https://api.fontsource.org/v1/fonts/";
const OPEN_FONT_LIBRARY_BASE_URL = "https://fontlibrary.org";

function normalizeSource(value) {
  const source = String(value || "").trim().toLowerCase();
  if (source === FONT_SYNC_SOURCES.google) return FONT_SYNC_SOURCES.google;
  if (source === FONT_SYNC_SOURCES.fontsource) return FONT_SYNC_SOURCES.fontsource;
  if (source === FONT_SYNC_SOURCES.openfontlibrary) return FONT_SYNC_SOURCES.openfontlibrary;
  return "";
}

function normalizeIsoString(value) {
  const source = String(value || "").trim();
  if (!source) return "";
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]+/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function normalizeMimeType(value) {
  return String(value || "").trim().toLowerCase();
}

function inferMimeTypeFromFormat(format) {
  const value = String(format || "").trim().toLowerCase();
  if (value === "ttf") return "font/ttf";
  if (value === "otf") return "font/otf";
  if (value === "ttc") return "font/ttc";
  if (value === "woff") return "font/woff";
  if (value === "woff2") return "font/woff2";
  if (value === "eot") return "application/vnd.ms-fontobject";
  return "application/octet-stream";
}

function inferFormatFromMimeType(value) {
  const mimeType = normalizeMimeType(value);
  if (!mimeType) return "";
  if (
    mimeType === "font/ttf" ||
    mimeType === "application/x-font-ttf" ||
    mimeType === "application/font-sfnt"
  ) {
    return "ttf";
  }
  if (mimeType === "font/otf" || mimeType === "application/x-font-otf") {
    return "otf";
  }
  if (
    mimeType === "font/ttc" ||
    mimeType === "application/x-font-ttc" ||
    mimeType === "font/collection"
  ) {
    return "ttc";
  }
  if (mimeType === "font/woff" || mimeType === "application/font-woff") {
    return "woff";
  }
  if (mimeType === "font/woff2") {
    return "woff2";
  }
  if (mimeType === "application/vnd.ms-fontobject") {
    return "eot";
  }
  return "";
}

function inferFormatFromUrl(value) {
  const source = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, "");
  if (!source) return "";
  if (source.endsWith(".ttf")) return "ttf";
  if (source.endsWith(".otf")) return "otf";
  if (source.endsWith(".ttc")) return "ttc";
  if (source.endsWith(".woff2")) return "woff2";
  if (source.endsWith(".woff")) return "woff";
  if (source.endsWith(".eot")) return "eot";
  return "";
}

function sanitizeHttpUrl(value, baseUrl = "") {
  const source = String(value || "").trim();
  if (!source) return "";

  try {
    const parsed = baseUrl ? new URL(source, baseUrl) : new URL(source);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function sanitizeDataUrl(value) {
  const source = String(value || "").trim();
  if (!source.startsWith("data:")) return "";
  if (!source.includes(";base64,")) return "";
  return source;
}

function extractMimeTypeFromDataUrl(value) {
  const source = String(value || "").trim();
  const match = source.match(/^data:([^;,]+);base64,/i);
  return normalizeMimeType(match?.[1] || "");
}

function toDataUrl(mimeType, bytes) {
  return `data:${normalizeMimeType(mimeType) || "application/octet-stream"};base64,${bytes.toString("base64")}`;
}

function normalizeSubsetTokens(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((token) => sanitizeText(token).toLowerCase())
    .filter(Boolean);
}

function inferCategoriesFromSubsets(subsets = []) {
  const normalized = normalizeSubsetTokens(subsets);
  const hasArabic = normalized.some((token) => token.includes("arabic"));
  const hasEnglish = normalized.some(
    (token) =>
      token.includes("latin") ||
      token.includes("western") ||
      token.includes("english")
  );

  if (!hasArabic && !hasEnglish) return [];

  const categories = [CATEGORY_EXCLUSIVE];
  if (hasArabic) categories.push(CATEGORY_ARABIC);
  if (hasEnglish) categories.push(CATEGORY_ENGLISH);
  return categories;
}

function pickPreviewText(categories, displayName) {
  const values = Array.isArray(categories) ? categories : [];
  if (values.includes(CATEGORY_ARABIC)) {
    return "رمضان ليس شهراً في التقويم،";
  }
  const fallback = sanitizeText(displayName);
  return fallback || "The quick brown fox";
}

function sanitizeFileName(value, fallback = "font") {
  const source = String(value || "").trim();
  const cleaned = source
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

function createSyncedFontId(source, sourceId, family) {
  const sourceKey = normalizeSource(source);
  const stable = slugify(sourceId) || slugify(family) || `font-${Date.now()}`;
  return `synced-${sourceKey}-${stable}`;
}

function normalizeStoredSyncedFont(input) {
  if (!input || typeof input !== "object") return null;

  const source = normalizeSource(input.source);
  if (!source) return null;

  const family = sanitizeText(input.family);
  const displayName = sanitizeText(input.displayName || family);
  if (!family) return null;

  const sourceId = sanitizeText(input.sourceId || "");
  const id = sanitizeText(input.id || createSyncedFontId(source, sourceId, family));

  const fileUrl = sanitizeHttpUrl(input.fileUrl);
  const dataUrl = sanitizeDataUrl(input.dataUrl);
  if (!fileUrl && !dataUrl) return null;

  const format =
    inferFormatFromMimeType(input.mimeType) ||
    inferFormatFromMimeType(extractMimeTypeFromDataUrl(dataUrl)) ||
    inferFormatFromUrl(fileUrl || input.fileUrl) ||
    inferFormatFromUrl(input.fileName) ||
    "unknown";
  const mimeType =
    normalizeMimeType(input.mimeType) ||
    extractMimeTypeFromDataUrl(dataUrl) ||
    inferMimeTypeFromFormat(format) ||
    "application/octet-stream";

  const categories = Array.isArray(input.categories)
    ? Array.from(
        new Set(
          input.categories
            .map((value) => sanitizeText(value).toUpperCase())
            .filter((value) =>
              value === CATEGORY_EXCLUSIVE || value === CATEGORY_ENGLISH || value === CATEGORY_ARABIC
            )
        )
      )
    : [];

  if (categories.length === 0) return null;

  const sourcePageUrl = sanitizeHttpUrl(input.sourcePageUrl);
  const createdAt = normalizeIsoString(input.createdAt) || new Date(0).toISOString();
  const updatedAt = normalizeIsoString(input.updatedAt) || createdAt;

  return {
    id,
    source,
    sourceId,
    family,
    displayName,
    categories,
    previewText: sanitizeText(input.previewText) || pickPreviewText(categories, displayName),
    previewWeight: 400,
    cssFontFamily: `'${family}'`,
    fileName: sanitizeFileName(input.fileName || `${family}.${format === "unknown" ? "ttf" : format}`),
    fileUrl,
    dataUrl,
    mimeType,
    fontFormat: format,
    mobileCompatible: MOBILE_SUPPORTED_FORMATS.has(format),
    sourcePageUrl,
    createdAt,
    updatedAt,
  };
}

function normalizeStatusRecord(input) {
  if (!input || typeof input !== "object") return {
    source: "",
    sourceLabel: "",
    lastSyncedAt: "",
    status: "idle",
    syncedFontsCount: 0,
    error: "",
  };

  const source = normalizeSource(input.source);
  return {
    source,
    sourceLabel: FONT_SYNC_SOURCE_LABELS[source] || source,
    lastSyncedAt: normalizeIsoString(input.lastSyncedAt),
    status: ["idle", "running", "success", "error"].includes(String(input.status || ""))
      ? String(input.status)
      : "idle",
    syncedFontsCount: Number.isFinite(Number(input.syncedFontsCount))
      ? Math.max(0, Math.trunc(Number(input.syncedFontsCount)))
      : 0,
    error: sanitizeText(input.error),
  };
}

function buildDefaultStatuses() {
  return {
    [FONT_SYNC_SOURCES.google]: normalizeStatusRecord({ source: FONT_SYNC_SOURCES.google }),
    [FONT_SYNC_SOURCES.fontsource]: normalizeStatusRecord({ source: FONT_SYNC_SOURCES.fontsource }),
    [FONT_SYNC_SOURCES.openfontlibrary]: normalizeStatusRecord({ source: FONT_SYNC_SOURCES.openfontlibrary }),
  };
}

function normalizeStoredState(value) {
  const source = value && typeof value === "object" ? value : {};
  const rawFonts = Array.isArray(source.fonts) ? source.fonts : [];

  const byId = new Map();
  const bySourceAndFamily = new Set();

  rawFonts.forEach((item) => {
    const normalized = normalizeStoredSyncedFont(item);
    if (!normalized) return;
    const dedupeKey = `${normalized.source}::${normalized.family.toLowerCase()}`;
    if (bySourceAndFamily.has(dedupeKey)) return;
    if (byId.has(normalized.id)) return;
    bySourceAndFamily.add(dedupeKey);
    byId.set(normalized.id, normalized);
  });

  const statuses = buildDefaultStatuses();
  const rawStatuses = source.statuses && typeof source.statuses === "object" ? source.statuses : {};
  for (const key of Object.keys(statuses)) {
    statuses[key] = normalizeStatusRecord({ source: key, ...rawStatuses[key] });
  }

  const syncedAt = normalizeIsoString(source.syncedAt);
  return {
    version: 1,
    fonts: Array.from(byId.values()),
    statuses,
    syncedAt,
  };
}

async function readSyncedFontState() {
  try {
    const library = await readEditorFontLibraryRaw();
    return normalizeStoredState({
      fonts: library.syncedFonts,
      statuses: library.syncStatuses,
      syncedAt: library.syncedAt,
    });
  } catch {
    return normalizeStoredState({});
  }
}

async function writeSyncedFontState(state) {
  const normalized = normalizeStoredState(state);
  const library = await readEditorFontLibraryRaw();
  library.syncedFonts = normalized.fonts;
  library.syncStatuses = normalized.statuses;
  library.syncedAt = normalized.syncedAt || new Date().toISOString();
  await writeEditorFontLibraryRaw(library);
}

function buildStatusSummary(state) {
  const normalized = normalizeStoredState(state);
  const perSourceCounts = {
    [FONT_SYNC_SOURCES.google]: 0,
    [FONT_SYNC_SOURCES.fontsource]: 0,
    [FONT_SYNC_SOURCES.openfontlibrary]: 0,
  };

  normalized.fonts.forEach((font) => {
    if (perSourceCounts[font.source] === undefined) return;
    perSourceCounts[font.source] += 1;
  });

  for (const key of Object.keys(normalized.statuses)) {
    normalized.statuses[key].syncedFontsCount = perSourceCounts[key] || 0;
  }

  return {
    totalFonts: normalized.fonts.length,
    sourceCounts: perSourceCounts,
    statuses: normalized.statuses,
    syncedAt: normalized.syncedAt || "",
  };
}

async function fetchTextWithTimeout(url, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "web-dashboard-font-sync/1.0",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFontDataUrlFromFileUrl(fileUrl, fallbackMimeType = "") {
  const normalizedUrl = sanitizeHttpUrl(fileUrl);
  if (!normalizedUrl) return { dataUrl: "", mimeType: "" };

  let response = null;
  try {
    response = await fetch(normalizedUrl, {
      cache: "no-store",
      headers: {
        "User-Agent": "web-dashboard-font-sync/1.0",
      },
    });
  } catch {
    return { dataUrl: "", mimeType: "" };
  }

  if (!response?.ok) {
    return { dataUrl: "", mimeType: "" };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_SYNCED_FONT_BYTES) {
    return { dataUrl: "", mimeType: "" };
  }

  const responseMimeType = normalizeMimeType(
    String(response.headers.get("content-type") || "").split(";")[0]
  );
  const mimeType =
    responseMimeType ||
    normalizeMimeType(fallbackMimeType) ||
    inferMimeTypeFromFormat(inferFormatFromUrl(normalizedUrl));

  return {
    dataUrl: toDataUrl(mimeType || "application/octet-stream", bytes),
    mimeType,
  };
}

async function fetchJsonWithTimeout(url, timeoutMs = 25_000) {
  const text = await fetchTextWithTimeout(url, timeoutMs);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON response.");
  }
}

async function runWithConcurrency(items, limit, handler) {
  const max = Math.max(1, Math.trunc(limit || 1));
  const values = Array.isArray(items) ? items : [];
  const result = new Array(values.length);
  let index = 0;

  async function worker() {
    while (index < values.length) {
      const current = index;
      index += 1;
      try {
        result[current] = await handler(values[current], current);
      } catch {
        result[current] = null;
      }
    }
  }

  const workers = Array.from({ length: Math.min(max, values.length) }, () => worker());
  await Promise.all(workers);
  return result;
}

async function buildSyncedFontRecord({
  source,
  sourceId,
  family,
  displayName,
  subsets,
  fileUrl,
  fileName,
  mimeType,
  sourcePageUrl,
  previewText,
}) {
  const normalizedSource = normalizeSource(source);
  if (!normalizedSource) return null;

  const categories = inferCategoriesFromSubsets(subsets);
  if (categories.length === 0) return null;

  const safeFamily = sanitizeText(family);
  const safeDisplayName = sanitizeText(displayName || family);
  const safeFileUrl = sanitizeHttpUrl(fileUrl);

  if (!safeFamily || !safeFileUrl) return null;

  const fetched = await fetchFontDataUrlFromFileUrl(safeFileUrl, mimeType);
  const safeDataUrl = sanitizeDataUrl(fetched.dataUrl);
  if (!safeDataUrl) return null;
  const detectedMimeType = normalizeMimeType(fetched.mimeType || mimeType);

  const format =
    inferFormatFromMimeType(detectedMimeType) ||
    inferFormatFromMimeType(extractMimeTypeFromDataUrl(safeDataUrl)) ||
    inferFormatFromUrl(fileUrl) ||
    inferFormatFromUrl(fileName) ||
    "unknown";
  const safeMimeType =
    detectedMimeType || inferMimeTypeFromFormat(format) || "application/octet-stream";

  const nowIso = new Date().toISOString();
  return normalizeStoredSyncedFont({
    id: createSyncedFontId(normalizedSource, sourceId, safeFamily),
    source: normalizedSource,
    sourceId: sanitizeText(sourceId),
    family: safeFamily,
    displayName: safeDisplayName,
    categories,
    previewText: sanitizeText(previewText) || pickPreviewText(categories, safeDisplayName),
    fileName: sanitizeFileName(
      fileName || `${safeFamily}.${format === "unknown" ? "ttf" : format}`,
      `${safeFamily}.ttf`
    ),
    fileUrl: safeFileUrl,
    dataUrl: safeDataUrl,
    mimeType: safeMimeType,
    sourcePageUrl: sanitizeHttpUrl(sourcePageUrl),
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

async function collectGoogleFonts() {
  const list = await fetchJsonWithTimeout(GOOGLE_FONTS_LIST_URL, 45_000);
  const families = Array.isArray(list) ? list : [];
  const candidates = families
    .map((entry) => {
      const id = sanitizeText(entry?.id);
      const family = sanitizeText(entry?.family);
      const subsets = normalizeSubsetTokens(entry?.subsets);
      const categories = inferCategoriesFromSubsets(subsets);
      if (!id || !family || categories.length === 0) return null;
      return {
        id,
        family,
        subsets,
      };
    })
    .filter(Boolean);

  const detailed = await runWithConcurrency(candidates, 10, async (candidate) => {
    const preferredSubset = candidate.subsets.includes("arabic")
      ? "arabic"
      : candidate.subsets.includes("latin")
        ? "latin"
        : candidate.subsets[0] || "latin";
    const detail = await fetchJsonWithTimeout(
      `${GOOGLE_FONTS_DETAIL_URL}${encodeURIComponent(candidate.id)}?subsets=${encodeURIComponent(preferredSubset)}`,
      25_000
    );
    const variants = Array.isArray(detail?.variants) ? detail.variants : [];
    const regularVariant =
      variants.find((variant) => String(variant?.id || "").toLowerCase() === "regular") ||
      variants.find(
        (variant) =>
          String(variant?.fontStyle || "").toLowerCase() === "normal" &&
          String(variant?.fontWeight || "") === "400"
      );

    if (!regularVariant) return null;

    const ttfUrl = sanitizeHttpUrl(regularVariant?.ttf);
    const otfUrl = sanitizeHttpUrl(regularVariant?.otf);
    const fileUrl = ttfUrl || otfUrl;
    if (!fileUrl) return null;

    return buildSyncedFontRecord({
      source: FONT_SYNC_SOURCES.google,
      sourceId: `${candidate.id}:${preferredSubset}`,
      family: detail?.family || candidate.family,
      displayName: detail?.family || candidate.family,
      subsets: [preferredSubset],
      fileUrl,
      fileName: `${detail?.family || candidate.family}.${ttfUrl ? "ttf" : "otf"}`,
      mimeType: ttfUrl ? "font/ttf" : "font/otf",
      sourcePageUrl: `https://fonts.google.com/specimen/${encodeURIComponent(
        String(detail?.family || candidate.family).replace(/\s+/g, "+")
      )}`,
    });
  });

  return detailed.filter(Boolean);
}

function resolveFontsourceRegularUrl(variants, preferredSubsets = []) {
  if (!variants || typeof variants !== "object") return null;
  const weightBlock = variants["400"] || variants[400];
  if (!weightBlock || typeof weightBlock !== "object") return null;
  const normalBlock = weightBlock.normal;
  if (!normalBlock || typeof normalBlock !== "object") return null;

  const candidates = [];
  const visited = new Set();

  const priority = [...preferredSubsets, "latin", "latin-ext", "arabic"];
  for (const subset of priority) {
    const key = sanitizeText(subset).toLowerCase();
    if (!key || visited.has(key)) continue;
    visited.add(key);
    const node = normalBlock[key];
    if (!node || typeof node !== "object") continue;
    const urlNode = node.url && typeof node.url === "object" ? node.url : {};
    const ttf = sanitizeHttpUrl(urlNode.ttf);
    const otf = sanitizeHttpUrl(urlNode.otf);
    const woff2 = sanitizeHttpUrl(urlNode.woff2);
    const woff = sanitizeHttpUrl(urlNode.woff);
    if (ttf) return { subset: key, url: ttf, format: "ttf" };
    if (otf) return { subset: key, url: otf, format: "otf" };
    if (woff2) candidates.push({ subset: key, url: woff2, format: "woff2" });
    if (woff) candidates.push({ subset: key, url: woff, format: "woff" });
  }

  if (candidates.length > 0) return candidates[0];
  return null;
}

async function collectFontsourceFonts() {
  const list = await fetchJsonWithTimeout(FONTSOURCE_LIST_URL, 90_000);
  const fonts = Array.isArray(list) ? list : [];

  const candidates = fonts
    .map((item) => {
      const id = sanitizeText(item?.id);
      const family = sanitizeText(item?.family);
      const subsets = normalizeSubsetTokens(item?.subsets);
      const categories = inferCategoriesFromSubsets(subsets);
      const weights = Array.isArray(item?.weights) ? item.weights.map((weight) => Number(weight)) : [];
      const styles = Array.isArray(item?.styles)
        ? item.styles.map((style) => sanitizeText(style).toLowerCase())
        : [];
      if (!id || !family || categories.length === 0) return null;
      if (!weights.includes(400)) return null;
      if (!styles.includes("normal")) return null;

      return {
        id,
        family,
        subsets,
      };
    })
    .filter(Boolean);

  const detailed = await runWithConcurrency(candidates, 10, async (candidate) => {
    const detail = await fetchJsonWithTimeout(
      `${FONTSOURCE_DETAIL_URL}${encodeURIComponent(candidate.id)}`,
      30_000
    );

    const detailSubsets = normalizeSubsetTokens(detail?.subsets || candidate.subsets);
    const choice = resolveFontsourceRegularUrl(detail?.variants, detailSubsets);
    if (!choice?.url) return null;

    return buildSyncedFontRecord({
      source: FONT_SYNC_SOURCES.fontsource,
      sourceId: candidate.id,
      family: detail?.family || candidate.family,
      displayName: detail?.family || candidate.family,
      subsets: detailSubsets,
      fileUrl: choice.url,
      fileName: `${detail?.family || candidate.family}.${choice.format === "otf" ? "otf" : choice.format === "ttf" ? "ttf" : choice.format}`,
      mimeType: inferMimeTypeFromFormat(choice.format),
      sourcePageUrl: sanitizeHttpUrl(detail?.source) || `https://fontsource.org/fonts/${candidate.id}`,
    });
  });

  return detailed.filter(Boolean);
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/&#([0-9]+);/g, (_match, num) => {
      const code = Number(num);
      if (!Number.isFinite(code)) return "";
      return String.fromCharCode(code);
    });
}

function parseOpenFontLibraryListingPage(html, currentUrl) {
  const links = [];
  const seen = new Set();
  const regex = /<li\s+class="family-name\s+heading"[^>]*>\s*<a[^>]+href="https:\/\/fontlibrary\.org\/en\/font\/([^"#?]+)"[^>]*>([^<]+)<\/a>/gi;
  let match = regex.exec(html);
  while (match) {
    const slug = sanitizeText(decodeHtmlEntities(match[1]));
    const family = sanitizeText(decodeHtmlEntities(match[2]));
    if (slug && family) {
      const key = slug.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ slug, family });
      }
    }
    match = regex.exec(html);
  }

  const nextMatch = html.match(/id="next_button"[^>]*href="([^"]+)"/i);
  const nextUrl = nextMatch?.[1]
    ? sanitizeHttpUrl(nextMatch[1], currentUrl)
    : "";

  return {
    links,
    nextUrl,
  };
}

function parseCssRegularFontSource(css, fontPageSlug) {
  const faceBlocks = String(css || "").match(/@font-face\s*\{[^}]*\}/gi) || [];
  const sources = [];

  for (const block of faceBlocks) {
    const fontStyle = sanitizeText((block.match(/font-style\s*:\s*([^;]+);/i) || [])[1]).toLowerCase();
    const fontWeight = sanitizeText((block.match(/font-weight\s*:\s*([^;]+);/i) || [])[1]).toLowerCase();

    if (fontStyle && fontStyle !== "normal") continue;
    if (fontWeight && fontWeight !== "normal" && fontWeight !== "400") continue;

    const family = sanitizeText(
      decodeHtmlEntities((block.match(/font-family\s*:\s*['\"]?([^;'\"]+)['\"]?\s*;/i) || [])[1])
    );
    const srcValue = String((block.match(/src\s*:\s*([^;]+);/i) || [])[1] || "");
    if (!srcValue) continue;

    const urlMatches = Array.from(srcValue.matchAll(/url\(([^)]+)\)/gi));
    const parsedCandidates = urlMatches
      .map((entry) => sanitizeHttpUrl(String(entry[1] || "").replace(/^['\"]|['\"]$/g, ""), OPEN_FONT_LIBRARY_BASE_URL))
      .filter(Boolean)
      .map((url) => ({
        url,
        format: inferFormatFromUrl(url),
      }));

    if (parsedCandidates.length === 0) continue;

    const preferred =
      parsedCandidates.find((entry) => entry.format === "ttf") ||
      parsedCandidates.find((entry) => entry.format === "otf") ||
      parsedCandidates[0];

    if (!preferred?.url) continue;

    sources.push({
      family,
      fileUrl: preferred.url,
      format: preferred.format,
      sourceId: fontPageSlug,
    });
  }

  return sources[0] || null;
}

async function collectOpenFontLibraryFontsByLanguage(languageQueryValue, categorySubset) {
  let nextUrl = sanitizeHttpUrl(
    `/en/search?lang=${encodeURIComponent(languageQueryValue)}&order=`,
    OPEN_FONT_LIBRARY_BASE_URL
  );

  const seenPages = new Set();
  const seenSlugs = new Set();
  const items = [];

  while (nextUrl && !seenPages.has(nextUrl)) {
    seenPages.add(nextUrl);

    const html = await fetchTextWithTimeout(nextUrl, 40_000);
    const parsed = parseOpenFontLibraryListingPage(html, nextUrl);

    for (const item of parsed.links) {
      const key = item.slug.toLowerCase();
      if (seenSlugs.has(key)) continue;
      seenSlugs.add(key);
      items.push(item);
    }

    nextUrl = parsed.nextUrl;
  }

  const detailed = await runWithConcurrency(items, 8, async (item) => {
    const css = await fetchTextWithTimeout(
      `${OPEN_FONT_LIBRARY_BASE_URL}/face/${encodeURIComponent(item.slug)}`,
      30_000
    );
    const regularSource = parseCssRegularFontSource(css, item.slug);
    if (!regularSource?.fileUrl) return null;

    return buildSyncedFontRecord({
      source: FONT_SYNC_SOURCES.openfontlibrary,
      sourceId: regularSource.sourceId || item.slug,
      family: item.family,
      displayName: item.family,
      subsets: [categorySubset],
      fileUrl: regularSource.fileUrl,
      fileName: `${item.family}.${regularSource.format || "ttf"}`,
      mimeType: inferMimeTypeFromFormat(regularSource.format),
      sourcePageUrl: `${OPEN_FONT_LIBRARY_BASE_URL}/en/font/${encodeURIComponent(item.slug)}`,
    });
  });

  return detailed.filter(Boolean);
}

async function collectOpenFontLibraryFonts() {
  const [arabicFonts, englishFonts] = await Promise.all([
    collectOpenFontLibraryFontsByLanguage("arabic", "arabic"),
    collectOpenFontLibraryFontsByLanguage("western european", "western european"),
  ]);

  const merged = [...arabicFonts, ...englishFonts];
  const byFamily = new Map();
  for (const font of merged) {
    const key = `${font.source}::${font.family.toLowerCase()}`;
    const existing = byFamily.get(key);
    if (!existing) {
      byFamily.set(key, font);
      continue;
    }

    const categories = Array.from(new Set([...(existing.categories || []), ...(font.categories || [])]));
    byFamily.set(key, {
      ...existing,
      categories,
      previewText: pickPreviewText(categories, existing.displayName || existing.family),
      mobileCompatible: existing.mobileCompatible || font.mobileCompatible,
      updatedAt: new Date().toISOString(),
    });
  }

  return Array.from(byFamily.values());
}

async function collectSourceFonts(source) {
  if (source === FONT_SYNC_SOURCES.google) {
    return collectGoogleFonts();
  }
  if (source === FONT_SYNC_SOURCES.fontsource) {
    return collectFontsourceFonts();
  }
  if (source === FONT_SYNC_SOURCES.openfontlibrary) {
    return collectOpenFontLibraryFonts();
  }
  throw new Error("Unsupported source.");
}

async function updateSourceStatus(source, update) {
  const state = await readSyncedFontState();
  const current = state.statuses[source] || normalizeStatusRecord({ source });
  state.statuses[source] = normalizeStatusRecord({
    ...current,
    source,
    ...update,
  });
  state.syncedAt = new Date().toISOString();
  await writeSyncedFontState(state);
}

export function listFontSyncSources() {
  return [
    {
      source: FONT_SYNC_SOURCES.google,
      label: FONT_SYNC_SOURCE_LABELS[FONT_SYNC_SOURCES.google],
    },
    {
      source: FONT_SYNC_SOURCES.fontsource,
      label: FONT_SYNC_SOURCE_LABELS[FONT_SYNC_SOURCES.fontsource],
    },
    {
      source: FONT_SYNC_SOURCES.openfontlibrary,
      label: FONT_SYNC_SOURCE_LABELS[FONT_SYNC_SOURCES.openfontlibrary],
    },
  ];
}

export async function getEditorSyncedFonts() {
  const state = await readSyncedFontState();
  return Array.isArray(state.fonts) ? state.fonts : [];
}

export async function getEditorSyncedFontsSummary() {
  const state = await readSyncedFontState();
  return {
    sources: listFontSyncSources(),
    ...buildStatusSummary(state),
  };
}

export async function deleteAllEditorSyncedFonts() {
  const state = await readSyncedFontState();
  const previousCount = state.fonts.length;
  state.fonts = [];

  const nextStatuses = buildDefaultStatuses();
  for (const source of Object.keys(nextStatuses)) {
    nextStatuses[source] = normalizeStatusRecord({
      source,
      status: "idle",
      syncedFontsCount: 0,
      error: "",
      lastSyncedAt: "",
    });
  }
  state.statuses = nextStatuses;
  state.syncedAt = new Date().toISOString();

  await writeSyncedFontState(state);

  return {
    deletedFonts: previousCount,
    ...buildStatusSummary(state),
  };
}

export async function syncEditorFontsFromSource(sourceInput) {
  const source = normalizeSource(sourceInput);
  if (!source) {
    throw new Error("Unsupported sync source.");
  }

  await updateSourceStatus(source, {
    status: "running",
    error: "",
  });

  try {
    const syncedFonts = await collectSourceFonts(source);

    const nowIso = new Date().toISOString();
    const state = await readSyncedFontState();

    const nextFonts = [
      ...state.fonts.filter((font) => normalizeSource(font.source) !== source),
      ...syncedFonts,
    ];

    const normalized = normalizeStoredState({
      fonts: nextFonts,
      statuses: {
        ...state.statuses,
        [source]: {
          ...(state.statuses[source] || normalizeStatusRecord({ source })),
          source,
          status: "success",
          error: "",
          lastSyncedAt: nowIso,
          syncedFontsCount: syncedFonts.length,
        },
      },
      syncedAt: nowIso,
    });

    await writeSyncedFontState(normalized);

    return {
      source,
      sourceLabel: FONT_SYNC_SOURCE_LABELS[source] || source,
      syncedCount: syncedFonts.length,
      totalFonts: normalized.fonts.length,
      ...buildStatusSummary(normalized),
    };
  } catch (error) {
    const message = sanitizeText(error?.message || "Failed to sync fonts.");
    await updateSourceStatus(source, {
      status: "error",
      error: message,
      lastSyncedAt: new Date().toISOString(),
    });
    throw new Error(message);
  }
}
