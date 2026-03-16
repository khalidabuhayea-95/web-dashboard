import { normalizeFontFamilyName } from "@/lib/editor/fonts";
import {
  readEditorFontLibraryRaw,
  writeEditorFontLibraryRaw,
} from "@/lib/editor/fontLibraryStore.server";
import { spawn } from "node:child_process";
import path from "node:path";

const MAX_CUSTOM_FONT_COUNT = 80;
const MAX_CUSTOM_FONT_BYTES = 5_000_000;
const MAX_CUSTOM_FONT_TOTAL_BYTES = 40_000_000;
const DATA_URI_PATTERN = /^data:([^;,]+);base64,(.+)$/i;
const ALLOWED_FONT_MIME_TYPES = new Set([
  "font/ttf",
  "font/otf",
  "font/ttc",
  "font/collection",
  "font/woff",
  "font/woff2",
  "application/font-sfnt",
  "application/font-woff",
  "application/x-font-ttf",
  "application/x-font-otf",
  "application/x-font-ttc",
  "application/vnd.ms-fontobject",
]);
const MOBILE_COMPATIBLE_FONT_FORMATS = new Set(["ttf", "otf", "ttc"]);
const MOBILE_CONVERTIBLE_FONT_FORMATS = new Set(["woff", "woff2", "eot"]);
const FONT_CONVERSION_STATUS_READY = "ready";
const FONT_CONVERSION_STATUS_PENDING = "pending";
const FONT_CONVERSION_STATUS_FAILED = "failed";
const FONT_CATEGORY_EXCLUSIVE = "EXCLUSIVE";
const FONT_CATEGORY_ENGLISH = "ENGLISH";
const FONT_CATEGORY_ARABIC = "ARABIC";
const ALLOWED_FONT_CATEGORIES = new Set([
  FONT_CATEGORY_EXCLUSIVE,
  FONT_CATEGORY_ENGLISH,
  FONT_CATEGORY_ARABIC,
]);
const FONT_CONVERTER_SCRIPT_PATH = path.join(
  process.cwd(),
  "scripts",
  "convert-font-to-mobile.mjs"
);

function isFontConversionRuntimeSupported() {
  const runtime = String(process.env.NEXT_RUNTIME || "").toLowerCase();
  return runtime !== "edge";
}

function estimateDataUrlBytes(dataUrl) {
  const value = String(dataUrl || "");
  if (!value.startsWith("data:")) return 0;
  const marker = ";base64,";
  const markerIndex = value.indexOf(marker);
  if (markerIndex === -1) return value.length;
  const base64Length = Math.max(0, value.length - markerIndex - marker.length);
  return Math.ceil((base64Length * 3) / 4);
}

function normalizeMimeType(value) {
  const mimeType = String(value || "").trim().toLowerCase();
  return mimeType;
}

function containsArabicScript(value) {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

function normalizeFontCategoryInput(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim().toUpperCase())
        .filter((item) => ALLOWED_FONT_CATEGORIES.has(item))
    )
  );
}

function resolveFontCategories(value, fallbackSample = "") {
  const normalized = normalizeFontCategoryInput(value);
  const categories = normalized.length > 0 ? [...normalized] : [];
  if (!categories.includes(FONT_CATEGORY_EXCLUSIVE)) {
    categories.unshift(FONT_CATEGORY_EXCLUSIVE);
  }

  const hasLanguageCategory =
    categories.includes(FONT_CATEGORY_ENGLISH) ||
    categories.includes(FONT_CATEGORY_ARABIC);

  if (!hasLanguageCategory) {
    categories.push(
      containsArabicScript(fallbackSample)
        ? FONT_CATEGORY_ARABIC
        : FONT_CATEGORY_ENGLISH
    );
  }

  return Array.from(new Set(categories));
}

function inferMimeTypeFromFileName(fileName) {
  const source = String(fileName || "").toLowerCase();
  const match = source.match(/\.([a-z0-9]{2,10})$/);
  const ext = match?.[1] || "";
  if (ext === "ttf") return "font/ttf";
  if (ext === "otf") return "font/otf";
  if (ext === "ttc") return "font/ttc";
  if (ext === "woff") return "font/woff";
  if (ext === "woff2") return "font/woff2";
  if (ext === "eot") return "application/vnd.ms-fontobject";
  return "";
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
    mimeType === "font/collection" ||
    mimeType === "application/x-font-ttc"
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

function inferFormatFromName(value) {
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

function inferFontFormat({ mimeType, fileName, fileUrl, dataUrl }) {
  const byMimeType = inferFormatFromMimeType(mimeType);
  if (byMimeType) return byMimeType;

  const byFileName = inferFormatFromName(fileName);
  if (byFileName) return byFileName;

  const byFileUrl = inferFormatFromName(fileUrl);
  if (byFileUrl) return byFileUrl;

  const dataUrlMimeType = String(dataUrl || "").match(/^data:([^;,]+);base64,/i)?.[1] || "";
  return inferFormatFromMimeType(dataUrlMimeType) || "";
}

function extensionForFormat(format) {
  if (format === "ttf") return "ttf";
  if (format === "otf") return "otf";
  if (format === "ttc") return "ttc";
  if (format === "woff2") return "woff2";
  if (format === "woff") return "woff";
  if (format === "eot") return "eot";
  return "ttf";
}

function canonicalMimeForFormat(format) {
  if (format === "ttf") return "font/ttf";
  if (format === "otf") return "font/otf";
  if (format === "ttc") return "font/ttc";
  if (format === "woff2") return "font/woff2";
  if (format === "woff") return "font/woff";
  if (format === "eot") return "application/vnd.ms-fontobject";
  return "application/octet-stream";
}

function replaceFileExtension(fileName, nextExtension) {
  const normalized = normalizeFileName(fileName);
  if (!normalized) return `font.${nextExtension}`;
  if (/\.[a-z0-9]{2,10}$/i.test(normalized)) {
    return normalized.replace(/\.[a-z0-9]{2,10}$/i, `.${nextExtension}`);
  }
  return `${normalized}.${nextExtension}`;
}

function extractMimeTypeFromDataUrl(dataUrl) {
  const source = String(dataUrl || "");
  const match = source.match(/^data:([^;,]+);base64,/i);
  return normalizeMimeType(match?.[1] || "");
}

function sanitizeDataUrl(dataUrl) {
  const source = String(dataUrl || "").trim();
  if (!source.startsWith("data:")) return "";
  if (!source.includes(";base64,")) return "";
  return source;
}

function parseDataUri(dataUrl) {
  const source = String(dataUrl || "").trim();
  const match = source.match(DATA_URI_PATTERN);
  if (!match) return null;
  try {
    return {
      mimeType: normalizeMimeType(match[1] || ""),
      bytes: Buffer.from(String(match[2] || ""), "base64"),
    };
  } catch (_error) {
    return null;
  }
}

function toDataUrl(mimeType, bytes) {
  return `data:${normalizeMimeType(mimeType) || "application/octet-stream"};base64,${bytes.toString("base64")}`;
}

function sanitizeFileUrl(fileUrl) {
  const source = String(fileUrl || "").trim();
  if (!source) return "";
  try {
    const parsed = new URL(source);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch (_error) {
    return "";
  }
}

async function runFontConverterSubprocess({ format, bytes }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FONT_CONVERTER_SCRIPT_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("Font conversion timed out."));
    }, 20_000);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk || "");
      if (stdout.length > 12_000_000 && !settled) {
        settled = true;
        clearTimeout(timeout);
        child.kill("SIGKILL");
        reject(new Error("Font conversion output exceeded limit."));
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
      if (stderr.length > 100_000) {
        stderr = stderr.slice(-100_000);
      }
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(
          new Error(
            String(stderr || "").trim() ||
              `Font conversion process exited with code ${code}.`
          )
        );
        return;
      }

      let payload = null;
      try {
        payload = JSON.parse(String(stdout || "{}"));
      } catch (_error) {
        reject(new Error("Font conversion returned invalid JSON output."));
        return;
      }

      if (!payload?.ok || typeof payload.base64 !== "string" || !payload.base64) {
        reject(new Error(payload?.error || "Font conversion failed."));
        return;
      }

      try {
        resolve(Buffer.from(payload.base64, "base64"));
      } catch (_error) {
        reject(new Error("Font conversion returned invalid base64 payload."));
      }
    });

    try {
      child.stdin.end(
        JSON.stringify({
          format,
          base64: bytes.toString("base64"),
        })
      );
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGKILL");
      reject(error);
    }
  });
}

async function fetchFontDataUrlFromFileUrl(fileUrl, fallbackMimeType) {
  const normalizedUrl = sanitizeFileUrl(fileUrl);
  if (!normalizedUrl) return { dataUrl: "", mimeType: "" };

  let response = null;
  try {
    response = await fetch(normalizedUrl, { cache: "no-store" });
  } catch (_error) {
    return { dataUrl: "", mimeType: "" };
  }
  if (!response?.ok) {
    return { dataUrl: "", mimeType: "" };
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (!bytes.length) return { dataUrl: "", mimeType: "" };
  if (bytes.length > MAX_CUSTOM_FONT_BYTES) {
    throw new Error("Font file is too large.");
  }

  const responseMimeType = normalizeMimeType(response.headers.get("content-type") || "").split(";")[0];
  const mimeType = normalizeMimeType(responseMimeType || fallbackMimeType || "") || inferMimeTypeFromFileName(normalizedUrl);
  return {
    dataUrl: toDataUrl(mimeType || "application/octet-stream", bytes),
    mimeType,
  };
}

async function convertFontDataToMobileCompatible({
  dataUrl,
  mimeType,
  fileName,
  fileUrl,
}) {
  const initialFormat = inferFontFormat({ mimeType, fileName, fileUrl, dataUrl });
  if (!initialFormat) {
    return {
      dataUrl,
      mimeType,
      fileName,
      fileUrl,
      converted: false,
      format: "",
    };
  }

  if (MOBILE_COMPATIBLE_FONT_FORMATS.has(initialFormat)) {
    return {
      dataUrl,
      mimeType: normalizeMimeType(mimeType) || canonicalMimeForFormat(initialFormat),
      fileName,
      fileUrl,
      converted: false,
      format: initialFormat,
    };
  }

  if (!MOBILE_CONVERTIBLE_FONT_FORMATS.has(initialFormat)) {
    return {
      dataUrl,
      mimeType,
      fileName,
      fileUrl,
      converted: false,
      format: initialFormat,
    };
  }

  let sourceDataUrl = sanitizeDataUrl(dataUrl);
  let sourceMimeType = normalizeMimeType(mimeType);
  if (!sourceDataUrl && fileUrl) {
    const fetched = await fetchFontDataUrlFromFileUrl(fileUrl, sourceMimeType);
    sourceDataUrl = sanitizeDataUrl(fetched.dataUrl);
    sourceMimeType = normalizeMimeType(fetched.mimeType || sourceMimeType);
  }
  if (!sourceDataUrl) {
    return {
      dataUrl,
      mimeType,
      fileName,
      fileUrl,
      converted: false,
      format: initialFormat,
    };
  }

  const parsed = parseDataUri(sourceDataUrl);
  if (!parsed || !parsed.bytes.length) {
    return {
      dataUrl,
      mimeType,
      fileName,
      fileUrl,
      converted: false,
      format: initialFormat,
    };
  }

  const format = inferFontFormat({
    mimeType: sourceMimeType || parsed.mimeType,
    fileName,
    fileUrl,
    dataUrl: sourceDataUrl,
  });
  if (!MOBILE_CONVERTIBLE_FONT_FORMATS.has(format)) {
    return {
      dataUrl: sourceDataUrl,
      mimeType: sourceMimeType || parsed.mimeType,
      fileName,
      fileUrl,
      converted: false,
      format,
    };
  }

  if (!isFontConversionRuntimeSupported()) {
    return {
      dataUrl: sourceDataUrl,
      mimeType: sourceMimeType || parsed.mimeType,
      fileName,
      fileUrl,
      converted: false,
      format,
      conversionSkippedReason: "unsupported-runtime",
    };
  }

  try {
    const outputBytes = await runFontConverterSubprocess({
      format,
      bytes: parsed.bytes,
    });

    if (!outputBytes?.length) {
      return {
        dataUrl: sourceDataUrl,
        mimeType: sourceMimeType || parsed.mimeType,
        fileName,
        fileUrl,
        converted: false,
        format,
      };
    }
    if (!outputBytes.length || outputBytes.length > MAX_CUSTOM_FONT_BYTES) {
      throw new Error("Converted font file is too large.");
    }

    return {
      dataUrl: toDataUrl("font/ttf", outputBytes),
      mimeType: "font/ttf",
      fileName: replaceFileExtension(fileName || "", extensionForFormat("ttf")),
      fileUrl: "",
      converted: true,
      format: "ttf",
      convertedFrom: format,
    };
  } catch (_error) {
    return {
      dataUrl: sourceDataUrl,
      mimeType: sourceMimeType || parsed.mimeType,
      fileName,
      fileUrl,
      converted: false,
      format,
      conversionSkippedReason: "conversion-failed",
    };
  }
}

function isAllowedMimeType(mimeType) {
  if (!mimeType) return false;
  return ALLOWED_FONT_MIME_TYPES.has(mimeType);
}

function normalizeFileName(value) {
  const fileName = String(value || "").trim();
  return fileName.slice(0, 180);
}

function sanitizeConversionStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === FONT_CONVERSION_STATUS_READY) return FONT_CONVERSION_STATUS_READY;
  if (normalized === FONT_CONVERSION_STATUS_FAILED) return FONT_CONVERSION_STATUS_FAILED;
  return FONT_CONVERSION_STATUS_PENDING;
}

function normalizeConversionAttempts(value) {
  const attempts = Number(value);
  if (!Number.isFinite(attempts) || attempts < 0) return 0;
  return Math.floor(attempts);
}

function toIsoString(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function toNullableIsoString(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeFontVariant(value, fallbackFileName = "") {
  if (!value || typeof value !== "object") return null;
  const source = value;
  const dataUrl = sanitizeDataUrl(source.dataUrl);
  const fileUrl = sanitizeFileUrl(source.fileUrl);
  if (!dataUrl && !fileUrl) return null;

  const fileName = normalizeFileName(source.fileName || fallbackFileName || "");
  const mimeType = normalizeMimeType(
    source.mimeType ||
      extractMimeTypeFromDataUrl(dataUrl) ||
      inferMimeTypeFromFileName(fileName || fileUrl)
  );
  if (!isAllowedMimeType(mimeType)) return null;

  const format = inferFontFormat({
    mimeType,
    fileName,
    fileUrl,
    dataUrl,
  });
  return {
    fileName,
    mimeType,
    dataUrl,
    fileUrl,
    format,
  };
}

function isMobileCompatibleVariant(variant) {
  return !!variant && MOBILE_COMPATIBLE_FONT_FORMATS.has(String(variant.format || ""));
}

function toLegacyFontFields(variant, familyFallback = "font") {
  if (!variant) {
    return {
      fileName: normalizeFileName(`${familyFallback}.ttf`),
      mimeType: "font/ttf",
      dataUrl: "",
      fileUrl: "",
    };
  }
  return {
    fileName: normalizeFileName(variant.fileName || `${familyFallback}.ttf`),
    mimeType: normalizeMimeType(variant.mimeType || canonicalMimeForFormat(variant.format || "ttf")),
    dataUrl: sanitizeDataUrl(variant.dataUrl),
    fileUrl: sanitizeFileUrl(variant.fileUrl),
  };
}

export function resolveEditorCustomFontSourceVariant(font) {
  return normalizeFontVariant(font?.source, font?.fileName || "") || normalizeFontVariant(font, font?.fileName || "");
}

export function resolveEditorCustomFontMobileVariant(font) {
  const explicitMobile = normalizeFontVariant(font?.mobile, font?.fileName || "");
  if (isMobileCompatibleVariant(explicitMobile)) return explicitMobile;

  const sourceVariant = resolveEditorCustomFontSourceVariant(font);
  if (isMobileCompatibleVariant(sourceVariant)) return sourceVariant;

  return null;
}

function normalizeStoredFontRecord(value) {
  if (!value || typeof value !== "object") return null;
  const source = value;
  const id = String(source.id || "").trim();
  const family = normalizeFontFamilyName(source.family);
  if (!id || !family) return null;

  const fallbackFileName = normalizeFileName(source.fileName || `${family}.ttf`);
  const sourceVariant =
    normalizeFontVariant(source.source, fallbackFileName) ||
    normalizeFontVariant(source, fallbackFileName);
  if (!sourceVariant) return null;

  const explicitMobileVariant = normalizeFontVariant(source.mobile, fallbackFileName);
  const mobileVariant = isMobileCompatibleVariant(explicitMobileVariant)
    ? explicitMobileVariant
    : isMobileCompatibleVariant(sourceVariant)
      ? sourceVariant
      : null;

  const legacyFields = toLegacyFontFields(sourceVariant, family);
  const conversionStatus = mobileVariant
    ? FONT_CONVERSION_STATUS_READY
    : sanitizeConversionStatus(source.conversionStatus);

  return {
    id,
    family,
    categories: resolveFontCategories(source.categories, family),
    ...legacyFields,
    source: sourceVariant,
    mobile: mobileVariant,
    conversionStatus,
    conversionError:
      conversionStatus === FONT_CONVERSION_STATUS_FAILED
        ? String(source.conversionError || "").trim()
        : "",
    conversionAttempts: normalizeConversionAttempts(source.conversionAttempts),
    lastConversionAt: toNullableIsoString(source.lastConversionAt),
    createdAt: toIsoString(source.createdAt),
    updatedAt: toIsoString(source.updatedAt || source.createdAt),
  };
}

function dedupeByIdAndFamily(fonts) {
  const byId = new Map();
  const byFamily = new Set();
  fonts.forEach((font) => {
    if (!font) return;
    const familyKey = String(font.family || "").toLowerCase();
    if (!familyKey || byFamily.has(familyKey)) return;
    if (byId.has(font.id)) return;
    byFamily.add(familyKey);
    byId.set(font.id, font);
  });
  return Array.from(byId.values());
}

function validateFontCollectionLimits(fonts) {
  if (fonts.length > MAX_CUSTOM_FONT_COUNT) {
    throw new Error(`Too many custom fonts. Limit is ${MAX_CUSTOM_FONT_COUNT}.`);
  }

  const uniqueDataUrls = new Set();
  fonts.forEach((font) => {
    const sourceDataUrl = sanitizeDataUrl(font?.source?.dataUrl || "");
    const mobileDataUrl = sanitizeDataUrl(font?.mobile?.dataUrl || "");
    const legacyDataUrl = sanitizeDataUrl(font?.dataUrl || "");
    if (sourceDataUrl) uniqueDataUrls.add(sourceDataUrl);
    if (mobileDataUrl) uniqueDataUrls.add(mobileDataUrl);
    if (legacyDataUrl) uniqueDataUrls.add(legacyDataUrl);
  });

  const totalBytes = Array.from(uniqueDataUrls).reduce(
    (sum, dataUrl) => sum + estimateDataUrlBytes(dataUrl),
    0
  );
  if (totalBytes > MAX_CUSTOM_FONT_TOTAL_BYTES) {
    throw new Error("Custom fonts storage limit exceeded.");
  }

  fonts.forEach((font) => {
    const perFontDataUrls = new Set([
      sanitizeDataUrl(font?.source?.dataUrl || ""),
      sanitizeDataUrl(font?.mobile?.dataUrl || ""),
      sanitizeDataUrl(font?.dataUrl || ""),
    ]);
    perFontDataUrls.forEach((dataUrl) => {
      if (!dataUrl) return;
      const bytes = estimateDataUrlBytes(dataUrl);
      if (bytes > MAX_CUSTOM_FONT_BYTES) {
        throw new Error(`Custom font "${font.family}" is too large.`);
      }
    });
  });
}

function normalizeStoredFonts(value) {
  const rawFonts = Array.isArray(value?.fonts) ? value.fonts : Array.isArray(value) ? value : [];
  const normalized = rawFonts.map((item) => normalizeStoredFontRecord(item)).filter(Boolean);
  const deduped = dedupeByIdAndFamily(normalized);
  validateFontCollectionLimits(deduped);
  return deduped;
}

function buildStorageValue(fonts) {
  return {
    version: 3,
    fonts,
  };
}

function makeFontId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `font-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeFamilyKey(value) {
  return normalizeFontFamilyName(value).toLowerCase();
}

function readSyncedFontsFromLibrary(library) {
  const value = library?.syncedFonts;
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.fonts)) {
    return value.fonts;
  }
  return [];
}

async function readStoredFonts() {
  try {
    const library = await readEditorFontLibraryRaw();
    return normalizeStoredFonts(library.customFonts);
  } catch (_error) {
    return [];
  }
}

async function writeStoredFonts(fonts) {
  validateFontCollectionLimits(fonts);
  const library = await readEditorFontLibraryRaw();
  library.customFonts = buildStorageValue(fonts);
  await writeEditorFontLibraryRaw(library);
}

export async function getEditorCustomFonts() {
  return readStoredFonts();
}

export async function upsertEditorCustomFont({
  family,
  fileName,
  dataUrl,
  fileUrl,
  mimeType,
  categories,
}) {
  const normalizedFamily = normalizeFontFamilyName(family);
  if (!normalizedFamily) {
    throw new Error("Font family is required.");
  }
  const familyKey = normalizeFamilyKey(normalizedFamily);

  const library = await readEditorFontLibraryRaw();
  const existingSyncedFont = readSyncedFontsFromLibrary(library).find(
    (item) => normalizeFamilyKey(item?.family) === familyKey
  );
  if (existingSyncedFont) {
    const existingCustomFonts = normalizeStoredFonts(library.customFonts);
    const syncedMobileCompatible = Boolean(existingSyncedFont?.mobileCompatible);
    return {
      font: {
        id: String(existingSyncedFont?.id || ""),
        family: normalizedFamily,
        fileName: String(existingSyncedFont?.fileName || ""),
        mimeType: String(existingSyncedFont?.mimeType || ""),
        fileUrl: String(existingSyncedFont?.fileUrl || ""),
        conversionStatus: syncedMobileCompatible
          ? FONT_CONVERSION_STATUS_READY
          : FONT_CONVERSION_STATUS_PENDING,
        conversionError: syncedMobileCompatible
          ? ""
          : "A synced font with the same family already exists.",
        categories: resolveFontCategories(
          existingSyncedFont?.categories,
          normalizedFamily
        ),
        source: "synced",
      },
      fonts: existingCustomFonts,
      skippedDuplicate: true,
      skippedReason: "synced-family-exists",
    };
  }

  const safeDataUrl = sanitizeDataUrl(dataUrl);
  const safeFileUrl = sanitizeFileUrl(fileUrl);
  if (!safeDataUrl && !safeFileUrl) {
    throw new Error("Invalid font data.");
  }

  const resolvedMimeType = normalizeMimeType(
    mimeType || extractMimeTypeFromDataUrl(safeDataUrl) || inferMimeTypeFromFileName(fileName)
  );
  if (!isAllowedMimeType(resolvedMimeType)) {
    throw new Error("Unsupported font file type.");
  }

  const sourceFormat =
    inferFontFormat({
      mimeType: resolvedMimeType,
      fileName,
      fileUrl: safeFileUrl,
      dataUrl: safeDataUrl,
    }) || "ttf";
  const defaultSourceFileName = normalizeFileName(
    fileName || `${normalizedFamily}.${extensionForFormat(sourceFormat)}`
  );
  const sourceVariant = normalizeFontVariant(
    {
      fileName: defaultSourceFileName,
      mimeType: resolvedMimeType,
      dataUrl: safeDataUrl,
      fileUrl: safeFileUrl,
    },
    defaultSourceFileName
  );
  if (!sourceVariant) {
    throw new Error("Invalid font data.");
  }

  if (sourceVariant.dataUrl) {
    const sourceBytes = estimateDataUrlBytes(sourceVariant.dataUrl);
    if (sourceBytes <= 0 || sourceBytes > MAX_CUSTOM_FONT_BYTES) {
      throw new Error("Font file is too large.");
    }
  }

  let mobileVariant = null;
  let conversionStatus = FONT_CONVERSION_STATUS_PENDING;
  let conversionError = "";
  let conversionAttempts = 0;
  let lastConversionAt = null;

  if (isMobileCompatibleVariant(sourceVariant)) {
    mobileVariant = sourceVariant;
    conversionStatus = FONT_CONVERSION_STATUS_READY;
  } else {
    const converted = await convertFontDataToMobileCompatible({
      dataUrl: sourceVariant.dataUrl,
      mimeType: sourceVariant.mimeType,
      fileName: sourceVariant.fileName,
      fileUrl: sourceVariant.fileUrl,
    });

    if (MOBILE_CONVERTIBLE_FONT_FORMATS.has(String(converted?.format || sourceVariant.format || ""))) {
      conversionAttempts = 1;
      lastConversionAt = toIsoString(new Date());
    }

    if (converted?.converted) {
      const normalizedConverted = normalizeFontVariant(
        {
          fileName: converted.fileName || `${normalizedFamily}.ttf`,
          mimeType: converted.mimeType || "font/ttf",
          dataUrl: converted.dataUrl,
          fileUrl: converted.fileUrl,
        },
        `${normalizedFamily}.ttf`
      );
      if (isMobileCompatibleVariant(normalizedConverted)) {
        mobileVariant = normalizedConverted;
        conversionStatus = FONT_CONVERSION_STATUS_READY;
      }
    }

    if (!mobileVariant) {
      const skippedReason = String(converted?.conversionSkippedReason || "").trim();
      if (skippedReason === "conversion-failed") {
        conversionStatus = FONT_CONVERSION_STATUS_FAILED;
        conversionError = `Could not convert ${sourceVariant.format || "font"} to a mobile-compatible format.`;
      } else if (skippedReason === "unsupported-runtime") {
        conversionStatus = FONT_CONVERSION_STATUS_PENDING;
        conversionError = "Font conversion is unavailable in the current runtime.";
      } else {
        conversionStatus = FONT_CONVERSION_STATUS_PENDING;
      }
    }
  }

  if (mobileVariant?.dataUrl) {
    const mobileBytes = estimateDataUrlBytes(mobileVariant.dataUrl);
    if (mobileBytes <= 0 || mobileBytes > MAX_CUSTOM_FONT_BYTES) {
      throw new Error("Converted font file is too large.");
    }
  }

  const nowIso = new Date().toISOString();
  const existingFonts = normalizeStoredFonts(library.customFonts);
  const providedCategories = normalizeFontCategoryInput(categories);
  const existingIndex = existingFonts.findIndex(
    (item) => normalizeFamilyKey(item.family) === familyKey
  );

  if (existingIndex >= 0) {
    const existing = existingFonts[existingIndex];
    const resolvedCategories =
      providedCategories.length > 0
        ? resolveFontCategories(providedCategories, normalizedFamily)
        : resolveFontCategories(existing?.categories, existing?.family || normalizedFamily);
    const legacyFields = toLegacyFontFields(sourceVariant, normalizedFamily);
    existingFonts[existingIndex] = {
      ...existing,
      family: normalizedFamily,
      categories: resolvedCategories,
      ...legacyFields,
      source: sourceVariant,
      mobile: mobileVariant,
      conversionStatus,
      conversionError,
      conversionAttempts,
      lastConversionAt,
      updatedAt: nowIso,
    };
  } else {
    const resolvedCategories = resolveFontCategories(
      providedCategories,
      normalizedFamily
    );
    const legacyFields = toLegacyFontFields(sourceVariant, normalizedFamily);
    existingFonts.push({
      id: makeFontId(),
      family: normalizedFamily,
      categories: resolvedCategories,
      ...legacyFields,
      source: sourceVariant,
      mobile: mobileVariant,
      conversionStatus,
      conversionError,
      conversionAttempts,
      lastConversionAt,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  validateFontCollectionLimits(existingFonts);
  await writeStoredFonts(existingFonts);

  const stored = existingFonts.find(
    (item) => normalizeFamilyKey(item.family) === familyKey
  );
  return {
    font: stored || null,
    fonts: existingFonts,
  };
}

export async function deleteEditorCustomFont({ id, family }) {
  const normalizedId = String(id || "").trim();
  const normalizedFamily = normalizeFontFamilyName(family);
  if (!normalizedId && !normalizedFamily) {
    throw new Error("Missing font id or family.");
  }

  const existingFonts = await readStoredFonts();
  const nextFonts = existingFonts.filter((item) => {
    if (normalizedId && item.id === normalizedId) return false;
    if (
      normalizedFamily &&
      String(item.family || "").toLowerCase() === normalizedFamily.toLowerCase()
    ) {
      return false;
    }
    return true;
  });

  await writeStoredFonts(nextFonts);
  return {
    deleted: nextFonts.length !== existingFonts.length,
    fonts: nextFonts,
  };
}
