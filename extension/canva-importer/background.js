/* global chrome, OffscreenCanvas, createImageBitmap, btoa, self */
importScripts("logger.js");
importScripts("shared-constants.js");

// Take over immediately on update so a reloaded extension runs the NEW service-worker code
// instead of Chrome keeping the previously-running (stale) worker alive. Without this, the
// manifest/popup/injected-scraper update but the worker logic (e.g. the import build) stays
// on the old version until it naturally terminates.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Build marker — sourced from the manifest (bump version/version_name there). Confirms a
// reload took effect, shown both here and as the popup version badge.
const EXTENSION_BUILD = (() => {
  try {
    const m = chrome.runtime.getManifest();
    return String(m.version_name || m.version || "?");
  } catch (_error) {
    return "?";
  }
})();
console.log(`[CanvaImporter] build ${EXTENSION_BUILD} loaded`);

// Global text scale applied to EVERY imported text layer — Canva's measured font sizes come in a
// touch large for our editor/mobile rendering, so shrink all text by 5% (0.95). Adjust here to
// change the amount; 1 disables it. Applied in layerToFabricObject so DOM-captured text and the
// off-screen model-supplement text (both flow through it) shrink by the same factor.
const IMPORT_TEXT_FONT_SCALE = 0.95;

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

const IMPORT_PORT_NAME = "canva-import";
const IMPORT_PROGRESS_EVENT = "IMPORT_PROGRESS";
const IMPORT_SUCCESS_EVENT = "IMPORT_SUCCESS";
const IMPORT_ERROR_EVENT = "IMPORT_ERROR";

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

const SHARED_CONSTANTS = globalThis.CANVA_IMPORTER_SHARED_CONSTANTS || {};
const MAX_LAYER_SNAPSHOT_TOTAL_BYTES = Number(SHARED_CONSTANTS.MAX_LAYER_SNAPSHOT_TOTAL_BYTES || 6_000_000);
const MAX_LAYER_SNAPSHOT_BYTES = Number(SHARED_CONSTANTS.MAX_LAYER_SNAPSHOT_BYTES || 1_200_000);
const MAX_INLINE_IMAGE_DATA_URL_LENGTH = Number(
  SHARED_CONSTANTS.MAX_INLINE_IMAGE_DATA_URL_LENGTH || 1_800_000
);
const MAX_TRANSPORT_JSON_LENGTH = Number(SHARED_CONSTANTS.MAX_TRANSPORT_JSON_LENGTH || 7_500_000);
const MAX_IMPORT_PAGES = Number(SHARED_CONSTANTS.MAX_IMPORT_PAGES || 10);
const MAX_INLINE_FONT_DATA_URL_LENGTH = Number(
  SHARED_CONSTANTS.MAX_INLINE_FONT_DATA_URL_LENGTH || 7_000_000
);
const MAX_IMPORTED_FONT_BYTES = Number(SHARED_CONSTANTS.MAX_IMPORTED_FONT_BYTES || 5_000_000);
const MAX_IMPORTED_FONTS_TOTAL_BYTES = Number(
  SHARED_CONSTANTS.MAX_IMPORTED_FONTS_TOTAL_BYTES || 12_000_000
);
const MAX_IMPORTED_FONTS_PER_IMPORT = Number(SHARED_CONSTANTS.MAX_IMPORTED_FONTS_PER_IMPORT || 6);
// Real cuts kept per family — one per weight the design actually uses. Canva designs typically
// use 2-3 (this one uses 400/500/700 of a single family); the scraper resolves at most 4
// candidates per family, ordered by those same used weights.
const MAX_FONT_VARIANTS_PER_FAMILY = 4;
const FONT_BUCKET_REGULAR_WEIGHT = 400;
const IMPORT_MULTIPART_MANIFEST_FIELD = String(
  SHARED_CONSTANTS.IMPORT_MULTIPART_MANIFEST_FIELD || "payload"
);
const IMPORT_MULTIPART_ASSET_PREFIX = String(
  SHARED_CONSTANTS.IMPORT_MULTIPART_ASSET_PREFIX || "asset_"
);
const FONT_FETCH_TIMEOUT_MS = 15_000;
const PROGRESS_CAPTURE_FORMAT = "png";

function createProgressReporter(port = null) {
  return (message, context = {}) => {
    const payload = {
      type: IMPORT_PROGRESS_EVENT,
      message: String(message || "").trim(),
      context: context && typeof context === "object" ? context : {},
    };
    logger.info("Import progress", {
      ...payload.context,
      message: payload.message,
    });
    if (!port) return;
    try {
      port.postMessage(payload);
    } catch (_error) {
      // Ignore progress delivery failures if the popup disconnected.
    }
  };
}

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
  const commaIndex = source.indexOf(",");
  if (commaIndex === -1 || !/^data:/i.test(source)) {
    throw new Error("Invalid data URL.");
  }
  // Parse by hand instead of one regex so this accepts EVERY valid data URL — the previous
  // /^data:([^;,]*)(;base64)?,(.*)$/i rejected two shapes the extension itself emits:
  //   • parameters, e.g. `data:image/svg+xml;charset=utf-8,…` (vector shapes, lines 2737/3081), and
  //   • payloads containing newlines (raw SVG markup, or line-wrapped base64) — `.` skips `\n`.
  // A single unparseable asset threw here during multipart build and aborted the WHOLE import
  // ("Invalid data URL") before the POST — even though the server parses these fine.
  // Header = between "data:" and the first comma: "<mime>[;param=value]*[;base64]".
  const header = source.slice(5, commaIndex);
  const payload = source.slice(commaIndex + 1);
  const headerParts = header.split(";").map((part) => part.trim());
  const isBase64 = headerParts[headerParts.length - 1].toLowerCase() === "base64";
  const mimeType = headerParts[0] || "application/octet-stream";
  let bytes;
  if (isBase64) {
    const binaryString = atob(payload.replace(/\s+/g, "")); // base64 may be line-wrapped
    bytes = new Uint8Array(binaryString.length);
    for (let index = 0; index < binaryString.length; index += 1) {
      bytes[index] = binaryString.charCodeAt(index);
    }
  } else {
    // Percent-encoded text (SVG). TextEncoder yields correct UTF-8 bytes for non-ASCII glyphs,
    // unlike the old charCodeAt loop which truncated code points > 255.
    let text;
    try {
      text = decodeURIComponent(payload);
    } catch (_error) {
      text = payload;
    }
    bytes = new TextEncoder().encode(text);
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
    response = await fetchWithTimeout(
      url,
      {
        credentials: "omit",
        cache: "no-store",
      },
      FONT_FETCH_TIMEOUT_MS
    );
  } catch (error) {
    logger.warn("Failed to fetch font asset", { sourceUrl: url }, error);
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

// Is [posterSrc] a single frame of a clipWidth x clipHeight video? Canva's poster URL sometimes
// answers with a scrubber FILMSTRIP — several frames tiled in one sheet — and a sheet passed off as
// a poster is drawn stretched across the whole video layer (observed: the scene stacked twice above
// a black band). The captured clip's own dimensions are ground truth, so compare aspects.
// Unknown either way (no dimensions, a poster that will not decode) keeps the poster: a missing
// thumbnail is worse than an unverified one, and the scraper already gated on the clip rect.
async function posterMatchesVideoAspect(posterSrc, clipWidth, clipHeight) {
  const width = Number(clipWidth) || 0;
  const height = Number(clipHeight) || 0;
  if (width <= 0 || height <= 0) return true;
  try {
    const blob = String(posterSrc).startsWith("data:image/")
      ? dataUrlToBlob(posterSrc)
      : await (await fetch(posterSrc)).blob();
    const bitmap = await createImageBitmap(blob);
    const posterWidth = bitmap.width;
    const posterHeight = bitmap.height;
    bitmap.close?.();
    const posterAspect = posterWidth / Math.max(1, posterHeight);
    const videoAspect = width / height;
    const matches = Math.abs(posterAspect - videoAspect) / videoAspect <= 0.15;
    if (!matches) {
      logger.warn("Background video poster rejected: not a single frame of the clip", {
        poster: `${posterWidth}x${posterHeight}`,
        clip: `${width}x${height}`,
      });
    }
    return matches;
  } catch (_error) {
    return true;
  }
}

// Fraction of (downsampled) pixels that are opaque (alpha > 200). Returns -1 on failure.
async function imageOpaqueFraction(dataUrl) {
  try {
    if (!String(dataUrl || "").startsWith("data:image/")) return -1;
    const bitmap = await decodeDataUrlToBitmap(dataUrl);
    if (!bitmap) return -1;
    const w = Math.max(1, Math.min(120, bitmap.width));
    const h = Math.max(1, Math.min(120, bitmap.height));
    const canvas = new OffscreenCanvas(w, h);
    const context = canvas.getContext("2d");
    if (!context) return -1;
    context.drawImage(bitmap, 0, 0, w, h);
    const data = context.getImageData(0, 0, w, h).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 200) opaque += 1;
    }
    return opaque / (w * h);
  } catch (_error) {
    return -1;
  }
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
  const minVisibleDelta = Math.max(1, Math.round(numberOr(options?.minVisibleDelta, 4)));
  const softEdgeDelta = Math.max(minVisibleDelta + 1, Math.round(numberOr(options?.softEdgeDelta, 7)));
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
    const maxDelta = Math.max(deltaR, deltaG, deltaB, deltaA);
    if (maxDelta < minVisibleDelta) continue;

    let alphaByte = 255;
    if (maxDelta < softEdgeDelta) {
      alphaByte = Math.max(
        0,
        Math.min(
          255,
          Math.round(((maxDelta - minVisibleDelta) / Math.max(1, softEdgeDelta - minVisibleDelta)) * 255)
        )
      );
    }
    if (alphaByte <= 0) continue;

    output[index] = source[index];
    output[index + 1] = source[index + 1];
    output[index + 2] = source[index + 2];
    output[index + 3] = alphaByte;
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

// Canva numeric animation-preset id → the editor's animation type (a name the editor's
// normalizeAnimationType / ANIMATION_TYPE_ALIASES understands). CALIBRATED 2026-07-13 by applying
// each animation in Canva's Animate panel to a scratch element and reading
// `element.animation.animation` off the React fiber after each click (two passes, cross-checked).
// Unmapped presets fall back to a sensible type by mode below.
const CANVA_ANIMATION_PRESET_TO_TYPE = {
  1: "BASELINE", // Baseline
  2: "BREATHE", // ظهور بطيء (Breathe / slow reveal)
  3: "DRIFT", // انجراف (Drift)
  4: "FADE", // تلاشي (Fade)
  5: "NEON", // نيون (Neon)
  6: "PAN", // تأرجح (Pan)
  7: "POP", // انبثاق (Pop)
  8: "RISE", // ارتقاء (Ascend/Rise)
  9: "SCRAPBOOK", // سجل قصاصات (Scrapbook)
  11: "STOMP", // سقوط هوائي (Stomp / aerial drop)
  12: "TECTONIC", // حركة تكتونية (Tectonic)
  13: "TUMBLE", // دوران (Tumble)
  // 14-16, 30, 38-42: PHOTO panel presets (calibrated 2026-07-14 on an image element).
  14: "DRIFT", // انسيابية الصورة (Image flow — slow photo drift)
  15: "BREATHE", // تكبير الصورة (Photo zoom / Ken Burns — closest editor motion is the slow scale wave)
  16: "RISE", // ارتقاء الصور (Photo rise)
  17: "BLOCK", // Block — we have the real thing now (شريط: a bar sweeps past and leaves the text)
  26: "WIPE", // المسح (Wipe)
  // 28 is NOT a panel preset: it's the id Canva assigns to CUSTOM "create an animation" motion
  // paths (baked Acb keyframes) — imported exactly via mediaMotionPath, never via this table.
  29: "BLUR", // تمويه (Blur)
  30: "WIPE", // اسحب الفرشاة (Brush reveal — progressive reveal, closest is wipe)
  31: "SUCCESSION", // التتابع (Succession)
  38: "PULSE", // تكبير اهتزازي (Shake zoom)
  39: "PAN", // انزلاق سريع (Quick slide)
  40: "WAVE", // تموج (Ripple) — matched by name, not observed
  41: "FLICKER", // موجة الانحراف اللوني (Chromatic aberration wave — glitch-like)
  42: "FLICKER", // التلفزيون القديم (Old TV — glitch/static)
  43: "DRIFT", // حركة بطيئة (Slow motion) — matched by name, not observed
};

// PAGE animations ("Animate page") use a SEPARATE enum from element presets — verified by applying
// each one on a scratch copy and reading page.animation: page Rise=5 while element 5 is Neon, page
// Fade=3 while element 3 is Drift, page Pop=11 while element 11 is Stomp. Routing a page preset
// through the element table would therefore pick an unrelated animation, so it gets its own map.
// Calibrated 2026-09-22 on a copy of DAHN3H7074o (Canva Arabic UI), then RE-VERIFIED 2026-09-22 on
// DAHOPR_iwyk without touching the design: every tile in the Animate panel carries its own preset in
// its React props (`memoizedProps.animation.animation`, with `animation.type` = "page" | "element" |
// "element_mask"), so walking up the fiber from each `button[role="switch"]` reads the WHOLE enum —
// id, family and label — in one pass. That is strictly better than applying each preset to a scratch
// element: nothing is written, and the two id spaces cannot be confused because the family says
// which is which. Every id below 1-13/20-27 matched; 17-19 were added from that read.
const CANVA_PAGE_ANIMATION_PRESET_TO_TYPE = {
  1: "BLOCK", // Block
  2: "BREATHE", // ظهور بطيء (Breathe)
  3: "FADE", // تلاشي (Fade)
  4: "PAN", // تأرجح (Pan)
  5: "RISE", // ارتقاء (Rise)
  6: "TUMBLE", // دوران (Tumble)
  7: "BASELINE", // Baseline
  8: "NEON", // نيون (Neon)
  9: "DRIFT", // انجراف (Drift)
  10: "TECTONIC", // حركة تكتونية (Tectonic)
  11: "POP", // انبثاق (Pop)
  12: "SCRAPBOOK", // سجل قصاصات (Scrapbook)
  13: "STOMP", // سقوط هوائي (Stomp)
  17: "DRIFT", // انسيابية الصورة (Image flow)
  18: "BREATHE", // تكبير الصورة (Photo zoom)
  19: "RISE", // ارتقاء الصور (Photo rise)
  20: "WIPE", // المسح (Wipe)
  // 21-27 are the "متميز" (Featured) page STYLES. Each is a COMBO — Canva gives text and images
  // different motions under one name — so a single editor type can only approximate it. Only 23 is
  // confirmed by watching it play (fade in + drop from above, ~1s); the rest are matched by name.
  21: "FADE", // بسيط (Simple)
  22: "BREATHE", // ناعم (Soft)
  23: "DRIFT", // مضحكة (Wacky) — verified on DAHN3H7074o
  24: "POP", // حفلة (Party)
  26: "WIPE", // مؤسسة (Corporate)
  27: "FADE", // هادئ (Calm)
};

// Four of those map onto effects that PING-PONG or ride a wave: they finish exactly where they
// started. As an ENTRANCE they reveal nothing at all, and no entrance tab offers them, so the
// editor's picker showed an empty selection on a layer that plainly had an animation. They belong
// in the loop slot, where an infinite spec cycles them the way Canva plays them. The rest of the
// page presets (Rise, Pan, Drift, Tectonic, Stomp, Tumble) SETTLE into place, so they stay
// entrances.
const CANVA_PAGE_AMBIENT_TYPES = new Set(["BREATHE", "NEON", "BASELINE", "SCRAPBOOK"]);
// Canva easing enum → editor easing (best-effort; editor also has its own per-type defaults).
const CANVA_ANIMATION_EASING_TO_EDITOR = { 0: "LINEAR", 1: "EASE_OUT", 2: "EASE_IN_OUT" };

// Map the scraper's raw fiber animation ({canvaPreset, mode, durationMs, easing}) to the editor's
// mediaAnimation* element fields. Type uses the calibrated preset table when known, else a
// mode-based fallback so the layer still animates (entrance/exit → FADE, emphasis → PULSE).
function buildEditorAnimationFields(animation) {
  if (!animation || typeof animation !== "object") return {};
  const fields = {
    // keep the raw Canva preset on the object for DB verification + future re-calibration
    canvaAnimationPreset: Number.isFinite(Number(animation.canvaPreset)) ? Number(animation.canvaPreset) : null,
  };
  // Custom "create an animation" motion path (e.g. wedding doors sliding apart) — keyframed
  // position offsets the editor's previewRuntime interpolates. Composes with a preset when the
  // element also has entrance/exit tracks; a PURE motion path gets NO preset type (a fabricated
  // FADE/PULSE would play motion Canva never authored).
  const hasMotionPath = Array.isArray(animation.motionPath) && animation.motionPath.length >= 2;
  if (hasMotionPath) fields.mediaMotionPath = animation.motionPath;
  const hasIn = Number(animation.inMs) > 0;
  const hasOut = Number(animation.outMs) > 0;
  let mode = ["IN", "OUT", "LOOP"].includes(animation.mode) ? animation.mode : undefined;
  // Canva elements with BOTH tracks animate in at window start AND out at window end.
  if (hasIn && hasOut) mode = "IN_OUT";
  // SAFETY NET — un-baked animations: when a design's animations were edited in the OPEN Canva
  // session, the model holds the preset id but EMPTY Sv tracks (no durations/keyframes) until the
  // page is reloaded from the server. Rather than importing a dead element, emit the mapped type
  // as a default entrance so the animation is at least present. (A Canva page refresh + reimport
  // recovers the exact durations and custom-path keyframes.)
  if (!mode && !hasMotionPath && fields.canvaAnimationPreset !== null) {
    mode = "IN";
    if (!Number(animation.durationMs)) animation = { ...animation, durationMs: 1500 };
  }
  if (!mode && !hasMotionPath) return fields.canvaAnimationPreset === null ? {} : fields;
  if (mode) {
    // A page animation carries a preset from the PAGE enum (see the table above), so it must not
    // be looked up in the element one — the ids collide with different meanings.
    const mappedType = animation.fromPageAnimation
      ? CANVA_PAGE_ANIMATION_PRESET_TO_TYPE[animation.canvaPreset]
      : CANVA_ANIMATION_PRESET_TO_TYPE[animation.canvaPreset];
    // An UNKNOWN page preset is not an animation Canva plays. The page enum above is complete (read
    // straight off Canva's own tiles), so an id outside it is a leftover from whatever template the
    // design was built from — DAHOPR_iwyk carries page.animation = 31 while Canva's page panel shows
    // nothing applied and plays nothing. The generic fallback would have put a FADE on EVERY layer
    // of that design, inventing an animation the original does not have. Element presets keep the
    // fallback: there the id came from a tile the user really did click.
    if (animation.fromPageAnimation && !mappedType) {
      return fields.canvaAnimationPreset === null ? {} : fields;
    }
    fields.mediaAnimationType = mappedType || (mode === "LOOP" ? "PULSE" : "FADE");
    if (animation.fromPageAnimation && CANVA_PAGE_AMBIENT_TYPES.has(fields.mediaAnimationType)) {
      mode = "LOOP";
    }
    fields.mediaAnimationMode = mode;
    const durationMs = Number(animation.durationMs) > 0 ? Math.round(Number(animation.durationMs)) : undefined;
    if (durationMs) fields.mediaAnimationDurationMs = durationMs;
    // A page animation carries in/out legs rather than one duration; a looping one takes the in leg.
    if (mode === "LOOP" && !durationMs && Number(animation.inMs) > 0) {
      fields.mediaAnimationDurationMs = Math.round(Number(animation.inMs));
    }
    if (mode === "IN_OUT") {
      fields.mediaAnimationDurationMs = Math.round(Number(animation.inMs));
      fields.mediaAnimationOutDurationMs = Math.round(Number(animation.outMs));
    }
    const easing = CANVA_ANIMATION_EASING_TO_EDITOR[animation.easing];
    if (easing) fields.mediaAnimationEasing = easing;
    if (mode === "LOOP") fields.mediaAnimationInfinite = true;
  }
  return fields;
}

// Can the editor redraw this Canva photo frame itself, from the fetched asset? A plain rect frame
// via cornerRadius + stroke, and a ROUND frame at ANY aspect via `mediaShape: "circle"` — the
// editor masks those to a true ellipse inscribed in the box (a corner radius could only ever make
// a stadium, which is why this used to be restricted to square boxes).
function isReproducibleFrameBorder(border) {
  return Boolean(border && (border.rectFrame || border.circleFrame));
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
    ...(layer && typeof layer.imageProvenance === "string" && layer.imageProvenance
      ? { imageProvenance: layer.imageProvenance }
      : {}),
    // Per-element animation captured from Canva's design model (fiber-walk) → editor fields.
    ...buildEditorAnimationFields(layer?.animation),
    // Drop shadow from the model, applied HERE so every emitted object type gets it — editable
    // shape, rebuilt vector, image and text all funnel through this annotator. The alpha rides in
    // the colour (`rgba(...)`) because the editor element has no separate shadow-opacity field;
    // the mobile exporter splits it back out via rgbaToHexWithOpacity.
    ...(layer?.modelShadow && typeof layer.modelShadow === "object"
      ? {
          shadowColor: String(layer.modelShadow.color || "rgba(0, 0, 0, 0.3)"),
          shadowBlur: Math.max(0, numberOr(layer.modelShadow.blur, 0)),
          shadowOffsetX: numberOr(layer.modelShadow.offsetX, 0),
          shadowOffsetY: numberOr(layer.modelShadow.offsetY, 0),
        }
      : {}),
    // Per-element timeline window (when the element appears/disappears) from the model's
    // startUs/durationUs — so a sequenced timeline/video design plays in order instead of piling
    // every element at t=0. The editor reads these (SidePanel → resolveTimelineWindow).
    ...(Number.isFinite(Number(layer?.timelineStartMs))
      ? { timelineStartMs: Math.max(0, Math.round(Number(layer.timelineStartMs))) }
      : {}),
    ...(Number.isFinite(Number(layer?.timelineEndMs))
      ? { timelineEndMs: Math.max(0, Math.round(Number(layer.timelineEndMs))) }
      : {}),
    // Permanent build stamp — lets the DB prove which service-worker version produced an
    // import (the worker can stay cached on an old version even when the badge updates).
    extBuild: EXTENSION_BUILD,
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
      // EVERY (weight, style) this family's text is set in, not just the dominant one. The
      // importer stores a real file per cut, and picking by "closest to the dominant weight"
      // grabbed near-neighbours the design never uses (300/600) while missing the ones it does.
      usedVariants: [...bucket.keys()].map((key) => {
        const [weightText, styleText] = key.split("|");
        return {
          weight: parseNumericFontWeight(weightText, 400),
          style: normalizeFontStyleValue(styleText),
        };
      }),
    };
  });
  return result;
}

function getFontTargetForFamily(fontTargetsByFamily, family) {
  // NOTE: this rebuilds a clean {fontWeight, fontStyle} for the ranker, so anything else the
  // usage scan computed must be carried across EXPLICITLY — `usedVariants` (every weight the
  // design sets this family in) was silently dropped here, which made every family look like it
  // only used 400 and so never got a bold bucket.
  const empty = { fontWeight: 400, fontStyle: "normal", usedVariants: [] };
  const normalizedFamily = normalizeFontFamilyName(family);
  if (!normalizedFamily) return empty;
  const source = fontTargetsByFamily && typeof fontTargetsByFamily === "object" ? fontTargetsByFamily : {};
  const readTarget = (entry) => ({
    fontWeight: parseNumericFontWeight(entry.fontWeight, 400),
    fontStyle: normalizeFontStyleValue(entry.fontStyle),
    usedVariants: Array.isArray(entry.usedVariants) ? entry.usedVariants : [],
  });
  if (source[normalizedFamily]) return readTarget(source[normalizedFamily]);
  const targetKey = normalizedFamily.toLowerCase();
  const matchedKey = Object.keys(source).find(
    (candidate) => normalizeFontFamilyName(candidate).toLowerCase() === targetKey
  );
  if (!matchedKey || !source[matchedKey]) return empty;
  return readTarget(source[matchedKey]);
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
    const rawFontSize = Math.max(8, numberOr(layer?.fontSize, 28));
    const letterSpacingPx = numberOr(layer?.letterSpacing, 0);
    // charSpacing is em-based (1/1000 em); derive it from the RAW size, then scale fontSize — so the
    // glyphs AND their letter-spacing shrink by the same 5%, a uniform reduction (not just smaller
    // letters with the original px gaps). Floor at 8px so tiny labels stay legible.
    const charSpacing = rawFontSize > 0 ? (letterSpacingPx / rawFontSize) * 1000 : 0;
    const fontSize = Math.max(8, rawFontSize * IMPORT_TEXT_FONT_SCALE);
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

  // Editable shape from the MODEL (simple solid-colour circle/rect). Canva renders these as
  // PROTECTED raster images, so the DOM path snapshot-crops them with a baked-in background; the
  // model carries the clean vector, so emit a preset circle/rect fabric object (SidePanel turns
  // type:"circle"/"rect" into an editable editor shape). Runs BEFORE the image path, so no protected
  // src reaches the server — no 403, no snapshot crop, no baked background. Takes priority over the
  // legacy kind==="shape" handler because these layers are usually classified as images.
  if (
    layer?.modelShape &&
    (typeof layer.modelShape.fillColor === "string" ||
      typeof layer.modelShape.strokeColor === "string") &&
    (layer.modelShape.shapeKind === "circle" || layer.modelShape.shapeKind === "rect")
  ) {
    const ms = layer.modelShape;
    const shapeKind = ms.shapeKind;
    const hasStroke = typeof ms.strokeColor === "string" && Number(ms.strokeWidth) > 0;
    const shapeAnchor = resolveRotatedTopLeftAnchor(left, top, width, height, angle);
    return annotateImportMetadata(
      {
        type: shapeKind,
        version: "7.0.0",
        originX: "left",
        originY: "top",
        left: shapeAnchor.left,
        top: shapeAnchor.top,
        width,
        height,
        scaleX: 1,
        scaleY: 1,
        angle,
        opacity,
        // Stroke-only outline shapes (photo frames, contact bars, ring dividers) have no fill →
        // emit a transparent fill so only the outline shows; the editor reads fill/stroke/strokeWidth.
        fill: typeof ms.fillColor === "string" ? ms.fillColor : "transparent",
        stroke: hasStroke ? ms.strokeColor : "rgba(0,0,0,0)",
        strokeWidth: hasStroke ? Number(ms.strokeWidth) : 0,
        // Rounded rects (pill labels, rounded bars): the editor's rect loader reads max(rx, ry).
        ...(shapeKind === "rect" && Number(ms.cornerRadius) > 0
          ? { rx: Math.round(Number(ms.cornerRadius)), ry: Math.round(Number(ms.cornerRadius)) }
          : {}),
        flipX,
        flipY,
        layerType: "shape",
        layerName:
          String(layer?.name || "").trim() ||
          `${shapeKind === "circle" ? "Circle" : "Rectangle"} ${index + 1}`,
        layerLocked: false,
        layerHidden: false,
      },
      layer
    );
  }

  // Model-rebuilt VECTOR shape (arch / blob / badge / gradient fill — anything the editable
  // circle/rect branch above can't express). Canva renders these as PROTECTED rasters, so the DOM
  // paths can only screenshot-crop them: no alpha, so the shape's silhouette is lost and whatever
  // was painted behind it bakes into every pixel outside the path (a rounded arch imported as a
  // hard rectangle with the page baked into its corners). The SVG rebuilt from the design model
  // has the exact path and real transparency; the server rasterizes it to a PNG, alpha intact.
  const modelVectorSvg = String(layer?.modelVectorSvg || "");
  if (modelVectorSvg.includes("<svg")) {
    const vectorAnchor = resolveRotatedTopLeftAnchor(left, top, width, height, angle);
    return annotateImportMetadata(
      {
        type: "image",
        version: "7.0.0",
        originX: "left",
        originY: "top",
        left: vectorAnchor.left,
        top: vectorAnchor.top,
        width,
        height,
        scaleX: 1,
        scaleY: 1,
        angle,
        opacity,
        src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(modelVectorSvg)}`,
        flipX,
        flipY,
        layerType: "image",
        layerName: String(layer?.name || "").trim() || `Shape ${index + 1}`,
        layerLocked: false,
        layerHidden: false,
        sourceWidth: width,
        sourceHeight: height,
      },
      layer
    );
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
        // trimmedImage.{width,height,offsetX,offsetY} are measured in the NATURAL
        // pixel space of the decoded source (originalWidth/Height). Map that space to
        // the layer's displayed design frame (width/height) using originalWidth/Height
        // as the denominator — NOT intrinsicWidth. For masked / preserve-pixels layers
        // intrinsicWidth (= layer.sourceWidth) is the design frame itself, which would
        // make the scale 1.0 and blow the image up to its full natural resolution
        // (e.g. a 1126px frame rendered at the image's native 2400px → 2.1x oversize).
        const naturalSourceWidth = Math.max(
          1,
          Math.round(trimmedImage.originalWidth || intrinsicWidth || width)
        );
        const naturalSourceHeight = Math.max(
          1,
          Math.round(trimmedImage.originalHeight || intrinsicHeight || height)
        );
        const sourceScaleX = width / naturalSourceWidth;
        const sourceScaleY = height / naturalSourceHeight;
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

  // Canva photo-frame outline + rounded corners → the editor reads stroke/strokeWidth/cornerRadius
  // on the image object and renders them around the display-sized element (strokeScaleEnabled off),
  // so both are the Canva design-px values directly. Renderers clamp radius to min(w,h)/2 (pills).
  // ONLY for a reproducible frame. Anything else — a blob, an ellipse — keeps the rendered
  // snapshot, which already has the frame's outline baked into its pixels; drawing the model's
  // stroke on top of that would ring the layer TWICE.
  const border = isReproducibleFrameBorder(layer?.modelBorder)
    ? layer.modelBorder
    : null;
  if (border) {
    if (typeof border.strokeColor === "string" && Number(border.strokeWidth) > 0) {
      imageObject.stroke = border.strokeColor;
      imageObject.strokeWidth = Math.max(1, Math.round(Number(border.strokeWidth)));
    }
    if (border.circleFrame) {
      // Canva's round photo frame is an ELLIPSE inscribed in its box — a circle only when that
      // box happens to be square. `mediaShape` is the faithful channel for it: the editor masks
      // to a true ellipse and the mobile renderer maps it to filters.shape CIRCLE.
      imageObject.mediaShape = "circle";
      // Keep the maxed corner radius alongside it as the graceful degradation: any renderer that
      // doesn't know `mediaShape` still draws the closest thing a rounded rect can (a stadium,
      // and an exact circle whenever the box IS square) rather than a bare rectangle. Measured on
      // the DISPLAYED box (width/height here, not the intrinsic objectWidth/Height), which is the
      // space both the editor and mobile read the radius in.
      imageObject.cornerRadius = Math.max(1, Math.round(Math.min(width, height) / 2));
    } else if (Number(border.cornerRadius) > 0) {
      imageObject.cornerRadius = Math.round(Number(border.cornerRadius));
    }
  }

  if (/^https?:\/\//i.test(imageSrc)) {
    imageObject.crossOrigin = "anonymous";
  }

  return annotateImportMetadata(imageObject, layer);
}

// A full-page OPAQUE solid-color rect stacked ABOVE an image is almost always a
// mis-ordered page background — it paints over the real (image) background, so the
// import renders as a flat color. Move such rects to the bottom of the z-order so the
// decorative background image shows. Semi-transparent overlays (opacity < 0.98) are
// left alone — those are intentional tints.
function reorderBackgroundRectsToBottom(objects, canvasWidth, canvasHeight) {
  if (!Array.isArray(objects) || objects.length < 2) return objects;
  const pageArea = Math.max(1, Number(canvasWidth || 0) * Number(canvasHeight || 0));
  const firstImageIndex = objects.findIndex(
    (object) => String(object?.type || "").toLowerCase() === "image"
  );
  if (firstImageIndex < 0) return objects;
  const isFullPageOpaqueRect = (object) => {
    if (String(object?.type || "").toLowerCase() !== "rect") return false;
    if (Math.max(0, Math.min(1, numberOr(object?.opacity, 1))) < 0.98) return false;
    const width = Math.max(1, numberOr(object?.width, 1) * Math.abs(numberOr(object?.scaleX, 1)));
    const height = Math.max(1, numberOr(object?.height, 1) * Math.abs(numberOr(object?.scaleY, 1)));
    return (width * height) / pageArea >= 0.92;
  };
  const movedRects = [];
  const rest = [];
  objects.forEach((object, index) => {
    if (index > firstImageIndex && isFullPageOpaqueRect(object)) {
      movedRects.push(object);
    } else {
      rest.push(object);
    }
  });
  if (movedRects.length === 0) return objects;
  return [...movedRects, ...rest];
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
  // Optional screenshot with editable-text layers hidden. Image layers that fall back
  // to screenshot raster crops are cropped from THIS bitmap so overlapping foreground
  // text isn't baked into the image (the text is emitted separately as an editable
  // layer; baking it would render the text twice). Falls back to the normal screenshot.
  const screenshotBitmapNoText = options?.screenshotBitmapNoText || null;
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
    // Model-classified simple shape (solid circle/rect): emit the editable preset shape directly and
    // skip ALL image/snapshot logic below — Canva renders these as protected rasters, so letting
    // them fall through would snapshot-crop them with a baked background instead.
    if (
      layer?.modelShape &&
      (typeof layer.modelShape.fillColor === "string" ||
        typeof layer.modelShape.strokeColor === "string") &&
      (layer.modelShape.shapeKind === "circle" || layer.modelShape.shapeKind === "rect")
    ) {
      const shapeObject = await layerToFabricObject(layer, result.length);
      if (shapeObject) {
        result.push(shapeObject);
        continue;
      }
    }
    // Same short-circuit for a shape rebuilt as a VECTOR (arch / blob / gradient fill): the SVG
    // from the design model is the only source with the real silhouette and true transparency, so
    // it must not fall through to the snapshot/crop branches that would flatten it back into an
    // opaque rectangle.
    if (String(layer?.modelVectorSvg || "").includes("<svg")) {
      const vectorObject = await layerToFabricObject(layer, result.length);
      if (vectorObject) {
        result.push(vectorObject);
        continue;
      }
    }
    const layerKind = String(layer?.kind || "").toLowerCase();
    // Plain overflow/aspect crops (snapshotIsLossyFallback) keep the high-resolution
    // fetched asset that the scraper already cropped to the visible region, so skip the
    // lossy on-screen screenshot snapshot whenever we actually captured the asset pixels.
    // Require real data-URL pixels (not a bare remote URL whose fetch may have failed) so
    // a failed asset fetch safely falls back to the snapshot. Genuine masks/composites
    // have snapshotIsLossyFallback=false and still snapshot.
    const hasCapturedImagePixels =
      String(layer?.imageDataUrl || "").startsWith("data:image/") ||
      String(layer?.imageSrc || "").startsWith("data:image/");
    let directAssetPreferredOverSnapshot =
      layerKind === "image" &&
      Boolean(layer?.snapshotIsLossyFallback) &&
      hasCapturedImagePixels;
    // Auto-pick: if the captured asset has the page background baked into it (markedly more
    // opaque than the clean isolation snapshot), use the snapshot instead — it diffs the
    // background out. Genuine cut-outs keep their high-res asset.
    // A model-confirmed photo frame (rect or circle) is EXEMPT from that auto-pick: its asset is
    // meant to be a fully-opaque rectangle, because the editor applies the frame itself via
    // cornerRadius. Comparing opaqueness would otherwise always hand a ROUND frame back to the
    // snapshot — a circle covers only ~79% of its box, so the asset reads 21% "more opaque",
    // over the baked-background threshold — and the snapshot has no alpha to mask with, which is
    // exactly how a circular photo ended up an opaque square.
    const modelFrame = isReproducibleFrameBorder(layer?.modelBorder);
    if (directAssetPreferredOverSnapshot && !modelFrame) {
      const snapshotDataUrl = String(layer?.isolatedImageDataUrl || "");
      const hadSnapshot = snapshotDataUrl.startsWith("data:image/");
      const assetOpaque = await imageOpaqueFraction(String(layer?.imageDataUrl || ""));
      const snapshotOpaque = hadSnapshot ? await imageOpaqueFraction(snapshotDataUrl) : -1;
      const useSnapshot = hadSnapshot && snapshotOpaque >= 0.03 && assetOpaque - snapshotOpaque > 0.15;
      if (useSnapshot) {
        directAssetPreferredOverSnapshot = false;
      }
    }
    const shouldForceSnapshotForLayer =
      layerKind === "image" &&
      Boolean(layer?.preferSnapshot) &&
      !layer?.hasCompanionText &&
      !directAssetPreferredOverSnapshot;
    const layerFontFamily = normalizeFontFamilyName(layer?.fontFamily).toLowerCase();
    const shouldRasterizeUnsupportedText =
      layerKind === "text" &&
      Boolean(layerFontFamily) &&
      unsupportedTextFamilies.has(layerFontFamily) &&
      // Off-screen model (timeline supplement) text is NOT in the screenshot, so rasterizing it
      // from a screenshot crop would yield a blank — keep it as an editable text object instead.
      !layer?.fromModel;
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
    // Off-screen model (timeline supplement) images aren't in the screenshot, so every
    // screenshot-crop fallback below would bake a blank raster. The direct path above already
    // used the shared-media pixels; if that failed there's nothing to salvage — skip cleanly.
    if (layer?.fromModel) {
      continue;
    }

    const layerWidth = Math.max(1, Math.round(numberOr(layer?.width, 1)));
    const layerHeight = Math.max(1, Math.round(numberOr(layer?.height, 1)));
    const layerArea = layerWidth * layerHeight;
    // This gate culls near-full-page images that would blanket the design — meant for
    // redundant flattened SCREENSHOT layers. A full-page image backed by a real fetched
    // asset (data/blob/fetch/shape-svg) is legit content — typically a textured paper
    // background — so keep it; only raster (screenshot) full-page layers stay droppable.
    const hasRealAssetProvenance = ["data", "blob", "fetch", "fetch-fit", "shape-svg"].includes(
      String(layer?.imageProvenance || "")
    );
    if (
      resolvableImageLayerCount > 0 &&
      layerArea > canvasArea * 0.8 &&
      !layer?.isBackgroundNode &&
      !layer?.isFullPageBackground &&
      !looksLikeDecorativeFrameLayer(layer) &&
      !hasRealAssetProvenance
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
      // Crop image layers from the text-hidden screenshot so overlapping editable text
      // isn't baked into the raster (it is re-added as an editable text layer).
      const cropped = await cropBitmapToDataUrl(
        screenshotBitmapNoText || screenshotBitmap,
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

// The dashboard import POST is sent as MULTIPART: createDashboardMultipartPayload() moves every
// externalizable data: URL (keys src/imageDataUrl/dataUrl/thumbnailDataUrl) into its own binary
// part, leaving only a tiny {__canvaMultipartAssetRef} placeholder in the JSON manifest. So the
// real transport size is the manifest WITHOUT the inlined image bytes. Measure that — not the
// fully-inlined base64 JSON — otherwise a design multipart can comfortably carry gets needlessly
// flattened to a single snapshot just because its images are large.
function estimateExternalizedTransportLength(body) {
  try {
    const serialized = JSON.stringify(body, (key, value) =>
      shouldExternalizeMultipartAsset(key, value) ? "__canvaMultipartAssetRef__" : value
    );
    return serialized ? serialized.length : 0;
  } catch (_error) {
    try {
      return JSON.stringify(body).length;
    } catch (_secondError) {
      return Number.MAX_SAFE_INTEGER;
    }
  }
}

function compactRequestBody(body, fallbackImageDataUrl, fallbackWidth, fallbackHeight) {
  let nextBody = { ...body };
  if (estimateExternalizedTransportLength(nextBody) <= MAX_TRANSPORT_JSON_LENGTH) {
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

  if (estimateExternalizedTransportLength(nextBody) <= MAX_TRANSPORT_JSON_LENGTH) {
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

  if (estimateExternalizedTransportLength(nextBody) <= MAX_TRANSPORT_JSON_LENGTH) {
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

  if (estimateExternalizedTransportLength(nextBody) <= MAX_TRANSPORT_JSON_LENGTH) {
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

// Extract Canva's full per-element design model from the React fiber. This MUST run in the page's
// MAIN world — content scripts run in an ISOLATED world where DOM nodes do NOT expose React's
// __reactFiber$ expando, so the same walk inside canva-scraper.js (isolated) always returns {}. It
// is injected via chrome.scripting.executeScript({ world: "MAIN", func: extractCanvaFiberModel }) and
// so must be fully SELF-CONTAINED (no outer references). Returns { [LBid]: { type, left, top, width,
// height, rotation, transparency, startUs, durationUs, animation, text, image } } — a superset of the
// DOM used to supplement off-screen layers of timeline/video designs. Mirrors canva-scraper.js's
// buildFiberElementModel(); keep the two in sync. Best-effort: {} on any failure.
function extractCanvaFiberModel() {
  const result = {};
  try {
    const usToMs = (us) =>
      Number.isFinite(Number(us)) && Number(us) > 0 ? Math.round(Number(us) / 1000) : undefined;
    const seed = document.querySelector('[id^="LB"]');
    if (!seed) return result;
    const fiberKey = Object.keys(seed).find((k) => k.startsWith("__reactFiber$"));
    if (!fiberKey) return result;
    let fiber = seed[fiberKey];
    let doc = null;
    let hops = 0;
    while (fiber && hops < 120) {
      const props = fiber.memoizedProps;
      if (
        props &&
        props.document &&
        (props.document.doctype !== undefined || props.document.pages !== undefined)
      ) {
        doc = props.document;
        break;
      }
      fiber = fiber.return;
      hops += 1;
    }
    if (!doc) return result;
    const seen = new Set();
    let elementsArray = null;
    const findElements = (obj, depth) => {
      if (elementsArray || !obj || typeof obj !== "object" || depth > 14 || seen.has(obj)) return;
      seen.add(obj);
      if (Array.isArray(obj)) {
        if (
          obj.length &&
          obj.some((it) => it && typeof it.id === "string" && /^LB/.test(it.id) && "animation" in it)
        ) {
          elementsArray = obj;
          return;
        }
        for (const it of obj) findElements(it, depth + 1);
      } else {
        for (const key in obj) {
          try {
            findElements(obj[key], depth + 1);
          } catch (_e) {
            /* observable getters can throw */
          }
        }
      }
    };
    findElements(doc, 0);
    if (!elementsArray) return result;
    const allElements = [];
    const collected = new Set();
    const collect = (items, depth) => {
      if (!Array.isArray(items) || depth > 10) return;
      for (const el of items) {
        if (!el || typeof el !== "object" || collected.has(el)) continue;
        collected.add(el);
        allElements.push(el);
        for (const key in el) {
          try {
            const val = el[key];
            if (Array.isArray(val) && val.some((it) => it && typeof it === "object" && "type" in it)) {
              collect(val, depth + 1);
            }
          } catch (_e) {
            /* ignore */
          }
        }
      }
    };
    collect(elementsArray, 0);

    // Canva custom "create an animation" motion paths are DELTA-encoded keyframe streams: a time
    // array (per-sample ms deltas, all ≥0, summing ≈ durationUs/1000) + x/y px delta arrays.
    // MINIFIED NAMES ROTATE BETWEEN CANVA DEPLOYS (observed: dts/eGd/gGd → dts/SGd/UGd), so the
    // arrays are identified STRUCTURALLY: time = the non-negative array whose sum best matches the
    // track duration; x/y = the remaining two by known-name priority, else alphabetical order.
    const decodeMotionPath = (track) => {
      try {
        if (!track || typeof track !== "object") return null;
        const arrays = Object.keys(track).filter(
          (k) => Array.isArray(track[k]) && track[k].length >= 2 && track[k].every((v) => Number.isFinite(Number(v)))
        );
        if (arrays.length < 2) return null;
        const durationMsTarget = Number(track.durationUs) > 0 ? Number(track.durationUs) / 1000 : null;
        const sums = {};
        for (const k of arrays) sums[k] = track[k].reduce((a, v) => a + (Number(v) || 0), 0);
        // time array: all non-negative; when several qualify, the one closest to the track duration
        let timeKey = null;
        let bestScore = Infinity;
        for (const k of arrays) {
          if (!track[k].every((v) => Number(v) >= 0)) continue;
          const score = durationMsTarget ? Math.abs(sums[k] - durationMsTarget) : -sums[k];
          if (score < bestScore) {
            bestScore = score;
            timeKey = k;
          }
        }
        if (!timeKey) return null;
        const rest = arrays.filter((k) => k !== timeKey);
        if (!rest.length) return null;
        const X_NAMES = ["eGd", "SGd"];
        const Y_NAMES = ["gGd", "UGd"];
        let xKey = rest.find((k) => X_NAMES.includes(k));
        let yKey = rest.find((k) => Y_NAMES.includes(k));
        if (!xKey || !yKey) {
          const ordered = [...rest].sort();
          xKey = xKey || ordered.find((k) => k !== yKey);
          yKey = yKey || ordered.find((k) => k !== xKey) || null;
        }
        const dts = track[timeKey];
        const xs = track[xKey];
        const ys = yKey ? track[yKey] : null;
        const n = Math.min(dts.length, xs.length, ys ? ys.length : xs.length);
        let t = 0;
        let x = 0;
        let y = 0;
        const raw = [];
        for (let i = 0; i < n; i += 1) {
          t += Number(dts[i]) || 0;
          x += Number(xs[i]) || 0;
          y += Number(ys ? ys[i] : 0) || 0;
          raw.push({ t: Math.round(t), x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
        }
        if (raw.length < 2) return null;
        let span = 0;
        for (const p of raw) span = Math.max(span, Math.abs(p.x), Math.abs(p.y));
        if (span < 2) return null;
        const MAX_POINTS = 48;
        if (raw.length <= MAX_POINTS) return raw;
        const sampled = [];
        for (let i = 0; i < MAX_POINTS; i += 1) {
          sampled.push(raw[Math.round((i * (raw.length - 1)) / (MAX_POINTS - 1))]);
        }
        return sampled;
      } catch (_e) {
        return null;
      }
    };
    const extractAnimation = (el) => {
      const anim = el && el.animation;
      if (!anim || typeof anim !== "object") return null;
      // Track CONTAINER found structurally (was anim.Sv, now anim.Tv — names rotate): the first
      // object-valued prop whose children include a track ({durationUs > 0}).
      let container = null;
      for (const key of Object.keys(anim)) {
        const v = anim[key];
        if (!v || typeof v !== "object" || Array.isArray(v)) continue;
        for (const kk of Object.keys(v)) {
          const t = v[kk];
          if (t && typeof t === "object" && Number(t.durationUs) > 0) {
            container = v;
            break;
          }
        }
        if (container) break;
      }
      // classify tracks by SHAPE: ≥2 numeric arrays = keyframe/loop track; else plain duration
      // tracks — entrance/exit resolved by known names first (Wf=in; tf/sf=out), else by order.
      let inTrack = null;
      let outTrack = null;
      let kfCandidate = null;
      if (container) {
        const plain = [];
        for (const kk of Object.keys(container)) {
          const t = container[kk];
          if (!t || typeof t !== "object" || !(Number(t.durationUs) > 0)) continue;
          const arrayCount = Object.keys(t).filter((a) => Array.isArray(t[a]) && t[a].length >= 2).length;
          if (arrayCount >= 2) kfCandidate = t;
          else plain.push({ key: kk, track: t });
        }
        const inPlain = plain.find((p) => ["Wf", "in", "enter"].includes(p.key)) || plain[0] || null;
        const outPlain =
          plain.find((p) => ["tf", "sf", "out", "exit"].includes(p.key)) ||
          plain.find((p) => p !== inPlain) ||
          null;
        inTrack = inPlain ? inPlain.track : null;
        outTrack = outPlain && outPlain !== inPlain ? outPlain.track : null;
      }
      const motionPath = kfCandidate ? decodeMotionPath(kfCandidate) : null;
      const loopTrack = motionPath ? null : kfCandidate;
      let mode;
      let durationMs;
      let easingRaw;
      if (inTrack) {
        mode = "IN";
        durationMs = usToMs(inTrack.durationUs);
        easingRaw = inTrack.easing;
      } else if (loopTrack) {
        mode = "LOOP";
        durationMs = usToMs(loopTrack.durationUs);
        easingRaw = loopTrack.easing;
      } else if (outTrack) {
        mode = "OUT";
        durationMs = usToMs(outTrack.durationUs);
        easingRaw = outTrack.easing;
      }
      const canvaPreset = Number.isFinite(Number(anim.animation)) ? Number(anim.animation) : null;
      if (canvaPreset === null && !mode && !motionPath) return null;
      return {
        canvaPreset,
        family: typeof anim.type === "string" ? anim.type : undefined,
        mode,
        inMs: inTrack ? usToMs(inTrack.durationUs) : undefined,
        outMs: outTrack ? usToMs(outTrack.durationUs) : undefined,
        loopMs: loopTrack ? usToMs(loopTrack.durationUs) : undefined,
        durationMs,
        delayMs: usToMs(el.startUs),
        easing: Number.isFinite(Number(easingRaw)) ? Number(easingRaw) : undefined,
        ...(motionPath ? { motionPath } : {}),
      };
    };
    const extractText = (el) => {
      try {
        const stream = el.text && el.text.stream;
        if (!stream) return null;
        let plaintext = "";
        const cells = stream.cells || {};
        // run-strings array (was cells.xc — minified names rotate): first all-string array
        let runs = Array.isArray(cells.xc) ? cells.xc : null;
        if (!runs) {
          for (const k of Object.keys(cells)) {
            const v = cells[k];
            if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string")) {
              runs = v;
              break;
            }
          }
        }
        if (Array.isArray(runs)) plaintext = runs.join("");
        plaintext = String(plaintext == null ? "" : plaintext);
        const items = stream.attrs && stream.attrs.items;
        let style = {};
        if (Array.isArray(items) && items.length) {
          // Style bag prop name rotates between deploys (observed j7→q7, Pdb→Xdb) — resolve
          // STRUCTURALLY: any child object carrying CSS-ish keys; the inner keys ("color",
          // "font-family", …) are stable. Mixed-script text (Arabic name + Latin year) splits into
          // runs whose FIRST run may lack font/size — merge across ALL runs, first defined wins.
          const merged = {};
          for (const item of items) {
            if (!item || typeof item !== "object") continue;
            let bag = null;
            for (const k of Object.keys(item)) {
              const v = item[k];
              if (!v || typeof v !== "object") continue;
              if (!("font-family" in v) && !("color" in v) && !("font-size" in v)) continue;
              if (!bag || typeof v["font-size"] === "number") bag = v;
            }
            if (!bag) continue;
            for (const prop of ["color", "font-family", "font-size", "text-align", "direction"]) {
              if (merged[prop] === undefined && bag[prop] !== undefined) merged[prop] = bag[prop];
            }
          }
          style = {
            color: typeof merged.color === "string" ? merged.color : undefined,
            fontFamilyToken: typeof merged["font-family"] === "string" ? merged["font-family"] : undefined,
            fontSize: Number(merged["font-size"]) > 0 ? Number(merged["font-size"]) : undefined,
            textAlign: typeof merged["text-align"] === "string" ? merged["text-align"] : undefined,
            direction: typeof merged.direction === "string" ? merged.direction : undefined,
          };
        }
        return { plaintext, ...style };
      } catch (_e) {
        return null;
      }
    };
    const extractImage = (el) => {
      try {
        const img = el.fill && el.fill.image;
        const media = img && img.media;
        if (!media || typeof media.id !== "string") return null;
        const sb = img.sb && typeof img.sb === "object" ? img.sb : null;
        return {
          mediaId: media.id,
          version: Number(media.version) || undefined,
          crop: sb
            ? {
                top: Number(sb.top) || 0,
                left: Number(sb.left) || 0,
                width: Number(sb.width) || 0,
                height: Number(sb.height) || 0,
                rotation: Number(sb.rotation) || 0,
              }
            : null,
          transparency: Number(img.transparency) || 0,
          // fill-level mirroring (e.g. paired corner decorations) — lost = wrong orientation
          flipX: Boolean(el.fill && el.fill.flipX),
          flipY: Boolean(el.fill && el.fill.flipY),
        };
      } catch (_e) {
        return null;
      }
    };
    // Corner radius of a shape path, in DESIGN px — minified numeric prop on the path (observed
    // `mb`); known name first, structural numeric fallback. 0 = sharp.
    const readPathCornerRadius = (p0) => {
      try {
        if (!p0 || typeof p0 !== "object") return 0;
        if (typeof p0.mb === "number" && Number.isFinite(p0.mb)) return Math.max(0, Math.round(p0.mb));
        for (const k of Object.keys(p0)) {
          const v = p0[k];
          if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.max(0, Math.round(v));
        }
      } catch (_e) {
        /* ignore */
      }
      return 0;
    };
    // Canva 'shape' elements (paths + viewBox + fill) RENDER as protected raster images in the DOM,
    // so the DOM capture path can only snapshot-crop them (baked background). The model holds the
    // clean vector — classify a SIMPLE solid-colour circle/rect (the icon-circle & banner-bar cases)
    // so it imports as an EDITABLE editor shape instead. Complex/image-filled paths → null (image).
    const extractShape = (el) => {
      try {
        const paths = Array.isArray(el.paths) ? el.paths : null;
        if (!paths || paths.length !== 1) return null;
        const p0 = paths[0] || {};
        // A path FILLED WITH AN IMAGE is a Canva photo-frame (the shape clips a photo), NOT an
        // editable shape — leave it to the image path so the photo is preserved.
        if (p0.fill && typeof p0.fill === "object" && p0.fill.image) return null;
        const d = String(p0.d || "").trim();
        let shapeKind = null;
        if (/^M0[ ,]0\s*H[\d.]+\s*V[\d.]+\s*H0\s*z?$/i.test(d)) shapeKind = "rect";
        else if (/A/.test(d) && !/[LlCcQqSsTtHhVv]/.test(d)) shapeKind = "circle";
        if (!shapeKind) return null;
        // Solid fill AND/OR an outline stroke — Canva photo frames, pill labels and dividers are
        // stroke-only rects/circles (no fill). Emit whichever paint(s) the shape carries.
        const fillColor = p0.fill && typeof p0.fill.color === "string" ? p0.fill.color : null;
        const stroke = p0.stroke && typeof p0.stroke === "object" ? p0.stroke : null;
        const strokeColor = stroke && typeof stroke.color === "string" ? stroke.color : null;
        const strokeWidth =
          stroke && Number(stroke.weight) > 0 ? Math.max(1, Math.round(Number(stroke.weight))) : 0;
        if (!fillColor && !(strokeColor && strokeWidth > 0)) return null;
        return { shapeKind, fillColor, strokeColor, strokeWidth, cornerRadius: readPathCornerRadius(p0) };
      } catch (_e) {
        return null;
      }
    };
    // Border + corner radius for an IMAGE-filled shape (Canva photo-frame).
    const extractBorder = (el) => {
      try {
        const paths = Array.isArray(el.paths) ? el.paths : null;
        const p0 = paths && paths.length === 1 ? paths[0] : null;
        if (!p0 || !(p0.fill && typeof p0.fill === "object" && p0.fill.image)) return null;
        const stroke = p0.stroke && typeof p0.stroke === "object" ? p0.stroke : null;
        const strokeColor = stroke && typeof stroke.color === "string" ? stroke.color : null;
        const strokeWidth =
          stroke && Number(stroke.weight) > 0 ? Math.max(1, Math.round(Number(stroke.weight))) : 0;
        const cornerRadius = readPathCornerRadius(p0);
        const d = String(p0.d || "").trim();
        // rectFrame: plain rect frame → editor reproduces frame+radius+stroke exactly;
        // rendered snapshot never needed.
        const rectFrame = /^M0[ ,]0\s*H[\d.]+\s*V[\d.]+\s*H0\s*z?$/i.test(d);
        // circleFrame: an arc-only path is Canva's round photo frame — a true ELLIPSE inscribed
        // in the box, a circle only when that box is square. The editor reproduces it via
        // `mediaShape: "circle"` at any aspect, so the layer keeps its clean fetched asset
        // instead of the isolation snapshot (which has no alpha outside the mask, and so
        // came back as an opaque rectangle with the page baked into its corners).
        const circleFrame = !rectFrame && /A/.test(d) && !/[LlCcQqSsTtHhVv]/.test(d);
        if (!(strokeColor && strokeWidth > 0) && !(cornerRadius > 0) && !circleFrame) return null;
        return { strokeColor, strokeWidth, cornerRadius, rectFrame, circleFrame };
      } catch (_e) {
        return null;
      }
    };
    // Drop shadow: found STRUCTURALLY (the array keys are minified and rotate between deploys)
    // via the stable "shadow" id + "drop-shadow" type. offset/blur are design px 1:1, angle is
    // anticlockwise from +x with y pointing down, alpha = 1 - transparency. See the canonical,
    // commented copy in canva-fiber-main.js.
    const hexToRgba = (hex, alpha) => {
      const raw = String(hex || "").trim().replace(/^#/, "");
      const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
      if (!/^[0-9a-f]{6}$/i.test(full)) return null;
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
    };
    const extractShadow = (el) => {
      try {
        for (const key in el) {
          let bucket;
          try {
            bucket = el[key];
          } catch (_e) {
            continue;
          }
          if (!Array.isArray(bucket)) continue;
          for (const entry of bucket) {
            if (!entry || typeof entry !== "object" || entry.id !== "shadow") continue;
            for (const innerKey in entry) {
              const effects = entry[innerKey];
              if (!Array.isArray(effects)) continue;
              const drop = effects.find((e) => e && String(e.type || "") === "drop-shadow");
              if (!drop) continue;
              const blur = Math.max(0, Number(drop.blur) || 0);
              const offset = Math.max(0, Number(drop.offset) || 0);
              if (blur <= 0 && offset <= 0) return null;
              let transparency = Number(drop.fill && drop.fill.transparency) || 0;
              if (transparency > 1) transparency /= 100;
              const alpha = Math.max(0, Math.min(1, 1 - transparency));
              if (alpha <= 0) return null;
              const color = hexToRgba((drop.fill && drop.fill.color) || "#000000", alpha);
              if (!color) return null;
              const radians = ((Number(drop.direction) || 0) * Math.PI) / 180;
              return {
                color,
                blur: Math.round(blur * 100) / 100,
                offsetX: Math.round(-offset * Math.sin(radians) * 100) / 100,
                offsetY: Math.round(offset * Math.cos(radians) * 100) / 100,
              };
            }
          }
        }
      } catch (_e) {
        return null;
      }
      return null;
    };
    // Rebuild a non-simple shape (arch / blob / gradient fill) as an SVG — Canva renders these as
    // protected rasters, and a screenshot crop has no alpha so the silhouette is lost. See the
    // canonical, commented copy in canva-fiber-main.js.
    const svgColor = (color, transparency) => {
      const hex = typeof color === "string" ? color.trim() : "";
      if (!hex) return null;
      let t = Number(transparency) || 0;
      if (t > 1) t /= 100;
      return { hex, alpha: Math.max(0, Math.min(1, 1 - t)) };
    };
    const svgPaintFromFill = (fill, gradientId) => {
      if (!fill || typeof fill !== "object") return null;
      const gradient = fill.gradient && typeof fill.gradient === "object" ? fill.gradient : null;
      if (gradient && Array.isArray(gradient.stops) && gradient.stops.length > 0) {
        const stops = gradient.stops
          .map((stop) => {
            const paint = svgColor(stop && stop.color, stop && stop.transparency);
            if (!paint) return null;
            const offset = Math.max(0, Math.min(1, Number(stop.position) || 0));
            return `<stop offset="${offset}" stop-color="${paint.hex}" stop-opacity="${paint.alpha}"/>`;
          })
          .filter(Boolean);
        if (stops.length === 0) return null;
        const isRadial = String(gradient.type || "").toLowerCase() === "radial";
        const cx = Number(gradient.center && gradient.center.left);
        const cy = Number(gradient.center && gradient.center.top);
        const defs = isRadial
          ? `<radialGradient id="${gradientId}" cx="${Number.isFinite(cx) ? cx : 0.5}" cy="${
              Number.isFinite(cy) ? cy : 0.5
            }" r="0.75">${stops.join("")}</radialGradient>`
          : `<linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">${stops.join("")}</linearGradient>`;
        return { paint: `url(#${gradientId})`, alpha: 1, defs };
      }
      const solid = svgColor(fill.color, fill.transparency);
      if (!solid) return null;
      return { paint: solid.hex, alpha: solid.alpha, defs: "" };
    };
    const extractVectorShape = (el) => {
      try {
        const paths = Array.isArray(el.paths) ? el.paths : null;
        if (!paths || paths.length === 0 || paths.length > 12) return null;
        if (paths.some((p) => p && p.fill && typeof p.fill === "object" && p.fill.image)) return null;
        const viewBox = el.viewBox && typeof el.viewBox === "object" ? el.viewBox : null;
        const vbWidth = Number(viewBox && viewBox.width) || 0;
        const vbHeight = Number(viewBox && viewBox.height) || 0;
        if (!(vbWidth > 0 && vbHeight > 0)) return null;
        const vbLeft = Number(viewBox.left) || 0;
        const vbTop = Number(viewBox.top) || 0;
        const defs = [];
        const body = [];
        paths.forEach((p, i) => {
          const d = p && typeof p.d === "string" ? p.d.trim() : "";
          if (!d) return;
          const fillPaint = svgPaintFromFill(p.fill, `g${i}`);
          const stroke = p.stroke && typeof p.stroke === "object" ? p.stroke : null;
          const strokePaint = stroke ? svgColor(stroke.color, stroke.transparency) : null;
          const strokeWidth = stroke && Number(stroke.weight) > 0 ? Number(stroke.weight) : 0;
          if (!fillPaint && !(strokePaint && strokeWidth > 0)) return;
          if (fillPaint && fillPaint.defs) defs.push(fillPaint.defs);
          const attrs = [
            `d="${d.replace(/"/g, "'")}"`,
            fillPaint ? `fill="${fillPaint.paint}"` : 'fill="none"',
            fillPaint && fillPaint.alpha < 1 ? `fill-opacity="${fillPaint.alpha}"` : "",
            strokePaint && strokeWidth > 0 ? `stroke="${strokePaint.hex}"` : "",
            strokePaint && strokeWidth > 0 ? `stroke-width="${strokeWidth}"` : "",
            strokePaint && strokeWidth > 0 && strokePaint.alpha < 1
              ? `stroke-opacity="${strokePaint.alpha}"`
              : "",
          ].filter(Boolean);
          body.push(`<path ${attrs.join(" ")}/>`);
        });
        if (body.length === 0) return null;
        const boxWidth = Math.max(1, Math.round(Number(el.width) || vbWidth));
        const boxHeight = Math.max(1, Math.round(Number(el.height) || vbHeight));
        const scale = Math.min(1, 2048 / Math.max(boxWidth, boxHeight));
        const outWidth = Math.max(1, Math.round(boxWidth * scale));
        const outHeight = Math.max(1, Math.round(boxHeight * scale));
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${outWidth}" height="${outHeight}" ` +
          `viewBox="${vbLeft} ${vbTop} ${vbWidth} ${vbHeight}" preserveAspectRatio="none">` +
          (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
          body.join("") +
          `</svg>`;
        return { svg, width: outWidth, height: outHeight };
      } catch (_e) {
        return null;
      }
    };
    // Canva 'line' elements (dividers / rules) are thin strokes the DOM capture's thin-vector gate
    // often drops entirely, leaving a visible gap. The model always has them: a straight stroke
    // with a color + weight (thickness). Recover them as a thin filled rect downstream.
    const extractLine = (el) => {
      try {
        const color =
          typeof el.color === "string"
            ? el.color
            : el.fill && typeof el.fill.color === "string"
              ? el.fill.color
              : null;
        if (!color) return null;
        const weight =
          Number(el.weight) > 0 ? Number(el.weight) : Number(el.height) > 0 ? Number(el.height) : 1;
        return { color, weight: Math.max(1, Math.round(weight)) };
      } catch (_e) {
        return null;
      }
    };
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    // zOrder: Canva's element array order IS the paint order (index 0 = bottom). Stamped
    // EXPLICITLY because the model crosses executeScript arg serialization, which SORTS object
    // keys alphabetically — Object.keys() insertion order does NOT survive the boundary.
    let zOrder = 0;
    for (const el of allElements) {
      const id = String((el && el.id) || "");
      if (!id || !/^LB/.test(id)) continue;
      result[id] = {
        zOrder: zOrder++,
        type: typeof el.type === "string" ? el.type : "",
        left: num(el.left),
        top: num(el.top),
        width: num(el.width),
        height: num(el.height),
        rotation: num(el.rotation),
        transparency: num(el.transparency),
        startUs: num(el.startUs),
        durationUs: num(el.durationUs),
        animation: extractAnimation(el),
        text: el.type === "text" ? extractText(el) : null,
        image: el.type === "rect" ? extractImage(el) : null,
        shape: el.type === "shape" ? extractShape(el) : null,
        line: el.type === "line" ? extractLine(el) : null,
        border: el.type === "shape" ? extractBorder(el) : null,
        vector: el.type === "shape" && !extractShape(el) ? extractVectorShape(el) : null,
        shadow: extractShadow(el),
      };
    }

    // ── Page BACKGROUND clip track (video designs) ──────────────────────────────────────────────
    // The full-canvas backdrop of a Canva video is NOT an LB element — it's a per-scene clip array
    // on the PAGE object (each item: {durationUs, color, video:{video:"VA…", rb placement,
    // transparency, trim}}). Video FILES are signed/protected, but the poster JPGs on
    // video-public.canva.com are public and the editor page has already loaded them — harvest the
    // exact URLs from resource timing. Found structurally (prop names rotate).
    try {
      let pageObj = null;
      const pseen = new Set();
      (function findPage(n, depth) {
        if (pageObj || depth > 12 || !n || typeof n !== "object" || pseen.has(n)) return;
        pseen.add(n);
        if (!Array.isArray(n)) {
          for (const k of Object.keys(n)) {
            const v = n[k];
            if (
              Array.isArray(v) &&
              v.length &&
              v.some((it) => it && typeof it.id === "string" && /^LB/.test(it.id))
            ) {
              pageObj = n;
              return;
            }
          }
        }
        const keys = Array.isArray(n) ? [...n.keys()] : Object.keys(n);
        for (const k of keys) {
          try {
            findPage(n[k], depth + 1);
          } catch (_e) {
            /* ignore */
          }
        }
      })(doc, 0);
      if (pageObj) {
        let clips = null;
        for (const k of Object.keys(pageObj)) {
          const v = pageObj[k];
          if (!Array.isArray(v) || !v.length) continue;
          const looksLikeClips = v.every(
            (it) =>
              it &&
              typeof it === "object" &&
              Number(it.durationUs) > 0 &&
              !("id" in it && /^LB/.test(String(it.id)))
          );
          if (looksLikeClips) {
            clips = v;
            break;
          }
        }
        if (clips) {
          const findVideoRef = (clip) => {
            for (const k of Object.keys(clip)) {
              const v = clip[k];
              if (!v || typeof v !== "object" || Array.isArray(v)) continue;
              // a video clip object carries a VA… reference + trim/autoplay/volume-ish fields
              const refKey = Object.keys(v).find(
                (kk) => typeof v[kk] === "string" && /^VA/.test(v[kk])
              );
              if (refKey && ("trim" in v || "autoplay" in v || "volume" in v)) {
                let rb = null;
                for (const kk of Object.keys(v)) {
                  const cand = v[kk];
                  if (
                    cand &&
                    typeof cand === "object" &&
                    Number.isFinite(Number(cand.width)) &&
                    Number.isFinite(Number(cand.left)) &&
                    Number(cand.width) > 0
                  ) {
                    rb = {
                      left: Number(cand.left) || 0,
                      top: Number(cand.top) || 0,
                      width: Number(cand.width) || 0,
                      height: Number(cand.height) || 0,
                    };
                    break;
                  }
                }
                return { videoId: v[refKey], transparency: Number(v.transparency) || 0, rb };
              }
            }
            return null;
          };
          const outClips = [];
          for (const clip of clips) {
            outClips.push({
              durationMs: Math.round(Number(clip.durationUs) / 1000),
              color: typeof clip.color === "string" ? clip.color : null,
              video: findVideoRef(clip),
            });
          }
          const posters = {};
          try {
            for (const entry of performance.getEntriesByType("resource")) {
              const m = String(entry.name || "").match(
                /https:\/\/video-public\.canva\.com\/([^/]+)\/([pl])\/[^?#]+\.jpe?g/i
              );
              if (!m) continue;
              const [url, vid, tier] = [entry.name, m[1], m[2].toLowerCase()];
              // prefer the larger /l/ poster over /p/
              if (!posters[vid] || (tier === "l" && !/\/l\//.test(posters[vid]))) posters[vid] = url;
            }
          } catch (_e) {
            /* resource timing unavailable */
          }
          if (outClips.some((c) => c.video)) {
            result.__background = { clips: outClips, posters };
          }
        }
      }
    } catch (_bgError) {
      /* best-effort */
    }
  } catch (_e) {
    /* fiber shape changed — best-effort */
  }
  return result;
}

// Fetch protected/session-scoped image URLs from the PAGE's MAIN world, where the Canva session
// cookies apply (the isolated content script's fetch does not carry them, so it 403s on
// media.canva.com/v2 / signed premium+upload assets). Self-contained (serialized across the world
// boundary via executeScript world:"MAIN"). Returns { [url]: "data:image/…" } for whatever resolved.
async function fetchProtectedImagesInMainWorld(urls) {
  const out = {};
  const MAX_BYTES = 12_000_000;
  const list = Array.isArray(urls) ? urls.slice(0, 200) : [];
  const toDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("read-failed"));
      reader.readAsDataURL(blob);
    });
  const fetchOne = async (url) => {
    // "omit" FIRST: signed Canva asset URLs (csig=…) return ACAO:* which forbids credentialed
    // requests — "include" throws a CORS TypeError. "omit" succeeds (the signature authorizes).
    for (const credentials of ["omit", "include"]) {
      try {
        const response = await fetch(url, { credentials, cache: "force-cache" });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (!blob || blob.size <= 0 || blob.size > MAX_BYTES) continue;
        const type = String(blob.type || "").toLowerCase();
        if (type && !type.startsWith("image/")) continue;
        const dataUrl = await toDataUrl(blob);
        if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
          out[url] = dataUrl;
          return;
        }
      } catch (_e) {
        /* try the next credentials mode */
      }
    }
  };
  // small concurrency cap so a big design doesn't open hundreds of parallel fetches
  const CONCURRENCY = 6;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      await fetchOne(list[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

// Extract Canva's design model in the MAIN world (the ONLY world that can see React's
// __reactFiber$). This is what makes timeline/video designs import their full layer set +
// animations — the isolated content script can't reach the fiber itself. Best-effort: {} on
// failure (the scraper still imports the current frame's DOM).
async function extractFiberModelFromTab(tabId) {
  let fiberModel = {};
  try {
    let extracted = null;
    // PREFER file injection over the serialized `func` below. A `func` is serialized from THIS
    // service worker, which Chrome caches hard — so fiber-derived features (animations, text,
    // editable shapes, flips) silently ran stale until a full Remove+Load-unpacked. canva-fiber-
    // main.js is re-read from disk on every import (like canva-scraper.js), so it updates on a
    // plain reload. It stashes its result on globalThis; a trivial (never-changing → cache-immune)
    // read-back func retrieves it. Falls back to the in-worker func if file injection is blocked.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        files: ["canva-fiber-main.js"],
      });
      const readBack = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () =>
          globalThis.__canvaFiberModelResult && typeof globalThis.__canvaFiberModelResult === "object"
            ? globalThis.__canvaFiberModelResult
            : null,
      });
      const fromFile = Array.isArray(readBack)
        ? readBack.find((entry) => entry && entry.result && typeof entry.result === "object")?.result
        : null;
      if (fromFile && typeof fromFile === "object" && Object.keys(fromFile).length) extracted = fromFile;
    } catch (_fileInjectError) {
      /* file injection unavailable (older Chrome / blocked) — fall through to the func path */
    }
    if (!extracted) {
      // NOTE: this in-worker fallback predates multi-page extraction (no __pages) — a stale
      // worker degrades to importing the current page only, which matches its historic behavior.
      const fiberResults = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: extractCanvaFiberModel,
      });
      extracted = Array.isArray(fiberResults)
        ? fiberResults.find((entry) => entry && entry.result && typeof(entry.result) === "object")?.result
        : null;
    }
    if (extracted && typeof extracted === "object") fiberModel = extracted;
  } catch (_fiberError) {
    /* MAIN-world injection blocked or fiber shape changed — static designs still import. */
  }
  return fiberModel;
}

// Per-page view of the fiber model: the flat legacy map for page 0 (or when the model has no
// per-page data), else that page's element map + background re-shaped to the legacy contract the
// scraper consumes.
function sliceFiberModelForPage(fiberModel, pageIndex) {
  if (!fiberModel || typeof fiberModel !== "object") return {};
  const pages = Array.isArray(fiberModel.__pages) ? fiberModel.__pages : null;
  if (!pages || !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) {
    return fiberModel;
  }
  const page = pages[pageIndex] || {};
  const sliced = { ...(page.elements && typeof page.elements === "object" ? page.elements : {}) };
  if (page.background && typeof page.background === "object") {
    sliced.__background = page.background;
  }
  // The page's own fill (colour / photo placement + flips): the scraper reads it for the
  // full-page background node, which has no LB element of its own.
  if (page.fill && typeof page.fill === "object") {
    sliced.__pageFill = page.fill;
  }
  if (page.animation && typeof page.animation === "object") {
    sliced.__pageAnimation = page.animation;
  }
  if (Number(page.durationMs) > 0) {
    sliced.__pageDurationMs = Number(page.durationMs);
  }
  return sliced;
}

// Ordered [data-page-id] inventory of the open design (scraper file must not yet be injected —
// this injects it). Empty array when detection fails.
async function listCanvaPagesInTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["canva-scraper.js"],
    });
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const listPages = globalThis.__canvaImporterListPages;
        return typeof listPages === "function" ? listPages() : [];
      },
    });
    const pages = Array.isArray(results)
      ? results.find((entry) => entry && Array.isArray(entry.result))?.result
      : null;
    return Array.isArray(pages) ? pages.filter((page) => page && page.pageId) : [];
  } catch (_error) {
    return [];
  }
}

// ── Debugger sessions ──────────────────────────────────────────────────────────────────────
// One attachment per tab, refcounted: the background-video capture holds a CDP Network session
// open for several seconds, and a trusted page-switch click inside that window must not try to
// attach a second time (Chrome refuses) or detach underneath it. Chrome shows its standard
// "is debugging this browser" banner while attached; the last release clears it.
const debuggerSessions = new Map();

async function acquireDebugger(tabId) {
  const existing = debuggerSessions.get(tabId);
  if (existing) {
    existing.refs += 1;
    return { tabId };
  }
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (error) {
    // A previous session that failed to detach (worker restart mid-import) is still ours.
    if (!/already attached/i.test(String(error?.message || ""))) throw error;
  }
  debuggerSessions.set(tabId, { refs: 1 });
  return { tabId };
}

async function releaseDebugger(tabId) {
  const session = debuggerSessions.get(tabId);
  if (!session) return;
  session.refs -= 1;
  if (session.refs > 0) return;
  debuggerSessions.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch (_detachError) {
    /* already detached */
  }
}

function cdpSend(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

// Trusted input via the debugger protocol: Canva's page-switcher thumbnails ignore synthetic
// DOM events (isTrusted checks), so a real Input.dispatchMouseEvent click — indistinguishable
// from a physical one — is the only reliable way to change pages in single-page view.
async function trustedClickAt(tabId, x, y) {
  await acquireDebugger(tabId);
  try {
    const base = {
      x: Math.round(x),
      y: Math.round(y),
      button: "left",
      clickCount: 1,
      pointerType: "mouse",
    };
    await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: base.x, y: base.y, pointerType: "mouse" });
    await sleep(30);
    await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...base, buttons: 1 });
    await sleep(40);
    await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0 });
  } finally {
    await releaseDebugger(tabId);
  }
}

// ── Background video capture ───────────────────────────────────────────────────────────────
// Canva streams a page's background video through MediaSource from signed media.canva.com
// URLs: the <video> src is a blob:, and the page's own JS is CORS-blocked from the file. The
// extension is not: a CDP Network session on the tab sees every media request the player makes
// while we force playback, and the service worker — host permission on *.canva.com, no CORS —
// re-downloads the signed URL in full. Byte-range and segmented deliveries are reassembled.
// Everything here is best-effort: any failure leaves the poster-frame layer in place.
const BINARY_ASSET_SCHEME = "canva-ext-binary://";
const pendingBinaryAssets = new Map();
const MAX_CAPTURED_VIDEO_BYTES = 200 * 1024 * 1024;
const VIDEO_CAPTURE_MAX_PLAYBACK_MS = 8000;
const VIDEO_CAPTURE_MIN_PLAYBACK_MS = 2500;
const VIDEO_CAPTURE_QUIET_MS = 1500;
const VIDEO_RANGE_CHUNK_BYTES = 8 * 1024 * 1024;
const VIDEO_MAX_SEGMENTS = 400;
const MEDIA_URL_IMAGE_RE = /\.(jpe?g|png|webp|gif|svg|avif|bmp|ico)(\?|#|$)/i;
const MEDIA_URL_VIDEO_EXT_RE = /\.(mp4|m4s|m4v|webm|mov|mpd|m3u8|ts)(\?|#|$)/i;

// Blobs travel to the dashboard as multipart parts, never as JSON: a 30 MB clip base64'd into
// the manifest would triple the memory the worker needs and defeat the transport size checks.
function registerBinaryAsset(blob, fileName) {
  const ref = `${BINARY_ASSET_SCHEME}${crypto.randomUUID()}`;
  pendingBinaryAssets.set(ref, { blob, fileName: String(fileName || "asset.bin") });
  return ref;
}

function isBinaryAssetRef(value) {
  return typeof value === "string" && value.startsWith(BINARY_ASSET_SCHEME) && pendingBinaryAssets.has(value);
}

function clearBinaryAssets() {
  pendingBinaryAssets.clear();
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + CHUNK));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

// The JSON transport (tab-bridge fallback) cannot carry blobs; inline them as data URLs there.
async function inlineBinaryAssetsForJson(body, serializedBody) {
  if (pendingBinaryAssets.size === 0 || !String(serializedBody || "").includes(BINARY_ASSET_SCHEME)) {
    return serializedBody;
  }
  const inline = async (value) => {
    if (typeof value === "string" && value.startsWith(BINARY_ASSET_SCHEME)) {
      const asset = pendingBinaryAssets.get(value);
      return asset ? await blobToDataUrl(asset.blob) : "";
    }
    if (Array.isArray(value)) return Promise.all(value.map(inline));
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, nested] of Object.entries(value)) out[key] = await inline(nested);
      return out;
    }
    return value;
  };
  return JSON.stringify(await inline(body));
}

function isCanvaHostUrl(url) {
  try {
    return /(^|\.)canva\.com$/i.test(new URL(String(url || "")).hostname);
  } catch (_error) {
    return false;
  }
}

function looksLikeCanvaVideoUrl(url, videoId) {
  const value = String(url || "");
  if (!/^https:/i.test(value) || !isCanvaHostUrl(value) || MEDIA_URL_IMAGE_RE.test(value)) return false;
  if (MEDIA_URL_VIDEO_EXT_RE.test(value)) return true;
  if (videoId && value.includes(videoId)) return true;
  return /\/video\//i.test(value);
}

function lowerCaseHeaders(headers) {
  const out = {};
  Object.entries(headers && typeof headers === "object" ? headers : {}).forEach(([key, value]) => {
    out[String(key).toLowerCase()] = String(value ?? "");
  });
  return out;
}

function parseContentRange(value) {
  const match = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(String(value || ""));
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === "*" ? 0 : Number(match[3]),
  };
}

function describeVideoUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch (_error) {
    return String(url || "").slice(0, 120);
  }
}

function readBoxType(bytes, offset) {
  if (!bytes || offset + 8 > bytes.length) return "";
  return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
}

// Container sniff on the first bytes: "ftyp" = complete MP4/fMP4 init, "styp"/"moof" = a media
// segment with no init (useless alone), EBML magic = WebM.
function sniffVideoContainer(bytes) {
  if (!bytes || bytes.length < 12) return "";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  const type = readBoxType(bytes, 0);
  if (type === "ftyp") return "mp4";
  if (type === "styp" || type === "moof" || type === "sidx") return "mp4-segment";
  return "";
}

function readUint32(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function readUint64(bytes, offset) {
  return readUint32(bytes, offset) * 4294967296 + readUint32(bytes, offset + 4);
}

// Walks the top-level boxes of an MP4 blob (only headers are read, so a non-fast-start file with
// moov at the end costs a few tiny slices) and reads the duration from moov/mvhd — or, for a
// fragmented file whose mvhd says 0, from moov/mvex/mehd.
async function readMp4DurationSeconds(blob) {
  try {
    const size = blob.size;
    let offset = 0;
    let moov = null;
    for (let guard = 0; guard < 64 && offset + 8 <= size; guard += 1) {
      const header = new Uint8Array(await blob.slice(offset, Math.min(size, offset + 16)).arrayBuffer());
      let boxSize = readUint32(header, 0);
      const type = readBoxType(header, 0);
      let headerSize = 8;
      if (boxSize === 1) {
        boxSize = readUint64(header, 8);
        headerSize = 16;
      } else if (boxSize === 0) {
        boxSize = size - offset;
      }
      if (boxSize < headerSize) break;
      if (type === "moov") {
        moov = new Uint8Array(await blob.slice(offset, Math.min(size, offset + boxSize)).arrayBuffer());
        break;
      }
      offset += boxSize;
    }
    if (!moov) return 0;
    let timescale = 0;
    let duration = 0;
    let fragmentDuration = 0;
    const walk = (bytes, start, end, depth) => {
      let cursor = start;
      while (cursor + 8 <= end) {
        let boxSize = readUint32(bytes, cursor);
        const type = readBoxType(bytes, cursor);
        let headerSize = 8;
        if (boxSize === 1) {
          boxSize = readUint64(bytes, cursor + 8);
          headerSize = 16;
        } else if (boxSize === 0) {
          boxSize = end - cursor;
        }
        if (boxSize < headerSize) return;
        const body = cursor + headerSize;
        if (type === "mvhd") {
          const version = bytes[body];
          if (version === 1) {
            timescale = readUint32(bytes, body + 20);
            duration = readUint64(bytes, body + 24);
          } else {
            timescale = readUint32(bytes, body + 12);
            duration = readUint32(bytes, body + 16);
          }
        } else if (type === "mehd") {
          const version = bytes[body];
          fragmentDuration = version === 1 ? readUint64(bytes, body + 4) : readUint32(bytes, body + 4);
        } else if ((type === "mvex" || type === "moov") && depth < 3) {
          walk(bytes, body, cursor + boxSize, depth + 1);
        }
        cursor += boxSize;
      }
    };
    walk(moov, 0, moov.length, 0);
    const ticks = duration > 0 ? duration : fragmentDuration;
    if (!(timescale > 0) || !(ticks > 0)) return 0;
    const seconds = ticks / timescale;
    return Number.isFinite(seconds) && seconds < 24 * 3600 ? seconds : 0;
  } catch (_error) {
    return 0;
  }
}

async function fetchCanvaMediaBytes(url, { rangeHeader = "", timeoutMs = 120_000 } = {}) {
  // "omit" first: signed URLs (csig=…) answer ACAO:* and reject credentialed requests.
  for (const credentials of ["omit", "include"]) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "GET",
          credentials,
          cache: "no-store",
          headers: rangeHeader ? { Range: rangeHeader } : {},
        },
        timeoutMs
      );
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      return {
        status: response.status,
        buffer,
        contentType: String(response.headers.get("content-type") || "").toLowerCase(),
        contentRange: parseContentRange(response.headers.get("content-range")),
        contentLength: Number(response.headers.get("content-length") || buffer.byteLength),
      };
    } catch (_error) {
      /* next credentials mode */
    }
  }
  return null;
}

// Runs in the page (MAIN world): drives every <video> and reports what the player knows.
// Retroactive discovery too — Resource Timing keeps the full (signed) URL of every fetch/XHR
// the player already made, so a video that is buffered before we attach is still found.
function probeCanvaVideosInPage(mode, videoId) {
  const out = { videos: [], resources: [] };
  try {
    performance.setResourceTimingBufferSize(4000);
  } catch (_e) {
    /* ignore */
  }
  try {
    const videoExt = /\.(mp4|m4s|m4v|webm|mov|mpd|m3u8|ts)(\?|#|$)/i;
    const imageExt = /\.(jpe?g|png|webp|gif|svg|avif|bmp|ico)(\?|#|$)/i;
    for (const entry of performance.getEntriesByType("resource")) {
      const name = String(entry.name || "");
      if (!/^https:\/\/[^/]*\.canva\.com\//i.test(name) || imageExt.test(name)) continue;
      const matches =
        videoExt.test(name) || (videoId && name.includes(videoId)) || /\/video\//i.test(name);
      if (!matches) continue;
      out.resources.push({
        url: name,
        initiatorType: String(entry.initiatorType || ""),
        bytes: Number(entry.transferSize || entry.encodedBodySize || 0),
        startTime: Number(entry.startTime || 0),
      });
    }
  } catch (_e) {
    /* resource timing unavailable */
  }
  try {
    for (const video of Array.from(document.querySelectorAll("video"))) {
      try {
        if (mode === "play") {
          video.muted = true;
          video.defaultMuted = true;
          if (video.preload !== "auto") video.preload = "auto";
          try {
            if (video.currentTime > 0.25) video.currentTime = 0;
          } catch (_seekError) {
            /* not seekable yet */
          }
          const playing = video.play();
          if (playing && typeof playing.catch === "function") playing.catch(() => {});
        } else if (mode === "stop") {
          video.pause();
          try {
            video.currentTime = 0;
          } catch (_seekError) {
            /* ignore */
          }
        }
        out.videos.push({
          src: String(video.currentSrc || video.src || ""),
          duration: Number(video.duration),
          width: Number(video.videoWidth || 0),
          height: Number(video.videoHeight || 0),
          readyState: Number(video.readyState || 0),
          paused: Boolean(video.paused),
        });
      } catch (_videoError) {
        /* next video */
      }
    }
  } catch (_e) {
    /* ignore */
  }
  return out;
}

async function probeCanvaVideos(tabId, mode, videoId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: probeCanvaVideosInPage,
      args: [String(mode || "probe"), String(videoId || "")],
    });
    const found = Array.isArray(results)
      ? results.find((entry) => entry && entry.result && typeof entry.result === "object")?.result
      : null;
    return found || { videos: [], resources: [] };
  } catch (_error) {
    return { videos: [], resources: [] };
  }
}

// Canva's editor paints a paused background video as its poster <img>: no <video> element exists
// until the design is played, so the timeline Play control gets a trusted click (synthetic clicks
// are ignored, like the page-switcher thumbnails). The control is localized — match the Arabic UI
// too — and "Preview"/"معاينة" (a different, full-screen control) is never it. A "pause" label
// means playback is already running, so nothing needs clicking.
async function findCanvaPlayButton(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // No `\b` here: JS word boundaries are ASCII-only, so `تشغيل\b` can never match — the Arabic
        // label ends with non-\w characters on both sides. Anchor on whitespace/end instead.
        const PLAY = /^(play|تشغيل|reproducir|lecture|lire|abspielen|riproduci|reproduzir|oynat)(\s|$)/i;
        const PAUSE = /^(pause|إيقاف مؤقت|pausar|pausa|pausieren|duraklat)(\s|$)/i;
        const PREVIEW = /preview|معاينة|present|عرض/i;
        const candidates = Array.from(document.querySelectorAll("button, [role='button']"));
        let pauseControl = null;
        for (const node of candidates) {
          const label = `${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""}`.trim();
          if (!label || PREVIEW.test(label)) continue;
          const rect = node.getBoundingClientRect();
          if (rect.width < 8 || rect.height < 8) continue;
          const hit = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, label };
          if (PLAY.test(label)) return { ...hit, state: "play" };
          if (!pauseControl && PAUSE.test(label)) pauseControl = { ...hit, state: "pause" };
        }
        return pauseControl;
      },
    });
    return Array.isArray(results) ? results.find((entry) => entry?.result)?.result || null : null;
  } catch (_error) {
    return null;
  }
}

// Fallback when the trusted click does not start playback: call the Play control's React handler
// directly in the MAIN world. React handlers do not see isTrusted, only native listeners do.
async function invokeCanvaPlayHandler(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const PLAY = /^(play|تشغيل|reproducir|lecture|lire|abspielen|riproduci|reproduzir|oynat)(\s|$)/i;
        const button = Array.from(document.querySelectorAll("button, [role='button']")).find((node) =>
          PLAY.test(`${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""}`.trim())
        );
        if (!button) return "no-button";
        const propsKey = Object.keys(button).find((key) => key.startsWith("__reactProps$"));
        const props = propsKey ? button[propsKey] : null;
        if (!props) return "no-react-props";
        const rect = button.getBoundingClientRect();
        const fakeEvent = (type) => ({
          type,
          target: button,
          currentTarget: button,
          nativeEvent: new MouseEvent(type, { bubbles: true, cancelable: true }),
          button: 0,
          buttons: 0,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          pointerType: "mouse",
          isTrusted: true,
          preventDefault() {},
          stopPropagation() {},
          persist() {},
          isDefaultPrevented: () => false,
          isPropagationStopped: () => false,
        });
        const called = [];
        for (const name of ["onPointerDown", "onMouseDown", "onPointerUp", "onMouseUp", "onClick"]) {
          if (typeof props[name] === "function") {
            try {
              props[name](fakeEvent(name.slice(2).toLowerCase()));
              called.push(name);
            } catch (error) {
              called.push(`${name}!${String(error && error.message).slice(0, 40)}`);
            }
          }
        }
        return called.length ? called.join("+") : "no-handlers";
      },
    });
    return Array.isArray(results) ? String(results.find((entry) => entry?.result)?.result || "no-result") : "no-result";
  } catch (error) {
    return `error:${describeError(error)}`;
  }
}

// Starts the design playing and reports how. "Started" = the control's label flipped to pause, or
// a <video> element exists with data on the way; polled, because Canva builds its player lazily.
async function triggerCanvaPlayback(tabId, control, videoId, diagnostics) {
  const readState = async () => {
    const [state, probe] = await Promise.all([findCanvaPlayButton(tabId), probeCanvaVideos(tabId, "probe", videoId)]);
    const playing =
      (state && state.state === "pause") ||
      probe.videos.some((video) => !video.paused || Number(video.readyState) >= 1);
    return { playing, label: state ? `${state.state}:${state.label}` : "none", videoEls: probe.videos.length };
  };
  const waitStarted = async (ms) => {
    const until = Date.now() + ms;
    let last = null;
    while (Date.now() < until) {
      await sleep(300);
      last = await readState();
      if (last.playing) return last;
    }
    return last || (await readState());
  };
  await trustedClickAt(tabId, control.x, control.y);
  let state = await waitStarted(3000);
  diagnostics.afterCdpClick = `${state.label} videoEls=${state.videoEls}`;
  if (state.playing) return { method: "cdp-click", ...state };
  diagnostics.reactHandler = await invokeCanvaPlayHandler(tabId);
  state = await waitStarted(2500);
  if (state.playing) return { method: "react-handler", ...state };
  return { method: "none", ...state };
}

async function collectCdpResponseBody(tabId, requestId, sessionId = "") {
  try {
    const target = sessionId ? { tabId, sessionId } : { tabId };
    const result = await chrome.debugger.sendCommand(target, "Network.getResponseBody", { requestId });
    if (!result || typeof result.body !== "string") return null;
    if (result.base64Encoded) {
      const binary = atob(result.body);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    }
    return new TextEncoder().encode(result.body);
  } catch (_error) {
    return null;
  }
}

// Numbered segment URLs (…/seg-12.m4s, …/12.m4s, …segment=12…): returns the template pieces
// so the missing indexes can be fetched directly.
function splitSegmentUrl(url) {
  const value = String(url || "");
  const match = /^(.*?)(\d+)(\.(?:m4s|mp4|m4v|ts)(?:[?#].*)?)$/i.exec(value);
  if (!match) return null;
  return { prefix: match[1], index: Number(match[2]), digits: match[2].length, suffix: match[3] };
}

async function captureCanvaBackgroundVideo(tabId, { videoId = "", reportProgress = () => {} } = {}) {
  const diagnostics = { videoId, attached: false, requests: 0, mediaRequests: 0, method: "", probeResources: 0 };
  const requests = new Map();
  const mediaOrder = [];
  let lastMediaAt = 0;
  const onEvent = (source, method, params) => {
    if (!source || source.tabId !== tabId || !params) return;
    // Media fetched from a dedicated worker reports on the worker's (flattened) session: enable
    // Network there as soon as it attaches so its requests land in the same table.
    if (method === "Target.attachedToTarget") {
      const type = String(params.targetInfo?.type || "");
      if ((type === "worker" || type === "shared_worker") && params.sessionId) {
        diagnostics.workerSessions = (diagnostics.workerSessions || 0) + 1;
        chrome.debugger
          .sendCommand({ tabId, sessionId: params.sessionId }, "Network.enable", {
            maxTotalBufferSize: 256 * 1024 * 1024,
            maxResourceBufferSize: 128 * 1024 * 1024,
          })
          .catch(() => {});
      }
      return;
    }
    if (method === "Network.requestWillBeSent") {
      const url = String(params.request?.url || "");
      if (!/^https:/i.test(url)) return;
      diagnostics.requests += 1;
      requests.set(params.requestId, {
        requestId: params.requestId,
        sessionId: String(source.sessionId || ""),
        url,
        resourceType: String(params.type || ""),
        rangeHeader: lowerCaseHeaders(params.request?.headers).range || "",
        order: requests.size,
        status: 0,
        mimeType: "",
        contentRange: null,
        contentLength: 0,
        finished: false,
        isMedia: false,
      });
      return;
    }
    const entry = requests.get(params.requestId);
    if (!entry) return;
    if (method === "Network.responseReceived") {
      const headers = lowerCaseHeaders(params.response?.headers);
      entry.status = Number(params.response?.status || 0);
      entry.mimeType = String(params.response?.mimeType || headers["content-type"] || "").toLowerCase();
      entry.contentRange = parseContentRange(headers["content-range"]);
      entry.contentLength = Number(headers["content-length"] || 0);
      const mimeSaysVideo =
        entry.mimeType.startsWith("video/") ||
        /application\/(mp4|octet-stream|dash\+xml|vnd\.apple\.mpegurl|x-mpegurl)/.test(entry.mimeType);
      entry.isMedia =
        isCanvaHostUrl(entry.url) &&
        !entry.mimeType.startsWith("image/") &&
        !MEDIA_URL_IMAGE_RE.test(entry.url) &&
        entry.status > 0 &&
        entry.status < 400 &&
        (mimeSaysVideo || entry.resourceType === "Media" || looksLikeCanvaVideoUrl(entry.url, videoId));
      if (entry.isMedia) {
        diagnostics.mediaRequests += 1;
        mediaOrder.push(entry);
        lastMediaAt = Date.now();
      }
      return;
    }
    if (method === "Network.loadingFinished") {
      entry.finished = true;
      entry.encodedDataLength = Number(params.encodedDataLength || 0);
      if (entry.isMedia) lastMediaAt = Date.now();
    }
  };

  let playButtonClicked = null;
  let probe = { videos: [], resources: [] };
  try {
    await acquireDebugger(tabId);
    diagnostics.attached = true;
    chrome.debugger.onEvent.addListener(onEvent);
    await cdpSend(tabId, "Network.enable", {
      maxTotalBufferSize: 512 * 1024 * 1024,
      maxResourceBufferSize: 256 * 1024 * 1024,
    });
    await cdpSend(tabId, "Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    }).catch(() => {});
    reportProgress("Capturing background video...");
    probe = await probeCanvaVideos(tabId, "play", videoId);
    diagnostics.probeResources = probe.resources.length;
    diagnostics.videoElements = probe.videos.length;
    const somethingPlays = probe.videos.some((video) => !video.paused || video.readyState >= 2);
    if (!somethingPlays) {
      const control = await findCanvaPlayButton(tabId);
      diagnostics.playControl = control ? `${control.state}:${control.label}` : "none";
      if (control && control.state === "play") {
        const started = await triggerCanvaPlayback(tabId, control, videoId, diagnostics);
        diagnostics.playback = started.method;
        diagnostics.videoElementsAfterPlay = started.videoEls;
        if (started.method !== "none") playButtonClicked = control;
      } else if (control && control.state === "pause") {
        diagnostics.playback = "already-playing";
      }
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt < VIDEO_CAPTURE_MAX_PLAYBACK_MS) {
      await sleep(250);
      const elapsed = Date.now() - startedAt;
      const finishedMedia = mediaOrder.filter((entry) => entry.finished).length;
      if (
        elapsed >= VIDEO_CAPTURE_MIN_PLAYBACK_MS &&
        finishedMedia > 0 &&
        Date.now() - lastMediaAt >= VIDEO_CAPTURE_QUIET_MS
      ) {
        break;
      }
    }
    const stopProbe = await probeCanvaVideos(tabId, "stop", videoId);
    diagnostics.videoElementsAtEnd = stopProbe.videos.length;
    if (stopProbe.videos.length > 0) probe.videos = stopProbe.videos;
    if (playButtonClicked) {
      // Leave the design where the user had it: the same control now reads "pause" — click it
      // only in that state (a blind second click could START a playback that never began).
      const control = await findCanvaPlayButton(tabId);
      if (control && control.state === "pause") {
        await trustedClickAt(tabId, control.x, control.y).catch(() => {});
      }
    }

    // ── Choose the source ────────────────────────────────────────────────────────────────
    // Prefer what the player fetched while we watched (certainly the right clip); fall back to
    // Resource Timing entries for a clip buffered before we attached.
    const byUrl = new Map();
    mediaOrder.forEach((entry) => {
      const bucket = byUrl.get(entry.url) || { url: entry.url, entries: [], total: 0 };
      bucket.entries.push(entry);
      if (entry.contentRange?.total) bucket.total = Math.max(bucket.total, entry.contentRange.total);
      byUrl.set(entry.url, bucket);
    });
    const candidateUrls = Array.from(byUrl.values())
      .sort((a, b) => (b.total || 0) - (a.total || 0) || b.entries.length - a.entries.length)
      .map((bucket) => bucket.url);
    probe.resources
      .filter((resource) => !byUrl.has(resource.url))
      .sort((a, b) => b.bytes - a.bytes)
      .forEach((resource) => candidateUrls.push(resource.url));
    if (candidateUrls.length === 0) {
      return {
        ok: false,
        reason: probe.videos.length === 0 ? "no-video-element" : "no-media-requests",
        diagnostics,
      };
    }

    const videoMeta = probe.videos.find((video) => Number.isFinite(video.duration) && video.duration > 0) || probe.videos[0] || null;
    const finish = async (parts, method, sourceUrl) => {
      const totalBytes = parts.reduce((sum, part) => sum + part.byteLength, 0);
      if (totalBytes < 1024) return null;
      if (totalBytes > MAX_CAPTURED_VIDEO_BYTES) {
        return { ok: false, reason: `video-too-large:${Math.round(totalBytes / 1048576)}MB`, diagnostics };
      }
      const head = parts[0] instanceof Uint8Array ? parts[0] : new Uint8Array(parts[0]);
      const container = sniffVideoContainer(head.subarray(0, 16));
      if (container !== "mp4" && container !== "webm") return null;
      const mimeType = container === "webm" ? "video/webm" : "video/mp4";
      const blob = new Blob(parts, { type: mimeType });
      const parsedDuration = container === "mp4" ? await readMp4DurationSeconds(blob) : 0;
      const durationSec =
        parsedDuration > 0
          ? parsedDuration
          : videoMeta && Number.isFinite(videoMeta.duration) && videoMeta.duration > 0
            ? videoMeta.duration
            : 0;
      diagnostics.method = method;
      diagnostics.bytes = totalBytes;
      diagnostics.source = describeVideoUrl(sourceUrl);
      return {
        ok: true,
        blob,
        mimeType,
        bytes: totalBytes,
        durationSec,
        width: Number(videoMeta?.width || 0),
        height: Number(videoMeta?.height || 0),
        method,
        diagnostics,
      };
    };

    for (const url of candidateUrls.slice(0, 4)) {
      const bucket = byUrl.get(url) || { url, entries: [], total: 0 };
      const segment = splitSegmentUrl(url);
      const segmentUrls = Array.from(byUrl.keys()).filter((other) => {
        const otherSegment = splitSegmentUrl(other);
        return otherSegment && segment && otherSegment.prefix === segment.prefix && otherSegment.suffix === segment.suffix;
      });
      const isSegmented = Boolean(segment) && segmentUrls.length >= 2;

      if (!isSegmented) {
        // A) One signed URL, whole file. Works for plain and byte-range deliveries alike when the
        //    signature is not bound to a range.
        reportProgress("Downloading background video...");
        const full = await fetchCanvaMediaBytes(url);
        if (full && full.status === 200 && full.buffer.byteLength > 0) {
          const result = await finish([full.buffer], "refetch", url);
          if (result) return result;
        }
        // B) The server insists on ranges: walk the file in fixed chunks.
        const total =
          (full?.status === 206 && full.contentRange?.total) || bucket.total || 0;
        if (total > 0 && total <= MAX_CAPTURED_VIDEO_BYTES) {
          const parts = [];
          let failed = false;
          for (let start = 0; start < total; start += VIDEO_RANGE_CHUNK_BYTES) {
            const end = Math.min(total, start + VIDEO_RANGE_CHUNK_BYTES) - 1;
            reportProgress(`Downloading background video (${Math.round((start / total) * 100)}%)...`);
            const chunk = await fetchCanvaMediaBytes(url, { rangeHeader: `bytes=${start}-${end}` });
            if (!chunk || chunk.buffer.byteLength !== end - start + 1) {
              failed = true;
              break;
            }
            parts.push(chunk.buffer);
          }
          if (!failed) {
            const result = await finish(parts, "ranges", url);
            if (result) return result;
          }
        }
        // C) Last resort: what the player itself buffered, when it is contiguous from byte 0.
        const buffered = bucket.entries
          .filter((entry) => entry.finished && entry.contentRange)
          .sort((a, b) => a.contentRange.start - b.contentRange.start);
        if (buffered.length > 0 && buffered[0].contentRange.start === 0) {
          const parts = [];
          let cursor = 0;
          let contiguous = true;
          for (const entry of buffered) {
            if (entry.contentRange.start > cursor) {
              contiguous = false;
              break;
            }
            const body = await collectCdpResponseBody(tabId, entry.requestId, entry.sessionId);
            if (!body) {
              contiguous = false;
              break;
            }
            const skip = cursor - entry.contentRange.start;
            parts.push(skip > 0 ? body.subarray(skip) : body);
            cursor = entry.contentRange.end + 1;
          }
          const total2 = buffered[0].contentRange.total || cursor;
          if (contiguous && cursor >= total2) {
            const result = await finish(parts, "buffered", url);
            if (result) return result;
          }
        }
        continue;
      }

      // D) Segmented stream (DASH-style numbered files): init segment + every media segment in
      //    index order. Segments the player never reached are fetched by their number.
      const initCandidates = Array.from(byUrl.keys()).filter((other) => {
        const otherSegment = splitSegmentUrl(other);
        return !otherSegment && /init|\.mp4(\?|#|$)/i.test(other) && other.startsWith(segment.prefix.split("/").slice(0, -1).join("/"));
      });
      let initBytes = null;
      for (const initUrl of initCandidates) {
        const fetched = await fetchCanvaMediaBytes(initUrl);
        if (fetched && sniffVideoContainer(new Uint8Array(fetched.buffer).subarray(0, 16)) === "mp4") {
          initBytes = fetched.buffer;
          break;
        }
      }
      const known = segmentUrls.map((other) => splitSegmentUrl(other).index).sort((a, b) => a - b);
      const firstIndex = Math.max(0, Math.min(...known) <= 1 ? Math.min(...known) : 0);
      const parts = initBytes ? [initBytes] : [];
      let totalBytes = initBytes ? initBytes.byteLength : 0;
      let index = firstIndex;
      let fetchedSegments = 0;
      while (index < firstIndex + VIDEO_MAX_SEGMENTS) {
        const segmentUrl = `${segment.prefix}${String(index).padStart(segment.digits, "0")}${segment.suffix}`;
        const fetched = await fetchCanvaMediaBytes(segmentUrl, { timeoutMs: 30_000 });
        if (!fetched || fetched.buffer.byteLength === 0) {
          if (fetchedSegments === 0 && index === 0) {
            index += 1;
            continue;
          }
          break;
        }
        if (!initBytes && parts.length === 0 && sniffVideoContainer(new Uint8Array(fetched.buffer).subarray(0, 16)) !== "mp4") {
          break;
        }
        parts.push(fetched.buffer);
        totalBytes += fetched.buffer.byteLength;
        fetchedSegments += 1;
        if (totalBytes > MAX_CAPTURED_VIDEO_BYTES) break;
        reportProgress(`Downloading background video (${fetchedSegments} segments)...`);
        index += 1;
      }
      if (fetchedSegments > 0) {
        const result = await finish(parts, "segments", url);
        if (result) return result;
      }
    }
    return { ok: false, reason: "download-failed", diagnostics };
  } catch (error) {
    return { ok: false, reason: `capture-error:${describeError(error)}`, diagnostics };
  } finally {
    try {
      chrome.debugger.onEvent.removeListener(onEvent);
    } catch (_listenerError) {
      /* ignore */
    }
    if (diagnostics.attached) {
      await cdpSend(tabId, "Network.disable").catch(() => {});
      await releaseDebugger(tabId);
    }
  }
}

// Swaps the page's poster-frame layer (scraper: imageProvenance "background-video-poster") for a
// real video object when the clip can be captured. Geometry follows the model's video rect
// (`rb`) when the clip is larger than the page; the poster stays as the video's thumbnail. The
// server's asset sanitizer uploads both (src → video/*, thumbnailUri → image), the web editor
// and mobile exporter read `layerType: "video"`. Capture is cached per Canva video id, so a
// design whose six scenes reuse one clip downloads it once.
async function attachCapturedBackgroundVideo(fabricObjects, context) {
  const objects = Array.isArray(fabricObjects) ? fabricObjects : [];
  const posterIndexes = objects
    .map((object, index) => (String(object?.imageProvenance || "") === "background-video-poster" ? index : -1))
    .filter((index) => index >= 0);
  if (posterIndexes.length === 0) return { objects, captured: false, attempted: false };
  const warnings = Array.isArray(context?.importWarnings) ? context.importWarnings : [];
  const fiberModel = context?.fiberModel || {};
  const pageBackground =
    (Array.isArray(fiberModel.__pages) ? fiberModel.__pages[context?.pageIndex ?? 0]?.background : null) ||
    fiberModel.__background ||
    null;
  const clips = Array.isArray(pageBackground?.clips) ? pageBackground.clips : [];
  const videoClip = clips.find((clip) => clip && clip.video) || null;
  const videoId = String(videoClip?.video?.videoId || "");
  const cache = context?.cache instanceof Map ? context.cache : new Map();
  const cacheKey = videoId || `page-${context?.pageIndex ?? 0}`;
  if (!cache.has(cacheKey)) {
    cache.set(
      cacheKey,
      captureCanvaBackgroundVideo(context.tabId, { videoId, reportProgress: context?.reportProgress })
    );
  }
  const capture = await cache.get(cacheKey);
  if (!capture?.ok) {
    logger.warn("Background video capture failed; keeping poster frame", {
      reason: capture?.reason,
      diagnostics: capture?.diagnostics,
    });
    const d = capture?.diagnostics || {};
    const detail = [
      `requests=${Number(d.requests || 0)}`,
      `media=${Number(d.mediaRequests || 0)}`,
      `videoEls=${Number(d.videoElements || 0)}${Number.isFinite(Number(d.videoElementsAfterPlay)) ? `→${d.videoElementsAfterPlay}` : ""}${Number.isFinite(Number(d.videoElementsAtEnd)) ? `→${d.videoElementsAtEnd}` : ""}`,
      `control=${String(d.playControl || "?")}`,
      `playback=${String(d.playback || "-")}`,
      ...(d.afterCdpClick ? [`afterClick=${d.afterCdpClick}`] : []),
      ...(d.reactHandler ? [`react=${d.reactHandler}`] : []),
      `timing=${Number(d.probeResources || 0)}`,
      `workers=${Number(d.workerSessions || 0)}`,
    ].join(" ");
    warnings.push(
      `Background video imported as a static poster frame (capture: ${String(capture?.reason || "unknown")}; ${detail}); timing and transparency preserved.`
    );
    return { objects, captured: false, attempted: true, reason: capture?.reason };
  }
  const blobRef = registerBinaryAsset(
    capture.blob,
    `canva-background-video.${capture.mimeType === "video/webm" ? "webm" : "mp4"}`
  );
  const pageWidth = Math.max(1, Math.round(numberOr(context?.pageWidth, 1080)));
  const pageHeight = Math.max(1, Math.round(numberOr(context?.pageHeight, 1920)));
  const rb = videoClip?.video?.rb;
  const hasRect = rb && Number(rb.width) > 0 && Number(rb.height) > 0;
  const durationSec = Math.round(Math.max(0, Number(capture.durationSec) || 0) * 1000) / 1000;
  const nextObjects = objects.slice();
  // One decode for the whole page: every poster index here is the same clip's poster frame.
  const firstPosterSrc = String(nextObjects[posterIndexes[0]]?.src || "");
  const posterUsable =
    (firstPosterSrc.startsWith("data:image/") || /^https?:\/\//i.test(firstPosterSrc)) &&
    (await posterMatchesVideoAspect(firstPosterSrc, capture.width, capture.height));
  for (const index of posterIndexes) {
    const poster = nextObjects[index];
    const posterSrc = posterUsable ? String(poster?.src || "") : "";
    nextObjects[index] = {
      ...poster,
      type: "video",
      layerType: "video",
      importKind: "video",
      layerName: "Background video",
      left: hasRect ? Number(rb.left) || 0 : 0,
      top: hasRect ? Number(rb.top) || 0 : 0,
      width: hasRect ? Math.round(Number(rb.width)) : pageWidth,
      height: hasRect ? Math.round(Number(rb.height)) : pageHeight,
      scaleX: 1,
      scaleY: 1,
      src: blobRef,
      ...(posterSrc.startsWith("data:image/") || /^https?:\/\//i.test(posterSrc) ? { thumbnailUri: posterSrc } : {}),
      videoStart: 0,
      videoEnd: durationSec,
      videoDuration: durationSec,
      sourceWidth: capture.width > 0 ? capture.width : hasRect ? Math.round(Number(rb.width)) : pageWidth,
      sourceHeight: capture.height > 0 ? capture.height : hasRect ? Math.round(Number(rb.height)) : pageHeight,
      fallback: false,
      fallbackReason: "",
      imageProvenance: "background-video",
      videoCapture: {
        videoId,
        method: capture.method,
        bytes: capture.bytes,
        durationSec,
      },
    };
  }
  if (!posterUsable) {
    warnings.push(
      "Background video poster dropped (it was not a single frame of the clip); the layer shows the video itself once it decodes."
    );
  }
  warnings.push(
    `Background video captured (${(capture.bytes / 1048576).toFixed(1)} MB${durationSec > 0 ? `, ${durationSec.toFixed(1)} s` : ""}, ${capture.method}).`
  );
  return { objects: nextObjects, captured: true, attempted: true, durationMs: Math.round(durationSec * 1000) };
}

async function displayedPageMatches(tabId, expectedLbIds) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [expectedLbIds],
      func: (ids) => {
        const matches = globalThis.__canvaImporterDisplayedPageMatches;
        return typeof matches === "function" ? matches(ids) : false;
      },
    });
    return Boolean(
      Array.isArray(results) ? results.find((entry) => entry && entry.result === true) : false
    );
  } catch (_error) {
    return false;
  }
}

async function locatePageThumb(tabId, pageNumber) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [pageNumber],
      func: (number) => {
        const locate = globalThis.__canvaImporterLocatePageThumb;
        return typeof locate === "function" ? locate(number) : null;
      },
    });
    const thumb = Array.isArray(results)
      ? results.find((entry) => entry && entry.result && typeof entry.result === "object")?.result
      : null;
    return thumb && Number.isFinite(Number(thumb.x)) && Number.isFinite(Number(thumb.y))
      ? thumb
      : null;
  } catch (_error) {
    return null;
  }
}

// Virtualized single-page editors: switch to design page `pageIndex` by trusted-clicking its
// bottom-strip thumbnail, verifying by page CONTENT (the model's per-page LB element ids) —
// the [data-page-id] attribute is just the viewport slot and never changes.
async function ensureVirtualizedPageDisplayed(tabId, pageIndex, expectedLbIds, maxAttempts = 6) {
  const hasExpectedIds = Array.isArray(expectedLbIds) && expectedLbIds.length > 0;
  if (!hasExpectedIds) {
    // Without ids we cannot verify which page is on screen; only page 0 (initial view) is safe.
    return pageIndex === 0;
  }
  if (await displayedPageMatches(tabId, expectedLbIds)) return true;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const thumb = await locatePageThumb(tabId, pageIndex + 1);
    if (thumb) {
      try {
        await trustedClickAt(tabId, thumb.x, thumb.y);
      } catch (clickError) {
        logger.warn("Trusted page-thumbnail click failed", { pageIndex }, clickError);
      }
    }
    await sleep(900);
    if (await displayedPageMatches(tabId, expectedLbIds)) return true;
  }
  return false;
}

// Brings a page's [data-page-id] node into view, retry-scrolling to force virtualized editors
// (one mounted page at a time, attribute value = page index) to materialize it.
async function ensureCanvaPageVisible(tabId, pageId, maxAttempts = 12) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let outcome = "";
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        args: [String(pageId || "")],
        func: (targetPageId) => {
          const scrollTo = globalThis.__canvaImporterScrollToPage;
          return typeof scrollTo === "function" ? scrollTo(targetPageId) : "";
        },
      });
      outcome = String(
        (Array.isArray(results)
          ? results.find((entry) => entry && typeof entry.result === "string")?.result
          : "") || ""
      );
    } catch (_error) {
      outcome = "";
    }
    if (outcome === "found") return true;
    if (!outcome) return false;
    await sleep(450);
  }
  return false;
}

async function getCaptureMetaFromTab(tabId, options = {}) {
  const shouldCollectLayerMetadata = Boolean(options?.captureMetadata);
  const targetPageId = String(options?.targetPageId || "").trim();
  const expectedLbIds = Array.isArray(options?.expectedLbIds) ? options.expectedLbIds : [];
  let results = null;
  let primaryError = "";
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["canva-scraper.js"],
    });
    const fiberModel =
      options?.fiberModel && typeof options.fiberModel === "object"
        ? sliceFiberModelForPage(options.fiberModel, Number(options?.pageIndex))
        : await extractFiberModelFromTab(tabId);
    results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [{ captureMetadata: shouldCollectLayerMetadata, fiberModel, targetPageId, expectedLbIds }],
      func: async (runtimeOptions = {}) => {
        const scraper = globalThis.__canvaImporterGetCaptureMetaFromTab;
        if (typeof scraper !== "function") {
          return {
            ok: false,
            error: "Canva scraper bootstrap is unavailable.",
          };
        }
        return scraper(runtimeOptions);
      },
    });
  } catch (error) {
    primaryError = String(error?.message || "Script injection failed.");
  }

  const primaryResult = Array.isArray(results)
    ? results.find((entry) => entry && typeof entry.result === "object")?.result
    : null;
  if (primaryResult && typeof primaryResult === "object") {
    // ── Protected images → MAIN-world fetch ─────────────────────────────────────────────────────
    // The scraper runs in the ISOLATED world, whose fetch has NO Canva session — so protected srcs
    // (media.canva.com/v2, signed premium/upload) can't be fetched there and stay as URLs. The
    // SERVER can't fetch them either (403) → the whole design collapses to a flat snapshot. The
    // MAIN world (like the fiber walk) DOES have the session, so fetch the leftover protected srcs
    // here and merge the bytes back into the layers before they're sent.
    try {
      const isServerFetchable = (url) =>
        /^https?:\/\/(?:[a-z0-9-]+\.)*(?:media-public|video-public)\.canva\.com\//i.test(url) ||
        /^https?:\/\/pub-[a-z0-9]+\.r2\.dev\//i.test(url);
      const layers = Array.isArray(primaryResult.layers) ? primaryResult.layers : [];
      const protectedUrls = [
        ...new Set(
          layers
            .filter((layer) => {
              if (String(layer?.imageDataUrl || "").startsWith("data:image/")) return false;
              const src = String(layer?.imageSrc || "");
              return /^https?:\/\//i.test(src) && !isServerFetchable(src);
            })
            .map((layer) => String(layer.imageSrc))
        ),
      ];
      let merged = 0;
      if (protectedUrls.length) {
        const fetchResults = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: fetchProtectedImagesInMainWorld,
          args: [protectedUrls],
        });
        const urlToDataUrl =
          (Array.isArray(fetchResults)
            ? fetchResults.find((entry) => entry && entry.result && typeof entry.result === "object")
                ?.result
            : null) || {};
        for (const layer of layers) {
          const src = String(layer?.imageSrc || "");
          const bytes = urlToDataUrl[src];
          if (bytes && typeof bytes === "string" && bytes.startsWith("data:image/")) {
            layer.imageSrc = bytes;
            layer.imageDataUrl = bytes;
            layer.imageProvenance = layer.imageProvenance || "mainworld-fetch";
            merged += 1;
          }
        }
        console.log(
          `[canva-importer] MAIN-world protected-image fetch: ${merged}/${protectedUrls.length} resolved`
        );
      }
    } catch (_protectedFetchError) {
      /* best-effort; unresolved layers degrade to the server's per-layer snapshot crop */
    }
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

async function compressUtf8Gzip(input) {
  if (typeof CompressionStream !== "function" || typeof TextEncoder !== "function") {
    return null;
  }
  const encoded = new TextEncoder().encode(String(input || ""));
  const stream = new Blob([encoded]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressedBuffer = await new Response(stream).arrayBuffer();
  return compressedBuffer.byteLength > 0 ? compressedBuffer : null;
}

async function createDashboardRequestPayload(serializedBody) {
  const headers = {
    "Content-Type": "application/json;charset=UTF-8",
  };
  let body = serializedBody;
  try {
    const compressed = await compressUtf8Gzip(serializedBody);
    if (compressed && compressed.byteLength > 0 && compressed.byteLength < serializedBody.length) {
      headers["Content-Encoding"] = "gzip";
      body = compressed;
    }
  } catch (error) {
    logger.warn("Failed to gzip dashboard payload; falling back to plain JSON", {}, error);
  }
  return { headers, body };
}

function shouldExternalizeMultipartAsset(key, value) {
  if (!String(value || "").startsWith("data:")) return false;
  const normalizedKey = String(key || "").toLowerCase();
  return (
    normalizedKey === "imagedataurl" ||
    normalizedKey === "thumbnaildataurl" ||
    normalizedKey === "src" ||
    normalizedKey === "thumbnailuri" ||
    normalizedKey === "dataurl"
  );
}

function extensionFromMultipartMimeType(mimeType) {
  const normalized = String(mimeType || "").trim().toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("svg")) return "svg";
  if (normalized.includes("avif")) return "avif";
  if (normalized.includes("bmp")) return "bmp";
  if (normalized.includes("ttf")) return "ttf";
  if (normalized.includes("otf")) return "otf";
  if (normalized.includes("woff2")) return "woff2";
  if (normalized.includes("woff")) return "woff";
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("quicktime")) return "mov";
  return "bin";
}

function createMultipartAssetFileName(assetKey, mimeType, originalKey) {
  const extension = extensionFromMultipartMimeType(mimeType);
  const normalizedKey = String(originalKey || "asset").replace(/[^a-z0-9_-]+/gi, "-");
  return `${assetKey}-${normalizedKey || "asset"}.${extension || "bin"}`;
}

async function createDashboardMultipartPayload(body, token) {
  const formData = new FormData();
  const assetEntries = [];
  let assetCounter = 0;

  const rewriteValue = (value, keyHint = "") => {
    // Captured background videos are registered as blobs (registerBinaryAsset) and referenced by
    // a placeholder string; they ride as parts exactly like externalized data URLs.
    if (isBinaryAssetRef(value)) {
      const asset = pendingBinaryAssets.get(value);
      const assetKey = `${IMPORT_MULTIPART_ASSET_PREFIX}${assetCounter++}`;
      assetEntries.push({ assetKey, blob: asset.blob, keyHint: keyHint || "video" });
      return { __canvaMultipartAssetRef: assetKey };
    }
    if (typeof value === "string" && shouldExternalizeMultipartAsset(keyHint, value)) {
      // Resilience: never let ONE unparseable asset abort the whole import. If dataUrlToBlob still
      // throws (a genuinely malformed data URL), leave the value INLINE and keep going — the server's
      // robust sanitizer + snapshot-recovery handle or replace it per-layer instead of failing all.
      let blob;
      try {
        blob = dataUrlToBlob(value);
      } catch (assetError) {
        logger.warn("Skipping multipart externalization for unparseable data URL", {
          keyHint,
          head: String(value).slice(0, 48),
        });
        return value;
      }
      const assetKey = `${IMPORT_MULTIPART_ASSET_PREFIX}${assetCounter++}`;
      assetEntries.push({
        assetKey,
        blob,
        keyHint,
      });
      return {
        __canvaMultipartAssetRef: assetKey,
      };
    }
    if (Array.isArray(value)) {
      return value.map((item) => rewriteValue(item, keyHint));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [key, rewriteValue(nestedValue, key)])
      );
    }
    return value;
  };

  const payloadBody = rewriteValue({
    ...(body && typeof body === "object" ? body : {}),
    token: String(token || ""),
  });
  formData.append(IMPORT_MULTIPART_MANIFEST_FIELD, JSON.stringify(payloadBody));
  assetEntries.forEach(({ assetKey, blob, keyHint }) => {
    const mimeType = String(blob?.type || "application/octet-stream");
    formData.append(assetKey, blob, createMultipartAssetFileName(assetKey, mimeType, keyHint));
  });
  return {
    headers: {},
    body: formData,
    assetCount: assetEntries.length,
  };
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

async function postToDashboardViaTabBridge({ endpoint, token, serializedBody, reportProgress = () => {} }) {
  const endpointUrl = new URL(String(endpoint || ""));
  const origin = `${endpointUrl.protocol}//${endpointUrl.host}`;
  let dashboardTab = await findDashboardTabByOrigin(origin);
  let createdTabId = 0;
  if (!dashboardTab?.id) {
    reportProgress("Opening dashboard tab to complete import...");
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
              "Content-Type": "application/json;charset=UTF-8",
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
  const payloadBody = {
    ...(payload.body && typeof payload.body === "object" ? payload.body : {}),
    token: String(payload.token || ""),
  };
  const serializedBody = JSON.stringify(payloadBody);
  const requestPayload = await createDashboardRequestPayload(serializedBody);
  const multipartPayload = await createDashboardMultipartPayload(payload.body, payload.token);
  const payloadSizeKb = Math.round(serializedBody.length / 1024);
  const reportProgress = typeof payload.reportProgress === "function" ? payload.reportProgress : () => {};
  const endpointCandidates = resolveDashboardEndpointCandidates(payload.endpoint);
  const attempts = endpointCandidates.length > 0 ? endpointCandidates : [String(payload.endpoint || "")];
  logger.info("Posting template import payload to dashboard", {
    endpoint: payload.endpoint,
    endpointCandidates: attempts,
    payloadSizeKb,
    compressed: Boolean(requestPayload.headers["Content-Encoding"]),
    multipartAssetCount: Number(multipartPayload.assetCount || 0),
  });
  reportProgress("Uploading imported design to dashboard...");

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
          headers: multipartPayload.headers,
          body: multipartPayload.body,
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
    const bridgeSerializedBody = await inlineBinaryAssetsForJson(payloadBody, serializedBody);
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
          serializedBody: bridgeSerializedBody,
          reportProgress,
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
    // ONE REAL FILE PER WEIGHT THE DESIGN USES — full Canva parity.
    //
    // Canva ships a separate file per weight under one family name (this design uses Avenir Next
    // Arabic at 400, 500 and 700), and the editor now asks the canvas for the numeric weight, so
    // each cut is actually reachable. Targets come from the design's own usage, never from
    // "nearest weight" ranking, which used to drag in cuts the design never had (a 300, a 600).
    const usedVariants = Array.isArray(fontTarget?.usedVariants) ? fontTarget.usedVariants : [];
    const wantedTargets = (usedVariants.length > 0
      ? usedVariants
      : [{ weight: FONT_BUCKET_REGULAR_WEIGHT, style: "normal" }]
    )
      .map((variant) => ({
        weight: Math.max(100, Math.min(900, Math.round(Number(variant?.weight)) || 400)),
        style: String(variant?.style || "").toLowerCase() === "italic" ? "italic" : "normal",
      }))
      .filter((variant, index, all) =>
        all.findIndex((other) => other.weight === variant.weight && other.style === variant.style) === index
      )
      .sort((a, b) => a.weight - b.weight)
      .slice(0, MAX_FONT_VARIANTS_PER_FAMILY);

    let saved = null;
    let lastFailureReason = "";
    const takenSourceUrls = new Set();
    for (const target of wantedTargets) {
      const ranked = orderFontCandidatesForTarget(candidates, {
        fontWeight: target.weight,
        fontStyle: target.style,
      });
      for (let candidateIndex = 0; candidateIndex < ranked.length; candidateIndex += 1) {
        const candidate = ranked[candidateIndex];
        const sourceUrl = String(candidate?.dataUrl || candidate?.url || "").trim();
        if (!sourceUrl) {
          lastFailureReason = "missing-source-url";
          continue;
        }
        // Two used weights resolving to the SAME file means the family doesn't really have both
        // cuts (Roboto maps 600/700/800 to one Bold). Store it once — CSS weight matching picks
        // it for the other weight anyway, with no synthesis.
        if (takenSourceUrls.has(sourceUrl)) break;
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
        takenSourceUrls.add(sourceUrl);
        const entry = {
          family,
          fileName:
            sanitizeFontFileName(
              resolved.fileName || candidate.fileName || candidate.url,
              `${family}.ttf`
            ) || `${family}.ttf`,
          mimeType: resolved.mimeType,
          dataUrl: resolved.dataUrl,
          fontWeight: target.weight,
          fontStyle: target.style,
        };
        saved = saved || entry;
        importedFonts.push(entry);
        totalBytes += bytes;
        break;
      }
    }

    if (saved) {
      // Proof the fresh service worker ran (this string only exists in the bucketed build) plus
      // what it actually collected. chrome.runtime.getManifest() reports the NEW version even
      // from a cached worker, so the version number alone proves nothing.
      safeWarnings.push(
        `Font cuts: ${family} -> ${importedFonts
          .filter((entry) => entry.family === family)
          .map((entry) => `${entry.fontWeight}${entry.fontStyle === "italic" ? "i" : ""}`)
          .join(",")} (design used ${wantedTargets.map((t) => t.weight).join("/")})`
      );
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

async function importActiveCanvaTab(message, options = {}) {
  const reportProgress = typeof options.reportProgress === "function" ? options.reportProgress : () => {};
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

  reportProgress("Waiting for Canva tab to finish loading...");
  await timePhase("waitForTabReady", () => waitForTabReady(tab.id));
  reportProgress("Reading Canva design structure...");
  const designFiberModel = await timePhase("extractFiberModel", () => extractFiberModelFromTab(tab.id));
  const pageInventory = await timePhase("listCanvaPages", () => listCanvaPagesInTab(tab.id));
  const fiberPageCount = Array.isArray(designFiberModel?.__pages)
    ? designFiberModel.__pages.length
    : 0;
  const totalPageCount = Math.max(pageInventory.length, fiberPageCount, 1);
  let pagePlan;
  if (pageInventory.length > 1) {
    // Classic editor: every page node is in the DOM with its own id.
    pagePlan = pageInventory.slice(0, MAX_IMPORT_PAGES);
  } else if (fiberPageCount > 1) {
    // Virtualized editor: one mounted [data-page-id] node at a time (the attribute is the
    // viewport slot) — the design model (fiber) is the source of truth for the page count, and
    // each page is recognized on screen by its own LB element ids.
    pagePlan = Array.from(
      { length: Math.min(fiberPageCount, MAX_IMPORT_PAGES) },
      (_, index) => ({
        index,
        pageId: String(index),
        virtualized: true,
        expectedLbIds: Object.keys(designFiberModel.__pages[index]?.elements || {}).slice(0, 8),
      })
    );
  } else {
    pagePlan = [null];
  }
  const isMultiPageImport = pagePlan.length > 1;
  const truncatedPageCount = isMultiPageImport ? totalPageCount - pagePlan.length : 0;

  // One full capture pass (DOM scrape + screenshots + isolation + hybrid build + font
  // resolution) scoped to a single design page. pageInfo === null runs the legacy
  // whole-viewport single-page behavior.
  clearBinaryAssets();
  const backgroundVideoCaptureCache = new Map();
  const capturePageArtifacts = async (pageInfo, pageIndex) => {
    const pagePrefix = isMultiPageImport ? `Page ${pageIndex + 1}/${pagePlan.length}: ` : "";
    const pageProgress = (text) => reportProgress(`${pagePrefix}${text}`);
    const captureMeta = await timePhase("getCaptureMetaFromTab", () =>
      getCaptureMetaFromTab(tab.id, {
        captureMetadata,
        targetPageId: pageInfo?.pageId || "",
        expectedLbIds: pageInfo?.expectedLbIds || [],
        pageIndex,
        fiberModel: designFiberModel,
      })
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
      pageProgress("Capturing Canva canvas snapshot...");
      screenshotDataUrl = await timePhase("captureVisibleTab", () =>
        chrome.tabs.captureVisibleTab(tab.windowId, { format: PROGRESS_CAPTURE_FORMAT })
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
        .filter((layer) => !layer?.hasCompanionText)
        // Compute the isolation snapshot for ALL prefer-snapshot image layers (including
        // plain crops that captured an asset). buildHybridFabricObjects compares the asset
        // against this snapshot and uses the snapshot only when the asset has the page
        // background baked in; otherwise it keeps the high-res asset.
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
          pageProgress(`Preparing ${preferSnapshotLayers.length} merged image layer snapshots...`);
          const isolatedSnapshotsById = new Map();
          const preferSnapshotLayerIds = preferSnapshotLayers
            .map((layer) => String(layer?.id || "").trim())
            .filter(Boolean);
          let hiddenAllBitmap = null;
          // Editable text is re-added as its own layer, so hide it for every isolation
          // capture. Otherwise overlapping (often semi-transparent) text blends against
          // the layer in the "visible" shot but the background in the "hidden" shot, so
          // the visible-vs-hidden diff keeps a faint ghost copy baked into the snapshot.
          const isolationTextLayerIds = extractedLayers
            .filter((l) => String(l?.kind || "").toLowerCase() === "text")
            .map((l) => String(l?.id || "").trim())
            .filter((id) => id.startsWith("LB"));

          try {
            await setCanvaLayerVisibility(tab.id, preferSnapshotLayerIds, true);
            if (isolationTextLayerIds.length > 0) {
              await setCanvaLayerVisibility(tab.id, isolationTextLayerIds, true).catch(() => {});
            }
            await sleep(180);
            const allHiddenScreenshotDataUrl = await timePhase("captureLayersAllHidden", () =>
              chrome.tabs.captureVisibleTab(tab.windowId, { format: PROGRESS_CAPTURE_FORMAT })
            );
            hiddenAllBitmap = await timePhase("decodeLayersAllHiddenBitmap", () =>
              decodeDataUrlToBitmap(allHiddenScreenshotDataUrl)
            );

            for (let index = 0; index < preferSnapshotLayers.length; index += 1) {
              const layer = preferSnapshotLayers[index];
              const layerId = String(layer?.id || "").trim();
              if (!layerId) continue;
              pageProgress(
                `Isolating merged image layer ${index + 1} of ${preferSnapshotLayers.length}...`
              );
              try {
                await setCanvaLayerVisibility(tab.id, [layerId], false);
                let isolatedDataUrl = "";
                const isolationWaits = [140, 240];
                for (let attempt = 0; attempt < isolationWaits.length; attempt += 1) {
                  await sleep(isolationWaits[attempt]);
                  const visibleLayerScreenshotDataUrl = await timePhase(
                    `captureLayerVisible_${index + 1}_${attempt + 1}`,
                    () => chrome.tabs.captureVisibleTab(tab.windowId, { format: PROGRESS_CAPTURE_FORMAT })
                  );
                  const visibleLayerBitmap = await timePhase(
                    `decodeLayerVisibleBitmap_${index + 1}_${attempt + 1}`,
                    () => decodeDataUrlToBitmap(visibleLayerScreenshotDataUrl)
                  );
                  isolatedDataUrl = await timePhase(
                    `isolateLayerSnapshot_${index + 1}_${attempt + 1}`,
                    () =>
                      isolateLayerSnapshotFromBitmaps(visibleLayerBitmap, hiddenAllBitmap, layer.viewportRect, {
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
              } catch (error) {
                logger.warn("Layer isolation failed for merged Canva layer", { layerId }, error);
                isolatedSnapshotWarnings.push(`Could not isolate merged Canva layer "${layerId}".`);
              } finally {
                await setCanvaLayerVisibility(tab.id, [layerId], true).catch(() => {});
                await sleep(40);
              }
            }
          } finally {
            await setCanvaLayerVisibility(tab.id, preferSnapshotLayerIds, false).catch(() => {});
            if (isolationTextLayerIds.length > 0) {
              await setCanvaLayerVisibility(tab.id, isolationTextLayerIds, false).catch(() => {});
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
        } catch (error) {
          logger.warn("Merged Canva layer isolation batch failed", {}, error);
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
    // Off-screen model elements are skipped when their image has NO rendered instance at the import
    // frame (nothing to capture pixels from). Silent skipping loses elements — e.g. a video design's
    // opening doors imported from a late frame. Tell the user how to get a complete capture.
    const unresolvedMediaCount = Number(captureMeta?.timelineSupplement?.unresolvedMedia || 0);
    if (unresolvedMediaCount > 0) {
      const animatedCount = Number(captureMeta?.timelineSupplement?.unresolvedAnimated || 0);
      importWarnings.push(
        `${unresolvedMediaCount} image element(s) were SKIPPED because their image is not visible at the current frame` +
          (animatedCount > 0 ? ` (${animatedCount} of them animated)` : "") +
          ". Move the Canva playhead to the START of the video (0:00) and reimport to capture the full design."
      );
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
        pageProgress("Capturing text-free background snapshot...");
        await setCanvaLayerVisibility(tab.id, textLayerIds, true);
        const hiddenTextScreenshotDataUrl = await timePhase("captureVisibleTabWithoutText", () =>
          chrome.tabs.captureVisibleTab(tab.windowId, { format: PROGRESS_CAPTURE_FORMAT })
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
    pageProgress("Resolving imported fonts...");
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
        // Capture a parallel screenshot with editable text hidden, so image layers that
        // fall back to raster screenshot crops don't bake in overlapping foreground text
        // (which is also emitted as an editable text layer — otherwise it renders twice).
        let screenshotBitmapNoText = null;
        if (textLayerIds.length > 0) {
          try {
            pageProgress("Capturing text-free snapshot for image layers...");
            await setCanvaLayerVisibility(tab.id, textLayerIds, true);
            await sleep(180);
            const noTextScreenshotDataUrl = await timePhase("captureVisibleTabHybridNoText", () =>
              chrome.tabs.captureVisibleTab(tab.windowId, { format: PROGRESS_CAPTURE_FORMAT })
            );
            if (String(noTextScreenshotDataUrl || "").startsWith("data:image/")) {
              screenshotBitmapNoText = await timePhase("decodeScreenshotBitmapNoText", () =>
                decodeDataUrlToBitmap(noTextScreenshotDataUrl)
              );
            }
          } catch (noTextError) {
            logger.warn(
              "Text-hidden screenshot capture failed; image crops may include text",
              {},
              noTextError
            );
          } finally {
            await setCanvaLayerVisibility(tab.id, textLayerIds, false).catch(() => {});
          }
        }
        fabricObjects = await timePhase("buildHybridFabricObjects", () =>
          buildHybridFabricObjects(
            extractedLayers,
            screenshotBitmap,
            Number(captureMeta.devicePixelRatio || 1),
            sourceWidth || Number(captureMeta.designWidth || 0),
            sourceHeight || Number(captureMeta.designHeight || 0),
            {
              unsupportedTextFamilies,
              screenshotBitmapNoText,
            }
          )
        );
      } catch (error) {
        logger.warn("Hybrid fabric object build failed; falling back to simple objects", {}, error);
        fabricObjects = [];
      }
    }
    if (fabricObjects.length === 0) {
      fabricObjects = await timePhase("buildFabricObjectsFallback", () =>
        buildFabricObjects(extractedLayers)
      );
    }
    // Keep a full-page opaque background rect from painting over the real background image.
    fabricObjects = reorderBackgroundRectsToBottom(
      fabricObjects,
      Math.round(sourceWidth || Number(captureMeta.designWidth || 1080)),
      Math.round(sourceHeight || Number(captureMeta.designHeight || 1920))
    );
    // Background video: replace the poster-frame layer with the captured clip when possible.
    let backgroundVideoDurationMs = 0;
    if (captureMeta?.timelineSupplement?.backgroundVideoPoster) {
      const videoSwap = await timePhase("captureBackgroundVideo", () =>
        attachCapturedBackgroundVideo(fabricObjects, {
          tabId: tab.id,
          pageIndex,
          fiberModel: designFiberModel,
          cache: backgroundVideoCaptureCache,
          importWarnings,
          pageWidth: sourceWidth || Number(captureMeta.designWidth || 1080),
          pageHeight: sourceHeight || Number(captureMeta.designHeight || 1920),
          reportProgress: (text) => reportProgress(`${pagePrefix}${text}`),
        })
      );
      fabricObjects = videoSwap.objects;
      // A video-backed page runs for the clip's length, and only the capture knows it (the model
      // leaves page.durationUs unset for these).
      if (videoSwap.captured && Number(videoSwap.durationMs) > 0) {
        backgroundVideoDurationMs = Math.round(Number(videoSwap.durationMs));
      }
    }
    const fallbackWidth = Math.max(1, Math.round(sourceWidth || 1080));
    const fallbackHeight = Math.max(1, Math.round(sourceHeight || 1080));
    const hasMeaningfulDrawableLayers = fabricObjects.some((object) => {
      const type = String(object?.type || "").toLowerCase();
      if (type === "video") return Boolean(String(object?.src || "").trim());
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
    // Per-page snapshot fallback keeps a failed page from collapsing the whole import.
    const pageHasExtractedLayers = fabricObjects.length > 0 && hasMeaningfulDrawableLayers;
    let pageFabricObjects = fabricObjects;
    if (!pageHasExtractedLayers && imageDataUrl.startsWith("data:image/")) {
      pageFabricObjects = [
        buildSingleImageFabricObject(imageDataUrl, fallbackWidth, fallbackHeight, {
          importNodeId: `canva-snapshot-${pageIndex + 1}`,
          fallback: true,
          fallbackReason: "full-snapshot",
        }),
      ];
      importWarnings.push("Could not extract reliable Canva layers; imported as full-page snapshot.");
    }

    return {
      captureMeta,
      imageDataUrl,
      sourceWidth,
      sourceHeight,
      fallbackWidth,
      fallbackHeight,
      extractedLayers,
      fabricObjects: pageFabricObjects,
      importWarnings,
      usedFonts,
      importedCustomFonts,
      hasExtractedLayers: pageHasExtractedLayers,
      backgroundVideoDurationMs,
    };
  };

  const pageArtifacts = [];
  for (let pageIndex = 0; pageIndex < pagePlan.length; pageIndex += 1) {
    const pageInfo = pagePlan[pageIndex];
    if (pageInfo) {
      reportProgress(`Opening page ${pageIndex + 1} of ${pagePlan.length}...`);
      const pageVisible = pageInfo.virtualized
        ? await ensureVirtualizedPageDisplayed(tab.id, pageIndex, pageInfo.expectedLbIds)
        : await ensureCanvaPageVisible(tab.id, pageInfo.pageId);
      if (!pageVisible && pageIndex > 0) {
        logger.warn("Multi-page import: page never became visible; skipping page", {
          pageIndex,
          pageId: pageInfo.pageId,
          virtualized: Boolean(pageInfo.virtualized),
        });
        pageArtifacts.push(null);
        continue;
      }
      // Let Canva lazy-render the newly displayed page before scraping/capturing it.
      await sleep(700);
    }
    try {
      pageArtifacts.push(await capturePageArtifacts(pageInfo, pageIndex));
    } catch (pageError) {
      if (!isMultiPageImport || pageIndex === 0) throw pageError;
      logger.warn("Multi-page import: page capture failed; skipping page", { pageIndex }, pageError);
      pageArtifacts.push(null);
    }
  }
  const capturedArtifacts = pageArtifacts.filter(Boolean);
  if (capturedArtifacts.length === 0) {
    throw new Error("Could not capture any Canva pages.");
  }

  // ── Merge per-page artifacts into the single import payload ─────────────────────────────────
  const primaryArtifacts = capturedArtifacts[0];
  const captureMeta = primaryArtifacts.captureMeta;
  const imageDataUrl = primaryArtifacts.imageDataUrl;
  const sourceWidth = primaryArtifacts.sourceWidth;
  const sourceHeight = primaryArtifacts.sourceHeight;
  const fallbackWidth = primaryArtifacts.fallbackWidth;
  const fallbackHeight = primaryArtifacts.fallbackHeight;
  const fabricObjects = [];
  capturedArtifacts.forEach((artifacts, mergedPageIndex) => {
    artifacts.fabricObjects.forEach((object) => {
      fabricObjects.push(
        isMultiPageImport ? { ...object, importPageIndex: mergedPageIndex } : object
      );
    });
  });
  const extractedLayers = capturedArtifacts.flatMap((artifacts) => artifacts.extractedLayers);
  const importWarnings = [];
  if (isMultiPageImport) {
    // Diagnostic breadcrumb: makes "why did only N pages import" answerable from the stored
    // template alone (DOM node count vs model page count vs what was actually captured).
    importWarnings.push(
      `Multi-page debug: domPages=${pageInventory.length}, modelPages=${fiberPageCount}, planned=${pagePlan.length}, captured=${capturedArtifacts.length}.`
    );
  }
  if (truncatedPageCount > 0) {
    importWarnings.push(
      `Design has ${totalPageCount} pages; imported the first ${pagePlan.length} (page cap).`
    );
  }
  pageArtifacts.forEach((artifacts, pageIndex) => {
    if (!artifacts) {
      importWarnings.push(`Page ${pageIndex + 1}: capture failed; page was skipped.`);
      return;
    }
    const prefix = isMultiPageImport ? `Page ${pageIndex + 1}: ` : "";
    artifacts.importWarnings.forEach((warning) => importWarnings.push(`${prefix}${warning}`));
  });
  const usedFonts = capturedArtifacts.reduce(
    (merged, artifacts) => mergeUsedFontFamilies(merged, artifacts.usedFonts),
    []
  );
  // Deduped per (family, weight, style), NOT per family: the same family legitimately ships one
  // file per cut the design uses, and collapsing on family alone silently threw every extra
  // weight away right before the payload was built — the editor then faked them (faux-bold).
  // Keying on family alone is still right for the thing this merge exists for: the same page
  // font appearing across several pages.
  const importedCustomFontsByVariant = new Map();
  capturedArtifacts.forEach((artifacts) => {
    (artifacts.importedCustomFonts || []).forEach((font) => {
      const familyKey = String(font?.family || "").trim().toLowerCase();
      if (!familyKey) return;
      const weight = Math.max(100, Math.min(900, Math.round(Number(font?.fontWeight)) || 400));
      const style = String(font?.fontStyle || "").toLowerCase() === "italic" ? "italic" : "normal";
      const variantKey = `${familyKey}|${weight}|${style}`;
      if (!importedCustomFontsByVariant.has(variantKey)) {
        importedCustomFontsByVariant.set(variantKey, font);
      }
    });
  });
  const importedCustomFonts = [...importedCustomFontsByVariant.values()];
  const hasExtractedLayers = capturedArtifacts.some((artifacts) => artifacts.hasExtractedLayers);

  // Per-page capture already degraded empty pages to their own snapshot objects; this outer
  // fallback only fires when merging produced nothing at all.
  // Canva's page fill colour, when the model exposes it. The server only infers a colour from
  // the snapshot when none is sent, and that inference took the frame's sage for a cream page.
  const modelPageColor = String(designFiberModel?.__pageFill?.color || "").trim().toLowerCase();
  // Canva's page length (5s unless the author re-timed it). It only travels for a design that
  // actually plays — a static import keeps the editor's own default page duration, and shipping a
  // 5s page for a still template would shorten it for no reason.
  const designPlays =
    Boolean(designFiberModel?.__pageAnimation) ||
    Boolean(designFiberModel?.__background) ||
    capturedArtifacts.some((artifacts) => Number(artifacts?.backgroundVideoDurationMs) > 0) ||
    (Array.isArray(fabricObjects) &&
      fabricObjects.some((object) => String(object?.mediaAnimationType || "NONE") !== "NONE"));
  const canvaPageDurationMs = (pageIndex) => {
    if (!designPlays) return 0;
    // A captured background video states the page's real length; the model does not.
    const captured = Number(capturedArtifacts[pageIndex]?.backgroundVideoDurationMs);
    if (Number.isFinite(captured) && captured > 0) return Math.round(captured);
    const pages = Array.isArray(designFiberModel?.__pages) ? designFiberModel.__pages : null;
    const fromPage = pages && pages[pageIndex] ? Number(pages[pageIndex].durationMs) : 0;
    const value = fromPage > 0 ? fromPage : Number(designFiberModel?.__pageDurationMs);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  };
  const fabricData = {
    version: "7.0.0",
    ...(/^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(modelPageColor) ? { backgroundColor: modelPageColor } : {}),
    objects:
      fabricObjects.length > 0
        ? fabricObjects
        : [
            buildSingleImageFabricObject(imageDataUrl, fallbackWidth, fallbackHeight, {
              importNodeId: "canva-snapshot-1",
              fallback: true,
              fallbackReason: "full-snapshot",
            }),
          ],
  };
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
        // Canva's own document keywords when the design carries them (see __keywords in
        // canva-fiber-main). Usually absent on a user's copy of a template, in which case the
        // server derives search tags from the title instead.
        canvaKeywords: Array.isArray(designFiberModel?.__keywords) ? designFiberModel.__keywords : [],
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
            ...(canvaPageDurationMs(0) > 0 ? { durationMs: canvaPageDurationMs(0) } : {}),
          },
          // Multi-page designs: ordered page descriptors; every fabric object carries an
          // importPageIndex pointing into this list. `page` above stays the first page for
          // single-page consumers.
          ...(isMultiPageImport
            ? {
                pages: capturedArtifacts.map((artifacts, mergedPageIndex) => ({
                  id: `canva-page-${mergedPageIndex + 1}`,
                  name: `Page ${mergedPageIndex + 1}`,
                  width: Math.max(1, Math.round(artifacts.sourceWidth || sourceWidth || 1080)),
                  height: Math.max(1, Math.round(artifacts.sourceHeight || sourceHeight || 1080)),
                  ...(canvaPageDurationMs(mergedPageIndex) > 0
                    ? { durationMs: canvaPageDurationMs(mergedPageIndex) }
                    : {}),
                  // The page's own cropped screenshot, reused as its preview image — the app's
                  // page strip paints these instead of compositing every page on first open.
                  ...(String(artifacts.imageDataUrl || "").startsWith("data:image/")
                    ? { thumbnailDataUrl: artifacts.imageDataUrl }
                    : {}),
                })),
              }
            : {}),
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
  let result;
  try {
    result = await timePhase("postToDashboard", () =>
      postToDashboard({
        endpoint,
        token,
        body: requestBody,
        reportProgress,
      })
    );
  } finally {
    clearBinaryAssets();
  }

  const sortedPhaseTimings = Object.entries(phaseTimings).sort((a, b) => b[1] - a[1]);
  const provenanceCounts = (Array.isArray(fabricObjects) ? fabricObjects : []).reduce(
    (acc, object) => {
      const key = String(object?.imageProvenance || "none");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {}
  );
  logger.info("Canva import image provenance", { provenanceCounts });
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

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== IMPORT_PORT_NAME) return;
  port.onMessage.addListener((message) => {
    const messageType = String(message?.type || "").trim();
    if (messageType !== "IMPORT_ACTIVE_CANVA_TAB") return;
    const reportProgress = createProgressReporter(port);
    try {
      logger.info("Received import request from popup port", {
        tabId: Number(message?.tabId || 0),
        dashboardUrl: String(message?.dashboardUrl || ""),
      });
      importActiveCanvaTab(message, { reportProgress })
        .then((result) => {
          logger.info("Import finished successfully", {
            templateId: String(result?.template?.id || ""),
            layerCount: Number(result?.layerCount || 0),
            importedCustomFonts: Number(result?.importedCustomFonts || 0),
          });
          port.postMessage({
            type: IMPORT_SUCCESS_EVENT,
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
          logger.error("Import failed over popup port", {
            tabId: Number(message?.tabId || 0),
          }, error);
          try {
            port.postMessage({
              type: IMPORT_ERROR_EVENT,
              ok: false,
              error: errorMessage(error, "Failed to import active Canva tab."),
            });
          } catch (_error) {
            // Ignore if the popup disconnected before the error arrived.
          }
        });
    } catch (error) {
      logger.error("Port message handler crashed", {}, error);
      try {
        port.postMessage({
          type: IMPORT_ERROR_EVENT,
          ok: false,
          error: errorMessage(error, "Importer message handler crashed."),
        });
      } catch (_error) {
        // Ignore if the popup disconnected before the error arrived.
      }
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const messageType = String(message?.type || "").trim();
  if (!messageType) return;

  if (messageType !== "IMPORT_ACTIVE_CANVA_TAB") return;

  try {
    logger.info("Received import request from popup", {
      tabId: Number(message?.tabId || 0),
      dashboardUrl: String(message?.dashboardUrl || ""),
    });

    importActiveCanvaTab(message, { reportProgress: createProgressReporter(null) })
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
