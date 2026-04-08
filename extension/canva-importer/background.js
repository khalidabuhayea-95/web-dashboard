/* global chrome, OffscreenCanvas, createImageBitmap, btoa */
importScripts("logger.js");

const logger =
  typeof globalThis.createExtensionLogger === "function"
    ? globalThis.createExtensionLogger("background")
    : {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      };

if (typeof globalThis.installExtensionGlobalErrorHandlers === "function") {
  globalThis.installExtensionGlobalErrorHandlers(logger, { scope: "background" });
}
logger.info("Background service worker initialized");

function errorMessage(error, fallback = "Unexpected error.") {
  return error?.message || fallback;
}

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeDashboardUrl(raw) {
  const value = String(raw || "").trim() || "http://localhost:3000";
  const parsed = new URL(value);
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("Dashboard URL must start with http:// or https://");
  }
  return parsed.toString().replace(/\/$/, "");
}

const MAX_LAYER_SNAPSHOT_TOTAL_BYTES = 6_000_000;
const MAX_LAYER_SNAPSHOT_BYTES = 1_200_000;
const MAX_INLINE_IMAGE_DATA_URL_LENGTH = 1_800_000;
const MAX_TRANSPORT_JSON_LENGTH = 7_500_000;
const MAX_INLINE_FONT_DATA_URL_LENGTH = 7_000_000;
const MAX_IMPORTED_FONT_BYTES = 5_000_000;
const MAX_IMPORTED_FONTS_TOTAL_BYTES = 12_000_000;
const MAX_IMPORTED_FONTS_PER_IMPORT = 6;

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

function estimateJsonLength(value) {
  try {
    return JSON.stringify(value).length;
  } catch (_error) {
    return Number.MAX_SAFE_INTEGER;
  }
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

function dataUrlToBlob(dataUrl) {
  const source = String(dataUrl || "").trim();
  const match = source.match(/^data:([^;,]*)(;base64)?,(.*)$/i);
  if (!match) {
    throw new Error("Invalid data URL.");
  }
  const mimeType =
    String(match[1] || "application/octet-stream").trim() || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = String(match[3] || "");
  const binaryString = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function cleanCropRect(rect, dpr, screenshotWidth, screenshotHeight) {
  const x = Math.max(0, Math.floor(Number(rect?.x || 0) * dpr));
  const y = Math.max(0, Math.floor(Number(rect?.y || 0) * dpr));
  const width = Math.max(1, Math.floor(Number(rect?.width || 0) * dpr));
  const height = Math.max(1, Math.floor(Number(rect?.height || 0) * dpr));

  const safeWidth = Math.max(1, Math.min(width, screenshotWidth - x));
  const safeHeight = Math.max(1, Math.min(height, screenshotHeight - y));
  return {
    x: Math.min(x, screenshotWidth - 1),
    y: Math.min(y, screenshotHeight - 1),
    width: safeWidth,
    height: safeHeight,
  };
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

function sanitizeFontFileName(value, fallback = "imported-font.ttf") {
  const source = String(value || "").trim();
  const cleaned = source
    .replace(/[?#].*$/, "")
    .split("/")
    .pop()
    ?.replace(/[^\w.\- ]+/g, "")
    .trim();
  if (cleaned) return cleaned.slice(0, 180);
  return fallback;
}

function inferFontMimeTypeFromSource(sourceUrl = "", hint = "") {
  const hintValue = String(hint || "").toLowerCase();
  if (hintValue.includes("truetype") || hintValue.includes("ttf")) return "font/ttf";
  if (hintValue.includes("opentype") || hintValue.includes("otf")) return "font/otf";
  if (hintValue.includes("ttc") || hintValue.includes("collection")) return "font/ttc";
  if (hintValue.includes("woff2")) return "font/woff2";
  if (hintValue.includes("woff")) return "font/woff";
  if (hintValue.includes("embedded-opentype") || hintValue.includes("eot")) {
    return "application/vnd.ms-fontobject";
  }

  const normalizedUrl = String(sourceUrl || "").toLowerCase();
  if (normalizedUrl.includes(".ttf")) return "font/ttf";
  if (normalizedUrl.includes(".otf")) return "font/otf";
  if (normalizedUrl.includes(".ttc")) return "font/ttc";
  if (normalizedUrl.includes(".woff2")) return "font/woff2";
  if (normalizedUrl.includes(".woff")) return "font/woff";
  if (normalizedUrl.includes(".eot")) return "application/vnd.ms-fontobject";
  return "";
}

function inferFontFileExtensionFromMimeType(mimeType = "") {
  const normalized = String(mimeType || "").trim().toLowerCase();
  if (
    normalized === "font/ttf" ||
    normalized === "application/x-font-ttf" ||
    normalized === "application/font-sfnt"
  ) {
    return "ttf";
  }
  if (normalized === "font/otf" || normalized === "application/x-font-otf") return "otf";
  if (
    normalized === "font/ttc" ||
    normalized === "font/collection" ||
    normalized === "application/x-font-ttc"
  ) {
    return "ttc";
  }
  if (normalized === "font/woff2") return "woff2";
  if (normalized === "font/woff" || normalized === "application/font-woff") return "woff";
  if (normalized === "application/vnd.ms-fontobject") return "eot";
  return "ttf";
}

function isAllowedFontMimeType(mimeType) {
  const normalized = String(mimeType || "").trim().toLowerCase();
  return ALLOWED_FONT_MIME_TYPES.has(normalized);
}

function parseMimeTypeFromDataUrl(dataUrl) {
  const source = String(dataUrl || "").trim();
  const match = source.match(/^data:([^;,]+)(?:;[^,]*)?,/i);
  return String(match?.[1] || "").trim().toLowerCase();
}

async function fetchFontDataUrl(sourceUrl, mimeTypeHint = "") {
  const url = String(sourceUrl || "").trim();
  if (!url) return { dataUrl: "", mimeType: "", fileName: "" };

  if (url.startsWith("data:")) {
    const hintedMimeType = inferFontMimeTypeFromSource("", mimeTypeHint);
    let dataMimeType = parseMimeTypeFromDataUrl(url) || hintedMimeType;
    if (!isAllowedFontMimeType(dataMimeType) && isAllowedFontMimeType(hintedMimeType)) {
      dataMimeType = hintedMimeType;
    }
    if (!isAllowedFontMimeType(dataMimeType)) {
      return { dataUrl: "", mimeType: "", fileName: "" };
    }
    const bytes = estimateDataUrlBytes(url);
    if (bytes <= 0 || bytes > MAX_IMPORTED_FONT_BYTES) {
      return { dataUrl: "", mimeType: "", fileName: "" };
    }
    return {
      dataUrl: url,
      mimeType: dataMimeType,
      fileName: sanitizeFontFileName(`font.${inferFontFileExtensionFromMimeType(dataMimeType)}`),
    };
  }

  let response = null;
  try {
    response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
    });
  } catch (_error) {
    return { dataUrl: "", mimeType: "", fileName: "" };
  }
  if (!response?.ok) {
    return { dataUrl: "", mimeType: "", fileName: "" };
  }
  const blob = await response.blob();
  if (!blob || blob.size <= 0 || blob.size > MAX_IMPORTED_FONT_BYTES) {
    return { dataUrl: "", mimeType: "", fileName: "" };
  }
  const hintedMimeType = inferFontMimeTypeFromSource(url, mimeTypeHint);
  let inferredMimeType = String(blob.type || "").trim().toLowerCase() || hintedMimeType;
  if (!isAllowedFontMimeType(inferredMimeType) && isAllowedFontMimeType(hintedMimeType)) {
    inferredMimeType = hintedMimeType;
  }
  if (!isAllowedFontMimeType(inferredMimeType)) {
    return { dataUrl: "", mimeType: "", fileName: "" };
  }
  const dataUrl = await blobToDataUrl(blob);
  if (!dataUrl.startsWith("data:") || dataUrl.length > MAX_INLINE_FONT_DATA_URL_LENGTH) {
    return { dataUrl: "", mimeType: "", fileName: "" };
  }
  return {
    dataUrl,
    mimeType: inferredMimeType,
    fileName: sanitizeFontFileName(url),
  };
}

async function createThumbnailDataUrl(sourceDataUrl, maxSide = 640, quality = 0.82) {
  const sourceBlob = dataUrlToBlob(sourceDataUrl);
  const sourceBitmap = await createImageBitmap(sourceBlob);
  const scale = Math.min(1, maxSide / Math.max(sourceBitmap.width, sourceBitmap.height, 1));
  const width = Math.max(1, Math.round(sourceBitmap.width * scale));
  const height = Math.max(1, Math.round(sourceBitmap.height * scale));
  const thumbnailCanvas = new OffscreenCanvas(width, height);
  const ctx = thumbnailCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create thumbnail context.");
  }
  ctx.drawImage(sourceBitmap, 0, 0, width, height);
  const thumbnailBlob = await thumbnailCanvas.convertToBlob({ type: "image/jpeg", quality });
  return blobToDataUrl(thumbnailBlob);
}

async function decodeDataUrlToBitmap(dataUrl) {
  const blob = dataUrlToBlob(dataUrl);
  return createImageBitmap(blob);
}

const TRIMMABLE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

async function trimTransparentPaddingFromDataUrl(dataUrl, options = {}) {
  const sourceDataUrl = String(dataUrl || "").trim();
  const mimeType = parseMimeTypeFromDataUrl(sourceDataUrl);
  if (!sourceDataUrl.startsWith("data:image/")) return null;
  if (!TRIMMABLE_IMAGE_MIME_TYPES.has(mimeType)) return null;

  const alphaThreshold = Math.max(1, Math.min(255, Number(options?.alphaThreshold || 8)));
  const bitmap = await decodeDataUrlToBitmap(sourceDataUrl);
  const sourceWidth = Math.max(1, Number(bitmap.width || 0));
  const sourceHeight = Math.max(1, Number(bitmap.height || 0));
  const scanCanvas = new OffscreenCanvas(sourceWidth, sourceHeight);
  const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });
  if (!scanContext) {
    throw new Error("Failed to create trim scan context.");
  }
  scanContext.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight);
  const imageData = scanContext.getImageData(0, 0, sourceWidth, sourceHeight);
  const pixels = imageData.data;

  let minX = sourceWidth;
  let minY = sourceHeight;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      const alpha = pixels[(y * sourceWidth + x) * 4 + 3];
      if (alpha < alphaThreshold) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      trimmed: false,
      dataUrl: sourceDataUrl,
      offsetX: 0,
      offsetY: 0,
      width: sourceWidth,
      height: sourceHeight,
      originalWidth: sourceWidth,
      originalHeight: sourceHeight,
    };
  }

  const shouldForceRasterize = Boolean(options?.forceRasterize);
  const alreadyTight =
    minX === 0 &&
    minY === 0 &&
    maxX === sourceWidth - 1 &&
    maxY === sourceHeight - 1;
  if (alreadyTight && !shouldForceRasterize) {
    return {
      trimmed: false,
      dataUrl: sourceDataUrl,
      offsetX: 0,
      offsetY: 0,
      width: sourceWidth,
      height: sourceHeight,
      originalWidth: sourceWidth,
      originalHeight: sourceHeight,
    };
  }

  const trimmedWidth = alreadyTight ? sourceWidth : Math.max(1, maxX - minX + 1);
  const trimmedHeight = alreadyTight ? sourceHeight : Math.max(1, maxY - minY + 1);
  const offsetX = alreadyTight ? 0 : minX;
  const offsetY = alreadyTight ? 0 : minY;
  const trimmedCanvas = new OffscreenCanvas(trimmedWidth, trimmedHeight);
  const trimmedContext = trimmedCanvas.getContext("2d", { willReadFrequently: false });
  if (!trimmedContext) {
    throw new Error("Failed to create trim output context.");
  }
  trimmedContext.drawImage(
    scanCanvas,
    offsetX,
    offsetY,
    trimmedWidth,
    trimmedHeight,
    0,
    0,
    trimmedWidth,
    trimmedHeight
  );
  const trimmedBlob = await trimmedCanvas.convertToBlob({ type: "image/png" });
  const trimmedDataUrl = await blobToDataUrl(trimmedBlob);
  return {
    trimmed: trimmedDataUrl.startsWith("data:image/"),
    dataUrl: trimmedDataUrl.startsWith("data:image/") ? trimmedDataUrl : sourceDataUrl,
    offsetX,
    offsetY,
    width: trimmedWidth,
    height: trimmedHeight,
    originalWidth: sourceWidth,
    originalHeight: sourceHeight,
  };
}

async function cropBitmapToDataUrl(bitmap, rect, options = {}) {
  const dpr = Number(options?.dpr || 1);
  const crop = cleanCropRect(rect, dpr, bitmap.width, bitmap.height);
  const targetWidth = Math.max(1, Math.round(numberOr(options?.targetWidth, crop.width)));
  const targetHeight = Math.max(1, Math.round(numberOr(options?.targetHeight, crop.height)));
  const outputType = String(options?.type || "image/png");
  const outputQuality = Number(options?.quality);
  const offscreenCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = offscreenCanvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) {
    throw new Error("Failed to create offscreen canvas context.");
  }
  ctx.drawImage(
    bitmap,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    targetWidth,
    targetHeight
  );

  const blobOptions = { type: outputType };
  if (Number.isFinite(outputQuality)) {
    blobOptions.quality = Math.max(0.1, Math.min(outputQuality, 1));
  }
  const croppedBlob = await offscreenCanvas.convertToBlob(blobOptions);
  const dataUrl = await blobToDataUrl(croppedBlob);
  return {
    dataUrl,
    width: targetWidth,
    height: targetHeight,
  };
}

async function cropScreenshotToCanvas(screenshotDataUrl, canvasMeta) {
  const screenshotBitmap = await decodeDataUrlToBitmap(screenshotDataUrl);

  const crop = await cropBitmapToDataUrl(
    screenshotBitmap,
    canvasMeta.rect,
    {
      dpr: Number(canvasMeta.devicePixelRatio || 1),
      targetWidth: Number(canvasMeta.designWidth || 0),
      targetHeight: Number(canvasMeta.designHeight || 0),
      type: "image/jpeg",
      quality: 0.9,
    }
  );
  return {
    dataUrl: crop.dataUrl,
    width: crop.width,
    height: crop.height,
  };
}

async function isolateLayerSnapshotFromBitmaps(visibleBitmap, hiddenBitmap, rect, options = {}) {
  if (!visibleBitmap || !hiddenBitmap || !rect) return "";
  const dpr = Number(options?.dpr || 1);
  const visibleCrop = cleanCropRect(rect, dpr, visibleBitmap.width, visibleBitmap.height);
  const hiddenCrop = cleanCropRect(rect, dpr, hiddenBitmap.width, hiddenBitmap.height);
  const targetWidth = Math.max(1, Math.round(numberOr(options?.targetWidth, visibleCrop.width)));
  const targetHeight = Math.max(1, Math.round(numberOr(options?.targetHeight, visibleCrop.height)));

  const drawCropToCanvas = (bitmap, cropRect) => {
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Failed to create isolation canvas context.");
    }
    context.drawImage(
      bitmap,
      cropRect.x,
      cropRect.y,
      cropRect.width,
      cropRect.height,
      0,
      0,
      targetWidth,
      targetHeight
    );
    return { canvas, context };
  };

  const visibleLayer = drawCropToCanvas(visibleBitmap, visibleCrop);
  const hiddenLayer = drawCropToCanvas(hiddenBitmap, hiddenCrop);
  const outputCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  const outputContext = outputCanvas.getContext("2d", { willReadFrequently: true });
  if (!outputContext) {
    throw new Error("Failed to create isolation output context.");
  }

  const visiblePixels = visibleLayer.context.getImageData(0, 0, targetWidth, targetHeight);
  const hiddenPixels = hiddenLayer.context.getImageData(0, 0, targetWidth, targetHeight);
  const outputPixels = outputContext.createImageData(targetWidth, targetHeight);
  const source = visiblePixels.data;
  const backdrop = hiddenPixels.data;
  const output = outputPixels.data;
  let nonTransparentPixelCount = 0;

  for (let index = 0; index < output.length; index += 4) {
    const deltaR = Math.abs(source[index] - backdrop[index]);
    const deltaG = Math.abs(source[index + 1] - backdrop[index + 1]);
    const deltaB = Math.abs(source[index + 2] - backdrop[index + 2]);
    const deltaA = Math.abs(source[index + 3] - backdrop[index + 3]);
    const alphaByte = Math.min(255, Math.round(Math.max(deltaR, deltaG, deltaB, deltaA) * 1.18));
    if (alphaByte < 10) continue;

    const alpha = alphaByte / 255;
    output[index + 3] = alphaByte;
    output[index] = Math.max(
      0,
      Math.min(255, Math.round((source[index] - backdrop[index] * (1 - alpha)) / Math.max(alpha, 0.001)))
    );
    output[index + 1] = Math.max(
      0,
      Math.min(255, Math.round((source[index + 1] - backdrop[index + 1] * (1 - alpha)) / Math.max(alpha, 0.001)))
    );
    output[index + 2] = Math.max(
      0,
      Math.min(255, Math.round((source[index + 2] - backdrop[index + 2] * (1 - alpha)) / Math.max(alpha, 0.001)))
    );
    nonTransparentPixelCount += 1;
  }

  const coverage = nonTransparentPixelCount / Math.max(1, targetWidth * targetHeight);
  if (coverage <= 0.0015) return "";

  outputContext.putImageData(outputPixels, 0, 0);
  const isolatedBlob = await outputCanvas.convertToBlob({ type: "image/png" });
  const isolatedDataUrl = await blobToDataUrl(isolatedBlob);
  return isolatedDataUrl.startsWith("data:image/") ? isolatedDataUrl : "";
}

function buildSingleImageFabricObject(imageDataUrl, width, height, options = {}) {
  return {
    type: "Image",
    version: "7.0.0",
    originX: "left",
    originY: "top",
    left: 0,
    top: 0,
    width,
    height,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    opacity: 1,
    src: imageDataUrl,
    layerType: "image",
    layerName: String(options?.layerName || "Imported Canva Snapshot"),
    layerLocked: false,
    layerHidden: false,
    sourceWidth: width,
    sourceHeight: height,
    importNodeId: String(options?.importNodeId || "canva-snapshot-1"),
    importParentId: options?.importParentId ? String(options.importParentId) : null,
    importKind: String(options?.importKind || "image"),
    importZIndex: Number.isFinite(Number(options?.importZIndex)) ? Number(options.importZIndex) : undefined,
    fallback: typeof options?.fallback === "boolean" ? options.fallback : true,
    fallbackReason: String(options?.fallbackReason || "full-snapshot"),
  };
}

function annotateImportMetadata(object, layer, fallbackOverride) {
  const fallbackReason = String(
    fallbackOverride?.reason || layer?.fallbackReason || (layer?.preferSnapshot ? "masked-or-clipped" : "")
  ).trim();
  const fallback = typeof fallbackOverride?.value === "boolean"
    ? fallbackOverride.value
    : Boolean(layer?.fallback || fallbackReason);
  return {
    ...object,
    importNodeId: String(layer?.id || object.importNodeId || ""),
    importParentId: String(layer?.parentId || "").trim() || null,
    importKind: String(layer?.kind || object.layerType || "unknown"),
    sourceAssetId: sanitizeMetadataText(layer?.sourceAssetId || object.sourceAssetId || ""),
    titleEn: sanitizeMetadataText(layer?.titleEn || object.titleEn || ""),
    tagsEn: uniqueMetadataStrings(layer?.tagsEn || object.tagsEn || []),
    labelsEn: uniqueMetadataStrings(layer?.labelsEn || object.labelsEn || []),
    fallback,
    fallbackReason,
  };
}

function parseNumericDimension(value) {
  const numeric = Number.parseFloat(String(value || "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

const GENERIC_FONT_FAMILIES = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "emoji",
  "math",
  "fangsong",
]);

function normalizeFontFamilyName(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  const primary = input.split(",")[0]?.replace(/^['"]+|['"]+$/g, "").trim() || "";
  if (!primary) return "";
  if (GENERIC_FONT_FAMILIES.has(primary.toLowerCase())) return "";
  return primary.replace(/\s+/g, " ").trim();
}

function collectUsedFontFamilies(layers = []) {
  const seen = new Set();
  const usedFonts = [];
  (Array.isArray(layers) ? layers : []).forEach((layer) => {
    if (String(layer?.kind || "").toLowerCase() !== "text") return;
    const family = normalizeFontFamilyName(layer?.fontFamily);
    if (!family) return;
    const key = family.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    usedFonts.push(family);
  });
  return usedFonts;
}

function normalizeFontStyleValue(value) {
  const source = String(value || "").trim().toLowerCase();
  if (!source) return "normal";
  if (source.includes("italic") || source.includes("oblique") || source.includes("slant")) {
    return "italic";
  }
  return "normal";
}

function parseNumericFontWeight(value, fallback = Number.NaN) {
  const source = String(value ?? "").trim().toLowerCase();
  if (!source) return fallback;
  if (source === "normal") return 400;
  if (source === "bold") return 700;
  const numeric = Number.parseInt(source.replace(/[^\d]/g, ""), 10);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.max(1, Math.min(1000, numeric));
  }
  return fallback;
}

function normalizeFontWeightRangeBounds(minValue, maxValue) {
  const minNumeric = parseNumericFontWeight(minValue, Number.NaN);
  const maxNumeric = parseNumericFontWeight(maxValue, Number.NaN);
  if (Number.isFinite(minNumeric) && Number.isFinite(maxNumeric)) {
    return minNumeric <= maxNumeric
      ? { min: minNumeric, max: maxNumeric }
      : { min: maxNumeric, max: minNumeric };
  }
  if (Number.isFinite(minNumeric)) {
    return { min: minNumeric, max: minNumeric };
  }
  if (Number.isFinite(maxNumeric)) {
    return { min: maxNumeric, max: maxNumeric };
  }
  return { min: Number.NaN, max: Number.NaN };
}

function inferFontWeightFromSourceName(sourceValue) {
  const source = String(sourceValue || "").toLowerCase();
  if (!source) return Number.NaN;
  const weightMatchers = [
    { regex: /(extra|ultra)[\s_-]*(black|heavy)/, weight: 900 },
    { regex: /\b(black|heavy)\b/, weight: 900 },
    { regex: /(extra|ultra)[\s_-]*bold/, weight: 800 },
    { regex: /\b(semi|demi)[\s_-]*bold\b/, weight: 600 },
    { regex: /\bmedium\b/, weight: 500 },
    { regex: /(extra|ultra)[\s_-]*light/, weight: 200 },
    { regex: /\b(thin|hairline)\b/, weight: 100 },
    { regex: /\blight\b/, weight: 300 },
    { regex: /\bbold\b/, weight: 700 },
    { regex: /\b(regular|normal|roman|book)\b/, weight: 400 },
  ];
  const matched = weightMatchers.find((entry) => entry.regex.test(source));
  return matched ? matched.weight : Number.NaN;
}

function inferFontStyleFromSourceName(sourceValue) {
  const source = String(sourceValue || "").toLowerCase();
  if (!source) return "normal";
  return /(italic|oblique|slant|slanted)/.test(source) ? "italic" : "normal";
}

function buildUsedFontTargetsByFamily(layers = []) {
  const usageByFamily = new Map();
  (Array.isArray(layers) ? layers : []).forEach((layer) => {
    if (String(layer?.kind || "").toLowerCase() !== "text") return;
    const family = normalizeFontFamilyName(layer?.fontFamily);
    if (!family) return;
    const weight = parseNumericFontWeight(layer?.fontWeight, 400);
    const style = normalizeFontStyleValue(layer?.fontStyle);
    const key = `${weight}|${style}`;
    const bucket = usageByFamily.get(family) || new Map();
    bucket.set(key, Number(bucket.get(key) || 0) + 1);
    usageByFamily.set(family, bucket);
  });

  const result = {};
  usageByFamily.forEach((bucket, family) => {
    let selected = null;
    bucket.forEach((count, key) => {
      const [weightText, styleText] = key.split("|");
      const weight = parseNumericFontWeight(weightText, 400);
      const style = normalizeFontStyleValue(styleText);
      const distanceFromRegular = Math.abs(weight - 400);
      const candidate = {
        count,
        weight,
        style,
        distanceFromRegular,
        preferNormalStyle: style === "normal" ? 1 : 0,
      };
      if (!selected) {
        selected = candidate;
        return;
      }
      if (candidate.count > selected.count) {
        selected = candidate;
        return;
      }
      if (candidate.count === selected.count && candidate.preferNormalStyle > selected.preferNormalStyle) {
        selected = candidate;
        return;
      }
      if (candidate.count === selected.count && candidate.style === selected.style) {
        if (candidate.distanceFromRegular < selected.distanceFromRegular) {
          selected = candidate;
        }
      }
    });

    result[family] = {
      fontWeight: selected?.weight || 400,
      fontStyle: selected?.style || "normal",
    };
  });
  return result;
}

function getFontTargetForFamily(fontTargetsByFamily, family) {
  const normalizedFamily = normalizeFontFamilyName(family);
  if (!normalizedFamily) {
    return { fontWeight: 400, fontStyle: "normal" };
  }
  const source = fontTargetsByFamily && typeof fontTargetsByFamily === "object" ? fontTargetsByFamily : {};
  if (source[normalizedFamily]) {
    return {
      fontWeight: parseNumericFontWeight(source[normalizedFamily].fontWeight, 400),
      fontStyle: normalizeFontStyleValue(source[normalizedFamily].fontStyle),
    };
  }
  const targetKey = normalizedFamily.toLowerCase();
  const matchedKey = Object.keys(source).find(
    (candidate) => normalizeFontFamilyName(candidate).toLowerCase() === targetKey
  );
  if (!matchedKey || !source[matchedKey]) {
    return { fontWeight: 400, fontStyle: "normal" };
  }
  return {
    fontWeight: parseNumericFontWeight(source[matchedKey].fontWeight, 400),
    fontStyle: normalizeFontStyleValue(source[matchedKey].fontStyle),
  };
}

function getFontMimePreferenceRank(mimeType) {
  const normalized = String(mimeType || "").trim().toLowerCase();
  if (
    normalized === "font/ttf" ||
    normalized === "application/x-font-ttf" ||
    normalized === "application/font-sfnt"
  ) {
    return 6;
  }
  if (normalized === "font/otf" || normalized === "application/x-font-otf") return 5;
  if (
    normalized === "font/ttc" ||
    normalized === "font/collection" ||
    normalized === "application/x-font-ttc"
  ) {
    return 4;
  }
  if (normalized === "font/woff2") return 3;
  if (normalized === "font/woff" || normalized === "application/font-woff") return 2;
  if (normalized === "application/vnd.ms-fontobject") return 1;
  return 0;
}

function buildFontCandidateProfile(candidate) {
  const sourceName = [candidate?.fileName, candidate?.url].filter(Boolean).join(" ");
  const explicitStyleValue = String(candidate?.fontStyle || "").trim();
  const explicitStyle = explicitStyleValue ? normalizeFontStyleValue(explicitStyleValue) : "";
  const inferredStyle = inferFontStyleFromSourceName(sourceName);
  const style = explicitStyle || inferredStyle || "normal";

  const range = normalizeFontWeightRangeBounds(candidate?.fontWeightMin, candidate?.fontWeightMax);
  let weightMin = range.min;
  let weightMax = range.max;
  if (!Number.isFinite(weightMin) || !Number.isFinite(weightMax)) {
    const inferredWeight = inferFontWeightFromSourceName(sourceName);
    const fallbackWeight = Number.isFinite(inferredWeight) ? inferredWeight : 400;
    weightMin = fallbackWeight;
    weightMax = fallbackWeight;
  }

  return { style, weightMin, weightMax };
}

function scoreFontCandidateForTarget(candidate, target) {
  const targetWeight = parseNumericFontWeight(target?.fontWeight, 400);
  const targetStyle = normalizeFontStyleValue(target?.fontStyle);
  const candidateProfile = buildFontCandidateProfile(candidate);
  const sourceName = [candidate?.fileName, candidate?.url].filter(Boolean).join(" ").toLowerCase();

  const distanceToRange =
    targetWeight < candidateProfile.weightMin
      ? candidateProfile.weightMin - targetWeight
      : targetWeight > candidateProfile.weightMax
        ? targetWeight - candidateProfile.weightMax
        : 0;

  let score = 0;
  if (candidateProfile.style === targetStyle) {
    score += 160;
  } else if (targetStyle === "normal" && candidateProfile.style === "italic") {
    score -= 120;
  } else {
    score -= 80;
  }

  score += Math.max(0, 140 - Math.round(distanceToRange / 3));
  if (distanceToRange === 0) score += 30;

  if (targetStyle === "normal" && /\b(regular|normal|roman|book)\b/.test(sourceName)) {
    score += 14;
  }
  if (targetStyle === "italic" && /(italic|oblique|slant|slanted)/.test(sourceName)) {
    score += 14;
  }

  if (Number.isFinite(targetWeight) && targetWeight >= 650 && /\bbold\b/.test(sourceName)) {
    score += 8;
  }
  if (Number.isFinite(targetWeight) && targetWeight <= 450 && /\blight\b/.test(sourceName)) {
    score -= 4;
  }

  const mimeRank = getFontMimePreferenceRank(candidate?.mimeType);
  score += mimeRank * 3;
  if (String(candidate?.dataUrl || "").startsWith("data:")) {
    score += 4;
  }

  return {
    score,
    distanceToRange,
    mimeRank,
  };
}

function orderFontCandidatesForTarget(candidates, target) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => ({
      candidate,
      index,
      ranking: scoreFontCandidateForTarget(candidate, target),
    }))
    .sort((a, b) => {
      if (b.ranking.score !== a.ranking.score) return b.ranking.score - a.ranking.score;
      if (a.ranking.distanceToRange !== b.ranking.distanceToRange) {
        return a.ranking.distanceToRange - b.ranking.distanceToRange;
      }
      if (b.ranking.mimeRank !== a.ranking.mimeRank) return b.ranking.mimeRank - a.ranking.mimeRank;
      return a.index - b.index;
    })
    .map((entry) => entry.candidate);
}

function resolveRotatedTopLeftAnchor(left, top, width, height, angle) {
  const normalizedAngle = ((numberOr(angle, 0) % 360) + 360) % 360;
  if (Math.abs(normalizedAngle) <= 0.2 || Math.abs(normalizedAngle - 360) <= 0.2) {
    return {
      left,
      top,
    };
  }

  const radians = (normalizedAngle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfWidth = Math.max(1, Number(width || 1)) / 2;
  const halfHeight = Math.max(1, Number(height || 1)) / 2;
  const centerX = Number(left || 0) + halfWidth;
  const centerY = Number(top || 0) + halfHeight;

  return {
    left: centerX - halfWidth * cos + halfHeight * sin,
    top: centerY - halfWidth * sin - halfHeight * cos,
  };
}

async function layerToFabricObject(layer, index) {
  let left = numberOr(layer?.x, 0);
  let top = numberOr(layer?.y, 0);
  let width = Math.max(1, Math.round(numberOr(layer?.width, 1)));
  let height = Math.max(1, Math.round(numberOr(layer?.height, 1)));
  const angle = numberOr(layer?.angle, 0);
  const opacity = Math.max(0, Math.min(1, numberOr(layer?.opacity, 1)));
  const flipX = Boolean(layer?.flipX);
  const flipY = Boolean(layer?.flipY);
  const normalizedAngle = ((angle % 360) + 360) % 360;
  const isAxisAlignedImage =
    !flipX &&
    !flipY &&
    (Math.abs(normalizedAngle) <= 0.2 || Math.abs(normalizedAngle - 360) <= 0.2);
  if (layer?.kind === "text" && String(layer?.text || "").trim()) {
    const text = String(layer.text || "").trim();
    const fontSize = Math.max(8, numberOr(layer?.fontSize, 28));
    const letterSpacingPx = numberOr(layer?.letterSpacing, 0);
    const charSpacing = fontSize > 0 ? (letterSpacingPx / fontSize) * 1000 : 0;
    const textDecoration = String(layer?.textDecoration || "").toLowerCase();
    const underline = textDecoration.includes("underline");
    const linethrough =
      textDecoration.includes("line-through") || textDecoration.includes("linethrough");
    const textBackgroundColor = String(layer?.textBackgroundColor || "").trim();
    const textBackgroundRadius = Math.max(0, numberOr(layer?.textBackgroundRadius, 0));
    const hasTextBackground =
      Boolean(textBackgroundColor) &&
      textBackgroundColor.toLowerCase() !== "transparent" &&
      textBackgroundColor.toLowerCase() !== "rgba(0, 0, 0, 0)";
    const resolvedAnchor = resolveRotatedTopLeftAnchor(left, top, width, height, angle);
    return annotateImportMetadata({
      type: "textbox",
      version: "7.0.0",
      originX: "left",
      originY: "top",
      left: resolvedAnchor.left,
      top: resolvedAnchor.top,
      width,
      height,
      angle,
      opacity,
      text,
      textAlign: String(layer?.textAlign || "left"),
      fill: String(layer?.color || "#111827"),
      fontFamily: normalizeFontFamilyName(layer?.fontFamily) || "Arial",
      fontSize,
      fontWeight: numberOr(layer?.fontWeight, 400),
      fontStyle: String(layer?.fontStyle || "normal"),
      lineHeight: Math.max(0.8, numberOr(layer?.lineHeight, 1.2)),
      charSpacing,
      underline,
      linethrough,
      ...(hasTextBackground ? { textBackgroundColor, textBackgroundRadius } : {}),
      flipX,
      flipY,
      layerType: "text",
      layerName: String(layer?.name || "").trim() || `Text ${index + 1}`,
      layerLocked: false,
      layerHidden: false,
    }, layer, { value: false, reason: "" });
  }

  if (layer?.kind === "shape") {
    const resolvedAnchor = resolveRotatedTopLeftAnchor(left, top, width, height, angle);
    return annotateImportMetadata({
      type: "rect",
      version: "7.0.0",
      originX: "left",
      originY: "top",
      left: resolvedAnchor.left,
      top: resolvedAnchor.top,
      width,
      height,
      scaleX: 1,
      scaleY: 1,
      angle,
      opacity,
      fill: String(layer?.fill || "#000000"),
      strokeWidth: 0,
      flipX,
      flipY,
      layerType: "shape",
      layerName: String(layer?.name || "").trim() || `Shape ${index + 1}`,
      layerLocked: false,
      layerHidden: false,
    }, layer);
  }

  const embeddedImageDataUrl = String(layer?.imageDataUrl || "");
  const rawImageSrc = String(layer?.imageSrc || "");
  const safeEmbeddedImageDataUrl = embeddedImageDataUrl.startsWith("data:image/")
    ? embeddedImageDataUrl
    : "";
  let imageSrc = "";
  if (safeEmbeddedImageDataUrl) {
    imageSrc = safeEmbeddedImageDataUrl;
  } else if (rawImageSrc.startsWith("data:image/")) {
    imageSrc = rawImageSrc;
  } else if (/^https?:\/\//i.test(rawImageSrc)) {
    imageSrc = rawImageSrc;
  } else if (/^file:\/\//i.test(rawImageSrc)) {
    imageSrc = rawImageSrc;
  }
  if (!imageSrc || /^blob:/i.test(imageSrc)) return null;
  let intrinsicWidth = Math.max(0, numberOr(layer?.sourceWidth, 0));
  let intrinsicHeight = Math.max(0, numberOr(layer?.sourceHeight, 0));
  if (isAxisAlignedImage && imageSrc.startsWith("data:image/")) {
    try {
      const sourceMimeType = parseMimeTypeFromDataUrl(imageSrc);
      const shouldForceRasterizeThinSvg =
        sourceMimeType === "image/svg+xml" && (width <= 16 || height <= 16);
      const trimmedImage = await trimTransparentPaddingFromDataUrl(imageSrc, {
        forceRasterize: shouldForceRasterizeThinSvg,
      });
      if (trimmedImage?.trimmed) {
        const sourceScaleX =
          width / Math.max(1, Math.round(intrinsicWidth || trimmedImage.originalWidth || width));
        const sourceScaleY =
          height / Math.max(1, Math.round(intrinsicHeight || trimmedImage.originalHeight || height));
        left += trimmedImage.offsetX * sourceScaleX;
        top += trimmedImage.offsetY * sourceScaleY;
        width = Math.max(1, Math.round(trimmedImage.width * sourceScaleX));
        height = Math.max(1, Math.round(trimmedImage.height * sourceScaleY));
        intrinsicWidth = Math.max(1, Math.round(trimmedImage.width));
        intrinsicHeight = Math.max(1, Math.round(trimmedImage.height));
        imageSrc = trimmedImage.dataUrl;
      }
    } catch (_error) {
      // Keep import resilient when transparent-bound trimming fails.
    }
  }
  const objectWidth = Math.max(1, Math.round(intrinsicWidth || width));
  const objectHeight = Math.max(1, Math.round(intrinsicHeight || height));
  const objectScaleX = width / Math.max(1, objectWidth);
  const objectScaleY = height / Math.max(1, objectHeight);
  const resolvedAnchor = resolveRotatedTopLeftAnchor(left, top, width, height, angle);

  const imageObject = {
    type: "image",
    version: "7.0.0",
    originX: "left",
    originY: "top",
    left: resolvedAnchor.left,
    top: resolvedAnchor.top,
    width: objectWidth,
    height: objectHeight,
    scaleX: objectScaleX,
    scaleY: objectScaleY,
    angle,
    opacity,
    src: imageSrc,
    flipX,
    flipY,
    layerType: "image",
    layerName: String(layer?.name || "").trim() || `Image ${index + 1}`,
    layerLocked: false,
    layerHidden: false,
    sourceWidth: objectWidth,
    sourceHeight: objectHeight,
  };

  if (/^https?:\/\//i.test(imageSrc)) {
    imageObject.crossOrigin = "anonymous";
  }

  return annotateImportMetadata(imageObject, layer);
}

async function buildFabricObjects(layers) {
  const result = [];
  for (let index = 0; index < layers.length; index += 1) {
    const object = await layerToFabricObject(layers[index], result.length);
    if (object) result.push(object);
  }
  return result;
}

async function buildHybridFabricObjects(
  layers,
  screenshotBitmap,
  devicePixelRatio,
  sourceWidth,
  sourceHeight,
  options = {}
) {
  const result = [];
  const unsupportedTextFamilies = new Set(
    (Array.isArray(options?.unsupportedTextFamilies) ? options.unsupportedTextFamilies : [])
      .map((family) => normalizeFontFamilyName(family).toLowerCase())
      .filter(Boolean)
  );
  const dpr = Math.max(0.1, Number(devicePixelRatio || 1));
  const canvasWidth = Math.max(
    1,
    Math.round(
      numberOr(
        sourceWidth,
        Math.max(
          ...layers.map((layer) => numberOr(layer?.x, 0) + numberOr(layer?.width, 0)),
          1080
        )
      )
    )
  );
  const canvasHeight = Math.max(
    1,
    Math.round(
      numberOr(
        sourceHeight,
        Math.max(
          ...layers.map((layer) => numberOr(layer?.y, 0) + numberOr(layer?.height, 0)),
          1080
        )
      )
    )
  );
  const canvasArea = Math.max(1, canvasWidth * canvasHeight);
  const resolvableImageLayerCount = layers.filter((layer) => {
    if (String(layer?.kind || "").toLowerCase() !== "image") return false;
    const src = String(layer?.imageSrc || "");
    const data = String(layer?.imageDataUrl || "");
    return (
      data.startsWith("data:image/") ||
      /^https?:\/\//i.test(src) ||
      /^file:\/\//i.test(src)
    );
  }).length;
  const looksLikeDecorativeFrameLayer = (layer) => {
    const metadata = [
      layer?.name,
      layer?.titleEn,
      Array.isArray(layer?.labelsEn) ? layer.labelsEn.join(" ") : "",
      Array.isArray(layer?.tagsEn) ? layer.tagsEn.join(" ") : "",
      layer?.sourceAssetId,
    ]
      .map((value) => sanitizeMetadataText(value).toLowerCase())
      .filter(Boolean)
      .join(" ");
    return /\b(frame|border)\b/.test(metadata);
  };
  const hasUsableDirectImageSource = (layer) => {
    const data = String(layer?.imageDataUrl || "").trim();
    if (data.startsWith("data:image/")) return true;
    const src = String(layer?.imageSrc || "").trim();
    return /^https?:\/\//i.test(src) || /^file:\/\//i.test(src) || src.startsWith("data:image/");
  };

  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    const layerKind = String(layer?.kind || "").toLowerCase();
    const shouldForceSnapshotForLayer =
      layerKind === "image" && Boolean(layer?.preferSnapshot);
    const layerFontFamily = normalizeFontFamilyName(layer?.fontFamily).toLowerCase();
    const shouldRasterizeUnsupportedText =
      layerKind === "text" &&
      Boolean(layerFontFamily) &&
      unsupportedTextFamilies.has(layerFontFamily);
    if (shouldRasterizeUnsupportedText) {
      const viewportRect = layer?.viewportRect;
      if (viewportRect) {
        try {
          const layerWidth = Math.max(1, Math.round(numberOr(layer?.width, 1)));
          const layerHeight = Math.max(1, Math.round(numberOr(layer?.height, 1)));
          const cropped = await cropBitmapToDataUrl(
            screenshotBitmap,
            viewportRect,
            {
              dpr,
              targetWidth: layerWidth,
              targetHeight: layerHeight,
              type: "image/png",
            }
          );
          if (String(cropped?.dataUrl || "").startsWith("data:image/")) {
            const snapshotLayer = {
              ...layer,
              kind: "image",
              imageSrc: cropped.dataUrl,
              imageDataUrl: cropped.dataUrl,
              angle: 0,
              flipX: false,
              flipY: false,
              sourceWidth: layerWidth,
              sourceHeight: layerHeight,
              fallback: true,
              fallbackReason: "unsupported-font-rasterized",
            };
            const snapshotObject = await layerToFabricObject(snapshotLayer, result.length);
            if (snapshotObject) {
              result.push(snapshotObject);
              continue;
            }
          }
        } catch (_error) {
          // Fall back to editable text object when rasterization fails.
        }
      }
    }

    if (!shouldForceSnapshotForLayer) {
      const directObject = await layerToFabricObject(layer, result.length);
      if (directObject) {
        result.push(directObject);
        continue;
      }
    }
    if (layerKind !== "image") {
      continue;
    }

    const layerWidth = Math.max(1, Math.round(numberOr(layer?.width, 1)));
    const layerHeight = Math.max(1, Math.round(numberOr(layer?.height, 1)));
    const layerArea = layerWidth * layerHeight;
    if (
      resolvableImageLayerCount > 0 &&
      layerArea > canvasArea * 0.8 &&
      !looksLikeDecorativeFrameLayer(layer)
    ) {
      continue;
    }
    const isolatedSnapshotDataUrl = String(layer?.isolatedImageDataUrl || "");
    if (isolatedSnapshotDataUrl.startsWith("data:image/")) {
      const snapshotLayer = {
        ...layer,
        imageSrc: isolatedSnapshotDataUrl,
        imageDataUrl: isolatedSnapshotDataUrl,
        angle: 0,
        flipX: false,
        flipY: false,
        sourceWidth: layerWidth,
        sourceHeight: layerHeight,
        fallback: true,
        fallbackReason: String(layer?.fallbackReason || "isolated-snapshot"),
      };
      const snapshotObject = await layerToFabricObject(snapshotLayer, result.length);
      if (snapshotObject) {
        result.push(snapshotObject);
        continue;
      }
    }
    if (shouldForceSnapshotForLayer && hasUsableDirectImageSource(layer)) {
      const directFallbackObject = await layerToFabricObject(
        {
          ...layer,
          preferSnapshot: false,
          fallback: true,
          fallbackReason: String(layer?.fallbackReason || "direct-source-fallback"),
        },
        result.length
      );
      if (directFallbackObject) {
        result.push(directFallbackObject);
        continue;
      }
    }
    const viewportRect = layer?.viewportRect;
    if (!viewportRect) {
      continue;
    }
    try {
      const cropped = await cropBitmapToDataUrl(
        screenshotBitmap,
        viewportRect,
        {
          dpr,
          targetWidth: layerWidth,
          targetHeight: layerHeight,
          type: "image/png",
        }
      );
      if (!String(cropped?.dataUrl || "").startsWith("data:image/")) {
        continue;
      }
      const snapshotLayer = {
        ...layer,
        imageSrc: cropped.dataUrl,
        imageDataUrl: cropped.dataUrl,
        angle: 0,
        flipX: false,
        flipY: false,
        sourceWidth: layerWidth,
        sourceHeight: layerHeight,
        fallback: true,
        fallbackReason: String(layer?.fallbackReason || "snapshot-crop"),
      };
      const snapshotObject = await layerToFabricObject(snapshotLayer, result.length);
      if (snapshotObject) {
        result.push(snapshotObject);
      }
    } catch (_error) {
      // Keep import resilient when one fallback crop fails.
    }
  }

  return result;
}

function compactRequestBody(body, fallbackImageDataUrl, fallbackWidth, fallbackHeight) {
  let nextBody = { ...body };
  if (estimateJsonLength(nextBody) <= MAX_TRANSPORT_JSON_LENGTH) {
    return nextBody;
  }

  if (
    Array.isArray(nextBody?.editorData?.customFonts) &&
    nextBody.editorData.customFonts.length > 0
  ) {
    nextBody = {
      ...nextBody,
      editorData: {
        ...nextBody.editorData,
        customFonts: [],
        warnings: Array.from(
          new Set(
            [
              ...(Array.isArray(nextBody.editorData?.warnings) ? nextBody.editorData.warnings : []),
              "Custom fonts omitted because payload exceeded transport limit.",
            ].filter(Boolean)
          )
        ),
      },
    };
  }

  if (estimateJsonLength(nextBody) <= MAX_TRANSPORT_JSON_LENGTH) {
    return nextBody;
  }

  const objects = Array.isArray(nextBody?.fabricData?.objects) ? nextBody.fabricData.objects : [];
  const canvasWidth = Math.max(1, Math.round(numberOr(nextBody?.canvasWidth, fallbackWidth || 1)));
  const canvasHeight = Math.max(1, Math.round(numberOr(nextBody?.canvasHeight, fallbackHeight || 1)));
  const pageArea = Math.max(1, canvasWidth * canvasHeight);
  const isEssentialOversizedInlineImageObject = (object) => {
    const src = String(object?.src || "");
    if (!src.startsWith("data:image/")) return false;
    if (src.length <= MAX_INLINE_IMAGE_DATA_URL_LENGTH) return false;
    const scaleX = Math.max(0.0001, Math.abs(numberOr(object?.scaleX, 1)));
    const scaleY = Math.max(0.0001, Math.abs(numberOr(object?.scaleY, 1)));
    const width = Math.max(1, numberOr(object?.width, 1) * scaleX);
    const height = Math.max(1, numberOr(object?.height, 1) * scaleY);
    const coverage = (width * height) / pageArea;
    const layerName = String(object?.layerName || object?.titleEn || "").toLowerCase();
    const labels = Array.isArray(object?.labelsEn) ? object.labelsEn.join(" ").toLowerCase() : "";
    const looksLikeFrame =
      /\b(frame|border)\b/.test(layerName) ||
      /\b(frame|border)\b/.test(labels);
    return coverage >= 0.78 || looksLikeFrame;
  };
  if (objects.length > 0) {
    const compactObjects = objects.filter((object) => {
      const src = String(object?.src || "");
      if (!src.startsWith("data:image/")) return true;
      return src.length <= MAX_INLINE_IMAGE_DATA_URL_LENGTH || isEssentialOversizedInlineImageObject(object);
    });
    if (compactObjects.length > 0) {
      nextBody = {
        ...nextBody,
        fabricData: {
          ...nextBody.fabricData,
          objects: compactObjects,
        },
        extractedLayerCount: compactObjects.length,
      };
    }
  }

  if (estimateJsonLength(nextBody) <= MAX_TRANSPORT_JSON_LENGTH) {
    return nextBody;
  }

  if (Array.isArray(nextBody?.editorData?.layerTree) && nextBody.editorData.layerTree.length > 0) {
    nextBody = {
      ...nextBody,
      editorData: {
        ...nextBody.editorData,
        layerTree: [],
        warnings: Array.from(
          new Set(
            [
              ...(Array.isArray(nextBody.editorData?.warnings) ? nextBody.editorData.warnings : []),
              "Layer tree omitted because payload exceeded transport limit.",
            ].filter(Boolean)
          )
        ),
      },
    };
  }

  if (estimateJsonLength(nextBody) <= MAX_TRANSPORT_JSON_LENGTH) {
    return nextBody;
  }

  if (String(fallbackImageDataUrl || "").startsWith("data:image/")) {
    return {
      ...nextBody,
      imageDataUrl: fallbackImageDataUrl,
      fabricData: {
        version: "7.0.0",
        objects: [buildSingleImageFabricObject(fallbackImageDataUrl, fallbackWidth, fallbackHeight)],
      },
      extractedLayerCount: 1,
      editorData: {
        importVersion: 2,
        source: "canva-extension",
        page: {
          id: "canva-page-1",
          name: "Canva Page 1",
          width: fallbackWidth,
          height: fallbackHeight,
          sourceWidth: fallbackWidth,
          sourceHeight: fallbackHeight,
        },
        layerTree: [
          {
            id: "canva-snapshot-1",
            parentId: null,
            zIndex: 0,
            name: "Imported Canva Snapshot",
            kind: "image",
            bounds: { x: 0, y: 0, width: fallbackWidth, height: fallbackHeight },
            transform: { rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
            fallback: true,
            fallbackReason: "payload-limit-full-snapshot",
          },
        ],
        layerStats: {
          detected: 1,
          editable: 0,
          rasterized: 1,
          skipped: 0,
        },
        usedFonts: Array.isArray(nextBody?.editorData?.usedFonts) ? nextBody.editorData.usedFonts : [],
        warnings: ["Payload exceeded transport limit. Imported as full snapshot."],
      },
    };
  }

  return nextBody;
}

function buildLayerTreeFromExtractedLayers(layers = []) {
  const safeLayers = Array.isArray(layers) ? layers : [];
  return safeLayers.map((layer, index) => ({
    id: String(layer?.id || `layer-${index + 1}`),
    parentId: String(layer?.parentId || "").trim() || null,
    zIndex: Number.isFinite(Number(layer?.zIndex)) ? Number(layer.zIndex) : index,
    name:
      String(layer?.name || "").trim() ||
      (String(layer?.kind || "layer").toLowerCase() === "text"
        ? `Text ${index + 1}`
        : String(layer?.kind || "layer").toLowerCase() === "shape"
          ? `Shape ${index + 1}`
          : `Image ${index + 1}`),
    kind: String(layer?.kind || "unknown").toLowerCase(),
    bounds: {
      x: numberOr(layer?.x, 0),
      y: numberOr(layer?.y, 0),
      width: Math.max(1, numberOr(layer?.width, 1)),
      height: Math.max(1, numberOr(layer?.height, 1)),
    },
    transform: {
      rotation: numberOr(layer?.angle, 0),
      scaleX: 1,
      scaleY: 1,
      opacity: Math.max(0, Math.min(1, numberOr(layer?.opacity, 1))),
    },
    fallback: Boolean(layer?.fallback),
    fallbackReason: String(layer?.fallbackReason || ""),
  }));
}

function buildLayerTreeFromFabricObjects(objects = []) {
  const safeObjects = Array.isArray(objects) ? objects : [];
  return safeObjects.map((object, index) => {
    const scaleX = Math.max(0.0001, numberOr(object?.scaleX, 1));
    const scaleY = Math.max(0.0001, numberOr(object?.scaleY, 1));
    const width = Math.max(1, numberOr(object?.width, 1) * scaleX);
    const height = Math.max(1, numberOr(object?.height, 1) * scaleY);
    const originX = String(object?.originX || "left").toLowerCase();
    const originY = String(object?.originY || "top").toLowerCase();
    let left = numberOr(object?.left, 0);
    let top = numberOr(object?.top, 0);
    if (originX === "center") left -= width / 2;
    if (originX === "right") left -= width;
    if (originY === "center") top -= height / 2;
    if (originY === "bottom") top -= height;
    return {
      id: String(object?.importNodeId || `layer-${index + 1}`),
      parentId: String(object?.importParentId || "").trim() || null,
      zIndex: index,
      name: String(object?.layerName || `Layer ${index + 1}`),
      kind: String(object?.importKind || object?.layerType || object?.type || "unknown").toLowerCase(),
      bounds: {
        x: left,
        y: top,
        width,
        height,
      },
      transform: {
        rotation: numberOr(object?.angle, 0),
        scaleX,
        scaleY,
        opacity: Math.max(0, Math.min(1, numberOr(object?.opacity, 1))),
      },
      fallback: Boolean(object?.fallback),
      fallbackReason: String(object?.fallbackReason || ""),
    };
  });
}

function deriveLayerStats(detectedCount, objects = []) {
  const safeObjects = Array.isArray(objects) ? objects : [];
  let editable = 0;
  let rasterized = 0;
  safeObjects.forEach((object) => {
    if (Boolean(object?.fallback) || String(object?.fallbackReason || "").trim()) {
      rasterized += 1;
      return;
    }
    editable += 1;
  });
  return {
    detected: Math.max(0, Number(detectedCount) || safeObjects.length),
    editable,
    rasterized,
    skipped: Math.max(0, (Number(detectedCount) || safeObjects.length) - editable - rasterized),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function sanitizeMetadataText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueMetadataStrings(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => sanitizeMetadataText(value))
        .filter(Boolean)
    )
  );
}

function normalizeMetadataKey(value) {
  return sanitizeMetadataText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeMetadataLabel(value) {
  return uniqueMetadataStrings(
    normalizeMetadataKey(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function isVisibleDomElement(node) {
  if (!node || typeof node.getBoundingClientRect !== "function") return false;
  const rect = node.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = window.getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.01;
}

function isKeywordChipButton(node) {
  if (!node || typeof node.getAttribute !== "function") return false;
  const ariaLabel = String(node.getAttribute("aria-label") || "").toLowerCase();
  return (
    ariaLabel.includes("الكلمة الرئيسية") ||
    ariaLabel.includes("keyword") ||
    ariaLabel.includes("search for keyword")
  );
}

function isKeywordExpandToggle(node) {
  if (!node) return false;
  const text = sanitizeMetadataText(
    node.textContent || node.getAttribute?.("aria-label") || node.getAttribute?.("title") || ""
  ).toLowerCase();
  if (!text) return false;
  const mentionsKeywords =
    text.includes("keyword") ||
    text.includes("keywords") ||
    text.includes("كلمات رئيسية") ||
    text.includes("الكلمات الرئيسية");
  const wantsMore =
    text.includes(" more") ||
    text.startsWith("more") ||
    text.includes("show all") ||
    text.includes("all keywords") ||
    text.includes("عرض كل") ||
    text.includes("كل الكلمات") ||
    text.includes("المزيد") ||
    text.includes("أكثر");
  const wantsLess =
    text.includes(" less") ||
    text.includes("fewer") ||
    text.includes("show fewer") ||
    text.includes("show less") ||
    text.includes("عرض أقل") ||
    text.includes("أقل");
  return mentionsKeywords && wantsMore && !wantsLess;
}

async function expandVisibleCanvaKeywordList() {
  const toggle = Array.from(document.querySelectorAll("button,[role='button']")).find(
    (candidate) => isVisibleDomElement(candidate) && isKeywordExpandToggle(candidate)
  );
  if (!toggle) return false;
  toggle.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    })
  );
  await sleep(180);
  return true;
}

function findMetadataContainerForChip(node) {
  let current = node?.parentElement || null;
  let best = null;
  let bestCount = 0;
  while (current && current !== document.body) {
    if (!isVisibleDomElement(current)) {
      current = current.parentElement;
      continue;
    }
    const visibleKeywordButtons = Array.from(current.querySelectorAll("button,[role='button']"))
      .filter((candidate) => isVisibleDomElement(candidate) && isKeywordChipButton(candidate));
    const hasHeading = Boolean(
      Array.from(current.querySelectorAll("h1,h2,h3,h4")).find(
        (heading) => isVisibleDomElement(heading) && sanitizeMetadataText(heading.textContent).length >= 3
      )
    );
    if (visibleKeywordButtons.length >= 2 && hasHeading) {
      if (visibleKeywordButtons.length >= bestCount) {
        best = current;
        bestCount = visibleKeywordButtons.length;
      }
    }
    current = current.parentElement;
  }
  return best;
}

function scrapeVisibleCanvaAssetMetadata() {
  const keywordButtons = Array.from(document.querySelectorAll("button,[role='button']"))
    .filter((candidate) => isVisibleDomElement(candidate) && isKeywordChipButton(candidate));
  if (keywordButtons.length === 0) return null;

  const containers = new Map();
  keywordButtons.forEach((button) => {
    const container = findMetadataContainerForChip(button);
    if (!container) return;
    const key = container;
    const existing = containers.get(key) || [];
    existing.push(button);
    containers.set(key, existing);
  });

  const sortedContainers = Array.from(containers.entries())
    .map(([container, buttons]) => ({ container, buttons }))
    .sort((left, right) => right.buttons.length - left.buttons.length);
  const selected = sortedContainers[0] || null;
  if (!selected) return null;

  const titleNode = Array.from(selected.container.querySelectorAll("h1,h2,h3,h4"))
    .find((heading) => isVisibleDomElement(heading) && sanitizeMetadataText(heading.textContent).length >= 3);
  const titleEn = sanitizeMetadataText(titleNode?.textContent || "");
  const tagsEn = uniqueMetadataStrings(
    selected.buttons
      .map((button) => sanitizeMetadataText(button.textContent || ""))
      .filter((value) => value.length >= 2)
  );

  if (!titleEn && tagsEn.length === 0) return null;

  return {
    titleEn,
    tagsEn,
    labelsEn: uniqueMetadataStrings([titleEn, ...tagsEn, ...tokenizeMetadataLabel(titleEn)]),
  };
}

function dispatchSyntheticLayerClick(node) {
  if (!node || typeof node.dispatchEvent !== "function") return;
  const rect = node.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const pointTarget = document.elementFromPoint?.(clientX, clientY);
  const target =
    (pointTarget && node.contains(pointTarget) ? pointTarget : null) ||
    node.querySelector?.("img,image,canvas") ||
    node;
  ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
      })
    );
  });
}

function dispatchSyntheticContextMenu(node) {
  if (!node || typeof node.dispatchEvent !== "function") return;
  const rect = node.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const pointTarget = document.elementFromPoint?.(clientX, clientY);
  const target =
    (pointTarget && node.contains(pointTarget) ? pointTarget : null) ||
    node.querySelector?.("img,image,canvas") ||
    node;
  ["pointerdown", "mousedown", "contextmenu", "mouseup"].forEach((type) => {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
        button: 2,
        buttons: type === "mouseup" ? 0 : 2,
      })
    );
  });
}

function findVisibleEditorActionButtonNearNode(node) {
  if (!node || typeof node.getBoundingClientRect !== "function") return null;
  const rect = node.getBoundingClientRect();
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  Array.from(document.querySelectorAll("button,[role='button']")).forEach((candidate) => {
    if (!isVisibleDomElement(candidate)) return;
    if (candidate === node || node.contains(candidate) || candidate.contains(node)) return;
    const candidateRect = candidate.getBoundingClientRect?.();
    if (!candidateRect || candidateRect.width <= 0 || candidateRect.height <= 0) return;
    if (candidateRect.width < 18 || candidateRect.width > 80) return;
    if (candidateRect.height < 18 || candidateRect.height > 80) return;
    const verticalDistance =
      candidateRect.bottom < rect.top
        ? rect.top - candidateRect.bottom
        : candidateRect.top > rect.bottom
          ? candidateRect.top - rect.bottom
          : 0;
    const horizontalDistance =
      candidateRect.right < rect.left
        ? rect.left - candidateRect.right
        : candidateRect.left > rect.right
          ? candidateRect.left - rect.right
          : 0;
    if (verticalDistance > 180 || horizontalDistance > 180) return;
    const iconLike =
      sanitizeMetadataText(candidate.textContent || "").length <= 2 ||
      Boolean(candidate.querySelector?.("svg"));
    if (!iconLike) return;
    const score = verticalDistance * 4 + horizontalDistance;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  return best;
}

async function openVisibleCanvaMetadataForNode(node) {
  if (!node) return false;
  if (scrapeVisibleCanvaAssetMetadata()) return true;
  dispatchSyntheticContextMenu(node);
  await sleep(220);
  await expandVisibleCanvaKeywordList();
  if (scrapeVisibleCanvaAssetMetadata()) return true;
  const actionButton = findVisibleEditorActionButtonNearNode(node);
  if (actionButton) {
    if (typeof actionButton.click === "function") {
      actionButton.click();
    }
    actionButton.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
      })
    );
    await sleep(320);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expandVisibleCanvaKeywordList();
      if (scrapeVisibleCanvaAssetMetadata()) return true;
      await sleep(200);
    }
  }
  return false;
}

function isBackgroundLikeMetadataCandidate(candidate, pageWidth, pageHeight) {
  if (!candidate) return true;
  if (candidate.isBackgroundNode || candidate.isFullPageBackground) return true;
  const width = Math.max(1, Number(candidate.width || 0));
  const height = Math.max(1, Number(candidate.height || 0));
  const pageArea = Math.max(1, Number(pageWidth || 0) * Number(pageHeight || 0));
  const areaRatio = (width * height) / pageArea;
  return areaRatio >= 0.8 || (width >= pageWidth * 0.9 && height >= pageHeight * 0.9);
}

function metadataMatchesCandidate(metadata, candidate) {
  if (!metadata || !candidate) return false;
  const metadataTitle = normalizeMetadataKey(metadata.titleEn);
  const candidateName = normalizeMetadataKey(candidate.name);
  if (!metadataTitle || !candidateName) return false;
  if (metadataTitle === candidateName) return true;
  if (metadataTitle.includes(candidateName) || candidateName.includes(metadataTitle)) return true;
  const metadataTokens = new Set(tokenizeMetadataLabel(metadataTitle));
  const candidateTokens = tokenizeMetadataLabel(candidateName);
  if (metadataTokens.size === 0 || candidateTokens.length === 0) return false;
  const shared = candidateTokens.filter((token) => metadataTokens.has(token)).length;
  return shared >= Math.max(1, Math.min(metadataTokens.size, candidateTokens.length) - 1);
}

async function collectCanvaLayerMetadata(candidates, pageWidth, pageHeight) {
  const byId = new Map();
  const pending = (Array.isArray(candidates) ? candidates : []).filter(
    (candidate) =>
      candidate &&
      candidate.kind === "image" &&
      candidate.node &&
      !isBackgroundLikeMetadataCandidate(candidate, pageWidth, pageHeight)
  );
  if (pending.length === 0) return byId;

  await expandVisibleCanvaKeywordList();
  const visibleMetadata = scrapeVisibleCanvaAssetMetadata();
  if (visibleMetadata) {
    const matchedCandidate = pending.find((candidate) => metadataMatchesCandidate(visibleMetadata, candidate));
    if (matchedCandidate) {
      byId.set(matchedCandidate.id, visibleMetadata);
    }
  }

  const maxMetadataScrapes = Math.min(18, pending.length);
  for (let index = 0; index < maxMetadataScrapes; index += 1) {
    const candidate = pending[index];
    if (byId.has(candidate.id)) continue;
    dispatchSyntheticLayerClick(candidate.node);
    await sleep(180);
    await openVisibleCanvaMetadataForNode(candidate.node);
    await expandVisibleCanvaKeywordList();
    let scraped = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      scraped = scrapeVisibleCanvaAssetMetadata();
      if (scraped && (scraped.tagsEn.length > 0 || scraped.titleEn)) break;
      await sleep(120);
    }
    if (!scraped) continue;
    if (!metadataMatchesCandidate(scraped, candidate) && scraped.tagsEn.length === 0) continue;
    byId.set(candidate.id, scraped);
  }

  return byId;
}

async function waitForTabReady(tabId, timeoutMs = 6000) {
  const deadline = Date.now() + Math.max(800, Number(timeoutMs) || 6000);
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const status = String(tab?.status || "");
      const url = String(tab?.url || "");
      if (status === "complete" && /^https?:\/\//i.test(url)) {
        return true;
      }
    } catch (_error) {
      return false;
    }
    await sleep(160);
  }
  return false;
}

async function getBasicCaptureMetaFromTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const isVisible = (element, rect) => {
        if (!element || !rect) return false;
        if (rect.width < 40 || rect.height < 40) return false;
        const style = window.getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) > 0.01
        );
      };

      const parseStyleDimension = (styleText, key) => {
        const match = String(styleText || "").match(
          new RegExp(`${key}\\s*:\\s*([0-9.]+)px`, "i")
        );
        const numeric = Number(match?.[1]);
        return Number.isFinite(numeric) ? numeric : 0;
      };

      const pickLargestVisibleNode = (nodes) => {
        let best = null;
        (Array.isArray(nodes) ? nodes : []).forEach((node) => {
          if (!node || typeof node.getBoundingClientRect !== "function") return;
          const rect = node.getBoundingClientRect();
          if (!isVisible(node, rect)) return;
          const area = rect.width * rect.height;
          if (!best || area > best.area) {
            best = { node, rect, area };
          }
        });
        return best;
      };

      const pageCandidate = pickLargestVisibleNode(
        Array.from(document.querySelectorAll("[data-page-id]"))
      );
      const canvasCandidate = pickLargestVisibleNode(
        Array.from(document.querySelectorAll("canvas"))
      );
      const selected = pageCandidate || canvasCandidate;

      let rect = selected
        ? {
            x: selected.rect.left,
            y: selected.rect.top,
            width: selected.rect.width,
            height: selected.rect.height,
          }
        : null;

      if (!rect) {
        const fallbackWidth = Math.max(120, Math.round(window.innerWidth * 0.75));
        const fallbackHeight = Math.max(120, Math.round(window.innerHeight * 0.75));
        rect = {
          x: Math.max(0, Math.round((window.innerWidth - fallbackWidth) / 2)),
          y: Math.max(0, Math.round((window.innerHeight - fallbackHeight) / 2)),
          width: fallbackWidth,
          height: fallbackHeight,
        };
      }

      let designWidth = Math.max(1, Math.round(rect.width));
      let designHeight = Math.max(1, Math.round(rect.height));
      if (selected?.node?.tagName?.toLowerCase() === "canvas") {
        designWidth = Math.max(1, Number(selected.node.width) || designWidth);
        designHeight = Math.max(1, Number(selected.node.height) || designHeight);
      } else if (selected?.node) {
        const styleText = selected.node.getAttribute("style") || "";
        const styleWidth = parseStyleDimension(styleText, "width");
        const styleHeight = parseStyleDimension(styleText, "height");
        if (styleWidth > 0) designWidth = Math.round(styleWidth);
        if (styleHeight > 0) designHeight = Math.round(styleHeight);
      }

      return {
        ok: true,
        title: document.title || "",
        sourceUrl: location.href,
        rect: {
          x: Number(rect.x) || 0,
          y: Number(rect.y) || 0,
          width: Math.max(1, Number(rect.width) || 1),
          height: Math.max(1, Number(rect.height) || 1),
        },
        devicePixelRatio: window.devicePixelRatio || 1,
        designWidth: Math.max(1, Math.round(designWidth)),
        designHeight: Math.max(1, Math.round(designHeight)),
        directDataUrl: "",
        sourceType: selected ? "fallback-frame" : "fallback-viewport",
        layers: [],
      };
    },
  });

  const result = Array.isArray(results)
    ? results.find((entry) => entry && typeof entry.result === "object")?.result
    : null;
  return result && typeof result === "object" ? result : null;
}

async function getCaptureMetaFromTab(tabId, options = {}) {
  const shouldCollectLayerMetadata = Boolean(options?.captureMetadata);
  let results = null;
  let primaryError = "";
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [{ captureMetadata: shouldCollectLayerMetadata }],
      func: async (runtimeOptions = {}) => {
      const shouldCollectLayerMetadata = Boolean(runtimeOptions?.captureMetadata);
      const viewportCenter = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      };

      const isVisible = (element, rect) => {
        if (!element || !rect) return false;
        if (rect.width < 80 || rect.height < 80) return false;
        const style = window.getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) > 0.01
        );
      };

      const scoreRect = (rect) => {
        const area = rect.width * rect.height;
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(centerX - viewportCenter.x, centerY - viewportCenter.y);
        const normalizedDistance = distance / Math.max(window.innerWidth, window.innerHeight, 1);
        const centerBias = 1 - Math.min(normalizedDistance, 1) * 0.55;
        return area * centerBias;
      };

      const parsePx = (value) => {
        const match = String(value || "").match(/([0-9.]+)px/i);
        const numeric = Number(match?.[1]);
        return Number.isFinite(numeric) ? numeric : 0;
      };

      const parseStyleDimension = (styleText, key) => {
        const match = String(styleText || "").match(
          new RegExp(`${key}\\s*:\\s*([0-9.]+)px`, "i")
        );
        const numeric = Number(match?.[1]);
        return Number.isFinite(numeric) ? numeric : 0;
      };

      const sleep = (ms) =>
        new Promise((resolve) => {
          window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
        });

      const sanitizeMetadataText = (value) =>
        String(value || "").replace(/\s+/g, " ").trim();

      const uniqueMetadataStrings = (values) =>
        Array.from(
          new Set(
            (Array.isArray(values) ? values : [])
              .map((value) => sanitizeMetadataText(value))
              .filter(Boolean)
          )
        );

      const parseCssTimeToMs = (value) => {
        const firstToken = String(value || "")
          .split(",")
          .map((token) => token.trim())
          .find(Boolean);
        if (!firstToken) return 0;
        if (/ms$/i.test(firstToken)) {
          const numeric = Number.parseFloat(firstToken);
          return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
        }
        if (/s$/i.test(firstToken)) {
          const numeric = Number.parseFloat(firstToken);
          return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric * 1000)) : 0;
        }
        const numeric = Number.parseFloat(firstToken);
        return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
      };

      const normalizeAnimationLabel = (value) =>
        sanitizeMetadataText(String(value || "").replace(/[_-]+/g, " "));

      const mapAnimationHintToType = (rawValue) => {
        const value = normalizeAnimationLabel(rawValue).toLowerCase();
        if (!value) return null;
        const matchers = [
          { type: "NONE", label: "None", regex: /\b(none|no animation|instant|instant show|instant hide|hard cut|show hide)\b|بدون|بدون حركة/ },
          { type: "FADE", label: "Fade", regex: /\b(static|fade|fade in|fade out|dissolve|soft dissolve)\b|ثابت|تلاشي/ },
          { type: "RISE", label: "Rise", regex: /\b(rise)\b|ارتفاع/ },
          { type: "PAN", label: "Pan", regex: /\b(pan)\b|تأرجح|ترنح/ },
          { type: "POP", label: "Pop", regex: /\b(pop|zoom|zoom in|zoom out)\b|انبثاق/ },
          { type: "WIPE", label: "Wipe", regex: /\b(directional wipe|wipe)\b|المسح/ },
          { type: "BLUR", label: "Blur", regex: /\b(blur|soft blur)\b|تمويه/ },
          { type: "SUCCESSION", label: "Succession", regex: /\b(succession|zoom fade)\b|التتابع/ },
          { type: "BREATHE", label: "Breathe", regex: /\b(breathe|slow reveal)\b|ظهور بطيء/ },
          { type: "BASELINE", label: "Baseline", regex: /\b(baseline|bounce)\b|baseline|خط الأساس/ },
          { type: "DRIFT", label: "Drift", regex: /\b(drift|slide|slide in|slide out)\b|انجراف/ },
          { type: "TECTONIC", label: "Tectonic", regex: /\b(soft gradient wipe|wipe gradient|gradient wipe|tectonic)\b|حركة تكتونية/ },
          { type: "TUMBLE", label: "Tumble", regex: /\b(tumble|turn|radial sweep reveal|radial sweep|radial)\b|دوران/ },
          { type: "NEON", label: "Neon", regex: /\b(neon|soft circular reveal|circular fade)\b|نيون/ },
          { type: "SCRAPBOOK", label: "Scrapbook", regex: /\b(scrapbook)\b|سجل قصاصات/ },
          { type: "STOMP", label: "Stomp", regex: /\b(stomp|circular reveal|circular|aerial)\b|سقوط هوائي/ },
          { type: "ROTATE", label: "Rotate", regex: /\b(continuous rotation|rotation|spin|rotate)\b|تدوير/ },
          { type: "FLICKER", label: "Flicker", regex: /\bflicker\b|ومض/ },
          { type: "PULSE", label: "Pulse", regex: /\b(pulse|pulse zoom|squash and stretch|heart beat|heartbeat)\b|تقلص العنصر وتمدد|نبض/ },
          { type: "WIGGLE", label: "Wiggle", regex: /\b(wiggle|directional shake|shake)\b|اهتزاز سريع|اهتزاز سريع بالاتجاه/ },
        ];
        return matchers.find((entry) => entry.regex.test(value)) || null;
      };

      const inferAnimationDirection = (values) => {
        const text = uniqueMetadataStrings(values).join(" ").toLowerCase();
        if (!text) return "";
        if (/\b(left|leftward)\b|يسار/.test(text)) return "LEFT";
        if (/\b(right|rightward)\b|يمين/.test(text)) return "RIGHT";
        if (/\b(top|up|upward)\b|أعلى|فوق/.test(text)) return "UP";
        if (/\b(bottom|down|downward)\b|أسفل|تحت/.test(text)) return "DOWN";
        if (/\b(counterclockwise|anti clockwise|anticlockwise)\b/.test(text)) return "COUNTERCLOCKWISE";
        if (/\b(clockwise)\b/.test(text)) return "CLOCKWISE";
        return "";
      };

      const inferAnimationMode = (values, isInfinite) => {
        if (isInfinite) return "LOOP";
        const text = uniqueMetadataStrings(values).join(" ").toLowerCase();
        if (/\b(out|exit|leave|disappear|hide|closing|close)\b/.test(text)) return "OUT";
        return "IN";
      };

      const collectAnimationHintStrings = (node, supplementalNodes = []) => {
        const results = [];
        const push = (value) => {
          const normalized = normalizeAnimationLabel(value);
          if (!normalized || normalized.length > 400) return;
          results.push(normalized);
        };
        const addNodeSignals = (candidate) => {
          if (!candidate) return;
          push(candidate.getAttribute?.("aria-label"));
          push(candidate.getAttribute?.("title"));
          push(candidate.getAttribute?.("data-element-name"));
          push(candidate.className);
          push(candidate.getAttribute?.("style"));
          if (candidate.attributes) {
            Array.from(candidate.attributes).forEach((attribute) => {
              const name = String(attribute?.name || "");
              if (!/(anim|motion|transition|enter|exit)/i.test(name)) return;
              push(`${name}:${attribute?.value || ""}`);
            });
          }
          if (candidate.dataset) {
            Object.entries(candidate.dataset).forEach(([key, value]) => {
              if (!/(anim|motion|transition|enter|exit)/i.test(key)) return;
              push(`${key}:${value || ""}`);
            });
          }
          try {
            const style = window.getComputedStyle(candidate);
            push(style.animationName);
            push(style.animationTimingFunction);
            push(style.transitionProperty);
          } catch (_error) {
            // Ignore style inspection failures on detached nodes.
          }
        };

        addNodeSignals(node);
        (Array.isArray(supplementalNodes) ? supplementalNodes : []).forEach((candidate) =>
          addNodeSignals(candidate)
        );
        let ancestor = node?.parentElement || null;
        let depth = 0;
        while (ancestor && depth < 2) {
          addNodeSignals(ancestor);
          ancestor = ancestor.parentElement;
          depth += 1;
        }
        return uniqueMetadataStrings(results);
      };

      const extractLayerAnimationMeta = (node, supplementalNodes = []) => {
        const inspectionNodes = [node, ...(Array.isArray(supplementalNodes) ? supplementalNodes : [])].filter(Boolean);
        const hintStrings = collectAnimationHintStrings(node, inspectionNodes);
        let matched = null;
        for (let index = 0; index < hintStrings.length; index += 1) {
          matched = mapAnimationHintToType(hintStrings[index]);
          if (matched) break;
        }

        let computedDurationMs = 0;
        let computedDelayMs = 0;
        let computedInfinite = false;
        let computedRawName = "";
        for (let index = 0; index < inspectionNodes.length; index += 1) {
          const candidate = inspectionNodes[index];
          try {
            const style = window.getComputedStyle(candidate);
            const animationName = String(style.animationName || "")
              .split(",")
              .map((token) => normalizeAnimationLabel(token))
              .find((token) => token && token.toLowerCase() !== "none");
            if (!computedRawName && animationName) {
              computedRawName = animationName;
            }
            if (!computedDurationMs) {
              computedDurationMs = parseCssTimeToMs(style.animationDuration);
            }
            if (!computedDelayMs) {
              computedDelayMs = parseCssTimeToMs(style.animationDelay);
            }
            if (!computedInfinite) {
              const iterationCount = String(style.animationIterationCount || "")
                .split(",")
                .map((token) => token.trim().toLowerCase())
                .find(Boolean);
              computedInfinite =
                iterationCount === "infinite" ||
                (Number.isFinite(Number(iterationCount)) && Number(iterationCount) > 1);
            }
            if (!matched && animationName) {
              matched = mapAnimationHintToType(animationName);
            }
          } catch (_error) {
            // Ignore computed-style failures.
          }
        }

        if (!matched && !computedRawName) {
          return null;
        }

        const rawAnimationName = computedRawName || hintStrings.find(Boolean) || "";
        const animationDirection = inferAnimationDirection([rawAnimationName, ...hintStrings]);
        return {
          animationType: matched?.type || "",
          animationLabel: matched?.label || normalizeAnimationLabel(rawAnimationName),
          rawAnimationName: normalizeAnimationLabel(rawAnimationName),
          animationMode: inferAnimationMode([rawAnimationName, ...hintStrings], computedInfinite),
          animationInfinite: computedInfinite,
          animationDurationMs: computedDurationMs > 0 ? computedDurationMs : undefined,
          animationDelayMs: computedDelayMs > 0 ? computedDelayMs : undefined,
          animationDirection: animationDirection || undefined,
        };
      };

      const normalizeMetadataKey = (value) =>
        sanitizeMetadataText(value)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]+/gu, " ")
          .replace(/\s+/g, " ")
          .trim();

      const tokenizeMetadataLabel = (value) =>
        uniqueMetadataStrings(
          normalizeMetadataKey(value)
            .split(/\s+/)
            .filter((token) => token.length >= 2)
        );

      const getImageElementTitleHint = (element) => {
        if (!element) return "";
        return sanitizeMetadataText(
          element.getAttribute?.("alt") ||
            element.getAttribute?.("aria-label") ||
            element.getAttribute?.("title") ||
            ""
        );
      };

      const looksLikeDecorativeFrameLabel = (value) =>
        /\b(frame|border)\b/.test(
          sanitizeMetadataText(value)
            .toLowerCase()
        );

      const isVisibleDomElement = (element) => {
        if (!element || typeof element.getBoundingClientRect !== "function") return false;
        const rect = element.getBoundingClientRect();
        if (!rect || rect.width < 2 || rect.height < 2) return false;
        const style = window.getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) > 0.01
        );
      };

      const isKeywordChipButton = (element) => {
        if (!element) return false;
        const text = sanitizeMetadataText(element.textContent || "");
        if (!text || text.length < 2 || text.length > 40) return false;
        const aria = sanitizeMetadataText(
          element.getAttribute?.("aria-label") ||
            element.getAttribute?.("title") ||
            ""
        ).toLowerCase();
        const className = sanitizeMetadataText(element.className || "").toLowerCase();
        return (
          aria.includes("الكلمة الرئيسية") ||
          aria.includes("keyword") ||
          className.includes("chip") ||
          className.includes("tag")
        );
      };

      const isKeywordExpandToggle = (element) => {
        if (!element) return false;
        const text = sanitizeMetadataText(
          element.textContent || element.getAttribute?.("aria-label") || element.getAttribute?.("title") || ""
        ).toLowerCase();
        if (!text) return false;
        const mentionsKeywords =
          text.includes("keyword") ||
          text.includes("keywords") ||
          text.includes("كلمات رئيسية") ||
          text.includes("الكلمات الرئيسية");
        const wantsMore =
          text.includes(" more") ||
          text.startsWith("more") ||
          text.includes("show all") ||
          text.includes("all keywords") ||
          text.includes("عرض كل") ||
          text.includes("كل الكلمات") ||
          text.includes("المزيد") ||
          text.includes("أكثر");
        const wantsLess =
          text.includes(" less") ||
          text.includes("fewer") ||
          text.includes("show fewer") ||
          text.includes("show less") ||
          text.includes("عرض أقل") ||
          text.includes("أقل");
        return mentionsKeywords && wantsMore && !wantsLess;
      };

      const expandVisibleCanvaKeywordList = async () => {
        const toggle = Array.from(document.querySelectorAll("button,[role='button']")).find(
          (candidate) => isVisibleDomElement(candidate) && isKeywordExpandToggle(candidate)
        );
        if (!toggle) return false;
        toggle.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
          })
        );
        await sleep(180);
        return true;
      };

      const findMetadataContainerForChip = (element) => {
        let current = element?.parentElement || null;
        let depth = 0;
        let best = null;
        let bestCount = 0;
        while (current && depth < 8) {
          const visibleKeywordButtons = Array.from(
            current.querySelectorAll("button,[role='button']")
          ).filter((candidate) => isVisibleDomElement(candidate) && isKeywordChipButton(candidate));
          const hasHeading = Array.from(current.querySelectorAll("h1,h2,h3,h4")).some(
            (heading) =>
              isVisibleDomElement(heading) &&
              sanitizeMetadataText(heading.textContent).length >= 3
          );
          if (visibleKeywordButtons.length >= 2 && hasHeading) {
            if (visibleKeywordButtons.length >= bestCount) {
              best = current;
              bestCount = visibleKeywordButtons.length;
            }
          }
          current = current.parentElement;
          depth += 1;
        }
        return best;
      };

      const scrapeVisibleCanvaAssetMetadata = () => {
        const keywordButtons = Array.from(document.querySelectorAll("button,[role='button']"))
          .filter((candidate) => isVisibleDomElement(candidate) && isKeywordChipButton(candidate));
        if (keywordButtons.length === 0) return null;

        const containers = new Map();
        keywordButtons.forEach((button) => {
          const container = findMetadataContainerForChip(button);
          if (!container) return;
          const existing = containers.get(container) || [];
          existing.push(button);
          containers.set(container, existing);
        });

        const selected =
          Array.from(containers.entries())
            .map(([container, buttons]) => ({ container, buttons }))
            .sort((left, right) => right.buttons.length - left.buttons.length)[0] || null;
        if (!selected) return null;

        const titleNode = Array.from(selected.container.querySelectorAll("h1,h2,h3,h4")).find(
          (heading) =>
            isVisibleDomElement(heading) &&
            sanitizeMetadataText(heading.textContent).length >= 3
        );
        const titleEn = sanitizeMetadataText(titleNode?.textContent || "");
        const tagsEn = uniqueMetadataStrings(
          selected.buttons
            .map((button) => sanitizeMetadataText(button.textContent || ""))
            .filter((value) => value.length >= 2)
        );

        if (!titleEn && tagsEn.length === 0) return null;

        return {
          titleEn,
          tagsEn,
          labelsEn: uniqueMetadataStrings([titleEn, ...tagsEn, ...tokenizeMetadataLabel(titleEn)]),
        };
      };

      const dispatchSyntheticLayerClick = (node) => {
        if (!node || typeof node.dispatchEvent !== "function") return;
        const rect = node.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        const pointTarget = document.elementFromPoint?.(clientX, clientY);
        const target =
          (pointTarget && node.contains(pointTarget) ? pointTarget : null) ||
          node.querySelector?.("img,image,canvas") ||
          node;
        ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
          target.dispatchEvent(
            new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
              clientX,
              clientY,
            })
          );
        });
      };

      const dispatchSyntheticContextMenu = (node) => {
        if (!node || typeof node.dispatchEvent !== "function") return;
        const rect = node.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        const pointTarget = document.elementFromPoint?.(clientX, clientY);
        const target =
          (pointTarget && node.contains(pointTarget) ? pointTarget : null) ||
          node.querySelector?.("img,image,canvas") ||
          node;
        ["pointerdown", "mousedown", "contextmenu", "mouseup"].forEach((type) => {
          target.dispatchEvent(
            new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
              clientX,
              clientY,
              button: 2,
              buttons: type === "mouseup" ? 0 : 2,
            })
          );
        });
      };

      const findVisibleEditorActionButtonNearNode = (node) => {
        if (!node || typeof node.getBoundingClientRect !== "function") return null;
        const rect = node.getBoundingClientRect();
        let best = null;
        let bestScore = Number.POSITIVE_INFINITY;
        Array.from(document.querySelectorAll("button,[role='button']")).forEach((candidate) => {
          if (!isVisibleDomElement(candidate)) return;
          if (candidate === node || node.contains(candidate) || candidate.contains(node)) return;
          const candidateRect = candidate.getBoundingClientRect?.();
          if (!candidateRect || candidateRect.width <= 0 || candidateRect.height <= 0) return;
          if (candidateRect.width < 18 || candidateRect.width > 80) return;
          if (candidateRect.height < 18 || candidateRect.height > 80) return;
          const verticalDistance =
            candidateRect.bottom < rect.top
              ? rect.top - candidateRect.bottom
              : candidateRect.top > rect.bottom
                ? candidateRect.top - rect.bottom
                : 0;
          const horizontalDistance =
            candidateRect.right < rect.left
              ? rect.left - candidateRect.right
              : candidateRect.left > rect.right
                ? candidateRect.left - rect.right
                : 0;
          if (verticalDistance > 180 || horizontalDistance > 180) return;
          const iconLike =
            sanitizeMetadataText(candidate.textContent || "").length <= 2 ||
            Boolean(candidate.querySelector?.("svg"));
          if (!iconLike) return;
          const score = verticalDistance * 4 + horizontalDistance;
          if (score < bestScore) {
            best = candidate;
            bestScore = score;
          }
        });
        return best;
      };

      const openVisibleCanvaMetadataForNode = async (node) => {
        if (!node) return false;
        if (scrapeVisibleCanvaAssetMetadata()) return true;
        dispatchSyntheticContextMenu(node);
        await sleep(220);
        await expandVisibleCanvaKeywordList();
        if (scrapeVisibleCanvaAssetMetadata()) return true;
        const actionButton = findVisibleEditorActionButtonNearNode(node);
        if (actionButton) {
          if (typeof actionButton.click === "function") {
            actionButton.click();
          }
          actionButton.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
            })
          );
          await sleep(320);
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await expandVisibleCanvaKeywordList();
            if (scrapeVisibleCanvaAssetMetadata()) return true;
            await sleep(200);
          }
        }
        return false;
      };

      const isBackgroundLikeMetadataCandidate = (candidate, pageWidth, pageHeight) => {
        if (!candidate) return true;
        if (candidate.isBackgroundNode || candidate.isFullPageBackground) return true;
        const width = Math.max(1, Number(candidate.width || 0));
        const height = Math.max(1, Number(candidate.height || 0));
        const pageArea = Math.max(1, Number(pageWidth || 0) * Number(pageHeight || 0));
        const areaRatio = (width * height) / pageArea;
        return areaRatio >= 0.8 || (width >= pageWidth * 0.9 && height >= pageHeight * 0.9);
      };

      const metadataMatchesCandidate = (metadata, candidate) => {
        if (!metadata || !candidate) return false;
        const metadataTitle = normalizeMetadataKey(metadata.titleEn);
        const candidateName = normalizeMetadataKey(candidate.name);
        if (!metadataTitle || !candidateName) return false;
        if (metadataTitle === candidateName) return true;
        if (metadataTitle.includes(candidateName) || candidateName.includes(metadataTitle)) return true;
        const metadataTokens = new Set(tokenizeMetadataLabel(metadataTitle));
        const candidateTokens = tokenizeMetadataLabel(candidateName);
        if (metadataTokens.size === 0 || candidateTokens.length === 0) return false;
        const shared = candidateTokens.filter((token) => metadataTokens.has(token)).length;
        return shared >= Math.max(1, Math.min(metadataTokens.size, candidateTokens.length) - 1);
      };

      const collectCanvaLayerMetadata = async (candidates, pageWidth, pageHeight) => {
        const byId = new Map();
        const pending = (Array.isArray(candidates) ? candidates : []).filter(
          (candidate) =>
            candidate &&
            candidate.kind === "image" &&
            candidate.node &&
            !isBackgroundLikeMetadataCandidate(candidate, pageWidth, pageHeight)
        );
        if (pending.length === 0) return byId;

        await expandVisibleCanvaKeywordList();
        const visibleMetadata = scrapeVisibleCanvaAssetMetadata();
        if (visibleMetadata) {
          const matchedCandidate = pending.find((candidate) =>
            metadataMatchesCandidate(visibleMetadata, candidate)
          );
          if (matchedCandidate) {
            byId.set(matchedCandidate.id, visibleMetadata);
          }
        }

        const maxMetadataScrapes = Math.min(18, pending.length);
        for (let index = 0; index < maxMetadataScrapes; index += 1) {
          const candidate = pending[index];
          if (byId.has(candidate.id)) continue;
          dispatchSyntheticLayerClick(candidate.node);
          await sleep(180);
          await openVisibleCanvaMetadataForNode(candidate.node);
          await expandVisibleCanvaKeywordList();
          let scraped = null;
          for (let attempt = 0; attempt < 4; attempt += 1) {
            scraped = scrapeVisibleCanvaAssetMetadata();
            if (scraped && (scraped.tagsEn.length > 0 || scraped.titleEn)) break;
            await sleep(120);
          }
          if (!scraped) continue;
          if (!metadataMatchesCandidate(scraped, candidate) && scraped.tagsEn.length === 0) continue;
          byId.set(candidate.id, scraped);
        }

        return byId;
      };

      const parseComputedTransform = (transformText = "") => {
        const value = String(transformText || "").trim();
        if (!value || value === "none") {
          return { angle: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false, hasReflection: false };
        }
        try {
          const matrix = new DOMMatrixReadOnly(value);
          const a = Number(matrix.a) || 0;
          const b = Number(matrix.b) || 0;
          const c = Number(matrix.c) || 0;
          const d = Number(matrix.d) || 0;
          const magnitudeX = Math.hypot(a, b);
          const safeScaleX = magnitudeX > 0.000001 ? magnitudeX : 1;
          const determinant = a * d - b * c;
          let signedScaleY = determinant / safeScaleX;
          if (!Number.isFinite(signedScaleY) || Math.abs(signedScaleY) < 0.000001) {
            const magnitudeY = Math.hypot(c, d);
            signedScaleY = magnitudeY > 0.000001 ? magnitudeY : 1;
          }
          const angle = (Math.atan2(b, a) * 180) / Math.PI;
          const flipX = false;
          const flipY = signedScaleY < 0;
          return {
            angle,
            scaleX: Math.max(0.001, safeScaleX),
            scaleY: Math.max(0.001, Math.abs(signedScaleY)),
            flipX,
            flipY,
            hasReflection: flipX !== flipY,
          };
        } catch (_error) {
          return { angle: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false, hasReflection: false };
        }
      };

      const parseStyleTransform = (styleText = "") => {
        const source = String(styleText || "");
        const translateMatch = source.match(
          /translate\(\s*([-0-9.e]+)px\s*,\s*([-0-9.e]+)px\s*\)/i
        );
        const rotateMatch = source.match(/rotate\(\s*([-0-9.e]+)deg\s*\)/i);
        return {
          hasTranslate: Boolean(translateMatch),
          x: Number.isFinite(Number(translateMatch?.[1])) ? Number(translateMatch[1]) : 0,
          y: Number.isFinite(Number(translateMatch?.[2])) ? Number(translateMatch[2]) : 0,
          hasAngle: Boolean(rotateMatch),
          angle: Number.isFinite(Number(rotateMatch?.[1])) ? Number(rotateMatch[1]) : 0,
        };
      };

      const rectArea = (rect) => Math.max(0, Number(rect?.width || 0)) * Math.max(0, Number(rect?.height || 0));

      const intersectRects = (a, b) => {
        if (!a || !b) return null;
        const left = Math.max(Number(a.left ?? a.x ?? 0), Number(b.left ?? b.x ?? 0));
        const top = Math.max(Number(a.top ?? a.y ?? 0), Number(b.top ?? b.y ?? 0));
        const right = Math.min(
          Number((a.left ?? a.x ?? 0) + (a.width ?? 0)),
          Number((b.left ?? b.x ?? 0) + (b.width ?? 0))
        );
        const bottom = Math.min(
          Number((a.top ?? a.y ?? 0) + (a.height ?? 0)),
          Number((b.top ?? b.y ?? 0) + (b.height ?? 0))
        );
        const width = Math.max(0, right - left);
        const height = Math.max(0, bottom - top);
        if (width < 1 || height < 1) return null;
        return {
          x: left,
          y: top,
          left,
          top,
          width,
          height,
          right,
          bottom,
        };
      };

      const getTransformedViewportRect = (element, frameRect) => {
        if (!element || !frameRect) return null;
        const rawRect = element.getBoundingClientRect();
        const intersection = intersectRects(rawRect, {
          left: frameRect.x,
          top: frameRect.y,
          width: frameRect.width,
          height: frameRect.height,
        });
        if (!intersection) return null;
        const rawArea = rectArea(rawRect);
        const visibleArea = rectArea(intersection);
        const coverage = rawArea > 0 ? visibleArea / rawArea : 0;
        return {
          x: intersection.x,
          y: intersection.y,
          width: intersection.width,
          height: intersection.height,
          rawRect,
          rawArea,
          visibleArea,
          coverage,
        };
      };

      const getEffectiveOpacity = (element, stopAtNode) => {
        let opacity = 1;
        let node = element;
        let depth = 0;
        while (node && node !== stopAtNode && depth < 12) {
          const style = window.getComputedStyle(node);
          const localOpacity = Number(style.opacity);
          if (Number.isFinite(localOpacity)) {
            opacity *= localOpacity;
          }
          node = node.parentElement;
          depth += 1;
        }
        return Math.max(0, Math.min(opacity, 1));
      };

      const getCompositeScaleToAncestor = (element, stopAtNode) => {
        let scaleX = 1;
        let scaleY = 1;
        let node = element;
        let depth = 0;
        while (node && node !== stopAtNode && depth < 16) {
          const style = window.getComputedStyle(node);
          const parsed = parseComputedTransform(style.transform);
          scaleX *= Number(parsed?.scaleX || 1);
          scaleY *= Number(parsed?.scaleY || 1);
          node = node.parentElement;
          depth += 1;
        }
        return {
          x: Math.max(0.01, scaleX),
          y: Math.max(0.01, scaleY),
        };
      };

      const hasMeaningfulTransformBetween = (element, stopAtNode) => {
        let node = element?.parentElement || null;
        let depth = 0;
        while (node && node !== stopAtNode && depth < 12) {
          const styleText = node.getAttribute?.("style") || "";
          const computedStyle = window.getComputedStyle(node);
          const computedTransform = parseComputedTransform(computedStyle.transform || styleText);
          const inlineTransform = parseStyleTransform(styleText);
          const hasMeaningfulScale =
            Math.abs(Number(computedTransform.scaleX || 1) - 1) > 0.02 ||
            Math.abs(Number(computedTransform.scaleY || 1) - 1) > 0.02;
          const hasMeaningfulAngle =
            Math.abs(Number(computedTransform.angle || 0)) > 0.2 ||
            inlineTransform.hasAngle;
          if (
            hasMeaningfulScale ||
            hasMeaningfulAngle ||
            Boolean(computedTransform.flipX) ||
            Boolean(computedTransform.flipY) ||
            Boolean(computedTransform.hasReflection)
          ) {
            return true;
          }
          node = node.parentElement;
          depth += 1;
        }
        return false;
      };

      const getNumericZIndex = (element, stopAtNode) => {
        let best = null;
        let node = element;
        let depth = 0;
        while (node && node !== stopAtNode && depth < 12) {
          const style = window.getComputedStyle(node);
          const numeric = Number(style.zIndex);
          if (Number.isFinite(numeric)) {
            best = best === null ? numeric : Math.max(best, numeric);
          }
          node = node.parentElement;
          depth += 1;
        }
        return best;
      };

      const getImageElementSource = (imageElement) => {
        if (!imageElement) return "";
        const xlinkNs = "http://www.w3.org/1999/xlink";
        const candidates = [
          imageElement.currentSrc,
          imageElement.src,
          imageElement.getAttribute?.("src"),
          imageElement.getAttribute?.("href"),
          imageElement.getAttribute?.("xlink:href"),
          imageElement.getAttributeNS?.(xlinkNs, "href"),
          imageElement.href?.baseVal,
          imageElement.href?.animVal,
        ];
        for (let index = 0; index < candidates.length; index += 1) {
          const normalized = normalizeAssetUrl(candidates[index]);
          if (normalized) return normalized;
        }
        return "";
      };

      const dedupeTextLines = (value) => {
        const lines = String(value || "")
          .split("\n")
          .map((line) => line.replace(/\s+/g, " ").trim())
          .filter(Boolean);
        if (lines.length === 0) return "";

        const shortLineCount = lines.filter((line) => line.length <= 2).length;
        const isCharacterStack =
          lines.length >= 4 && shortLineCount / Math.max(1, lines.length) >= 0.7;
        if (isCharacterStack) {
          return lines.join("");
        }

        const deduped = [];
        lines.forEach((line) => {
          if (deduped[deduped.length - 1] !== line) {
            deduped.push(line);
          }
        });
        return deduped.join("\n");
      };

      const parseFontWeight = (value) => {
        const numeric = Number(String(value || "").replace(/[^\d]/g, ""));
        if (Number.isFinite(numeric) && numeric > 0) return numeric;
        return String(value || "").toLowerCase().includes("bold") ? 700 : 400;
      };

      const normalizeFontStyle = (value) => {
        const source = String(value || "").trim().toLowerCase();
        if (!source) return "normal";
        if (source.includes("italic") || source.includes("oblique") || source.includes("slant")) {
          return "italic";
        }
        return "normal";
      };

      const parseFontFaceWeightRange = (value) => {
        const source = String(value || "").trim().toLowerCase();
        if (!source) return { min: 400, max: 400 };
        if (source === "normal") return { min: 400, max: 400 };
        if (source === "bold") return { min: 700, max: 700 };
        const numericParts = source
          .split(/[\s,]+/)
          .map((part) => Number.parseInt(part.replace(/[^\d]/g, ""), 10))
          .filter((part) => Number.isFinite(part) && part > 0);
        if (numericParts.length === 1) {
          const valueWeight = numericParts[0];
          return { min: valueWeight, max: valueWeight };
        }
        if (numericParts.length >= 2) {
          const first = numericParts[0];
          const second = numericParts[1];
          return first <= second ? { min: first, max: second } : { min: second, max: first };
        }
        return { min: 400, max: 400 };
      };

      const GENERIC_FONT_FAMILIES = new Set([
        "sans-serif",
        "serif",
        "monospace",
        "cursive",
        "fantasy",
        "system-ui",
        "ui-sans-serif",
        "ui-serif",
        "ui-monospace",
        "emoji",
        "math",
        "fangsong",
      ]);

      const normalizeFontFamilyName = (value) => {
        const input = String(value || "").trim();
        if (!input) return "";
        const primary = input.split(",")[0]?.replace(/^['"]+|['"]+$/g, "").trim() || "";
        if (!primary) return "";
        if (GENERIC_FONT_FAMILIES.has(primary.toLowerCase())) return "";
        return primary.replace(/\s+/g, " ").trim();
      };

      const normalizeAssetUrl = (value) => {
        const raw = String(value || "").trim();
        if (!raw) return "";
        if (raw.startsWith("data:image/")) return raw;
        if (raw.startsWith("data:font/")) return raw;
        if (raw.startsWith("data:application/font-")) return raw;
        if (raw.startsWith("data:application/x-font-")) return raw;
        if (raw.startsWith("data:application/vnd.ms-fontobject")) return raw;
        if (raw.startsWith("blob:")) return raw;
        try {
          return new URL(raw, location.href).toString();
        } catch (_error) {
          return raw;
        }
      };

      const guessFontMimeType = (sourceUrl, formatHint) => {
        const format = String(formatHint || "").toLowerCase();
        if (format.includes("truetype") || format.includes("ttf")) return "font/ttf";
        if (format.includes("opentype") || format.includes("otf")) return "font/otf";
        if (format.includes("ttc") || format.includes("collection")) return "font/ttc";
        if (format.includes("woff2")) return "font/woff2";
        if (format.includes("woff")) return "font/woff";
        if (format.includes("embedded-opentype") || format.includes("eot")) {
          return "application/vnd.ms-fontobject";
        }
        const url = String(sourceUrl || "").toLowerCase();
        if (url.includes(".ttf")) return "font/ttf";
        if (url.includes(".otf")) return "font/otf";
        if (url.includes(".ttc")) return "font/ttc";
        if (url.includes(".woff2")) return "font/woff2";
        if (url.includes(".woff")) return "font/woff";
        if (url.includes(".eot")) return "application/vnd.ms-fontobject";
        return "";
      };

      const parseFontMimeTypeFromDataUrl = (value) => {
        const source = String(value || "").trim();
        const match = source.match(/^data:([^;,]+);base64,/i);
        return String(match?.[1] || "").trim().toLowerCase();
      };

      const toDataUrlFromBlob = (blob) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : "");
          reader.onerror = () => resolve("");
          reader.readAsDataURL(blob);
        });

      const readRemoteImageAssetAsDataUrl = async (sourceUrl, maxBytes = 8_000_000) => {
        const normalizedUrl = normalizeAssetUrl(sourceUrl);
        if (!normalizedUrl) return "";
        if (/^data:/i.test(normalizedUrl) || /^blob:/i.test(normalizedUrl)) return "";
        try {
          const response = await fetch(normalizedUrl, {
            credentials: "include",
            cache: "force-cache",
          });
          if (!response.ok) return "";
          const blob = await response.blob();
          if (!blob || blob.size <= 0 || blob.size > maxBytes) return "";
          const mimeType = String(blob.type || "").trim().toLowerCase();
          if (mimeType && !mimeType.startsWith("image/")) return "";
          const dataUrl = await toDataUrlFromBlob(blob);
          return String(dataUrl).startsWith("data:image/") ? dataUrl : "";
        } catch (_error) {
          return "";
        }
      };

      const sanitizeFontFileName = (value, fallback = "imported-font.ttf") => {
        const source = String(value || "").trim();
        const cleaned = source
          .replace(/[?#].*$/, "")
          .split("/")
          .pop()
          ?.replace(/[^\w.\- ]+/g, "")
          .trim();
        if (cleaned) return cleaned.slice(0, 180);
        return fallback;
      };

      const readFontAssetAsDataUrl = async (entry) => {
        const sourceUrl = String(entry?.url || "").trim();
        if (!sourceUrl) return { dataUrl: "", mimeType: "" };
        if (sourceUrl.startsWith("data:")) {
          const hintedMimeType = String(
            entry?.mimeType || guessFontMimeType(sourceUrl, entry?.format || "") || ""
          ).toLowerCase();
          const dataMimeType =
            parseFontMimeTypeFromDataUrl(sourceUrl) ||
            hintedMimeType;
          const normalizedMimeType = String(dataMimeType || "").toLowerCase();
          const finalMimeType =
            normalizedMimeType === "application/octet-stream" && hintedMimeType
              ? hintedMimeType
              : normalizedMimeType;
          return { dataUrl: sourceUrl, mimeType: finalMimeType };
        }
        try {
          const response = await fetch(sourceUrl, { credentials: "include", cache: "force-cache" });
          if (!response.ok) return { dataUrl: "", mimeType: "" };
          const blob = await response.blob();
          if (!blob || blob.size <= 0 || blob.size > 5_000_000) {
            return { dataUrl: "", mimeType: "" };
          }
          const dataUrl = await toDataUrlFromBlob(blob);
          if (!String(dataUrl).startsWith("data:")) return { dataUrl: "", mimeType: "" };
          const hintedMimeType = String(
            entry?.mimeType || guessFontMimeType(sourceUrl, entry?.format || "") || ""
          ).toLowerCase();
          const mimeType =
            String(blob.type || "").trim().toLowerCase() ||
            hintedMimeType;
          const finalMimeType =
            mimeType === "application/octet-stream" && hintedMimeType ? hintedMimeType : mimeType;
          return { dataUrl, mimeType: finalMimeType };
        } catch (_error) {
          return { dataUrl: "", mimeType: "" };
        }
      };

      const extractFontFaceEntriesFromSrc = (srcValue) => {
        const entries = [];
        const source = String(srcValue || "");
        if (!source) return entries;
        const regex = /url\(([^)]+)\)\s*(?:format\(([^)]+)\))?/gi;
        let match = regex.exec(source);
        while (match) {
          const rawUrl = String(match[1] || "").replace(/^['"]+|['"]+$/g, "").trim();
          const normalizedUrl = normalizeAssetUrl(rawUrl);
          if (normalizedUrl) {
            const formatHint = String(match[2] || "").replace(/^['"]+|['"]+$/g, "").trim();
            const mimeType = guessFontMimeType(normalizedUrl, formatHint);
            entries.push({
              url: normalizedUrl,
              mimeType,
              format: formatHint,
            });
          }
          match = regex.exec(source);
        }
        return entries;
      };

      const collectDocumentFontAssets = () => {
        const byFamily = new Map();
        const addEntry = (familyName, entry) => {
          const normalizedFamily = normalizeFontFamilyName(familyName);
          if (!normalizedFamily) return;
          if (!entry || typeof entry !== "object") return;
          const url = normalizeAssetUrl(entry.url);
          if (!url) return;
          const weightRange = parseFontFaceWeightRange(entry.fontWeight);
          const normalizedStyle = normalizeFontStyle(entry.fontStyle);
          const dedupeKey = `${url}|${normalizedStyle}|${weightRange.min}|${weightRange.max}`;
          const current = byFamily.get(normalizedFamily) || [];
          if (
            current.some(
              (item) =>
                `${String(item?.url || "")}|${String(item?.fontStyle || "")}|${Number(item?.fontWeightMin || 0)}|${Number(item?.fontWeightMax || 0)}` ===
                dedupeKey
            )
          ) {
            return;
          }
          current.push({
            url,
            mimeType: String(entry.mimeType || guessFontMimeType(url, entry.format || "") || ""),
            format: String(entry.format || ""),
            fileName: sanitizeFontFileName(url),
            fontStyle: normalizedStyle,
            fontWeightMin: weightRange.min,
            fontWeightMax: weightRange.max,
          });
          byFamily.set(normalizedFamily, current);
        };

        const styleSheets = Array.from(document.styleSheets || []);
        styleSheets.forEach((sheet) => {
          let rules = null;
          try {
            rules = sheet.cssRules || [];
          } catch (_error) {
            rules = null;
          }
          if (!rules || !rules.length) return;
          Array.from(rules).forEach((rule) => {
            if (!rule || rule.type !== CSSRule.FONT_FACE_RULE) return;
            const familyRaw = rule.style?.getPropertyValue?.("font-family") || "";
            const srcRaw = rule.style?.getPropertyValue?.("src") || "";
            const styleRaw = rule.style?.getPropertyValue?.("font-style") || "";
            const weightRaw = rule.style?.getPropertyValue?.("font-weight") || "";
            const entries = extractFontFaceEntriesFromSrc(srcRaw);
            entries.forEach((entry) =>
              addEntry(familyRaw, {
                ...entry,
                fontStyle: styleRaw,
                fontWeight: weightRaw,
              })
            );
          });
        });

        return Array.from(byFamily.entries()).reduce((accumulator, [family, entries]) => {
          accumulator[family] = entries;
          return accumulator;
        }, {});
      };

      const getFontEntriesByFamily = (fontAssets, familyName) => {
        const family = normalizeFontFamilyName(familyName);
        if (!family) return [];
        const direct = Array.isArray(fontAssets?.[family]) ? fontAssets[family] : [];
        if (direct.length > 0) return direct;
        const key = family.toLowerCase();
        const matched = Object.keys(fontAssets || {}).find(
          (candidate) => String(candidate || "").toLowerCase() === key
        );
        if (!matched) return [];
        return Array.isArray(fontAssets?.[matched]) ? fontAssets[matched] : [];
      };

      const resolveFontAssetsForFamilies = async (fontAssets, families) => {
        const result = {};
        const seenFamilies = new Set();
        const sourceFamilies = Array.isArray(families) ? families : [];
        for (let index = 0; index < sourceFamilies.length; index += 1) {
          const family = normalizeFontFamilyName(sourceFamilies[index]);
          if (!family) continue;
          const familyKey = family.toLowerCase();
          if (seenFamilies.has(familyKey)) continue;
          seenFamilies.add(familyKey);

          const entries = getFontEntriesByFamily(fontAssets, family);
          if (entries.length === 0) continue;

          const resolvedEntries = [];
          for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
            const entry = entries[entryIndex];
            if (!entry || typeof entry !== "object") continue;
            const url = String(entry.url || "").trim();
            if (!url) continue;
            const resolved = await readFontAssetAsDataUrl(entry);
            resolvedEntries.push({
              url,
              dataUrl: String(resolved?.dataUrl || ""),
              mimeType: String(
                resolved?.mimeType ||
                  entry.mimeType ||
                  guessFontMimeType(url, entry.format || "") ||
                  ""
              ).toLowerCase(),
              format: String(entry.format || ""),
              fileName: sanitizeFontFileName(entry.fileName || url, `${family}.ttf`),
              fontStyle: normalizeFontStyle(entry.fontStyle || ""),
              fontWeightMin: Number.isFinite(Number(entry.fontWeightMin))
                ? Number(entry.fontWeightMin)
                : 400,
              fontWeightMax: Number.isFinite(Number(entry.fontWeightMax))
                ? Number(entry.fontWeightMax)
                : 400,
            });
            if (resolvedEntries.length >= 4) break;
          }
          if (resolvedEntries.length > 0) {
            result[family] = resolvedEntries;
          }
        }
        return result;
      };

      const parseBackgroundImageUrl = (value) => {
        const source = String(value || "");
        const match = source.match(/url\((['"]?)(.*?)\1\)/i);
        return match?.[2] ? normalizeAssetUrl(match[2]) : "";
      };

      const findCssImageUrl = (element) => {
        if (!element) return "";
        const searchSources = [];
        const pushStyle = (style) => {
          if (!style) return;
          searchSources.push(style.backgroundImage);
          searchSources.push(style.maskImage);
          searchSources.push(style.webkitMaskImage);
          searchSources.push(style.content);
        };
        try {
          pushStyle(window.getComputedStyle(element));
          pushStyle(window.getComputedStyle(element, "::before"));
          pushStyle(window.getComputedStyle(element, "::after"));
        } catch (_error) {
          // Ignore pseudo-style errors.
        }
        for (let index = 0; index < searchSources.length; index += 1) {
          const found = parseBackgroundImageUrl(searchSources[index]);
          if (found) return found;
        }
        return "";
      };

      const isInsideForeignLayer = (element, ownerNode) => {
        const layerAncestor = element?.closest?.('[id^="LB"]');
        if (!layerAncestor) return false;
        if (!ownerNode) return true;
        return layerAncestor !== ownerNode;
      };

      const getScopedImageElements = (node) => {
        if (!node) return [];
        return Array.from(node.querySelectorAll("img, image")).filter(
          (element) => !isInsideForeignLayer(element, node)
        );
      };

      const getScopedTextPreview = (node) => {
        if (!node) return "";
        const parts = [];
        try {
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let current = walker.nextNode();
          while (current) {
            const parentElement = current.parentElement || null;
            if (!isInsideForeignLayer(parentElement, node)) {
              const value = String(current.textContent || "").trim();
              if (value) parts.push(value);
            }
            current = walker.nextNode();
          }
        } catch (_error) {
          return "";
        }
        return dedupeTextLines(parts.join("\n"));
      };

      const getNodeVisualAssetKey = (node) => {
        if (!node) return "";
        const images = getScopedImageElements(node);
        for (let index = 0; index < images.length; index += 1) {
          const source = getImageElementSource(images[index]);
          if (source) return source;
        }
        const cssSource = findCssImageUrl(node);
        if (cssSource) return cssSource;
        const descendants = Array.from(node.querySelectorAll("*")).filter(
          (candidate) => !isInsideForeignLayer(candidate, node)
        );
        for (let index = 0; index < descendants.length; index += 1) {
          const source = findCssImageUrl(descendants[index]);
          if (source) return source;
        }
        return "";
      };

      const parseNumericPx = (value) => {
        const numeric = Number.parseFloat(String(value || "").replace(/[^\d.\-]/g, ""));
        return Number.isFinite(numeric) ? numeric : 0;
      };

      const isTransparentColor = (value) => {
        const color = String(value || "").trim().toLowerCase();
        return (
          !color ||
          color === "none" ||
          color === "transparent" ||
          color === "rgba(0, 0, 0, 0)"
        );
      };

      const resolveTextBackgroundStyle = (element, stopAtNode) => {
        const empty = { color: "", radius: 0 };
        if (!element) return empty;
        let node = element;
        let depth = 0;
        while (node && depth < 12) {
          const style = window.getComputedStyle(node);
          const backgroundColor = String(style.backgroundColor || "").trim();
          if (!isTransparentColor(backgroundColor)) {
            return {
              color: backgroundColor,
              radius: Math.max(0, parseNumericPx(style.borderRadius || "")),
            };
          }
          if (node === stopAtNode) break;
          node = node.parentElement;
          depth += 1;
        }
        if (!stopAtNode || !stopAtNode.querySelectorAll) return empty;

        const ownerRect = stopAtNode.getBoundingClientRect();
        const ownerArea = Math.max(1, rectArea(ownerRect));
        const textRect =
          element && typeof element.getBoundingClientRect === "function"
            ? element.getBoundingClientRect()
            : ownerRect;
        const textArea = Math.max(1, rectArea(textRect));
        const textCenterX = Number(textRect.left || 0) + Number(textRect.width || 0) / 2;
        const textCenterY = Number(textRect.top || 0) + Number(textRect.height || 0) / 2;

        const candidates = [stopAtNode, ...Array.from(stopAtNode.querySelectorAll("*"))].filter(
          (candidate) => !isInsideForeignLayer(candidate, stopAtNode)
        );
        let best = empty;
        let bestScore = -1;

        for (let index = 0; index < candidates.length; index += 1) {
          const candidate = candidates[index];
          let style = null;
          try {
            style = window.getComputedStyle(candidate);
          } catch (_error) {
            style = null;
          }
          if (!style) continue;
          const backgroundColor = String(style.backgroundColor || "").trim();
          if (isTransparentColor(backgroundColor)) continue;
          const candidateRect = candidate.getBoundingClientRect();
          const clipped = intersectRects(candidateRect, ownerRect);
          if (!clipped) continue;
          const candidateArea = Math.max(1, rectArea(clipped));
          const coverage = candidateArea / ownerArea;
          if (coverage < 0.01) continue;

          const centerInside =
            textCenterX >= clipped.left &&
            textCenterX <= clipped.right &&
            textCenterY >= clipped.top &&
            textCenterY <= clipped.bottom;
          const textOverlapRect = intersectRects(clipped, textRect);
          const textOverlap = textOverlapRect ? rectArea(textOverlapRect) / textArea : 0;
          if (!centerInside && textOverlap < 0.2) continue;

          const radius = Math.max(0, parseNumericPx(style.borderRadius || ""));
          const score =
            (centerInside ? 8 : 0) +
            Math.min(4, textOverlap * 6) +
            Math.max(0, 2 - coverage * 3) +
            (radius > 0 ? 1 : 0);
          if (score > bestScore) {
            bestScore = score;
            best = { color: backgroundColor, radius };
          }
        }
        return best;
      };

      const findBestTextStyleElement = (node, ownerNode = node) => {
        const candidates = Array.from(node.querySelectorAll("p,span,div")).filter(
          (candidate) =>
            !isInsideForeignLayer(candidate, ownerNode) &&
            String(candidate.innerText || "").trim()
        );
        let best = null;
        let bestScore = -1;
        for (let index = 0; index < candidates.length; index += 1) {
          const candidate = candidates[index];
          const style = window.getComputedStyle(candidate);
          const fontSize = Number.parseFloat(style.fontSize || "") || 0;
          const color = style.color;
          const hasVar = String(candidate.getAttribute("style") || "").includes("--H97cbQ");
          const score =
            (candidate.tagName === "P" ? 12 : 0) +
            (hasVar ? 8 : 0) +
            (!isTransparentColor(color) ? 5 : 0) +
            (fontSize >= 10 ? 3 : 0);
          if (score > bestScore) {
            bestScore = score;
            best = candidate;
          }
        }
        if (!best) return null;
        const style = window.getComputedStyle(best);
        return isTransparentColor(style.color) ? null : best;
      };

      const findCustomFontSizeFromNode = (element, stopAtNode) => {
        let node = element;
        let depth = 0;
        while (node && node !== stopAtNode && depth < 10) {
          const style = node.style;
          const raw = style?.getPropertyValue?.("--H97cbQ") || "";
          const px = parseNumericPx(raw);
          if (px > 0) return px;
          node = node.parentElement;
          depth += 1;
        }
        return 0;
      };

      const detectMaskedImageLayer = (layerNode, imageElement, viewportRect) => {
        if (!layerNode || !imageElement || !viewportRect) return false;
        const layerStyle = window.getComputedStyle(layerNode);
        const imageStyle = window.getComputedStyle(imageElement);
        const imageRect = imageElement.getBoundingClientRect();
        const imageArea = Math.max(0, imageRect.width) * Math.max(0, imageRect.height);
        const layerArea = Math.max(0, viewportRect.width) * Math.max(0, viewportRect.height);
        const clippedByArea = imageArea > 1 && layerArea > 1 && imageArea > layerArea * 1.18;
        const ratioLayer = viewportRect.width / Math.max(1, viewportRect.height);
        const ratioImage = imageRect.width / Math.max(1, imageRect.height);
        const ratioDelta = Math.abs(ratioLayer - ratioImage);
        let hasMaskSignals = false;
        let node = imageElement;
        let depth = 0;
        while (node && node !== layerNode && depth < 10) {
          const style = window.getComputedStyle(node);
          if (
            style.overflow !== "visible" ||
            style.clipPath !== "none" ||
            style.maskImage !== "none" ||
            style.webkitMaskImage !== "none" ||
            parseNumericPx(style.borderRadius) > 0
          ) {
            hasMaskSignals = true;
            break;
          }
          node = node.parentElement;
          depth += 1;
        }
        return (
          hasMaskSignals ||
          layerStyle.overflow !== "visible" ||
          imageStyle.objectFit === "cover" ||
          imageStyle.objectFit === "contain" ||
          ratioDelta > 0.22 ||
          clippedByArea
        );
      };

      const shouldPreferRenderedImageSnapshot = (layerNode, imageElement) => {
        if (!layerNode || !imageElement) return false;
        if (hasMeaningfulTransformBetween(imageElement, layerNode)) return true;

        const renderableDescendants = Array.from(
          layerNode.querySelectorAll("img, image, svg, canvas")
        ).filter(
          (candidate) =>
            !isInsideForeignLayer(candidate, layerNode) &&
            candidate !== imageElement &&
            !candidate.contains?.(imageElement)
        );
        if (renderableDescendants.length > 0) return true;

        if (findCssImageUrl(layerNode)) return true;

        const primarySource = getImageElementSource(imageElement);
        const siblingSources = getScopedImageElements(layerNode)
          .filter((candidate) => candidate !== imageElement)
          .map((candidate) => getImageElementSource(candidate))
          .filter(Boolean);
        return siblingSources.some((candidate) => candidate !== primarySource);
      };

      const resolveThinVectorStrokeStyle = (layerNode) => {
        const svgCandidate = findBestSvgRenderCandidate(layerNode);
        if (!(svgCandidate instanceof SVGElement)) {
          return { color: "", strokeOnly: false };
        }
        const vectorNodes = Array.from(
          svgCandidate.querySelectorAll("path,line,polyline,polygon,rect,ellipse,circle")
        ).filter((candidate) => !candidate.closest("defs"));
        let bestColor = "";
        let bestStrokeOnly = false;
        let bestScore = -1;

        for (let index = 0; index < vectorNodes.length; index += 1) {
          const candidate = vectorNodes[index];
          const style = window.getComputedStyle(candidate);
          const opacity = Number(style.opacity);
          if (Number.isFinite(opacity) && opacity <= 0.01) continue;
          const stroke = String(style.stroke || "").trim();
          const fill = String(style.fill || "").trim();
          const strokeWidth = parseNumericPx(style.strokeWidth || "");
          const rect = candidate.getBoundingClientRect();
          const score = Math.max(1, rectArea(rect)) + strokeWidth * 10;
          const strokeVisible = !isTransparentColor(stroke);
          const fillVisible = !isTransparentColor(fill);
          if (!strokeVisible && !fillVisible) continue;
          if (score <= bestScore) continue;
          bestScore = score;
          bestColor = strokeVisible ? stroke : fill;
          bestStrokeOnly = strokeVisible && !fillVisible;
        }

        if (!bestColor) {
          const svgStyle = window.getComputedStyle(svgCandidate);
          const svgStroke = String(svgStyle.stroke || "").trim();
          const svgFill = String(svgStyle.fill || "").trim();
          const svgStrokeVisible = !isTransparentColor(svgStroke);
          const svgFillVisible = !isTransparentColor(svgFill);
          if (svgStrokeVisible || svgFillVisible) {
            bestColor = svgStrokeVisible ? svgStroke : svgFill;
            bestStrokeOnly = svgStrokeVisible && !svgFillVisible;
          }
        }

        return {
          color: bestColor,
          strokeOnly: bestStrokeOnly,
        };
      };

      const hasVisibleBackgroundPaint = (element) => {
        if (!element) return false;
        const bgImage = findCssImageUrl(element);
        if (bgImage) return true;
        const style = window.getComputedStyle(element);
        const bgColor = String(style.backgroundColor || "").trim().toLowerCase();
        return Boolean(bgColor && bgColor !== "transparent" && bgColor !== "rgba(0, 0, 0, 0)");
      };

      const renderElementToDataUrl = (element, targetWidth, targetHeight) => {
        if (!element) return "";
        try {
          const elementWidth = Number(element.naturalWidth || element.width?.baseVal?.value || element.width || 0);
          const elementHeight = Number(element.naturalHeight || element.height?.baseVal?.value || element.height || 0);
          const width = Math.max(1, Math.round(targetWidth || elementWidth || 1));
          const height = Math.max(1, Math.round(targetHeight || elementHeight || 1));
          const rasterCanvas = document.createElement("canvas");
          rasterCanvas.width = width;
          rasterCanvas.height = height;
          const rasterContext = rasterCanvas.getContext("2d");
          if (!rasterContext) return "";
          rasterContext.drawImage(element, 0, 0, width, height);
          return rasterCanvas.toDataURL("image/png");
        } catch (_error) {
          return "";
        }
      };

      const SVG_RENDER_STYLE_PROPERTIES = [
        "fill",
        "fill-rule",
        "fill-opacity",
        "stroke",
        "clip-rule",
        "stroke-opacity",
        "stroke-width",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-dasharray",
        "stroke-dashoffset",
        "opacity",
        "filter",
        "clip-path",
        "mask",
        "transform",
        "transform-origin",
        "mix-blend-mode",
      ];

      const copyComputedSvgStyles = (sourceNode, targetNode) => {
        if (!(sourceNode instanceof Element) || !(targetNode instanceof Element)) return;
        try {
          const computed = window.getComputedStyle(sourceNode);
          SVG_RENDER_STYLE_PROPERTIES.forEach((property) => {
            const value = computed.getPropertyValue(property);
            if (value) {
              targetNode.style.setProperty(property, value);
            }
          });
        } catch (_error) {
          // Ignore style copy failures and keep the inline SVG as-is.
        }

        const sourceChildren = Array.from(sourceNode.children || []);
        const targetChildren = Array.from(targetNode.children || []);
        const childCount = Math.min(sourceChildren.length, targetChildren.length);
        for (let index = 0; index < childCount; index += 1) {
          copyComputedSvgStyles(sourceChildren[index], targetChildren[index]);
        }
      };

      const extractUrlFragmentId = (value) => {
        const source = String(value || "");
        const match = source.match(/url\((['"]?)#([^'")]+)\1\)/i);
        return match?.[2] ? String(match[2]).trim() : "";
      };

      const hasRenderableSvgContent = (svgElement) => {
        if (!(svgElement instanceof SVGElement)) return false;
        const renderableTags = [
          "path",
          "rect",
          "circle",
          "ellipse",
          "line",
          "polyline",
          "polygon",
          "image",
          "text",
          "use",
        ];
        return renderableTags.some((tagName) =>
          Array.from(svgElement.querySelectorAll(tagName)).some(
            (candidate) => !candidate.closest("defs")
          )
        );
      };

      const findBestSvgRenderCandidate = (layerNode) => {
        if (!layerNode) return null;
        const candidates = [
          ...(String(layerNode.tagName || "").toLowerCase() === "svg" ? [layerNode] : []),
          ...Array.from(layerNode.querySelectorAll("svg")).filter(
            (candidate) => !isInsideForeignLayer(candidate, layerNode)
          ),
        ];
        let best = null;
        let bestArea = 0;
        candidates.forEach((candidate) => {
          if (!(candidate instanceof SVGElement)) return;
          if (!hasRenderableSvgContent(candidate)) return;
          const rect = candidate.getBoundingClientRect();
          if (!isVisible(candidate, rect)) return;
          const area = Math.max(1, rect.width * rect.height);
          if (area > bestArea) {
            best = candidate;
            bestArea = area;
          }
        });
        return best;
      };

      const hasRenderableVectorSignal = (layerNode) => {
        if (!layerNode) return false;
        if (findBestClipPathShapeCandidate(layerNode)) return true;
        if (findBestSvgRenderCandidate(layerNode)) return true;
        const canvasCandidates = [
          ...(String(layerNode.tagName || "").toLowerCase() === "canvas" ? [layerNode] : []),
          ...Array.from(layerNode.querySelectorAll("canvas")).filter(
            (candidate) => !isInsideForeignLayer(candidate, layerNode)
          ),
        ];
        return canvasCandidates.some((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return isVisible(candidate, rect);
        });
      };

      const stripTextNodesFromElement = (rootElement) => {
        if (!(rootElement instanceof Element)) return;
        Array.from(rootElement.querySelectorAll("text, tspan, foreignObject")).forEach((candidate) =>
          candidate.remove()
        );
      };

      const serializeSvgElementToDataUrl = (svgElement, targetWidth, targetHeight, options = {}) => {
        if (!(svgElement instanceof SVGElement)) return "";
        try {
          const clone = svgElement.cloneNode(true);
          copyComputedSvgStyles(svgElement, clone);
          if (options?.excludeTextNodes) {
            stripTextNodesFromElement(clone);
          }

          const rect = svgElement.getBoundingClientRect();
          const width = Math.max(
            1,
            Math.round(targetWidth || parseNumericDimension(svgElement.getAttribute("width")) || rect.width || 1)
          );
          const height = Math.max(
            1,
            Math.round(targetHeight || parseNumericDimension(svgElement.getAttribute("height")) || rect.height || 1)
          );

          clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
          clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
          clone.setAttribute("width", String(width));
          clone.setAttribute("height", String(height));
          if (!clone.getAttribute("viewBox")) {
            clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
          }
          clone.setAttribute("preserveAspectRatio", clone.getAttribute("preserveAspectRatio") || "none");

          const serialized = new XMLSerializer().serializeToString(clone);
          if (!serialized.includes("<svg")) return "";
          return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
        } catch (_error) {
          return "";
        }
      };

      const rasterizeDataUrlWithCanvas = async (dataUrl, targetWidth, targetHeight) => {
        if (!String(dataUrl || "").startsWith("data:image/")) return "";
        try {
          const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error("image-load-failed"));
            element.src = dataUrl;
          });
          const width = Math.max(
            1,
            Math.round(
              targetWidth || Number(image?.naturalWidth || image?.width || 0) || 1
            )
          );
          const height = Math.max(
            1,
            Math.round(
              targetHeight || Number(image?.naturalHeight || image?.height || 0) || 1
            )
          );
          const rasterCanvas = document.createElement("canvas");
          rasterCanvas.width = width;
          rasterCanvas.height = height;
          const rasterContext = rasterCanvas.getContext("2d");
          if (!rasterContext) return "";
          rasterContext.drawImage(image, 0, 0, width, height);
          return rasterCanvas.toDataURL("image/png");
        } catch (_error) {
          return "";
        }
      };

      const findBestClipPathShapeCandidate = (layerNode) => {
        if (!layerNode) return null;
        const layerRect = layerNode.getBoundingClientRect();
        const candidates = [
          layerNode,
          ...Array.from(layerNode.querySelectorAll("*")).filter(
            (candidate) => !isInsideForeignLayer(candidate, layerNode)
          ),
        ];
        let best = null;
        let bestArea = 0;
        candidates.forEach((candidate) => {
          if (!(candidate instanceof Element)) return;
          let style = null;
          try {
            style = window.getComputedStyle(candidate);
          } catch (_error) {
            style = null;
          }
          if (!style) return;
          const clipPathId =
            extractUrlFragmentId(style.clipPath) ||
            extractUrlFragmentId(style.webkitClipPath) ||
            extractUrlFragmentId(candidate.getAttribute("style"));
          if (!clipPathId) return;
          const backgroundColor = String(style.backgroundColor || "").trim();
          if (isTransparentColor(backgroundColor)) return;
          const candidateRect = candidate.getBoundingClientRect();
          if (!isVisible(candidate, candidateRect)) return;
          const clippedRect = intersectRects(candidateRect, layerRect);
          const area = Math.max(1, rectArea(clippedRect || candidateRect));
          if (area > bestArea) {
            best = {
              candidate,
              rect: candidateRect,
              clipPathId,
              backgroundColor,
              opacity: Math.max(0, Math.min(1, Number.parseFloat(style.opacity || "1") || 1)),
            };
            bestArea = area;
          }
        });
        return best;
      };

      const serializeClipPathShapeToDataUrl = (
        layerNode,
        clipPathShapeCandidate,
        targetWidth,
        targetHeight
      ) => {
        if (!layerNode || !clipPathShapeCandidate?.clipPathId) return "";
        try {
          const clipPathElement = Array.from(layerNode.querySelectorAll("clipPath")).find(
            (candidate) => String(candidate.id || "").trim() === clipPathShapeCandidate.clipPathId
          );
          if (!(clipPathElement instanceof Element)) return "";
          const shapeElements = Array.from(
            clipPathElement.querySelectorAll(
              "path,rect,circle,ellipse,line,polyline,polygon"
            )
          );
          if (shapeElements.length === 0) return "";

          const clipBounds =
            typeof clipPathElement.getBBox === "function"
              ? clipPathElement.getBBox()
              : shapeElements[0].getBBox?.();
          if (!clipBounds || clipBounds.width <= 0 || clipBounds.height <= 0) return "";

          const layerRect = layerNode.getBoundingClientRect();
          const candidateRect = clipPathShapeCandidate.rect;
          const width = Math.max(1, Math.round(targetWidth || layerRect.width || candidateRect.width || 1));
          const height = Math.max(1, Math.round(targetHeight || layerRect.height || candidateRect.height || 1));
          const scaleX = candidateRect.width / Math.max(1, clipBounds.width);
          const scaleY = candidateRect.height / Math.max(1, clipBounds.height);
          const translateX =
            candidateRect.left - layerRect.left - clipBounds.x * scaleX;
          const translateY =
            candidateRect.top - layerRect.top - clipBounds.y * scaleY;
          const serializer = new XMLSerializer();
          const serializedShapes = shapeElements
            .map((shapeElement) => {
              const clone = shapeElement.cloneNode(true);
              copyComputedSvgStyles(shapeElement, clone);
              if (clone instanceof Element) {
                clone.removeAttribute("clip-path");
                clone.removeAttribute("fill");
                clone.style.removeProperty("clip-path");
                clone.style.removeProperty("fill");
                clone.style.removeProperty("fill-opacity");
                clone.removeAttribute("stroke");
                clone.style.removeProperty("stroke");
                clone.style.removeProperty("stroke-opacity");
                clone.style.removeProperty("stroke-width");
                clone.removeAttribute("opacity");
                clone.style.removeProperty("opacity");
              }
              return serializer.serializeToString(clone);
            })
            .join("");
          if (!serializedShapes) return "";

          const svgMarkup = [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`,
            `<g fill="${clipPathShapeCandidate.backgroundColor}" opacity="${clipPathShapeCandidate.opacity}" transform="translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})">`,
            serializedShapes,
            "</g>",
            "</svg>",
          ].join("");
          return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
        } catch (_error) {
          return "";
        }
      };

      const extractShapeImageDataUrl = (layerNode, targetWidth, targetHeight, options = {}) => {
        if (!layerNode) return "";

        const clipPathShapeCandidate = findBestClipPathShapeCandidate(layerNode);
        if (clipPathShapeCandidate) {
          const clipPathDataUrl = serializeClipPathShapeToDataUrl(
            layerNode,
            clipPathShapeCandidate,
            targetWidth,
            targetHeight
          );
          if (clipPathDataUrl.startsWith("data:image/")) {
            return clipPathDataUrl;
          }
        }

        const svgCandidate = findBestSvgRenderCandidate(layerNode);
        if (svgCandidate) {
          const svgDataUrl = serializeSvgElementToDataUrl(svgCandidate, targetWidth, targetHeight, options);
          if (svgDataUrl.startsWith("data:image/")) {
            return svgDataUrl;
          }
        }

        const canvasCandidates = [
          ...(String(layerNode.tagName || "").toLowerCase() === "canvas" ? [layerNode] : []),
          ...Array.from(layerNode.querySelectorAll("canvas")).filter(
            (candidate) => !isInsideForeignLayer(candidate, layerNode)
          ),
        ];
        let bestCanvas = null;
        let bestCanvasArea = 0;
        canvasCandidates.forEach((candidate) => {
          const rect = candidate.getBoundingClientRect();
          if (!isVisible(candidate, rect)) return;
          const area = Math.max(1, rect.width * rect.height);
          if (area > bestCanvasArea) {
            bestCanvas = candidate;
            bestCanvasArea = area;
          }
        });

        if (bestCanvas && typeof bestCanvas.toDataURL === "function") {
          try {
            const canvasDataUrl = bestCanvas.toDataURL("image/png");
            if (String(canvasDataUrl).startsWith("data:image/")) {
              return canvasDataUrl;
            }
          } catch (_error) {
            return "";
          }
        }

        return "";
      };

      const blobUrlToDataUrl = async (blobUrl, maxBytes = 8_000_000) => {
        if (!String(blobUrl || "").startsWith("blob:")) return "";
        try {
          const response = await fetch(blobUrl);
          if (!response.ok) return "";
          const blob = await response.blob();
          if (!blob || blob.size <= 0 || blob.size > maxBytes) return "";
          return await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              resolve(typeof reader.result === "string" ? reader.result : "");
            };
            reader.onerror = () => resolve("");
            reader.readAsDataURL(blob);
          });
        } catch (_error) {
          return "";
        }
      };

      let bestPage = null;
      const pageNodes = Array.from(document.querySelectorAll("[data-page-id]"));
      pageNodes.forEach((page) => {
        const rect = page.getBoundingClientRect();
        if (!isVisible(page, rect)) return;

        let designWidth = 0;
        let designHeight = 0;

        const scaleRoot = page.querySelector('div[style*="transform: scale"]');
        if (scaleRoot) {
          const styleText = scaleRoot.getAttribute("style") || "";
          designWidth = parseStyleDimension(styleText, "width");
          designHeight = parseStyleDimension(styleText, "height");
        }

        if (!designWidth || !designHeight) {
          const pageStyleText = page.getAttribute("style") || "";
          designWidth = parseStyleDimension(pageStyleText, "width") || parsePx(page.style.width) || rect.width;
          designHeight = parseStyleDimension(pageStyleText, "height") || parsePx(page.style.height) || rect.height;
        }

        const score = scoreRect(rect);
        if (!bestPage || score > bestPage.score) {
          bestPage = {
            node: page,
            score,
            rect: {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
            },
            designWidth: Math.max(1, Math.round(designWidth)),
            designHeight: Math.max(1, Math.round(designHeight)),
          };
        }
      });

      let bestCanvas = null;
      const canvases = Array.from(document.querySelectorAll("canvas"));
      canvases.forEach((canvas) => {
        const rect = canvas.getBoundingClientRect();
        if (!isVisible(canvas, rect)) return;
        if (rect.width < 220 || rect.height < 220) return;

        const score = scoreRect(rect);
        if (!bestCanvas || score > bestCanvas.score) {
          bestCanvas = {
            score,
            node: canvas,
            rect: {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
            },
          };
        }
      });

      const selectedCanvas = bestPage ? null : bestCanvas;

      let directDataUrl = "";
      let designWidth = 0;
      let designHeight = 0;
      let rect = null;

      if (selectedCanvas) {
        rect = selectedCanvas.rect;
        designWidth = Number(selectedCanvas.node.width || 0);
        designHeight = Number(selectedCanvas.node.height || 0);
        try {
          directDataUrl = selectedCanvas.node.toDataURL("image/png");
        } catch (_error) {
          directDataUrl = "";
        }
      } else if (bestPage) {
        rect = bestPage.rect;
        designWidth = bestPage.designWidth;
        designHeight = bestPage.designHeight;
      } else if (bestCanvas) {
        rect = bestCanvas.rect;
        designWidth = Math.round(bestCanvas.rect.width);
        designHeight = Math.round(bestCanvas.rect.height);
      }

      if (!rect) {
        return {
          ok: false,
          error: "No visible Canva page frame was detected. Zoom/page view may be collapsed.",
        };
      }

      const layers = [];
      const documentFontAssets = collectDocumentFontAssets();
      const isDuplicateLayerEntry = (candidate) => {
        const tolerance = 1.5;
        return layers.some((existing) => {
          if (existing.kind !== candidate.kind) return false;
          const samePosition =
            Math.abs(Number(existing.x || 0) - Number(candidate.x || 0)) <= tolerance &&
            Math.abs(Number(existing.y || 0) - Number(candidate.y || 0)) <= tolerance &&
            Math.abs(Number(existing.width || 0) - Number(candidate.width || 0)) <= tolerance &&
            Math.abs(Number(existing.height || 0) - Number(candidate.height || 0)) <= tolerance &&
            Math.abs(Number(existing.angle || 0) - Number(candidate.angle || 0)) <= 0.8 &&
            Boolean(existing.flipX) === Boolean(candidate.flipX) &&
            Boolean(existing.flipY) === Boolean(candidate.flipY);
          if (!samePosition) return false;
          if (candidate.kind === "text") {
            return String(existing.text || "").trim() === String(candidate.text || "").trim();
          }
          if (candidate.kind === "image") {
            const a = String(existing.imageSrc || existing.imageDataUrl || "").trim();
            const b = String(candidate.imageSrc || candidate.imageDataUrl || "").trim();
            return Boolean(a && b && a === b);
          }
          return true;
        });
      };

      if (bestPage?.node) {
        const designScaleX = Math.max(0.0001, Number(designWidth || rect.width) / Math.max(Number(rect.width || 1), 1));
        const designScaleY = Math.max(0.0001, Number(designHeight || rect.height) / Math.max(Number(rect.height || 1), 1));

        let backgroundLayerNodes = [];
        const backgroundLayerMeta = new Map();
        const pageArea = Math.max(1, rect.width * rect.height);
        const backgroundCandidatePool = [
          ...Array.from(bestPage.node.querySelectorAll('[style*="touch-action"]')),
          ...Array.from(bestPage.node.querySelectorAll("div")),
        ];
        const backgroundLayerCandidates = backgroundCandidatePool.filter((node, index, list) => {
          if (!node || list.indexOf(node) !== index) return false;
          if (node === bestPage.node) return false;
          if (String(node?.id || "").startsWith("LB")) return false;
          if (node.closest('[id^="LB"]')) return false;
          const nodeRect = node.getBoundingClientRect();
          if (!isVisible(node, nodeRect)) return false;
          const intersection = intersectRects(nodeRect, {
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          });
          if (!intersection) return false;
          const visibleArea = rectArea(intersection);
          const pageCoverage = visibleArea / pageArea;
          const assetKey = getNodeVisualAssetKey(node);
          const hasImageElement = Boolean(assetKey);
          const hasBackgroundPaint = hasVisibleBackgroundPaint(node);
          const hasLayerDescendants = Boolean(node.querySelector('[id^="LB"]'));
          if (hasLayerDescendants && !hasImageElement && !hasBackgroundPaint) return false;
          if (!hasImageElement && !hasBackgroundPaint) return false;
          return pageCoverage >= 0.18;
        });
        const scoredBackgroundCandidates = [];
        backgroundLayerCandidates.forEach((candidate) => {
          const candidateRect = candidate.getBoundingClientRect();
          const intersection = intersectRects(candidateRect, {
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          });
          const visibleArea = rectArea(intersection || candidateRect);
          const coverage = visibleArea / pageArea;
          const assetKey = getNodeVisualAssetKey(candidate);
          const hasImageElement = Boolean(assetKey);
          const hasBackgroundPaint = hasVisibleBackgroundPaint(candidate);
          const score =
            coverage * 100 +
            visibleArea / pageArea +
            (hasImageElement ? 0.5 : 0) +
            (hasBackgroundPaint ? 0.5 : 0);
          scoredBackgroundCandidates.push({
            node: candidate,
            score,
            coverage,
            assetKey,
          });
        });
        scoredBackgroundCandidates.sort((a, b) => b.score - a.score);
        const selectedBackgroundCandidates = [];
        for (let index = 0; index < scoredBackgroundCandidates.length; index += 1) {
          const candidate = scoredBackgroundCandidates[index];
          const overlapsExisting = selectedBackgroundCandidates.some(
            (existing) => {
              const overlaps =
                existing.node === candidate.node ||
                existing.node.contains(candidate.node) ||
                candidate.node.contains(existing.node);
              if (!overlaps) return false;
              const sameAsset =
                Boolean(existing.assetKey && candidate.assetKey) &&
                existing.assetKey === candidate.assetKey;
              const uncertainAsset = !existing.assetKey || !candidate.assetKey;
              return sameAsset || uncertainAsset;
            }
          );
          if (overlapsExisting) continue;
          selectedBackgroundCandidates.push(candidate);
          if (selectedBackgroundCandidates.length >= 3) break;
        }
        selectedBackgroundCandidates.forEach((candidate) => {
          backgroundLayerMeta.set(candidate.node, candidate);
        });
        backgroundLayerNodes = selectedBackgroundCandidates.map((candidate) => candidate.node);

        const scopedLayerNodes = Array.from(bestPage.node.querySelectorAll('[id^="LB"]'));
        const fallbackLayerNodes =
          scopedLayerNodes.length > 0
            ? []
            : Array.from(document.querySelectorAll('[id^="LB"]'));
        const uniqueLayerNodes = [...scopedLayerNodes, ...fallbackLayerNodes].filter(
          (node, index, all) =>
            node?.id &&
            all.findIndex((candidate) => candidate.id === node.id) === index &&
            !backgroundLayerMeta.has(node)
        );
        const layerNodes = [
          ...backgroundLayerNodes,
          ...uniqueLayerNodes,
        ];

        const imageMetadataCandidates = [];

        for (let layerIndex = 0; layerIndex < layerNodes.length; layerIndex += 1) {
          const node = layerNodes[layerIndex];
          const styleText = node.getAttribute("style") || "";
          const styleTransform = parseStyleTransform(styleText);
          const computedNodeStyle = window.getComputedStyle(node);
          const transform = parseComputedTransform(computedNodeStyle.transform || styleText);
          const backgroundMeta = backgroundLayerMeta.get(node) || null;
          const isBackgroundNode = Boolean(backgroundMeta);
          const isFullPageBackground = Boolean(backgroundMeta && backgroundMeta.coverage >= 0.9);
          const viewportInfo = isFullPageBackground
            ? {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                rawRect: {
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                  right: rect.x + rect.width,
                  bottom: rect.y + rect.height,
                },
                rawArea: rect.width * rect.height,
                visibleArea: rect.width * rect.height,
                coverage: 1,
              }
            : getTransformedViewportRect(node, rect);
          if (!viewportInfo) continue;

          const viewportRect = {
            x: viewportInfo.x,
            y: viewportInfo.y,
            width: viewportInfo.width,
            height: viewportInfo.height,
          };
          const minLayerSide = Math.max(14, Math.min(rect.width, rect.height) * 0.012);
          const minLayerArea = Math.max(320, rect.width * rect.height * 0.00035);
          const textPreview = getScopedTextPreview(node);
          const hasTextPreview = textPreview.length >= 2;
          const hasVectorSignal = hasRenderableVectorSignal(node);
          const minTextLayerSide = Math.max(4, Math.min(rect.width, rect.height) * 0.004);
          const minTextLayerArea = Math.max(16, rect.width * rect.height * 0.00001);
          const minVectorLayerSide = Math.max(1, Math.min(rect.width, rect.height) * 0.0012);
          const minVectorLayerArea = Math.max(4, rect.width * rect.height * 0.000003);
          const viewportArea = viewportRect.width * viewportRect.height;
          const isLargeEnough = viewportRect.width >= minLayerSide && viewportRect.height >= minLayerSide;
          const hasEnoughArea = viewportArea >= minLayerArea;
          const isTextLayerLargeEnough =
            viewportRect.width >= minTextLayerSide && viewportRect.height >= minTextLayerSide;
          const hasEnoughTextArea = viewportArea >= minTextLayerArea;
          const isVectorLayerLargeEnough =
            viewportRect.width >= minVectorLayerSide && viewportRect.height >= 1.5;
          const hasEnoughVectorArea = viewportArea >= minVectorLayerArea;
          const isInsidePageFrame = viewportInfo.coverage >= 0.2;
          const passesDefaultSizeGate = isLargeEnough && hasEnoughArea;
          const passesSmallTextGate =
            hasTextPreview && isTextLayerLargeEnough && hasEnoughTextArea;
          const passesThinVectorGate =
            hasVectorSignal && isVectorLayerLargeEnough && hasEnoughVectorArea;
          if (
            !isBackgroundNode &&
            (!isInsidePageFrame || (!passesDefaultSizeGate && !passesSmallTextGate && !passesThinVectorGate))
          ) {
            continue;
          }

          const styleWidth = parseStyleDimension(styleText, "width");
          const styleHeight = parseStyleDimension(styleText, "height");
          const hasStyleGeometry = styleWidth >= 2 && styleHeight >= 2;
          const imageElements = getScopedImageElements(node);
          const imageElement =
            imageElements
              .map((element) => ({ element, rect: element.getBoundingClientRect() }))
              .sort((a, b) => rectArea(b.rect) - rectArea(a.rect))[0]?.element || null;
          const imageTitleHint = getImageElementTitleHint(imageElement);
          const shouldUseVisibleGeometry =
            !isBackgroundNode &&
            Boolean(imageElement) &&
            detectMaskedImageLayer(node, imageElement, viewportRect);
          const rawRect = shouldUseVisibleGeometry
            ? viewportRect
            : viewportInfo.rawRect || viewportRect;
          const nodeScale = getCompositeScaleToAncestor(node, bestPage.node);
          const layerScaleX = Math.max(0.01, Number(transform.scaleX || 1));
          const layerScaleY = Math.max(0.01, Number(transform.scaleY || 1));
          const rawDesignWidth = Math.max(1, rawRect.width * designScaleX);
          const rawDesignHeight = Math.max(1, rawRect.height * designScaleY);
          const centerDesignX =
            (rawRect.x - rect.x + rawRect.width / 2) * designScaleX;
          const centerDesignY =
            (rawRect.y - rect.y + rawRect.height / 2) * designScaleY;
          const styledWidth = hasStyleGeometry
            ? Math.max(1, styleWidth * nodeScale.x * layerScaleX)
            : 0;
          const styledHeight = hasStyleGeometry
            ? Math.max(1, styleHeight * nodeScale.y * layerScaleY)
            : 0;
          const styleWidthRatio = styledWidth > 0 ? styledWidth / rawDesignWidth : 0;
          const styleHeightRatio = styledHeight > 0 ? styledHeight / rawDesignHeight : 0;
          const styleGeometryMatchesViewport =
            hasStyleGeometry &&
            styleWidthRatio >= 0.8 &&
            styleWidthRatio <= 1.25 &&
            styleHeightRatio >= 0.8 &&
            styleHeightRatio <= 1.25;
          const width = isFullPageBackground
            ? Math.max(1, Number(designWidth || rect.width))
            : styleGeometryMatchesViewport
              ? styledWidth
              : rawDesignWidth;
          const height = isFullPageBackground
            ? Math.max(1, Number(designHeight || rect.height))
            : styleGeometryMatchesViewport
              ? styledHeight
              : rawDesignHeight;
          const x = isFullPageBackground ? 0 : centerDesignX - width / 2;
          const y = isFullPageBackground ? 0 : centerDesignY - height / 2;
          const layerAngle = isFullPageBackground
            ? 0
            : transform.hasReflection
              ? transform.angle
              : styleTransform.hasAngle
                ? styleTransform.angle
                : transform.angle;
          const layerFlipX = isFullPageBackground ? false : Boolean(transform.flipX);
          const layerFlipY = isFullPageBackground ? false : Boolean(transform.flipY);
          if (width < 2 || height < 2) continue;

          const textFromParagraphs = Array.from(node.querySelectorAll("p"))
            .filter((item) => !isInsideForeignLayer(item, node))
            .map((item) => item.innerText || "")
            .filter(Boolean)
            .join("\n");
          const text = dedupeTextLines(textFromParagraphs || textPreview);

          const textStyleElement = findBestTextStyleElement(node, node);

          let shapeFill = "";
          let shapeImageDataUrl = "";
          let thinVectorStrokeStyle = { color: "", strokeOnly: false };
          if (!imageElement) {
            const shapeCandidates = [
              node,
              ...Array.from(node.querySelectorAll("*")).filter(
                (candidate) => !isInsideForeignLayer(candidate, node)
              ),
            ];
            for (let index = 0; index < shapeCandidates.length; index += 1) {
              const candidate = shapeCandidates[index];
              const style = window.getComputedStyle(candidate);
              const backgroundColor = style.backgroundColor;
              if (
                backgroundColor &&
                backgroundColor !== "rgba(0, 0, 0, 0)" &&
                backgroundColor !== "transparent"
              ) {
                shapeFill = backgroundColor;
                break;
              }
            }
            thinVectorStrokeStyle = resolveThinVectorStrokeStyle(node);
            shapeImageDataUrl = extractShapeImageDataUrl(node, width, height, {
              excludeTextNodes: Boolean(text),
            });
            const shouldRasterizeThinVectorShape =
              shapeImageDataUrl.startsWith("data:image/svg+xml") &&
              hasVectorSignal &&
              (Math.max(1, Math.round(width)) <= 24 ||
                Math.max(1, Math.round(height)) <= 16 ||
                viewportRect.height <= 8);
            if (shouldRasterizeThinVectorShape) {
              const rasterizedShapeImageDataUrl = await rasterizeDataUrlWithCanvas(
                shapeImageDataUrl,
                Math.max(1, Math.round(width)),
                Math.max(1, Math.round(height))
              );
              if (rasterizedShapeImageDataUrl.startsWith("data:image/")) {
                shapeImageDataUrl = rasterizedShapeImageDataUrl;
              }
            }
          }

          const effectiveOpacity = getEffectiveOpacity(node, bestPage.node);
          const zIndex = getNumericZIndex(node, bestPage.node);
          let imageSrc = "";
          let imageDataUrl = "";
          let preferSnapshot = false;
          const backgroundImageSignals = [];
          if (shapeImageDataUrl.startsWith("data:image/")) {
            imageSrc = shapeImageDataUrl;
            imageDataUrl = shapeImageDataUrl;
          }
          if (imageElement) {
            imageSrc = getImageElementSource(imageElement);
            if (String(imageSrc).startsWith("data:image/")) {
              imageDataUrl = imageSrc;
            }
            if (String(imageSrc).startsWith("blob:")) {
              imageDataUrl = await blobUrlToDataUrl(imageSrc);
              if (imageDataUrl) {
                imageSrc = imageDataUrl;
              }
            }
            if (!imageDataUrl) {
              imageDataUrl = renderElementToDataUrl(imageElement, width, height);
              if (imageDataUrl && (!imageSrc || String(imageSrc).startsWith("blob:"))) {
                imageSrc = imageDataUrl;
              }
            }
            if (!imageDataUrl && /^https?:\/\//i.test(String(imageSrc || ""))) {
              const fetchedImageDataUrl = await readRemoteImageAssetAsDataUrl(imageSrc);
              if (fetchedImageDataUrl) {
                imageDataUrl = fetchedImageDataUrl;
                imageSrc = fetchedImageDataUrl;
              }
            }
          }

          if (!imageSrc) {
            const backgroundCandidates = [
              node,
              ...Array.from(node.querySelectorAll("*")).filter(
                (candidate) => !isInsideForeignLayer(candidate, node)
              ),
            ];
            for (let index = 0; index < backgroundCandidates.length; index += 1) {
              const candidate = backgroundCandidates[index];
              const inlineStyle = candidate.getAttribute("style") || "";
              const inlineBackgroundImage = parseBackgroundImageUrl(inlineStyle);
              if (inlineBackgroundImage) {
                backgroundImageSignals.push(inlineBackgroundImage);
                imageSrc = inlineBackgroundImage;
                break;
              }
              const computedBackgroundImage = findCssImageUrl(candidate);
              if (computedBackgroundImage) {
                backgroundImageSignals.push(computedBackgroundImage);
                imageSrc = computedBackgroundImage;
                break;
              }
            }
            if (!imageDataUrl && /^https?:\/\//i.test(String(imageSrc || ""))) {
              const fetchedImageDataUrl = await readRemoteImageAssetAsDataUrl(imageSrc);
              if (fetchedImageDataUrl) {
                imageDataUrl = fetchedImageDataUrl;
                imageSrc = fetchedImageDataUrl;
              }
            }
          }

          if (imageElement && (imageSrc || imageDataUrl)) {
            preferSnapshot =
              shouldUseVisibleGeometry || shouldPreferRenderedImageSnapshot(node, imageElement);
          }
          if (
            !preferSnapshot &&
            shapeImageDataUrl.startsWith("data:image/") &&
            hasVectorSignal &&
            (Math.max(1, Math.round(width)) <= 8 || Math.max(1, Math.round(height)) <= 8)
          ) {
            preferSnapshot = true;
          }

          const textStyle = textStyleElement ? window.getComputedStyle(textStyleElement) : null;
          const textFontSize = Number.parseFloat(textStyle?.fontSize || "") || 0;
          const textScale = textStyleElement ? getCompositeScaleToAncestor(textStyleElement, node) : { x: 1, y: 1 };
          const customFontSize = textStyleElement ? findCustomFontSizeFromNode(textStyleElement, node) : 0;
          const resolvedFontFamily = normalizeFontFamilyName(textStyle?.fontFamily || "Arial") || "Arial";
          const resolvedFontSize = Math.max(
            8,
            (customFontSize > 0 ? customFontSize : textFontSize > 0 ? textFontSize : 28) * textScale.y
          );
          const textLineHeightRaw = Number.parseFloat(textStyle?.lineHeight || "");
          const textLineHeight =
            textLineHeightRaw && textFontSize > 0 ? textLineHeightRaw / textFontSize : 1.2;
          const textLetterSpacing = parseNumericPx(textStyle?.letterSpacing || "");
          const textDecoration = String(
            textStyle?.textDecorationLine || textStyle?.textDecoration || ""
          ).toLowerCase();
          const textBackgroundStyle = textStyleElement
            ? resolveTextBackgroundStyle(textStyleElement, node)
            : { color: "", radius: 0 };
          const textBackgroundColor = textBackgroundStyle.color;
          const textBackgroundRadius = textBackgroundStyle.radius;

          const mediaWidth = Number(imageElement?.naturalWidth || imageElement?.width?.baseVal?.value || 0);
          const mediaHeight = Number(imageElement?.naturalHeight || imageElement?.height?.baseVal?.value || 0);
          const hasMediaDimensions = mediaWidth >= 12 && mediaHeight >= 12;
          const hasImageSignal = Boolean(imageElement || imageSrc || imageDataUrl || backgroundImageSignals.length);
          const zIndexSignal = zIndex === null || zIndex >= -10;
          const opacitySignal = effectiveOpacity > 0.03;
          let imageConfidence = 0;
          if (imageElement) imageConfidence += 3;
          if (shapeImageDataUrl) imageConfidence += 4;
          if (imageSrc) imageConfidence += 2;
          if (imageDataUrl) imageConfidence += 2;
          if (hasMediaDimensions) imageConfidence += 1;
          if (isLargeEnough && hasEnoughArea) imageConfidence += 1;
          if (isInsidePageFrame) imageConfidence += 1;
          if (opacitySignal) imageConfidence += 1;
          if (zIndexSignal) imageConfidence += 1;

          const isLikelyImageLayer =
            hasImageSignal &&
            isLargeEnough &&
            hasEnoughArea &&
            isInsidePageFrame &&
            opacitySignal &&
            imageConfidence >= 5;
          const roundedWidth = Math.max(1, Math.round(width));
          const roundedHeight = Math.max(1, Math.round(height));
          const vectorAspectRatio =
            Math.max(roundedWidth, roundedHeight) / Math.max(1, Math.min(roundedWidth, roundedHeight));
          const isThinVectorDividerLayer =
            !imageElement &&
            !text &&
            hasVectorSignal &&
            thinVectorStrokeStyle.strokeOnly &&
            Boolean(thinVectorStrokeStyle.color) &&
            vectorAspectRatio >= 12 &&
            (roundedWidth <= 8 ||
              roundedHeight <= 8 ||
              viewportRect.width <= 8 ||
              viewportRect.height <= 8);

          const kind = isThinVectorDividerLayer
            ? "shape"
            : shapeImageDataUrl
            ? "image"
            : isLikelyImageLayer
              ? "image"
              : text
                ? "text"
                : shapeFill
                  ? "shape"
                  : "unknown";
          if (kind === "unknown") continue;
          const parentLayerNode = node.parentElement?.closest?.('[id^="LB"]');
          const parentId =
            parentLayerNode && parentLayerNode !== node
              ? String(parentLayerNode.id || "").trim()
              : "";
          const fallbackReason =
            kind === "image" && preferSnapshot
              ? "masked-or-clipped"
              : kind === "image" && !imageSrc && !imageDataUrl
                ? "unresolved-image-source"
                : "";

          const normalizedLayerAngle = isThinVectorDividerLayer ? 0 : layerAngle;
          const normalizedLayerFlipX = isThinVectorDividerLayer ? false : layerFlipX;
          const normalizedLayerFlipY = isThinVectorDividerLayer ? false : layerFlipY;

          const layerRecord = {
            id: String(node.id || `layer-${layerIndex + 1}`),
            parentId: parentId || null,
            name:
              String(node.getAttribute?.("aria-label") || "").trim() ||
              String(node.getAttribute?.("data-element-name") || "").trim() ||
              imageTitleHint ||
              `${kind === "text" ? "Text" : shapeImageDataUrl ? "Shape" : kind === "shape" ? "Shape" : "Image"} ${layerIndex + 1}`,
            kind,
            x,
            y,
            width: roundedWidth,
            height: roundedHeight,
            angle: normalizedLayerAngle,
            flipX: normalizedLayerFlipX,
            flipY: normalizedLayerFlipY,
            viewportRect: {
              x: viewportRect.x,
              y: viewportRect.y,
              width: viewportRect.width,
              height: viewportRect.height,
            },
            pageRelativeRect: {
              x,
              y,
              width: roundedWidth,
              height: roundedHeight,
            },
            imageSrc,
            imageDataUrl,
            preferSnapshot,
            sourceWidth:
              mediaWidth > 0 ? mediaWidth : shapeImageDataUrl ? Math.max(1, Math.round(width)) : undefined,
            sourceHeight:
              mediaHeight > 0 ? mediaHeight : shapeImageDataUrl ? Math.max(1, Math.round(height)) : undefined,
            text: kind === "text" ? text : "",
            textAlign: textStyle?.textAlign || "left",
            color: textStyle?.color || "#111827",
            fontFamily: resolvedFontFamily,
            fontSize: resolvedFontSize,
            fontStyle: textStyle?.fontStyle || "normal",
            fontWeight: parseFontWeight(textStyle?.fontWeight),
            lineHeight: Math.max(0.8, textLineHeight || 1.2),
            letterSpacing: textLetterSpacing,
            textDecoration,
            textBackgroundColor,
            textBackgroundRadius,
            fill: isThinVectorDividerLayer ? thinVectorStrokeStyle.color : shapeFill || "",
            zIndex: zIndex ?? layerIndex,
            opacity: effectiveOpacity,
            titleEn: kind === "image" ? imageTitleHint : "",
            tagsEn:
              kind === "image" && imageTitleHint
                ? uniqueMetadataStrings(tokenizeMetadataLabel(imageTitleHint))
                : [],
            labelsEn:
              kind === "image" && imageTitleHint
                ? uniqueMetadataStrings([imageTitleHint, ...tokenizeMetadataLabel(imageTitleHint)])
                : [],
            fallback: Boolean(fallbackReason),
            fallbackReason,
          };
          let companionTextRecord = null;
          if (kind === "image" && text && textStyleElement) {
            const textViewportInfo = getTransformedViewportRect(textStyleElement, rect);
            if (textViewportInfo) {
              const textViewportRect = {
                x: textViewportInfo.x,
                y: textViewportInfo.y,
                width: textViewportInfo.width,
                height: textViewportInfo.height,
              };
              const textWidth = Math.max(1, Math.round(textViewportRect.width * designScaleX));
              const textHeight = Math.max(1, Math.round(textViewportRect.height * designScaleY));
              const textX = (textViewportRect.x - rect.x) * designScaleX;
              const textY = (textViewportRect.y - rect.y) * designScaleY;
              companionTextRecord = {
                id: `${String(node.id || `layer-${layerIndex + 1}`)}__text`,
                parentId: String(node.id || "").trim() || null,
                name: `${String(layerRecord.name || `Layer ${layerIndex + 1}`)} Text`,
                kind: "text",
                x: textX,
                y: textY,
                width: textWidth,
                height: textHeight,
                angle: 0,
                flipX: false,
                flipY: false,
                viewportRect: textViewportRect,
                pageRelativeRect: {
                  x: textX,
                  y: textY,
                  width: textWidth,
                  height: textHeight,
                },
                imageSrc: "",
                imageDataUrl: "",
                preferSnapshot: false,
                sourceWidth: undefined,
                sourceHeight: undefined,
                text,
                textAlign: textStyle?.textAlign || "left",
                color: textStyle?.color || "#111827",
                fontFamily: resolvedFontFamily,
                fontSize: resolvedFontSize,
                fontStyle: textStyle?.fontStyle || "normal",
                fontWeight: parseFontWeight(textStyle?.fontWeight),
                lineHeight: Math.max(0.8, textLineHeight || 1.2),
                letterSpacing: textLetterSpacing,
                textDecoration,
                textBackgroundColor: "",
                textBackgroundRadius: 0,
                fill: "",
                zIndex: (zIndex ?? layerIndex) + 0.25,
                opacity: effectiveOpacity,
                titleEn: "",
                tagsEn: [],
                labelsEn: [],
                fallback: false,
                fallbackReason: "",
              };
            }
          }
          if (kind === "image") {
            imageMetadataCandidates.push({
              id: layerRecord.id,
              node,
              kind,
              name: layerRecord.name,
              width: layerRecord.width,
              height: layerRecord.height,
              fallback: layerRecord.fallback,
              isBackgroundNode,
              isFullPageBackground,
            });
          }
          if (!isDuplicateLayerEntry(layerRecord)) {
            layers.push(layerRecord);
          }
          if (companionTextRecord && !isDuplicateLayerEntry(companionTextRecord)) {
            layers.push(companionTextRecord);
          }
        }

        const imageMetadataById = shouldCollectLayerMetadata
          ? await collectCanvaLayerMetadata(
              imageMetadataCandidates,
              Number(designWidth || rect.width),
              Number(designHeight || rect.height)
            )
          : new Map();
        if (imageMetadataById.size > 0) {
          for (let index = 0; index < layers.length; index += 1) {
            const layer = layers[index];
            if (String(layer?.kind || "").toLowerCase() !== "image") continue;
            const metadata = imageMetadataById.get(String(layer.id || ""));
            if (!metadata) continue;
            layer.titleEn = sanitizeMetadataText(metadata.titleEn || layer.name || "");
            layer.tagsEn = uniqueMetadataStrings(metadata.tagsEn);
            layer.labelsEn = uniqueMetadataStrings(
              metadata.labelsEn && metadata.labelsEn.length > 0
                ? metadata.labelsEn
                : [layer.titleEn, ...layer.tagsEn, ...tokenizeMetadataLabel(layer.titleEn)]
            );
            layer.sourceAssetId =
              sanitizeMetadataText(layer.sourceAssetId || layer.imageSrc || layer.imageDataUrl || layer.id);
          }
        }

        if (layers.length <= 1) {
          const pageBounds = {
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          };
          const pageArea = Math.max(1, rect.width * rect.height);
          const minTextArea = Math.max(120, pageArea * 0.0002);
          const minImageArea = Math.max(200, pageArea * 0.0003);
          const maxFallbackLayers = 60;
          const fallbackCandidates = [];
          const seenTextKeys = new Set();

          const toLayerFromViewportRect = (rawRect) => {
            const clipped = intersectRects(rawRect, pageBounds);
            if (!clipped) return null;
            const width = Math.max(1, clipped.width * designScaleX);
            const height = Math.max(1, clipped.height * designScaleY);
            const x = (clipped.x - rect.x) * designScaleX;
            const y = (clipped.y - rect.y) * designScaleY;
            return {
              x,
              y,
              width,
              height,
              viewportRect: {
                x: clipped.x,
                y: clipped.y,
                width: clipped.width,
                height: clipped.height,
              },
            };
          };

          const textNodes = Array.from(bestPage.node.querySelectorAll("p,span,div"));
          for (let index = 0; index < textNodes.length; index += 1) {
            const node = textNodes[index];
            if (!node) continue;
            const text = dedupeTextLines(node.innerText || "");
            if (!text || text.length < 2) continue;
            const nodeRect = node.getBoundingClientRect();
            const layerRect = toLayerFromViewportRect(nodeRect);
            if (!layerRect) continue;
            const area = Math.max(1, layerRect.width * layerRect.height);
            if (area < minTextArea) continue;

            const textStyle = window.getComputedStyle(node);
            const fontFamily = normalizeFontFamilyName(textStyle.fontFamily || "Arial") || "Arial";
            const textScale = getCompositeScaleToAncestor(node, bestPage.node);
            const textFontSize = Number.parseFloat(textStyle.fontSize || "") || 0;
            const resolvedFontSize = Math.max(8, (textFontSize || 24) * Math.max(0.01, textScale.y));
            const textLineHeightRaw = Number.parseFloat(textStyle.lineHeight || "");
            const textLineHeight =
              textLineHeightRaw && textFontSize > 0 ? textLineHeightRaw / textFontSize : 1.2;
            const textLetterSpacing = parseNumericPx(textStyle.letterSpacing || "");
            const textDecoration = String(
              textStyle.textDecorationLine || textStyle.textDecoration || ""
            ).toLowerCase();
            const textBackgroundStyle = resolveTextBackgroundStyle(node, node);
            const textBackgroundColor = textBackgroundStyle.color;
            const textBackgroundRadius = textBackgroundStyle.radius;
            const opacity = getEffectiveOpacity(node, bestPage.node);
            if (opacity <= 0.03) continue;

            const textKey = `${text.toLowerCase()}|${Math.round(layerRect.x)}|${Math.round(
              layerRect.y
            )}|${Math.round(layerRect.width)}|${Math.round(layerRect.height)}`;
            if (seenTextKeys.has(textKey)) continue;
            seenTextKeys.add(textKey);

            const textRecord = {
              id: String(node.id || `fallback-text-${index + 1}`),
              parentId: null,
              name:
                String(node.getAttribute?.("aria-label") || "").trim() ||
                `Text ${fallbackCandidates.length + 1}`,
              kind: "text",
              x: layerRect.x,
              y: layerRect.y,
              width: Math.max(1, Math.round(layerRect.width)),
              height: Math.max(1, Math.round(layerRect.height)),
              angle: 0,
              flipX: false,
              flipY: false,
              viewportRect: layerRect.viewportRect,
              pageRelativeRect: {
                x: layerRect.x,
                y: layerRect.y,
                width: Math.max(1, Math.round(layerRect.width)),
                height: Math.max(1, Math.round(layerRect.height)),
              },
              imageSrc: "",
              imageDataUrl: "",
              preferSnapshot: false,
              sourceWidth: undefined,
              sourceHeight: undefined,
              text,
              textAlign: textStyle.textAlign || "left",
              color: textStyle.color || "#111827",
              fontFamily,
              fontSize: resolvedFontSize,
              fontStyle: textStyle.fontStyle || "normal",
              fontWeight: parseFontWeight(textStyle.fontWeight),
              lineHeight: Math.max(0.8, textLineHeight || 1.2),
              letterSpacing: textLetterSpacing,
              textDecoration,
              textBackgroundColor,
              textBackgroundRadius,
              fill: "",
              zIndex: getNumericZIndex(node, bestPage.node) ?? 1000 + index,
              opacity,
              fallback: false,
              fallbackReason: "",
            };
            if (!isDuplicateLayerEntry(textRecord)) {
              fallbackCandidates.push(textRecord);
            }
            if (fallbackCandidates.length >= maxFallbackLayers) break;
          }

          if (fallbackCandidates.length < maxFallbackLayers) {
            const mediaNodes = Array.from(bestPage.node.querySelectorAll("img,image,canvas,svg"));
            for (let index = 0; index < mediaNodes.length; index += 1) {
              const node = mediaNodes[index];
              if (!node) continue;

              const nodeRect = node.getBoundingClientRect();
              const layerRect = toLayerFromViewportRect(nodeRect);
              if (!layerRect) continue;
              const area = Math.max(1, layerRect.width * layerRect.height);
              if (area < minImageArea) continue;

              const tagName = String(node.tagName || "").toLowerCase();
              const imageTitleHint =
                tagName === "img" || tagName === "image"
                  ? getImageElementTitleHint(node)
                  : "";
              const isDecorativeFrame = looksLikeDecorativeFrameLabel(imageTitleHint);
              if (area > pageArea * 0.96 && layers.length > 0 && !isDecorativeFrame) continue;

              let imageSrc = "";
              if (tagName === "img" || tagName === "image") {
                imageSrc = getImageElementSource(node);
              } else if (tagName === "canvas") {
                try {
                  imageSrc = node.toDataURL("image/png");
                } catch (_error) {
                  imageSrc = "";
                }
              } else if (tagName === "svg") {
                if (hasRenderableSvgContent(node)) {
                  imageSrc = serializeSvgElementToDataUrl(
                    node,
                    Math.max(1, Math.round(layerRect.width)),
                    Math.max(1, Math.round(layerRect.height))
                  );
                }
              }
              if (!imageSrc) {
                imageSrc = findCssImageUrl(node);
              }

              let imageDataUrl = imageSrc.startsWith("data:image/") ? imageSrc : "";
              if (String(imageSrc).startsWith("blob:")) {
                const blobDataUrl = await blobUrlToDataUrl(imageSrc);
                if (blobDataUrl.startsWith("data:image/")) {
                  imageSrc = blobDataUrl;
                  imageDataUrl = blobDataUrl;
                }
              }
              if (!imageDataUrl && /^https?:\/\//i.test(String(imageSrc || ""))) {
                const fetchedImageDataUrl = await readRemoteImageAssetAsDataUrl(imageSrc);
                if (fetchedImageDataUrl.startsWith("data:image/")) {
                  imageSrc = fetchedImageDataUrl;
                  imageDataUrl = fetchedImageDataUrl;
                }
              }

              const opacity = getEffectiveOpacity(node, bestPage.node);
              if (opacity <= 0.03) continue;

              const fallbackReason = imageSrc ? "" : "unresolved-image-source";
              const imageRecord = {
                id: String(node.id || `fallback-image-${index + 1}`),
                parentId: null,
                name:
                  String(node.getAttribute?.("aria-label") || "").trim() ||
                  imageTitleHint ||
                  `Image ${fallbackCandidates.length + 1}`,
                kind: "image",
                x: layerRect.x,
                y: layerRect.y,
                width: Math.max(1, Math.round(layerRect.width)),
                height: Math.max(1, Math.round(layerRect.height)),
                angle: 0,
                flipX: false,
                flipY: false,
                viewportRect: layerRect.viewportRect,
                pageRelativeRect: {
                  x: layerRect.x,
                  y: layerRect.y,
                  width: Math.max(1, Math.round(layerRect.width)),
                  height: Math.max(1, Math.round(layerRect.height)),
                },
                imageSrc,
                imageDataUrl,
                preferSnapshot: !imageSrc,
                sourceWidth: Math.max(1, Math.round(layerRect.width)),
                sourceHeight: Math.max(1, Math.round(layerRect.height)),
                text: "",
                textAlign: "left",
                color: "#111827",
                fontFamily: "Arial",
                fontSize: 28,
                fontStyle: "normal",
                fontWeight: 400,
                lineHeight: 1.2,
                fill: "",
                zIndex: getNumericZIndex(node, bestPage.node) ?? 2000 + index,
                opacity,
                sourceAssetId: sanitizeMetadataText(imageSrc || node.id || ""),
                titleEn: imageTitleHint,
                tagsEn: imageTitleHint ? uniqueMetadataStrings(tokenizeMetadataLabel(imageTitleHint)) : [],
                labelsEn: imageTitleHint
                  ? uniqueMetadataStrings([imageTitleHint, ...tokenizeMetadataLabel(imageTitleHint)])
                  : [],
                fallback: Boolean(fallbackReason),
                fallbackReason,
              };
              if (!isDuplicateLayerEntry(imageRecord)) {
                fallbackCandidates.push(imageRecord);
              }
              if (fallbackCandidates.length >= maxFallbackLayers) break;
            }
          }

          fallbackCandidates
            .sort((a, b) => {
              const zA = Number.isFinite(Number(a?.zIndex)) ? Number(a.zIndex) : 0;
              const zB = Number.isFinite(Number(b?.zIndex)) ? Number(b.zIndex) : 0;
              if (zA !== zB) return zA - zB;
              const yA = Number.isFinite(Number(a?.y)) ? Number(a.y) : 0;
              const yB = Number.isFinite(Number(b?.y)) ? Number(b.y) : 0;
              return yA - yB;
            })
            .slice(0, maxFallbackLayers)
            .forEach((candidate) => {
              if (!isDuplicateLayerEntry(candidate)) {
                layers.push(candidate);
              }
            });
        }
      }

      const usedLayerFonts = Array.from(
        new Set(
          layers
            .filter((layer) => String(layer?.kind || "").toLowerCase() === "text")
            .map((layer) => normalizeFontFamilyName(layer?.fontFamily))
            .filter(Boolean)
        )
      );
      const resolvedFontAssets = await resolveFontAssetsForFamilies(
        documentFontAssets,
        usedLayerFonts
      );

      return {
        ok: true,
        title: document.title || "",
        sourceUrl: location.href,
        rect,
        devicePixelRatio: window.devicePixelRatio || 1,
        designWidth: Math.max(1, Math.round(designWidth || rect.width)),
        designHeight: Math.max(1, Math.round(designHeight || rect.height)),
        directDataUrl,
        sourceType: selectedCanvas ? "canvas" : "page-frame",
        layers,
        fontAssets: resolvedFontAssets,
      };
      },
    });
  } catch (error) {
    primaryError = String(error?.message || "Script injection failed.");
  }

  const primaryResult = Array.isArray(results)
    ? results.find((entry) => entry && typeof entry.result === "object")?.result
    : null;
  if (primaryResult && typeof primaryResult === "object") {
    return primaryResult;
  }

  try {
    const fallbackResult = await getBasicCaptureMetaFromTab(tabId);
    if (fallbackResult && typeof fallbackResult === "object") {
      return fallbackResult;
    }
  } catch (error) {
    if (!primaryError) {
      primaryError = String(error?.message || "Fallback capture failed.");
    }
  }

  return {
    ok: false,
    error: primaryError
      ? `Unable to read active tab canvas. ${primaryError}`
      : "Unable to read active tab canvas.",
  };
}

async function setCanvaLayerVisibility(tabId, layerIds, hidden) {
  const ids = Array.from(
    new Set(
      (Array.isArray(layerIds) ? layerIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
  if (!ids.length) return;
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (inputIds, shouldHide) => {
      inputIds.forEach((id) => {
        const node = document.getElementById(id);
        if (!node) return;
        if (shouldHide) {
          if (!node.dataset.codexPrevVisibility) {
            node.dataset.codexPrevVisibility = node.style.visibility || "";
          }
          if (!node.dataset.codexPrevOpacity) {
            node.dataset.codexPrevOpacity = node.style.opacity || "";
          }
          if (!node.dataset.codexPrevPointerEvents) {
            node.dataset.codexPrevPointerEvents = node.style.pointerEvents || "";
          }
          node.style.visibility = "hidden";
          node.style.opacity = "0";
          node.style.pointerEvents = "none";
          return;
        }
        const restoreVisibility = node.dataset.codexPrevVisibility;
        const restoreOpacity = node.dataset.codexPrevOpacity;
        const restorePointerEvents = node.dataset.codexPrevPointerEvents;
        if (restoreVisibility !== undefined) {
          if (restoreVisibility) node.style.visibility = restoreVisibility;
          else node.style.removeProperty("visibility");
          delete node.dataset.codexPrevVisibility;
        }
        if (restoreOpacity !== undefined) {
          if (restoreOpacity) node.style.opacity = restoreOpacity;
          else node.style.removeProperty("opacity");
          delete node.dataset.codexPrevOpacity;
        }
        if (restorePointerEvents !== undefined) {
          if (restorePointerEvents) node.style.pointerEvents = restorePointerEvents;
          else node.style.removeProperty("pointer-events");
          delete node.dataset.codexPrevPointerEvents;
        }
      });
    },
    args: [ids, Boolean(hidden)],
  });
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function resolveDashboardEndpointCandidates(endpoint) {
  const value = String(endpoint || "").trim();
  if (!value) return [];
  let parsed = null;
  try {
    parsed = new URL(value);
  } catch (_error) {
    return [value];
  }
  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1") {
    return [parsed.toString()];
  }
  const alternateHost = host === "localhost" ? "127.0.0.1" : "localhost";
  const alternate = new URL(parsed.toString());
  alternate.hostname = alternateHost;
  return uniqueStrings([parsed.toString(), alternate.toString()]);
}

function describeError(error) {
  if (!error) return "Unknown error";
  const name = String(error?.name || "").trim();
  const message = String(error?.message || "").trim();
  if (name && message) return `${name}: ${message}`;
  return message || name || String(error);
}

async function hasDashboardHostPermission(endpoint) {
  if (!chrome?.permissions?.contains) {
    return true;
  }
  let parsed = null;
  try {
    parsed = new URL(String(endpoint || ""));
  } catch (_error) {
    return true;
  }
  const originPattern = `${parsed.protocol}//${parsed.hostname}/*`;
  try {
    return await new Promise((resolve) => {
      chrome.permissions.contains({ origins: [originPattern] }, (granted) => {
        const runtimeError = chrome?.runtime?.lastError;
        if (runtimeError) {
          logger.warn("Could not verify host permission; continuing with fetch attempt", {
            endpoint,
            originPattern,
            runtimeError: String(runtimeError.message || runtimeError),
          });
          resolve(true);
          return;
        }
        resolve(Boolean(granted));
      });
    });
  } catch (_error) {
    return true;
  }
}

async function fetchWithTimeout(endpoint, init, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || 5_000));
  try {
    return await fetch(endpoint, {
      ...(init || {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function findDashboardTabByOrigin(origin) {
  const targetOrigin = String(origin || "").trim();
  if (!targetOrigin) return null;
  const pattern = `${targetOrigin}/*`;
  try {
    const tabs = await chrome.tabs.query({ url: [pattern] });
    if (Array.isArray(tabs) && tabs.length > 0) {
      return tabs[0];
    }
  } catch (_error) {
    // Fall through to broad query.
  }
  try {
    const tabs = await chrome.tabs.query({});
    return (
      (Array.isArray(tabs) ? tabs : []).find((tab) =>
        String(tab?.url || "").toLowerCase().startsWith(targetOrigin.toLowerCase())
      ) || null
    );
  } catch (_error) {
    return null;
  }
}

async function postToDashboardViaTabBridge({ endpoint, token, serializedBody }) {
  const endpointUrl = new URL(String(endpoint || ""));
  const origin = `${endpointUrl.protocol}//${endpointUrl.host}`;
  let dashboardTab = await findDashboardTabByOrigin(origin);
  let createdTabId = 0;
  if (!dashboardTab?.id) {
    dashboardTab = await chrome.tabs.create({
      url: `${origin}/canva-import`,
      active: false,
    });
    createdTabId = Number(dashboardTab?.id || 0);
    if (createdTabId > 0) {
      await waitForTabReady(createdTabId, 15_000);
    }
  }

  const tabId = Number(dashboardTab?.id || 0);
  if (tabId <= 0) {
    throw new Error(`No dashboard tab available for ${origin}`);
  }
  const readyTab = await chrome.tabs.get(tabId).catch(() => null);
  const readyUrl = String(readyTab?.url || "");
  if (!readyUrl || readyUrl.startsWith("chrome-error://")) {
    throw new Error(
      `Dashboard page is not reachable at ${origin}. Open ${origin}/canva-import in browser and ensure dev server is running.`
    );
  }

  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (inputEndpoint, inputToken, inputBody) => {
        try {
          const response = await fetch(inputEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "text/plain;charset=UTF-8",
            },
            body: inputBody,
            credentials: "include",
          });
          const raw = await response.text();
          let parsed = {};
          try {
            parsed = JSON.parse(raw || "{}");
          } catch (_error) {
            parsed = {};
          }
          return {
            ok: Boolean(response.ok),
            status: Number(response.status || 0),
            data: parsed,
          };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            data: {},
            networkError: {
              name: String(error?.name || ""),
              message: String(error?.message || ""),
            },
          };
        }
      },
      args: [endpoint, token, serializedBody],
    });
    const result = Array.isArray(injected) ? injected[0]?.result : null;
    if (!result || typeof result !== "object") {
      throw new Error("Dashboard tab bridge returned no result.");
    }
    return result;
  } finally {
    if (createdTabId > 0) {
      try {
        await chrome.tabs.remove(createdTabId);
      } catch (_error) {
        // Ignore best-effort cleanup failure.
      }
    }
  }
}

async function postToDashboard(payload) {
  const serializedBody = JSON.stringify({
    ...(payload.body && typeof payload.body === "object" ? payload.body : {}),
    token: String(payload.token || ""),
  });
  const payloadSizeKb = Math.round(serializedBody.length / 1024);
  const endpointCandidates = resolveDashboardEndpointCandidates(payload.endpoint);
  const attempts = endpointCandidates.length > 0 ? endpointCandidates : [String(payload.endpoint || "")];
  logger.info("Posting template import payload to dashboard", {
    endpoint: payload.endpoint,
    endpointCandidates: attempts,
    payloadSizeKb,
  });

  let response = null;
  let responseEndpoint = "";
  const failures = [];

  for (let index = 0; index < attempts.length; index += 1) {
    const endpoint = attempts[index];
    const hasPermission = await hasDashboardHostPermission(endpoint);
    if (!hasPermission) {
      const detail = `Missing extension host permission for ${endpoint}.`;
      failures.push(detail);
      logger.error("Dashboard import blocked by missing host permission", {
        endpoint,
        payloadSizeKb,
      });
      continue;
    }

    try {
      response = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "text/plain;charset=UTF-8",
          },
          body: serializedBody,
        },
        120_000
      );
      responseEndpoint = endpoint;
      break;
    } catch (error) {
      const detail = `POST failed for ${endpoint}: ${describeError(error)}`;
      failures.push(detail);
      logger.error(
        "Dashboard import fetch failed before receiving response",
        {
          endpoint,
          payloadSizeKb,
          attempt: index + 1,
          totalAttempts: attempts.length,
        },
        error
      );
    }
  }

  if (!response) {
    for (let index = 0; index < attempts.length; index += 1) {
      const endpoint = attempts[index];
      try {
        logger.warn("Direct fetch failed; attempting dashboard tab bridge fallback", {
          endpoint,
          payloadSizeKb,
          attempt: index + 1,
          totalAttempts: attempts.length,
        });
        const bridgeResult = await postToDashboardViaTabBridge({
          endpoint,
          token: payload.token,
          serializedBody,
        });
        const bridgeStatus = Number(bridgeResult?.status || 0);
        if (bridgeResult?.networkError) {
          const detail = `Tab bridge network failure for ${endpoint}: ${String(
            bridgeResult?.networkError?.message || "unknown"
          )}`;
          failures.push(detail);
          logger.error("Dashboard tab bridge network failure", {
            endpoint,
            payloadSizeKb,
            status: bridgeStatus,
            networkError: bridgeResult.networkError,
          });
          continue;
        }
        if (!bridgeResult?.ok) {
          const detail = String(
            bridgeResult?.data?.details ||
              bridgeResult?.data?.error ||
              `Dashboard import failed with HTTP ${bridgeStatus}.`
          );
          failures.push(`Tab bridge failed for ${endpoint}: ${detail}`);
          logger.error("Dashboard tab bridge request failed", {
            endpoint,
            payloadSizeKb,
            status: bridgeStatus,
            details: detail,
          });
          continue;
        }
        logger.info("Dashboard import request succeeded via tab bridge", {
          endpoint,
          status: bridgeStatus,
          templateId: String(bridgeResult?.data?.template?.id || ""),
        });
        return bridgeResult?.data || {};
      } catch (bridgeError) {
        const detail = `Tab bridge exception for ${endpoint}: ${describeError(bridgeError)}`;
        failures.push(detail);
        logger.error("Dashboard tab bridge threw exception", {
          endpoint,
          payloadSizeKb,
        }, bridgeError);
      }
    }

    const reason = failures.length > 0 ? failures.join(" | ") : "Unknown transport failure.";
    throw new Error(
      `Failed to reach dashboard import endpoint (${String(payload.endpoint || "")}). ${reason} ` +
        "Check dashboard URL/port, ensure server is running, and reload extension after manifest changes."
    );
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      data?.details || data?.error || `Dashboard import failed with HTTP ${response.status}.`;
    logger.error("Dashboard import request failed", {
      endpoint: responseEndpoint || payload.endpoint,
      status: response.status,
      payloadSizeKb,
      details: detail,
    });
    throw new Error(`${detail} (payload: ${payloadSizeKb} KB)`);
  }
  logger.info("Dashboard import request succeeded", {
    endpoint: responseEndpoint || payload.endpoint,
    status: response.status,
    templateId: String(data?.template?.id || ""),
  });
  return data;
}

function normalizeFontAssetMap(value) {
  const source = value && typeof value === "object" ? value : {};
  const result = {};
  Object.entries(source).forEach(([familyName, entries]) => {
    const family = normalizeFontFamilyName(familyName);
    if (!family) return;
    const normalizedEntries = [];
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const url = String(entry.url || "").trim();
      const dataUrl = String(entry.dataUrl || "").trim();
      if (!url && !dataUrl) return;
      const mimeType = String(
        entry.mimeType ||
          parseMimeTypeFromDataUrl(dataUrl) ||
          inferFontMimeTypeFromSource(url || dataUrl, entry.format || "")
      )
        .trim()
        .toLowerCase();
      if (mimeType && !isAllowedFontMimeType(mimeType)) return;
      const normalizedStyle = normalizeFontStyleValue(entry.fontStyle);
      const normalizedWeightMin = Number.isFinite(Number(entry.fontWeightMin))
        ? Number(entry.fontWeightMin)
        : Number.NaN;
      const normalizedWeightMax = Number.isFinite(Number(entry.fontWeightMax))
        ? Number(entry.fontWeightMax)
        : Number.NaN;
      const dedupeKey = [
        dataUrl || url,
        normalizedStyle,
        Number.isFinite(normalizedWeightMin) ? normalizedWeightMin : "",
        Number.isFinite(normalizedWeightMax) ? normalizedWeightMax : "",
      ].join("|");
      if (
        normalizedEntries.some(
          (item) =>
            [
              (item.dataUrl || item.url || "").trim(),
              normalizeFontStyleValue(item.fontStyle),
              Number.isFinite(Number(item.fontWeightMin)) ? Number(item.fontWeightMin) : "",
              Number.isFinite(Number(item.fontWeightMax)) ? Number(item.fontWeightMax) : "",
            ].join("|") === dedupeKey
        )
      ) {
        return;
      }
      normalizedEntries.push({
        url,
        dataUrl,
        mimeType,
        format: String(entry.format || ""),
        fileName: sanitizeFontFileName(entry.fileName || url || "", `${family}.ttf`),
        fontStyle: normalizedStyle,
        fontWeightMin: normalizedWeightMin,
        fontWeightMax: normalizedWeightMax,
      });
    });
    if (normalizedEntries.length > 0) {
      result[family] = normalizedEntries;
    }
  });
  return result;
}

function mergeUsedFontFamilies(primary, secondary) {
  const seen = new Set();
  const merged = [];
  [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])].forEach(
    (value) => {
      const family = normalizeFontFamilyName(value);
      if (!family) return;
      const key = family.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(family);
    }
  );
  return merged;
}

function getFontCandidatesForFamily(fontAssetMap, family) {
  const target = normalizeFontFamilyName(family);
  if (!target) return [];
  const direct = Array.isArray(fontAssetMap?.[target]) ? fontAssetMap[target] : [];
  if (direct.length > 0) return direct;
  const key = target.toLowerCase();
  const matchedKey = Object.keys(fontAssetMap || {}).find(
    (candidate) => String(candidate || "").toLowerCase() === key
  );
  if (!matchedKey) return [];
  return Array.isArray(fontAssetMap?.[matchedKey]) ? fontAssetMap[matchedKey] : [];
}

async function resolveImportedCustomFonts(usedFonts, fontAssetMap, fontTargetsByFamily, warnings) {
  const importedFonts = [];
  let totalBytes = 0;
  const safeWarnings = Array.isArray(warnings) ? warnings : [];
  const targetFonts = (Array.isArray(usedFonts) ? usedFonts : []).slice(0, MAX_IMPORTED_FONTS_PER_IMPORT);

  for (let index = 0; index < targetFonts.length; index += 1) {
    const family = normalizeFontFamilyName(targetFonts[index]);
    if (!family) continue;
    const candidates = getFontCandidatesForFamily(fontAssetMap, family);
    if (candidates.length === 0) {
      safeWarnings.push(`No downloadable font source found for "${family}".`);
      continue;
    }
    const fontTarget = getFontTargetForFamily(fontTargetsByFamily, family);
    const rankedCandidates = orderFontCandidatesForTarget(candidates, fontTarget);

    let saved = null;
    let lastFailureReason = "";
    for (let candidateIndex = 0; candidateIndex < rankedCandidates.length; candidateIndex += 1) {
      const candidate = rankedCandidates[candidateIndex];
      const sourceUrl = String(candidate?.dataUrl || candidate?.url || "").trim();
      if (!sourceUrl) {
        lastFailureReason = "missing-source-url";
        continue;
      }
      const resolved = await fetchFontDataUrl(sourceUrl, candidate.mimeType || candidate.format || "");
      if (!resolved?.dataUrl || !resolved?.mimeType) {
        lastFailureReason = "unresolved-data-url";
        continue;
      }
      if (!isAllowedFontMimeType(resolved.mimeType)) {
        lastFailureReason = `unsupported-mime:${resolved.mimeType}`;
        continue;
      }
      const bytes = estimateDataUrlBytes(resolved.dataUrl);
      if (bytes <= 0 || bytes > MAX_IMPORTED_FONT_BYTES) {
        lastFailureReason = bytes > MAX_IMPORTED_FONT_BYTES ? "font-too-large" : "empty-font";
        continue;
      }
      if (totalBytes + bytes > MAX_IMPORTED_FONTS_TOTAL_BYTES) {
        safeWarnings.push("Imported fonts exceeded size limit; some fonts were skipped.");
        lastFailureReason = "total-size-limit";
        break;
      }
      saved = {
        family,
        fileName:
          sanitizeFontFileName(
            resolved.fileName || candidate.fileName || candidate.url,
            `${family}.ttf`
          ) || `${family}.ttf`,
        mimeType: resolved.mimeType,
        dataUrl: resolved.dataUrl,
      };
      totalBytes += bytes;
      break;
    }

    if (saved) {
      importedFonts.push(saved);
    } else {
      const suffix = lastFailureReason ? ` (${lastFailureReason})` : "";
      safeWarnings.push(`Failed to import font file for "${family}"${suffix}.`);
    }
  }

  return {
    importedFonts,
    unsupportedFamilies: [],
  };
}

async function importActiveCanvaTab(message) {
  const dashboardUrl = normalizeDashboardUrl(message.dashboardUrl);
  const token = String(message.token || "").trim();
  const captureMetadata = Boolean(message?.captureMetadata);
  if (!token) {
    throw new Error("Import token is required.");
  }

  const phaseTimings = {};
  const phaseStart = (typeof performance !== "undefined" && typeof performance.now === "function")
    ? () => performance.now()
    : () => Date.now();
  const timePhase = async (phaseName, run) => {
    const startedAt = phaseStart();
    try {
      return await run();
    } finally {
      phaseTimings[phaseName] = Math.max(0, Math.round(phaseStart() - startedAt));
    }
  };
  const timeSyncPhase = (phaseName, run) => {
    const startedAt = phaseStart();
    try {
      return run();
    } finally {
      phaseTimings[phaseName] = Math.max(0, Math.round(phaseStart() - startedAt));
    }
  };

  const tab = await chrome.tabs.get(message.tabId);
  if (!tab?.id || !tab?.url) {
    throw new Error("Active Canva tab was not found.");
  }
  if (!/^https:\/\/www\.canva\.com\//i.test(tab.url)) {
    throw new Error("Active tab is not a Canva page.");
  }

  await timePhase("waitForTabReady", () => waitForTabReady(tab.id));
  const captureMeta = await timePhase("getCaptureMetaFromTab", () =>
    getCaptureMetaFromTab(tab.id, { captureMetadata })
  );
  if (!captureMeta?.ok) {
    throw new Error(captureMeta?.error || "Could not detect Canva design frame.");
  }

  let imageDataUrl = String(captureMeta.directDataUrl || "");
  let sourceWidth = Number(captureMeta.designWidth || 0);
  let sourceHeight = Number(captureMeta.designHeight || 0);
  let screenshotDataUrl = "";
  const hasExtractedLayerMetadata =
    Array.isArray(captureMeta.layers) && captureMeta.layers.length > 0;

  if (!imageDataUrl.startsWith("data:image/") || hasExtractedLayerMetadata) {
    screenshotDataUrl = await timePhase("captureVisibleTab", () =>
      chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
    );
  }

  if (!imageDataUrl.startsWith("data:image/")) {
    const cropped = await timePhase("cropScreenshotToCanvas", () =>
      cropScreenshotToCanvas(screenshotDataUrl, captureMeta)
    );
    imageDataUrl = cropped.dataUrl;
    sourceWidth = sourceWidth || cropped.width;
    sourceHeight = sourceHeight || cropped.height;
  }

  if (!imageDataUrl.startsWith("data:image/")) {
    throw new Error("Failed to build image payload from Canva tab.");
  }

  let extractedLayers = hasExtractedLayerMetadata ? captureMeta.layers : [];
  const isolatedSnapshotWarnings = [];
  if (screenshotDataUrl.startsWith("data:image/") && extractedLayers.length > 0) {
    const preferSnapshotLayers = extractedLayers
      .filter((layer) => String(layer?.kind || "").toLowerCase() === "image")
      .filter((layer) => Boolean(layer?.preferSnapshot))
      .filter((layer) => String(layer?.id || "").trim().startsWith("LB"))
      .filter((layer) => layer?.viewportRect)
      .sort((a, b) => {
        const aArea = numberOr(a?.width, 0) * numberOr(a?.height, 0);
        const bArea = numberOr(b?.width, 0) * numberOr(b?.height, 0);
        return bArea - aArea;
      })
      .slice(0, 24);

    if (preferSnapshotLayers.length > 0) {
      try {
        const visibleBitmap = await timePhase("decodeVisibleSnapshotBitmap", () =>
          decodeDataUrlToBitmap(screenshotDataUrl)
        );
        const isolatedSnapshotsById = new Map();

        for (let index = 0; index < preferSnapshotLayers.length; index += 1) {
          const layer = preferSnapshotLayers[index];
          const layerId = String(layer?.id || "").trim();
          if (!layerId) continue;
          try {
            await setCanvaLayerVisibility(tab.id, [layerId], true);
            let isolatedDataUrl = "";
            const isolationWaits = [140, 240];
            for (let attempt = 0; attempt < isolationWaits.length; attempt += 1) {
              await sleep(isolationWaits[attempt]);
              const hiddenScreenshotDataUrl = await timePhase(
                `captureLayerHidden_${index + 1}_${attempt + 1}`,
                () => chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
              );
              const hiddenBitmap = await timePhase(
                `decodeLayerHiddenBitmap_${index + 1}_${attempt + 1}`,
                () => decodeDataUrlToBitmap(hiddenScreenshotDataUrl)
              );
              isolatedDataUrl = await timePhase(
                `isolateLayerSnapshot_${index + 1}_${attempt + 1}`,
                () =>
                  isolateLayerSnapshotFromBitmaps(visibleBitmap, hiddenBitmap, layer.viewportRect, {
                    dpr: Number(captureMeta.devicePixelRatio || 1),
                    targetWidth: Math.max(1, Math.round(numberOr(layer?.width, 1))),
                    targetHeight: Math.max(1, Math.round(numberOr(layer?.height, 1))),
                  })
              );
              if (isolatedDataUrl.startsWith("data:image/")) break;
            }
            if (isolatedDataUrl.startsWith("data:image/")) {
              isolatedSnapshotsById.set(layerId, isolatedDataUrl);
            } else {
              isolatedSnapshotWarnings.push(`Could not isolate merged Canva layer "${layerId}".`);
            }
          } catch (_error) {
            isolatedSnapshotWarnings.push(`Could not isolate merged Canva layer "${layerId}".`);
          } finally {
            await setCanvaLayerVisibility(tab.id, [layerId], false).catch(() => {});
            await sleep(80);
          }
        }

        if (isolatedSnapshotsById.size > 0) {
          extractedLayers = extractedLayers.map((layer) => {
            const layerId = String(layer?.id || "").trim();
            const isolatedImageDataUrl = isolatedSnapshotsById.get(layerId);
            return isolatedImageDataUrl
              ? { ...layer, isolatedImageDataUrl }
              : layer;
          });
        }
      } catch (_error) {
        isolatedSnapshotWarnings.push("Could not isolate merged Canva layers; using screenshot crops.");
      }
    }
  }
  const extractionLikelyDegraded = extractedLayers.length <= 1;
  const usedFontsFromLayers = collectUsedFontFamilies(extractedLayers);
  const fontTargetsByFamily = buildUsedFontTargetsByFamily(extractedLayers);
  const fontAssetMap = normalizeFontAssetMap(captureMeta?.fontAssets);
  const fallbackFontsFromAssets = Object.keys(fontAssetMap || {})
    .map((family) => normalizeFontFamilyName(family))
    .filter(Boolean);
  const usedFonts = mergeUsedFontFamilies(
    usedFontsFromLayers,
    usedFontsFromLayers.length > 0 ? [] : fallbackFontsFromAssets
  );
  const textLayers = extractedLayers.filter((layer) => String(layer?.kind || "").toLowerCase() === "text");
  const resolvableImageLayerCount = extractedLayers.filter((layer) => {
    if (String(layer?.kind || "").toLowerCase() !== "image") return false;
    const dataUrl = String(layer?.imageDataUrl || "");
    const src = String(layer?.imageSrc || "");
    return (
      dataUrl.startsWith("data:image/") ||
      /^https?:\/\//i.test(src) ||
      /^file:\/\//i.test(src)
    );
  }).length;
  const textLayerIds = textLayers
    .map((layer) => String(layer?.id || "").trim())
    .filter((id) => id.startsWith("LB"));
  const shouldUseTextOverlayFallback = textLayers.length > 0 && resolvableImageLayerCount === 0;
  const importWarnings = extractionLikelyDegraded
    ? ["Canva DOM layer mapping is limited for this design; fallback extraction was used."]
    : [];
  if (usedFontsFromLayers.length === 0 && fallbackFontsFromAssets.length > 0) {
    importWarnings.push("Text font detection from layers was empty; using document font assets fallback.");
  }
  if (usedFonts.length === 0) {
    importWarnings.push("No text font families were detected for this import.");
  }
  if (String(captureMeta?.sourceType || "").toLowerCase().startsWith("fallback")) {
    importWarnings.push("Canvas frame detection used fallback mode.");
  }
  if (isolatedSnapshotWarnings.length > 0) {
    importWarnings.push(...isolatedSnapshotWarnings);
  }
  const fontResolutionWarnings = [];
  const resolvedFontsPromise = resolveImportedCustomFonts(
    usedFonts,
    fontAssetMap,
    fontTargetsByFamily,
    fontResolutionWarnings
  );
  let fabricObjects = [];
  let backgroundNoTextDataUrl = "";
  if (shouldUseTextOverlayFallback) {
    try {
      await setCanvaLayerVisibility(tab.id, textLayerIds, true);
      const hiddenTextScreenshotDataUrl = await timePhase("captureVisibleTabWithoutText", () =>
        chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
      );
      const croppedNoText = await timePhase("cropScreenshotToCanvasWithoutText", () =>
        cropScreenshotToCanvas(hiddenTextScreenshotDataUrl, captureMeta)
      );
      backgroundNoTextDataUrl = String(croppedNoText?.dataUrl || "");
    } finally {
      await setCanvaLayerVisibility(tab.id, textLayerIds, false).catch(() => {});
    }
  }
  if (shouldUseTextOverlayFallback) {
    if (backgroundNoTextDataUrl.startsWith("data:image/")) {
      const textObjects = await timePhase("buildFabricObjectsTextFallback", () =>
        buildFabricObjects(textLayers)
      );
      fabricObjects = [
        buildSingleImageFabricObject(
          backgroundNoTextDataUrl,
          Math.max(1, Math.round(sourceWidth || captureMeta.designWidth || 1080)),
          Math.max(1, Math.round(sourceHeight || captureMeta.designHeight || 1080)),
          {
            importNodeId: "canva-background-no-text",
            fallback: true,
            fallbackReason: "text-overlay-background",
          }
        ),
        ...textObjects,
      ];
      importWarnings.push("Text-only fallback used: background snapshot with editable text overlays.");
    }
  }
  const resolvedFonts = await timePhase("resolveImportedCustomFonts", () => resolvedFontsPromise);
  if (fontResolutionWarnings.length > 0) {
    importWarnings.push(...fontResolutionWarnings);
  }
  const importedCustomFonts = Array.isArray(resolvedFonts?.importedFonts)
    ? resolvedFonts.importedFonts
    : [];
  const unsupportedTextFamilies = Array.isArray(resolvedFonts?.unsupportedFamilies)
    ? resolvedFonts.unsupportedFamilies
    : [];
  if (fabricObjects.length === 0 && screenshotDataUrl && extractedLayers.length > 0) {
    try {
      const screenshotBitmap = await timePhase("decodeScreenshotBitmap", () =>
        decodeDataUrlToBitmap(screenshotDataUrl)
      );
      fabricObjects = await timePhase("buildHybridFabricObjects", () =>
        buildHybridFabricObjects(
          extractedLayers,
          screenshotBitmap,
          Number(captureMeta.devicePixelRatio || 1),
          sourceWidth || Number(captureMeta.designWidth || 0),
          sourceHeight || Number(captureMeta.designHeight || 0),
          {
            unsupportedTextFamilies,
          }
        )
      );
    } catch (_error) {
      fabricObjects = [];
    }
  }
  if (fabricObjects.length === 0) {
    fabricObjects = await timePhase("buildFabricObjectsFallback", () =>
      buildFabricObjects(extractedLayers)
    );
  }
  const fallbackWidth = Math.max(1, Math.round(sourceWidth || 1080));
  const fallbackHeight = Math.max(1, Math.round(sourceHeight || 1080));
  const hasMeaningfulDrawableLayers = fabricObjects.some((object) => {
    const type = String(object?.type || "").toLowerCase();
    if (type === "image") return Boolean(String(object?.src || "").startsWith("data:image/") || /^https?:\/\//i.test(String(object?.src || "")));
    if (type === "textbox") return Boolean(String(object?.text || "").trim());
    return false;
  });
  const thinVectorDebugEntries = extractedLayers
    .filter((layer) => {
      const width = Math.max(1, Math.round(numberOr(layer?.width, 1)));
      const height = Math.max(1, Math.round(numberOr(layer?.height, 1)));
      const ratio = Math.max(width, height) / Math.max(1, Math.min(width, height));
      return ratio >= 12 && Math.min(width, height) <= 8;
    })
    .slice(0, 6)
    .map((layer) => {
      const object = fabricObjects.find(
        (candidate) => String(candidate?.importNodeId || "").trim() === String(layer?.id || "").trim()
      );
      const width = Math.max(1, Math.round(numberOr(layer?.width, 1)));
      const height = Math.max(1, Math.round(numberOr(layer?.height, 1)));
      const angle = Math.round(numberOr(layer?.angle, 0));
      return `${String(layer?.id || "layer").trim()}:${String(layer?.kind || "?")}/${width}x${height}@${angle}->${String(object?.type || "missing").toLowerCase()}`;
    });
  if (thinVectorDebugEntries.length > 0) {
    importWarnings.push(`Thin vector debug: ${thinVectorDebugEntries.join(", ")}`);
  }
  const hasExtractedLayers = fabricObjects.length > 0 && hasMeaningfulDrawableLayers;

  const fabricData = {
    version: "7.0.0",
    objects:
      hasExtractedLayers
        ? fabricObjects
        : [
            buildSingleImageFabricObject(imageDataUrl, fallbackWidth, fallbackHeight, {
              importNodeId: "canva-snapshot-1",
              fallback: true,
              fallbackReason: "full-snapshot",
            }),
          ],
  };
  if (!hasExtractedLayers) {
    importWarnings.push("Could not extract reliable Canva layers; imported as full-page snapshot.");
  }
  const layerTreeFromExtraction = buildLayerTreeFromExtractedLayers(extractedLayers);
  const layerTree =
    layerTreeFromExtraction.length > 0 ? layerTreeFromExtraction : buildLayerTreeFromFabricObjects(fabricData.objects);
  const layerStats = deriveLayerStats(
    layerTree.length > 0 ? layerTree.length : fabricData.objects.length,
    fabricData.objects
  );

  let thumbnailDataUrl = imageDataUrl;
  try {
    thumbnailDataUrl = await timePhase("createThumbnailDataUrl", () =>
      createThumbnailDataUrl(imageDataUrl)
    );
  } catch (_error) {
    thumbnailDataUrl = imageDataUrl;
  }

  const requestBody = timeSyncPhase("compactRequestBody", () =>
    compactRequestBody(
      {
        sourceUrl: String(captureMeta.sourceUrl || tab.url || ""),
        title: String(captureMeta.title || ""),
        imageDataUrl: hasExtractedLayers ? undefined : imageDataUrl,
        thumbnailDataUrl,
        fabricData,
        canvasWidth: sourceWidth || Math.round(Number(captureMeta.rect?.width || 1080)),
        canvasHeight: sourceHeight || Math.round(Number(captureMeta.rect?.height || 1080)),
        sourceWidth,
        sourceHeight,
        extractedLayerCount: fabricObjects.length,
        importVersion: 2,
        editorData: {
          importVersion: 2,
          source: "canva-extension",
          page: {
            id: "canva-page-1",
            name: "Canva Page 1",
            width: sourceWidth || Math.round(Number(captureMeta.rect?.width || 1080)),
            height: sourceHeight || Math.round(Number(captureMeta.rect?.height || 1080)),
            sourceWidth: sourceWidth || Math.round(Number(captureMeta.rect?.width || 1080)),
            sourceHeight: sourceHeight || Math.round(Number(captureMeta.rect?.height || 1080)),
          },
          layerTree,
          layerStats,
          usedFonts,
          customFonts: importedCustomFonts,
          warnings: importWarnings,
        },
        maxDimension: 1920,
        name: String(message.name || "").trim() || undefined,
        slug: String(message.slug || "").trim() || undefined,
      },
      imageDataUrl,
      fallbackWidth,
      fallbackHeight
    )
  );

  const endpoint = `${dashboardUrl}/api/tools/canva-import/extension-import`;
  const result = await timePhase("postToDashboard", () =>
    postToDashboard({
      endpoint,
      token,
      body: requestBody,
    })
  );

  const sortedPhaseTimings = Object.entries(phaseTimings).sort((a, b) => b[1] - a[1]);
  logger.info("Canva import phase timings", {
    captureMetadata,
    timings: Object.fromEntries(sortedPhaseTimings),
  });

  return {
    ...result,
    phaseTimings,
    captureMetadata,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const messageType = String(message?.type || "").trim();
  if (!messageType) return;

  if (messageType !== "IMPORT_ACTIVE_CANVA_TAB") return;

  try {
    logger.info("Received import request from popup", {
      tabId: Number(message?.tabId || 0),
      dashboardUrl: String(message?.dashboardUrl || ""),
    });

    importActiveCanvaTab(message)
      .then((result) => {
        logger.info("Import finished successfully", {
          templateId: String(result?.template?.id || ""),
          layerCount: Number(result?.layerCount || 0),
          importedCustomFonts: Number(result?.importedCustomFonts || 0),
        });
        sendResponse({
          ok: true,
          template: result?.template || null,
          message: result?.message || "Imported successfully.",
          layerCount: Number(result?.layerCount || 0),
          warnings: Array.isArray(result?.warnings) ? result.warnings : [],
          importedCustomFonts: Number(result?.importedCustomFonts || 0),
          phaseTimings:
            result?.phaseTimings && typeof result.phaseTimings === "object"
              ? result.phaseTimings
              : {},
          captureMetadata: Boolean(result?.captureMetadata),
        });
      })
      .catch((error) => {
        logger.error("Import failed", {
          tabId: Number(message?.tabId || 0),
        }, error);
        sendResponse({
          ok: false,
          error: errorMessage(error, "Failed to import active Canva tab."),
        });
      });
  } catch (error) {
    logger.error("Message handler crashed", {}, error);
    sendResponse({
      ok: false,
      error: errorMessage(error, "Importer message handler crashed."),
    });
  }

  return true;
});
