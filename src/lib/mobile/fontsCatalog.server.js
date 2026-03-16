import {
  getEditorCustomFonts,
  resolveEditorCustomFontMobileVariant,
  resolveEditorCustomFontSourceVariant,
} from "@/lib/editor/customFonts.server";
import { deriveReadableFontLabel } from "@/lib/editor/customFontLabel";
import { getEditorSyncedFonts } from "@/lib/editor/syncedFonts.server";

const MOBILE_SUPPORTED_FONT_FORMATS = new Set(["ttf", "otf", "ttc"]);

function normalizeMimeType(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeMobileFontCategory(value) {
  return String(value || "").trim().toUpperCase();
}

export function normalizeMobileFontKey(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .replace(/[_\s-]+/g, "")
    .toLowerCase();
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

function resolveFontFormat(font) {
  const sourceMimeType = normalizeMimeType(font?.mimeType || "");
  const fromMimeType = inferFormatFromMimeType(sourceMimeType);
  if (fromMimeType) {
    return {
      format: fromMimeType,
      sourceMimeType: sourceMimeType || null,
    };
  }

  const fromFileName = inferFormatFromName(font?.fileName);
  if (fromFileName) {
    return {
      format: fromFileName,
      sourceMimeType: sourceMimeType || null,
    };
  }

  const fromFileUrl = inferFormatFromName(font?.fileUrl);
  if (fromFileUrl) {
    return {
      format: fromFileUrl,
      sourceMimeType: sourceMimeType || null,
    };
  }

  const fromDataUrl = inferFormatFromMimeType(
    String(font?.dataUrl || "").match(/^data:([^;,]+);/i)?.[1] || ""
  );
  return {
    format: fromDataUrl || "unknown",
    sourceMimeType: sourceMimeType || null,
  };
}

function containsArabic(value) {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

function inferCategories(value) {
  return containsArabic(value)
    ? ["EXCLUSIVE", "ARABIC"]
    : ["EXCLUSIVE", "ENGLISH"];
}

function resolvePreviewText(fontName, displayName, categories = []) {
  const normalizedCategories = Array.isArray(categories)
    ? categories.map((item) => normalizeMobileFontCategory(item))
    : [];
  if (normalizedCategories.includes("ARABIC")) {
    return "رمضان ليس شهراً في التقويم،";
  }

  const sample = String(displayName || "").trim() || String(fontName || "").trim();
  if (!sample) {
    return "The quick brown fox";
  }
  return containsArabic(sample) ? "رمضان ليس شهراً في التقويم،" : "The quick brown fox";
}

function resolveCustomDownloadDescriptor(request, font) {
  const sourceVariant = resolveEditorCustomFontSourceVariant(font);
  const mobileVariant = resolveEditorCustomFontMobileVariant(font);
  if (!mobileVariant) {
    return {
      downloadUrl: "",
      mobileDownloadUrl: "",
      mobileCompatible: false,
      fontFormat: "unknown",
      sourceMimeType: normalizeMimeType(sourceVariant?.mimeType || "") || null,
    };
  }

  const fileUrl = String(mobileVariant.fileUrl || "").trim();
  const hasDataUrl = String(mobileVariant.dataUrl || "").trim().startsWith("data:");
  const id = String(font?.id || "").trim();
  const routeUrl = id
    ? new URL(`/api/mobile/fonts/${encodeURIComponent(id)}/file`, request.url).toString()
    : "";
  const downloadUrl = routeUrl || fileUrl || "";
  if (!downloadUrl || (!hasDataUrl && !fileUrl)) {
    return {
      downloadUrl: "",
      mobileDownloadUrl: "",
      mobileCompatible: false,
      fontFormat: "unknown",
      sourceMimeType: normalizeMimeType(sourceVariant?.mimeType || "") || null,
    };
  }

  const formatInfo = resolveFontFormat(mobileVariant);
  const mobileCompatible = MOBILE_SUPPORTED_FONT_FORMATS.has(formatInfo.format);
  return {
    downloadUrl,
    mobileDownloadUrl: mobileCompatible ? downloadUrl : "",
    mobileCompatible,
    fontFormat: formatInfo.format,
    sourceMimeType:
      normalizeMimeType(sourceVariant?.mimeType || "") || formatInfo.sourceMimeType,
  };
}

function resolveSyncedDownloadDescriptor(request, font) {
  const id = String(font?.id || "").trim();
  const fileUrl = String(font?.fileUrl || "").trim();
  const hasDataUrl = String(font?.dataUrl || "").trim().startsWith("data:");
  if (!fileUrl && !hasDataUrl) {
    return {
      downloadUrl: "",
      mobileDownloadUrl: "",
      mobileCompatible: false,
      fontFormat: "unknown",
      sourceMimeType: normalizeMimeType(font?.mimeType || "") || null,
    };
  }

  const routeUrl = id
    ? new URL(`/api/mobile/fonts/${encodeURIComponent(id)}/file`, request.url).toString()
    : fileUrl;

  const formatInfo = resolveFontFormat(font);
  const mobileCompatible =
    typeof font?.mobileCompatible === "boolean"
      ? font.mobileCompatible
      : MOBILE_SUPPORTED_FONT_FORMATS.has(formatInfo.format);

  return {
    downloadUrl: routeUrl,
    mobileDownloadUrl: mobileCompatible ? routeUrl : "",
    mobileCompatible,
    fontFormat: formatInfo.format,
    sourceMimeType:
      normalizeMimeType(font?.mimeType || "") || formatInfo.sourceMimeType || null,
  };
}

async function readCustomFonts() {
  try {
    const fonts = await getEditorCustomFonts();
    return Array.isArray(fonts) ? fonts : [];
  } catch {
    return [];
  }
}

async function readSyncedFonts() {
  try {
    const fonts = await getEditorSyncedFonts();
    return Array.isArray(fonts) ? fonts : [];
  } catch {
    return [];
  }
}

function resolveDeclaredCategories(font) {
  const declared = Array.isArray(font?.categories)
    ? font.categories
        .map((value) => normalizeMobileFontCategory(value))
        .filter(Boolean)
    : [];
  if (declared.length > 0) {
    const withExclusive = declared.includes("EXCLUSIVE")
      ? declared
      : ["EXCLUSIVE", ...declared];
    return Array.from(new Set(withExclusive));
  }
  return inferCategories(String(font?.family || "").trim());
}

function toMobileCustomFont(font, request) {
  const family = String(font?.family || "").trim();
  if (!family) return null;

  const displayName = deriveReadableFontLabel(font);
  const familyKey = normalizeMobileFontKey(family);
  if (!familyKey) return null;

  const categories = resolveDeclaredCategories(font);
  const download = resolveCustomDownloadDescriptor(request, font);
  return {
    id: String(font?.id || `font-custom-${familyKey}`),
    fontName: family,
    displayName,
    previewText: resolvePreviewText(family, displayName, categories),
    categories,
    previewWeight: 500,
    cssFontFamily: `'${family}'`,
    downloadUrl: download.mobileDownloadUrl || null,
    mobileDownloadUrl: download.mobileDownloadUrl || null,
    mobileCompatible: download.mobileCompatible,
    fontFormat: download.fontFormat,
    sourceMimeType: download.sourceMimeType,
    source: "custom",
    isNew: false,
  };
}

function toMobileSyncedFont(font, request) {
  const family = String(font?.family || "").trim();
  if (!family) return null;

  const familyKey = normalizeMobileFontKey(family);
  if (!familyKey) return null;

  const categories = resolveDeclaredCategories(font);
  const displayName = String(font?.displayName || "").trim() || family;
  const download = resolveSyncedDownloadDescriptor(request, font);

  return {
    id: String(font?.id || `font-synced-${familyKey}`),
    fontName: family,
    displayName,
    previewText:
      String(font?.previewText || "").trim() ||
      resolvePreviewText(family, displayName, categories),
    categories,
    previewWeight: Number(font?.previewWeight) || 400,
    cssFontFamily: String(font?.cssFontFamily || "").trim() || `'${family}'`,
    downloadUrl: download.mobileDownloadUrl || null,
    mobileDownloadUrl: download.mobileDownloadUrl || null,
    mobileCompatible: download.mobileCompatible,
    fontFormat: download.fontFormat,
    sourceMimeType: download.sourceMimeType,
    source: String(font?.source || "synced").trim() || "synced",
    isNew: false,
  };
}

export async function buildMobileFontCatalog(request) {
  const [customFonts, syncedFonts] = await Promise.all([
    readCustomFonts(),
    readSyncedFonts(),
  ]);

  const byId = new Set();
  const byFamily = new Set();
  return [
    ...customFonts.map((font) => toMobileCustomFont(font, request)),
    ...syncedFonts.map((font) => toMobileSyncedFont(font, request)),
  ].filter((font) => {
    if (!font) return false;
    const idKey = String(font.id || "").trim();
    const familyKey = normalizeMobileFontKey(font.fontName);
    if (idKey && byId.has(idKey)) return false;
    if (familyKey && byFamily.has(familyKey)) return false;
    if (idKey) byId.add(idKey);
    if (familyKey) byFamily.add(familyKey);
    return true;
  });
}

export async function buildMobileFontCatalogLookupByNames(request, fontNames = []) {
  const requestedKeys = new Set(
    (Array.isArray(fontNames) ? fontNames : [])
      .map((value) => normalizeMobileFontKey(value))
      .filter(Boolean)
  );
  if (requestedKeys.size === 0) {
    return new Map();
  }

  const [customFonts, syncedFonts] = await Promise.all([
    readCustomFonts(),
    readSyncedFonts(),
  ]);

  const lookup = new Map();
  const tryAdd = (font) => {
    if (!font) return;
    const key = normalizeMobileFontKey(font.fontName);
    if (!key || !requestedKeys.has(key) || lookup.has(key)) return;
    lookup.set(key, font);
  };

  for (const font of customFonts) {
    tryAdd(toMobileCustomFont(font, request));
    if (lookup.size >= requestedKeys.size) {
      return lookup;
    }
  }

  for (const font of syncedFonts) {
    tryAdd(toMobileSyncedFont(font, request));
    if (lookup.size >= requestedKeys.size) {
      return lookup;
    }
  }

  return lookup;
}
