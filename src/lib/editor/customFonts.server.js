import { normalizeFontFamilyName } from "@/lib/editor/fonts";
import { extractFontFamilyName } from "@/lib/editor/fontName.server";
import { isSyntheticFontFamily } from "@/lib/editor/customFontLabel";
import {
  buildFontFileKind,
  deleteFontFamily,
  FONT_FILE_KIND_MOBILE,
  FONT_SOURCE_CUSTOM,
  FONT_STATUS_FAILED,
  FONT_STATUS_PENDING,
  FONT_STATUS_READY,
  defaultWeightVariants,
  findFontFamiliesByNames,
  listFontFamilies,
  normalizeFontStorageKey,
  normalizeFontStyleValue,
  normalizeFontWeightValue,
  toEditorFontRecord,
  upsertFontFamilyWithFiles,
} from "@/lib/editor/fontStorage.server";
import {
  readEditorFontLibraryRaw,
  writeEditorFontLibraryRaw,
} from "@/lib/editor/fontLibraryStore.server";
import {
  getPublicStorageBucketName,
  uploadObject,
} from "@/lib/storage/objectStorage.server";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

const MAX_CUSTOM_FONT_COUNT = 200;
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
const FONT_STORAGE_BUCKET = getPublicStorageBucketName();

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

function sanitizeStorageFileName(value, fallback = "font.ttf") {
  const source = String(value || fallback).trim() || fallback;
  return source
    .replace(/^.*[\\/]/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140) || fallback;
}

function resolveVariantSizeBytes(variant) {
  const parsed = parseDataUri(variant?.dataUrl);
  if (parsed?.bytes?.length) return parsed.bytes.length;
  return null;
}

async function uploadFontVariantDataUrl({ fontId, family, kind, variant }) {
  const parsed = parseDataUri(variant?.dataUrl);
  if (!parsed?.bytes?.length) {
    return null;
  }
  if (parsed.bytes.length > MAX_CUSTOM_FONT_BYTES) {
    throw new Error("Font file is too large.");
  }

  const checksum = createHash("sha256").update(parsed.bytes).digest("hex");
  const safeFileName = sanitizeStorageFileName(
    variant.fileName || `${family}.${extensionForFormat(variant.format || "ttf")}`,
    `${family || "font"}.${extensionForFormat(variant.format || "ttf")}`
  );
  const objectPath = `fonts/${fontId}/${kind}/${checksum.slice(0, 16)}-${safeFileName}`;
  const uploaded = await uploadObject({
    bucket: FONT_STORAGE_BUCKET,
    key: objectPath,
    body: parsed.bytes,
    cacheControl: "public, max-age=31536000, immutable",
    contentType: variant.mimeType || parsed.mimeType || "application/octet-stream",
    upsert: true,
  });
  const publicUrl = String(uploaded.url || "").trim();
  if (!publicUrl) {
    throw new Error("Uploaded font URL is unavailable.");
  }
  return {
    storageBucket: FONT_STORAGE_BUCKET,
    storagePath: objectPath,
    publicUrl,
    sizeBytes: parsed.bytes.length,
    checksum,
  };
}

async function materializeFontVariant({
  fontId,
  family,
  kind,
  variant,
  storageBucket,
  storagePath,
  sizeBytes,
}) {
  if (!variant) return null;
  const uploaded = variant.dataUrl
    ? await uploadFontVariantDataUrl({ fontId, family, kind, variant })
    : null;
  const publicUrl = String(uploaded?.publicUrl || variant.fileUrl || "").trim();
  const resolvedStoragePath = String(uploaded?.storagePath || storagePath || "").trim();
  const resolvedStorageBucket = String(uploaded?.storageBucket || storageBucket || "").trim();
  if (!publicUrl && !resolvedStoragePath) return null;
  return {
    kind,
    format: String(variant.format || inferFontFormat(variant) || "unknown").trim().toLowerCase(),
    mimeType: normalizeMimeType(variant.mimeType || canonicalMimeForFormat(variant.format || "ttf")),
    fileName: normalizeFileName(variant.fileName || `${family}.ttf`),
    publicUrl,
    storageBucket: resolvedStorageBucket || null,
    storagePath: resolvedStoragePath || null,
    sizeBytes:
      uploaded?.sizeBytes ||
      (Number.isFinite(Number(sizeBytes)) ? Math.max(0, Math.round(Number(sizeBytes))) : null) ||
      resolveVariantSizeBytes(variant),
    checksum: uploaded?.checksum || null,
    status: FONT_STATUS_READY,
  };
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
  const fonts = await listFontFamilies({ source: FONT_SOURCE_CUSTOM });
  return fonts.map(toEditorFontRecord).filter(Boolean);
}

export async function upsertEditorCustomFont({
  family,
  fileName,
  dataUrl,
  fileUrl,
  mimeType,
  categories,
  storageBucket,
  storagePath,
  sizeBytes,
  // Optional passthroughs so bulk importers (e.g. Google Fonts) can reuse this
  // whole materialize→store→upsert pipeline while tagging a non-custom source.
  // Defaults preserve the original custom-upload behavior.
  source = FONT_SOURCE_CUSTOM,
  sourceId,
  removable = true,
  includeFontList = true,
  // When true (default), skip re-importing/overwriting a font that already
  // exists in the library (matched by family name, alias, or — for synthetic
  // Canva names — the real family name embedded in the file). Set false to
  // force a replace/update.
  skipIfExists = true,
  // Additional weights/styles of the SAME family, each { dataUrl, mimeType, fileName, weight,
  // style }. Canva designs routinely use two or three cuts of one family; without these the
  // family stores a single file and the browser fakes every other weight (faux-bold), which
  // reads visibly heavier and differently shaped than the real cut.
  extraVariants = [],
}) {
  const normalizedFamily = normalizeFontFamilyName(family);
  if (!normalizedFamily) {
    throw new Error("Font family is required.");
  }
  const familyKey = normalizeFamilyKey(normalizedFamily);

  const safeDataUrl = sanitizeDataUrl(dataUrl);
  const safeFileUrl = sanitizeFileUrl(fileUrl);
  if (!safeDataUrl && !safeFileUrl) {
    throw new Error("Invalid font data.");
  }

  // De-duplicate across every import path (Google, manual upload, Canva). If the
  // font already exists, skip before any download/convert/upload/overwrite. For
  // Canva's opaque synthetic ids, also check the real family name embedded in the
  // font file so e.g. a scraped "Poppins" won't duplicate an existing Poppins.
  // Default-weight spellings count as the same font, so the Google catalog's
  // "Cairo" won't land alongside the appchief catalog's "Cairo Regular".
  if (skipIfExists) {
    const dedupeNames = [
      normalizedFamily,
      familyKey,
      ...defaultWeightVariants(normalizedFamily),
    ];
    if (isSyntheticFontFamily(normalizedFamily) && safeDataUrl) {
      const parsedForName = parseDataUri(safeDataUrl);
      const realName = parsedForName?.bytes?.length ? extractFontFamilyName(parsedForName.bytes) : "";
      if (realName && !isSyntheticFontFamily(realName)) {
        dedupeNames.push(realName, ...defaultWeightVariants(realName));
      }
    }
    const existingLookup = await findFontFamiliesByNames(dedupeNames);
    let existingMatch = null;
    for (const name of dedupeNames) {
      const found = existingLookup.get(normalizeFontStorageKey(name));
      if (found) {
        existingMatch = found;
        break;
      }
    }
    // An existing family that is MISSING a requested weight is not a duplicate to skip — it is a
    // family to complete. Without this, a design that uses a second weight of an already-imported
    // family would keep rendering that weight as faux-bold forever, because the first import
    // stored only the default face.
    const existingKinds = new Set(
      (Array.isArray(existingMatch?.files) ? existingMatch.files : []).map((file) =>
        String(file?.kind || "").toLowerCase()
      )
    );
    const missingVariant = (Array.isArray(extraVariants) ? extraVariants : []).some(
      (entry) =>
        sanitizeDataUrl(entry?.dataUrl) &&
        !existingKinds.has(
          buildFontFileKind(
            FONT_FILE_KIND_MOBILE,
            normalizeFontWeightValue(entry?.weight),
            normalizeFontStyleValue(entry?.style)
          )
        )
    );
    if (existingMatch && !missingVariant) {
      return {
        font: toEditorFontRecord(existingMatch),
        fonts: includeFontList ? await getEditorCustomFonts() : [],
        conversionStatus: FONT_CONVERSION_STATUS_READY,
        conversionError: "",
        conversionAttempts: 0,
        lastConversionAt: null,
        skippedDuplicate: true,
      };
    }
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
  const providedCategories = normalizeFontCategoryInput(categories);
  const existingFontLookup = await findFontFamiliesByNames([normalizedFamily, familyKey]);
  const existingFont = existingFontLookup.get(normalizeFontStorageKey(normalizedFamily)) ||
    existingFontLookup.get(normalizeFontStorageKey(familyKey));
  const fontId = existingFont?.id || randomUUID();
  if (!mobileVariant) {
    throw new Error(
      conversionError ||
        `Could not prepare ${sourceVariant.format || "font"} as a mobile-compatible font.`
    );
  }

  const mobileFile = await materializeFontVariant({
    fontId,
    family: normalizedFamily,
    kind: FONT_FILE_KIND_MOBILE,
    variant: mobileVariant,
    storageBucket,
    storagePath,
    sizeBytes,
  });
  if (!mobileFile) {
    throw new Error("Mobile font file is unavailable.");
  }

  // Extra weights/styles of the same family, each stored under a variant-suffixed kind. Best
  // effort: a weight that fails to convert is skipped with the rest of the family intact — a
  // missing bold still falls back to the default face, which is today's behavior anyway.
  const extraFiles = [];
  const seenExtraKinds = new Set([FONT_FILE_KIND_MOBILE]);
  for (const entry of Array.isArray(extraVariants) ? extraVariants : []) {
    const weight = normalizeFontWeightValue(entry?.weight);
    const style = normalizeFontStyleValue(entry?.style);
    const kind = buildFontFileKind(FONT_FILE_KIND_MOBILE, weight, style);
    if (seenExtraKinds.has(kind)) continue;
    const entryDataUrl = sanitizeDataUrl(entry?.dataUrl);
    if (!entryDataUrl) continue;
    const entryFileName = normalizeFileName(
      entry?.fileName || `${normalizedFamily}-${weight}${style === "italic" ? "i" : ""}.ttf`
    );
    const entryVariant = normalizeFontVariant(
      {
        fileName: entryFileName,
        mimeType: normalizeMimeType(entry?.mimeType || extractMimeTypeFromDataUrl(entryDataUrl)),
        dataUrl: entryDataUrl,
      },
      entryFileName
    );
    if (!entryVariant) continue;
    let usableVariant = entryVariant;
    if (!isMobileCompatibleVariant(entryVariant)) {
      // convertFontDataToMobileCompatible returns a FLAT {dataUrl, mimeType, fileName, fileUrl,
      // converted} — not a wrapped variant. Canva serves WOFF2, which is never mobile-compatible,
      // so EVERY extra weight comes through here; reading the wrong shape silently dropped all of
      // them (the family row updated, but no variant files appeared).
      const converted = await convertFontDataToMobileCompatible({
        dataUrl: entryVariant.dataUrl,
        mimeType: entryVariant.mimeType,
        fileName: entryVariant.fileName,
      });
      const normalizedConverted = converted?.converted
        ? normalizeFontVariant(
            {
              fileName: converted.fileName || entryFileName,
              mimeType: converted.mimeType || "font/ttf",
              dataUrl: converted.dataUrl,
              fileUrl: converted.fileUrl,
            },
            entryFileName
          )
        : null;
      usableVariant = isMobileCompatibleVariant(normalizedConverted) ? normalizedConverted : null;
    }
    if (!usableVariant) continue;
    const file = await materializeFontVariant({
      fontId,
      family: normalizedFamily,
      kind,
      variant: usableVariant,
      storageBucket,
      storagePath,
    });
    if (!file) continue;
    seenExtraKinds.add(kind);
    extraFiles.push({ ...file, fontWeight: weight, fontStyle: style });
  }

  // Canva-imported fonts are named by an opaque id (e.g. "YADkLzugzJU_0"); the
  // real family name (e.g. "Laftah") only exists inside the font file. Recover
  // it so the editor shows a readable label instead of the id / "font".
  let resolvedDisplayName = normalizedFamily;
  const extraAliases = [];
  if (isSyntheticFontFamily(normalizedFamily)) {
    const nameSource =
      parseDataUri(mobileVariant?.dataUrl) || parseDataUri(sourceVariant?.dataUrl);
    const realName = nameSource?.bytes?.length ? extractFontFamilyName(nameSource.bytes) : "";
    if (realName && !isSyntheticFontFamily(realName)) {
      resolvedDisplayName = realName;
      extraAliases.push(realName);
    }
  }

  const stored = await upsertFontFamilyWithFiles({
    id: fontId,
    family: normalizedFamily,
    displayName: resolvedDisplayName,
    source,
    sourceId,
    status:
      conversionStatus === FONT_CONVERSION_STATUS_READY
        ? FONT_STATUS_READY
        : conversionStatus === FONT_CONVERSION_STATUS_FAILED
          ? FONT_STATUS_FAILED
          : FONT_STATUS_PENDING,
    categories:
      providedCategories.length > 0
        ? resolveFontCategories(providedCategories, normalizedFamily)
        : resolveFontCategories(categories, normalizedFamily),
    cssFontFamily: `'${normalizedFamily}'`,
    removable,
    files: [mobileFile, ...extraFiles],
    aliases: [normalizedFamily, familyKey, ...extraAliases],
  });
  const editorFont = toEditorFontRecord({
    ...stored,
    conversionStatus,
    conversionError,
    conversionAttempts,
    lastConversionAt,
    createdAt: stored?.createdAt || nowIso,
    updatedAt: stored?.updatedAt || nowIso,
  });
  const fonts = includeFontList ? await getEditorCustomFonts() : [];
  return {
    font: editorFont,
    fonts,
    conversionStatus,
    conversionError,
    conversionAttempts,
    lastConversionAt,
  };
}

export async function deleteEditorCustomFont({ id, family }) {
  const normalizedId = String(id || "").trim();
  const normalizedFamily = normalizeFontFamilyName(family);
  if (!normalizedId && !normalizedFamily) {
    throw new Error("Missing font id or family.");
  }

  const result = await deleteFontFamily({
    id: normalizedId,
    family: normalizedFamily,
    source: FONT_SOURCE_CUSTOM,
  });
  const fonts = await getEditorCustomFonts();
  return {
    deleted: result.deleted,
    fonts,
  };
}
