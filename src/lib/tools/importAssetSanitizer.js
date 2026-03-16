import { createAdminClient } from "@/lib/supabase/admin";
import { resizeThumbnailBufferHalf } from "@/lib/media/thumbnailResize.server";

export const IMPORT_ASSET_MANIFEST_VERSION = 1;

const IMPORT_MEDIA_BUCKET = process.env.EDITOR_MEDIA_BUCKET || "editor-media";
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 45_000;
const MAX_CANVA_REFERENCE_RESULTS = 32;
const MAX_SVG_RASTER_SIDE = 8192;
const MAX_TRACE_SIDE = 1024;
const TRACE_OPTIONS = {
  ltres: 1,
  qtres: 1,
  pathomit: 2,
  numberofcolors: 18,
  mincolorratio: 0.015,
  colorquantcycles: 2,
  linefilter: true,
  scale: 1,
  roundcoords: 1,
  strokewidth: 0,
};

const CANVA_HOST_PATTERNS = [
  /(^|\.)canva\.com$/i,
  /(^|\.)canvaassets\.com$/i,
  /(^|\.)canva-apps\.com$/i,
  /(^|\.)canva\.site$/i,
  /(^|\.)canva\.cn$/i,
  /(^|\.)canvausercontent\.com$/i,
  /(^|\.)canva-cdn\.com$/i,
];

const ASSET_FIELD_NAMES = new Set([
  "src",
  "imageuri",
  "thumbnailuri",
  "videouri",
  "imageurl",
  "thumbnailurl",
  "videourl",
  "imagedataurl",
  "thumbnaildataurl",
  "videodataurl",
  "background",
  "backgroundimage",
  "backgroundimageuri",
  "poster",
  "posteruri",
  "source",
  "fileurl",
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv", "m4v", "avi"]);

function asString(value) {
  return String(value || "").trim();
}

function isHttpUrl(value) {
  const source = asString(value);
  if (!source) return false;
  try {
    const parsed = new URL(source);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function isDataUri(value) {
  return /^data:[^,]+,/i.test(asString(value));
}

function parseDataUri(value) {
  const source = asString(value);
  const match = source.match(/^data:([^;,]+)?((?:;[^;,=]+=[^;,]+)*)(;base64)?,([\s\S]*)$/i);
  if (!match) return null;

  const mimeType = asString(match[1] || "application/octet-stream").toLowerCase();
  const isBase64 = Boolean(match[3]);
  const payload = String(match[4] || "");
  if (!payload) return null;

  try {
    const bytes = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return { mimeType, bytes };
  } catch (_error) {
    return null;
  }
}

function extensionFromMimeType(mimeType) {
  const normalized = asString(mimeType).toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("svg")) return "svg";
  if (normalized.includes("avif")) return "avif";
  if (normalized.includes("bmp")) return "bmp";
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("quicktime")) return "mov";
  if (normalized.includes("x-matroska")) return "mkv";
  if (normalized.includes("avi")) return "avi";
  return "";
}

function extensionFromUrl(value) {
  const source = asString(value);
  if (!source) return "";
  try {
    const parsed = new URL(source);
    const pathname = parsed.pathname || "";
    const match = pathname.toLowerCase().match(/\.([a-z0-9]{1,10})$/);
    return match?.[1] || "";
  } catch (_error) {
    return "";
  }
}

function mimeTypeFromExtension(extension) {
  const ext = asString(extension).toLowerCase();
  if (!ext) return "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "bmp") return "image/bmp";
  if (ext === "avif") return "image/avif";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  if (ext === "mkv") return "video/x-matroska";
  if (ext === "m4v") return "video/x-m4v";
  if (ext === "avi") return "video/x-msvideo";
  return "";
}

function detectAssetKind({ mimeType, extension, fieldName }) {
  const normalizedMimeType = asString(mimeType).toLowerCase();
  const normalizedExtension = asString(extension).toLowerCase();
  const normalizedFieldName = asString(fieldName).toLowerCase();

  if (normalizedMimeType.startsWith("video/")) return "video";
  if (normalizedMimeType.startsWith("image/")) return "image";
  if (VIDEO_EXTENSIONS.has(normalizedExtension)) return "video";
  if (IMAGE_EXTENSIONS.has(normalizedExtension)) return "image";
  if (normalizedFieldName.includes("video")) return "video";
  return "image";
}

function sanitizePathSegment(value, fallback = "asset") {
  const normalized = asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function makeObjectPath({ ownerId, kind, extension, sourceLabel }) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const safeOwner = sanitizePathSegment(ownerId, "unknown-owner");
  const safeKind = sanitizePathSegment(kind, "asset");
  const safeSource = sanitizePathSegment(sourceLabel, "import");
  const safeExtension = sanitizePathSegment(extension, kind === "video" ? "mp4" : "png");
  const uniqueId =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return `users/${safeOwner}/imports/${safeSource}/${safeKind}/${yyyy}/${mm}/${dd}/${uniqueId}.${safeExtension}`;
}

function summarizeSource(value) {
  const source = asString(value);
  if (!source) return "";
  if (source.startsWith("data:")) {
    const mimeType = asString(source.match(/^data:([^;,]+)/i)?.[1] || "application/octet-stream");
    return `data:${mimeType};...`;
  }
  if (source.length <= 240) return source;
  return `${source.slice(0, 200)}...${source.slice(-20)}`;
}

function getPathString(pathSegments) {
  if (!Array.isArray(pathSegments) || pathSegments.length === 0) return "root";
  return pathSegments
    .map((segment, index) => {
      if (typeof segment === "number") return `[${segment}]`;
      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(segment)) {
        return index === 0 ? segment : `.${segment}`;
      }
      return `[${JSON.stringify(String(segment))}]`;
    })
    .join("");
}

function looksLikeAssetField(fieldName, value) {
  const normalizedFieldName = asString(fieldName).toLowerCase();
  const source = asString(value);
  if (!source) return false;
  if (isDataUri(source)) return true;
  if (!isHttpUrl(source)) return false;

  if (ASSET_FIELD_NAMES.has(normalizedFieldName)) return true;
  if (normalizedFieldName.endsWith("src")) return true;
  if (normalizedFieldName.endsWith("uri")) return true;
  if (normalizedFieldName.endsWith("url")) return true;
  return false;
}

function getSourceHostsFromEnv() {
  const appUrlHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_APP_URL).host;
    } catch (_error) {
      return "";
    }
  })();
  const supabaseUrlHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
    } catch (_error) {
      return "";
    }
  })();

  return new Set([appUrlHost, supabaseUrlHost].filter(Boolean));
}

function isInternalHost(hostname, knownHosts) {
  const host = asString(hostname).toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (knownHosts.has(host)) return true;
  return false;
}

function parseUrlOrNull(value) {
  const source = asString(value);
  if (!source) return null;
  try {
    const parsed = new URL(source);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

export function isCanvaExternalUrl(value) {
  const parsed = parseUrlOrNull(value);
  if (!parsed) return false;
  const host = asString(parsed.hostname).toLowerCase();
  if (!host) return false;
  if (CANVA_HOST_PATTERNS.some((pattern) => pattern.test(host))) return true;
  return host.includes("canva");
}

export function findExternalCanvaReferences(payload, options = {}) {
  const maxResults = Number.isFinite(Number(options.maxResults))
    ? Math.max(1, Math.round(Number(options.maxResults)))
    : MAX_CANVA_REFERENCE_RESULTS;
  const assetFieldsOnly = options.assetFieldsOnly === true;
  const pathPrefix = Array.isArray(options.pathPrefix)
    ? options.pathPrefix
    : typeof options.pathPrefix === "string" && options.pathPrefix
      ? [options.pathPrefix]
      : [];

  const matches = [];
  const visited = new WeakSet();

  function shouldInspectString(pathSegments, value) {
    if (!assetFieldsOnly) return true;
    const nearestFieldName = [...pathSegments]
      .reverse()
      .find((segment) => typeof segment === "string");
    if (!nearestFieldName) return false;
    return looksLikeAssetField(nearestFieldName, value);
  }

  function walk(node, pathSegments) {
    if (matches.length >= maxResults) return;

    if (typeof node === "string") {
      if (shouldInspectString(pathSegments, node) && isCanvaExternalUrl(node)) {
        matches.push({
          path: getPathString(pathSegments),
          url: asString(node),
        });
      }
      return;
    }

    if (!node || typeof node !== "object") return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        walk(item, [...pathSegments, index]);
      });
      return;
    }

    Object.entries(node).forEach(([key, value]) => {
      walk(value, [...pathSegments, key]);
    });
  }

  walk(payload, pathPrefix);
  return matches;
}

function normalizeManifestSummary(assets) {
  const total = assets.length;
  const uploaded = assets.filter((asset) => asset.status === "uploaded").length;
  const preserved = assets.filter((asset) => asset.status === "preserved").length;
  const failed = assets.filter((asset) => asset.status === "failed").length;
  return {
    total,
    uploaded,
    preserved,
    failed,
  };
}

async function fetchUrlAsAsset(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "image/*,video/*,*/*;q=0.8",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = asString(response.headers.get("content-type")).split(";")[0].toLowerCase();
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes || bytes.length === 0) {
      throw new Error("empty asset response");
    }

    return {
      mimeType: contentType,
      bytes,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

let canvasLibPromise = null;
let imageTracerLibPromise = null;

async function getCanvasLib() {
  if (canvasLibPromise) return canvasLibPromise;
  canvasLibPromise = import("canvas")
    .then((module) => ({
      createCanvas: module.createCanvas,
      loadImage: module.loadImage,
    }))
    .catch((_error) => null);
  return canvasLibPromise;
}

async function getImageTracerLib() {
  if (imageTracerLibPromise) return imageTracerLibPromise;
  imageTracerLibPromise = import("imagetracerjs")
    .then((module) => module?.default || module)
    .catch((_error) => null);
  return imageTracerLibPromise;
}

function estimateSvgPixelSize(svgText) {
  const source = String(svgText || "");
  const widthMatch = source.match(/\bwidth=["']?\s*([0-9.]+)\s*(px)?\s*["']?/i);
  const heightMatch = source.match(/\bheight=["']?\s*([0-9.]+)\s*(px)?\s*["']?/i);
  const viewBoxMatch = source.match(
    /\bviewBox=["']?\s*([0-9.+-eE]+)\s+([0-9.+-eE]+)\s+([0-9.+-eE]+)\s+([0-9.+-eE]+)\s*["']?/i
  );
  const widthFromAttr = Number(widthMatch?.[1] || 0);
  const heightFromAttr = Number(heightMatch?.[1] || 0);
  const widthFromViewBox = Number(viewBoxMatch?.[3] || 0);
  const heightFromViewBox = Number(viewBoxMatch?.[4] || 0);
  const width = Math.max(1, Math.round(widthFromAttr || widthFromViewBox || 1024));
  const height = Math.max(1, Math.round(heightFromAttr || heightFromViewBox || 1024));
  return {
    width: Math.min(MAX_SVG_RASTER_SIDE, width),
    height: Math.min(MAX_SVG_RASTER_SIDE, height),
  };
}

async function tryRasterizeSvgToPng(bytes) {
  const svgBytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!svgBytes || svgBytes.length === 0) return null;

  const canvasLib = await getCanvasLib();
  if (!canvasLib?.createCanvas || !canvasLib?.loadImage) return null;

  const svgText = svgBytes.toString("utf8");
  const estimated = estimateSvgPixelSize(svgText);
  const dataUrl = `data:image/svg+xml;base64,${svgBytes.toString("base64")}`;

  try {
    const image = await canvasLib.loadImage(dataUrl);
    const width = Math.max(
      1,
      Math.min(MAX_SVG_RASTER_SIDE, Math.round(Number(image?.width || estimated.width || 1)))
    );
    const height = Math.max(
      1,
      Math.min(MAX_SVG_RASTER_SIDE, Math.round(Number(image?.height || estimated.height || 1)))
    );
    const canvas = canvasLib.createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, width, height);
    return canvas.toBuffer("image/png");
  } catch (_error) {
    return null;
  }
}

async function maybeRasterizeSvgAsset({ bytes, mimeType, preserveSvg = false }) {
  const normalizedMimeType = asString(mimeType).toLowerCase();
  const isSvgMime =
    normalizedMimeType.includes("image/svg") || normalizedMimeType.includes("svg+xml");
  if (!isSvgMime) {
    return {
      bytes,
      mimeType: normalizedMimeType || mimeType,
      rasterized: false,
    };
  }

  if (preserveSvg) {
    return {
      bytes,
      mimeType: normalizedMimeType || mimeType || "image/svg+xml",
      rasterized: false,
    };
  }

  const rasterizedBytes = await tryRasterizeSvgToPng(bytes);
  if (!rasterizedBytes || rasterizedBytes.length === 0) {
    return {
      bytes,
      mimeType: normalizedMimeType || mimeType || "image/svg+xml",
      rasterized: false,
    };
  }

  return {
    bytes: rasterizedBytes,
    mimeType: "image/png",
    rasterized: true,
  };
}

function isRasterImageMimeType(mimeType) {
  const normalized = asString(mimeType).toLowerCase();
  if (!normalized.startsWith("image/")) return false;
  if (normalized.includes("svg")) return false;
  return true;
}

function buildDataUrlFromBytes(bytes, mimeType) {
  const safeMimeType = asString(mimeType) || "application/octet-stream";
  return `data:${safeMimeType};base64,${Buffer.from(bytes || []).toString("base64")}`;
}

async function tryTraceRasterToSvg({ bytes, mimeType }) {
  if (!bytes || bytes.length === 0) return null;
  if (!isRasterImageMimeType(mimeType)) return null;

  const canvasLib = await getCanvasLib();
  const imageTracer = await getImageTracerLib();
  if (!canvasLib?.createCanvas || !canvasLib?.loadImage) return null;
  if (!imageTracer || typeof imageTracer.imagedataToSVG !== "function") return null;

  try {
    const sourceDataUrl = buildDataUrlFromBytes(bytes, mimeType || "image/png");
    const sourceImage = await canvasLib.loadImage(sourceDataUrl);
    const sourceWidth = Math.max(1, Math.round(Number(sourceImage?.width || 1)));
    const sourceHeight = Math.max(1, Math.round(Number(sourceImage?.height || 1)));
    const downscale = Math.min(1, MAX_TRACE_SIDE / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * downscale));
    const height = Math.max(1, Math.round(sourceHeight * downscale));

    const canvas = canvasLib.createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    context.drawImage(sourceImage, 0, 0, width, height);

    const imageData = context.getImageData(0, 0, width, height);
    const tracedSvg = imageTracer.imagedataToSVG(imageData, TRACE_OPTIONS);
    const safeSvg = asString(tracedSvg);
    if (!safeSvg || !safeSvg.includes("<svg")) return null;

    const svgBytes = Buffer.from(safeSvg, "utf8");
    if (!svgBytes || svgBytes.length === 0 || svgBytes.length > MAX_IMAGE_BYTES) return null;

    return {
      bytes: svgBytes,
      mimeType: "image/svg+xml",
      traced: true,
    };
  } catch (_error) {
    return null;
  }
}

async function maybeTraceRasterToSvgAsset({
  bytes,
  mimeType,
  kind,
  fieldName,
  traceRasterToSvg = false,
}) {
  if (!traceRasterToSvg) {
    return {
      bytes,
      mimeType,
      traced: false,
    };
  }

  if (kind !== "image") {
    return {
      bytes,
      mimeType,
      traced: false,
    };
  }

  const normalizedFieldName = asString(fieldName).toLowerCase();
  if (normalizedFieldName.includes("thumbnail") || normalizedFieldName.includes("poster")) {
    return {
      bytes,
      mimeType,
      traced: false,
    };
  }

  const tracedAsset = await tryTraceRasterToSvg({ bytes, mimeType });
  if (!tracedAsset) {
    return {
      bytes,
      mimeType,
      traced: false,
    };
  }

  return tracedAsset;
}

function validateAssetBytes({ kind, bytes }) {
  const size = Number(bytes?.length || 0);
  if (size <= 0) {
    throw new Error("asset is empty");
  }
  if (kind === "video" && size > MAX_VIDEO_BYTES) {
    throw new Error("video asset is too large");
  }
  if (kind !== "video" && size > MAX_IMAGE_BYTES) {
    throw new Error("image asset is too large");
  }
}

async function ensurePublicBucket(admin) {
  const { data, error } = await admin.storage.getBucket(IMPORT_MEDIA_BUCKET);
  if (error) {
    const create = await admin.storage.createBucket(IMPORT_MEDIA_BUCKET, {
      public: true,
      fileSizeLimit: `${MAX_VIDEO_BYTES}`,
    });
    if (create.error && !asString(create.error.message).toLowerCase().includes("exists")) {
      throw create.error;
    }
    return;
  }

  if (data && data.public === false) {
    await admin.storage.updateBucket(IMPORT_MEDIA_BUCKET, {
      public: true,
      fileSizeLimit: `${MAX_VIDEO_BYTES}`,
    });
  }
}

function cloneSerializable(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

export async function sanitizeImportPayloadAssets({
  ownerId,
  imageDataUrl,
  thumbnailDataUrl,
  fabricData,
  sourceLabel = "canva-import",
  preserveSvg = false,
  traceRasterToSvg = false,
  rewriteExternalUrls = true,
  fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
}) {
  const safeOwnerId = asString(ownerId);
  if (!safeOwnerId) {
    throw new Error("Missing owner id for import asset sanitization.");
  }

  const safeSourceLabel = sanitizePathSegment(sourceLabel, "canva-import");
  const knownInternalHosts = getSourceHostsFromEnv();
  const admin = createAdminClient();
  const uploadCache = new Map();
  let bucketReady = false;

  const manifestAssets = [];
  const warnings = [];
  let changed = false;

  async function ensureBucketReady() {
    if (bucketReady) return;
    await ensurePublicBucket(admin);
    bucketReady = true;
  }

  async function uploadSource(value, fieldPath, fieldName) {
    const source = asString(value);
    if (!source) return { value: "", manifest: null, changed: false };

    const cacheKey = source;
    const parsedUrl = parseUrlOrNull(source);
    const parsedDataUri = isDataUri(source) ? parseDataUri(source) : null;

    if (!parsedDataUri && !parsedUrl) {
      return { value: source, manifest: null, changed: false };
    }

    const shouldRewriteUrl =
      Boolean(parsedDataUri) ||
      (Boolean(parsedUrl) && rewriteExternalUrls && !isInternalHost(parsedUrl.hostname, knownInternalHosts));

    if (!shouldRewriteUrl) {
      return {
        value: source,
        manifest: {
          id: `asset-${manifestAssets.length + 1}`,
          path: fieldPath,
          field: fieldName,
          kind: detectAssetKind({
            mimeType: "",
            extension: parsedUrl ? extensionFromUrl(source) : extensionFromMimeType(parsedDataUri?.mimeType),
            fieldName,
          }),
          sourceType: parsedDataUri ? "data-uri" : "url",
          original: summarizeSource(source),
          rewritten: summarizeSource(source),
          status: "preserved",
          mimeType: parsedDataUri?.mimeType || "",
          bytes: Number(parsedDataUri?.bytes?.length || 0),
        },
        changed: false,
      };
    }

    if (uploadCache.has(cacheKey)) {
      const cached = uploadCache.get(cacheKey);
      return {
        value: cached.url,
        manifest: {
          id: `asset-${manifestAssets.length + 1}`,
          path: fieldPath,
          field: fieldName,
          kind: cached.kind,
          sourceType: parsedDataUri ? "data-uri" : "url",
          original: summarizeSource(source),
          rewritten: summarizeSource(cached.url),
          status: "uploaded",
          mimeType: cached.mimeType,
          bytes: cached.bytes,
        },
        changed: cached.url !== source,
      };
    }

    let bytes = null;
    let mimeType = "";
    const normalizedFieldName = asString(fieldName).toLowerCase();

    if (parsedDataUri) {
      bytes = parsedDataUri.bytes;
      mimeType = parsedDataUri.mimeType;
    } else if (parsedUrl) {
      const fetched = await fetchUrlAsAsset(parsedUrl.toString(), fetchTimeoutMs);
      bytes = fetched.bytes;
      mimeType = fetched.mimeType || mimeTypeFromExtension(extensionFromUrl(parsedUrl.toString()));
    }

    const rasterizedAsset = await maybeRasterizeSvgAsset({
      bytes,
      mimeType,
      preserveSvg,
    });
    bytes = rasterizedAsset.bytes;
    mimeType = rasterizedAsset.mimeType || mimeType;

    const extensionBeforeTrace = extensionFromMimeType(mimeType) || extensionFromUrl(source);
    const kindBeforeTrace = detectAssetKind({
      mimeType,
      extension: extensionBeforeTrace,
      fieldName,
    });
    const tracedAsset = await maybeTraceRasterToSvgAsset({
      bytes,
      mimeType,
      kind: kindBeforeTrace,
      fieldName,
      traceRasterToSvg,
    });
    bytes = tracedAsset.bytes;
    mimeType = tracedAsset.mimeType || mimeType;

    if (normalizedFieldName.includes("thumbnail")) {
      const resizedThumbnail = await resizeThumbnailBufferHalf({ bytes, mimeType });
      if (resizedThumbnail.resized) {
        bytes = resizedThumbnail.bytes;
        mimeType = resizedThumbnail.mimeType || mimeType;
      }
    }

    const extension = extensionFromMimeType(mimeType) || extensionFromUrl(source);
    const kind = detectAssetKind({ mimeType, extension, fieldName });

    validateAssetBytes({ kind, bytes });
    await ensureBucketReady();

    const objectPath = makeObjectPath({
      ownerId: safeOwnerId,
      kind,
      extension,
      sourceLabel: safeSourceLabel,
    });

    const uploadMimeType = mimeType || mimeTypeFromExtension(extension) || "application/octet-stream";
    const { error: uploadError } = await admin.storage
      .from(IMPORT_MEDIA_BUCKET)
      .upload(objectPath, bytes, {
        contentType: uploadMimeType,
        cacheControl: "31536000",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(uploadError.message || "asset upload failed");
    }

    const { data: publicUrlData } = admin.storage.from(IMPORT_MEDIA_BUCKET).getPublicUrl(objectPath);
    const publicUrl = asString(publicUrlData?.publicUrl);
    if (!publicUrl) {
      throw new Error("uploaded asset URL is unavailable");
    }

    const cachedAsset = {
      url: publicUrl,
      kind,
      bytes: Number(bytes?.length || 0),
      mimeType: uploadMimeType,
    };
    uploadCache.set(cacheKey, cachedAsset);

    return {
      value: publicUrl,
        manifest: {
        id: `asset-${manifestAssets.length + 1}`,
        path: fieldPath,
        field: fieldName,
        kind,
        sourceType: parsedDataUri ? "data-uri" : "url",
        original: summarizeSource(source),
        rewritten: summarizeSource(publicUrl),
          status: "uploaded",
          mimeType: uploadMimeType,
          bytes: Number(bytes?.length || 0),
        },
        changed: publicUrl !== source,
      };
  }

  async function rewriteNodeAssets(node, pathSegments = []) {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        await rewriteNodeAssets(node[index], [...pathSegments, index]);
      }
      return;
    }

    const keys = Object.keys(node);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const value = node[key];

      if (typeof value === "string" && looksLikeAssetField(key, value)) {
        const fieldPath = getPathString([...pathSegments, key]);
        try {
          const rewritten = await uploadSource(value, fieldPath, key);
          if (rewritten.manifest) manifestAssets.push(rewritten.manifest);
          if (rewritten.changed) {
            node[key] = rewritten.value;
            changed = true;
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unknown upload error";
          throw new Error(`Failed to sanitize import asset at ${fieldPath}: ${message}`);
        }
        continue;
      }

      if (value && typeof value === "object") {
        await rewriteNodeAssets(value, [...pathSegments, key]);
      }
    }
  }

  const sanitizedFabricData = cloneSerializable(fabricData) || null;

  let safeImageDataUrl = asString(imageDataUrl);
  if (safeImageDataUrl && (isDataUri(safeImageDataUrl) || isHttpUrl(safeImageDataUrl))) {
    const topLevelResult = await uploadSource(
      safeImageDataUrl,
      "imageDataUrl",
      "imageDataUrl"
    );
    if (topLevelResult.manifest) manifestAssets.push(topLevelResult.manifest);
    safeImageDataUrl = topLevelResult.value;
    if (topLevelResult.changed) changed = true;
  }

  let safeThumbnailDataUrl = asString(thumbnailDataUrl || imageDataUrl);
  if (safeThumbnailDataUrl && (isDataUri(safeThumbnailDataUrl) || isHttpUrl(safeThumbnailDataUrl))) {
    const thumbnailResult = await uploadSource(
      safeThumbnailDataUrl,
      "thumbnailDataUrl",
      "thumbnailDataUrl"
    );
    if (thumbnailResult.manifest) manifestAssets.push(thumbnailResult.manifest);
    safeThumbnailDataUrl = thumbnailResult.value;
    if (thumbnailResult.changed) changed = true;
  }

  if (sanitizedFabricData && typeof sanitizedFabricData === "object") {
    await rewriteNodeAssets(sanitizedFabricData, ["fabricData"]);
  }

  const remainingCanvaReferences = findExternalCanvaReferences(
    {
      imageDataUrl: safeImageDataUrl,
      thumbnailDataUrl: safeThumbnailDataUrl,
      fabricData: sanitizedFabricData,
    },
    {
      pathPrefix: "payload",
      maxResults: MAX_CANVA_REFERENCE_RESULTS,
      assetFieldsOnly: true,
    }
  );

  if (remainingCanvaReferences.length > 0) {
    throw new Error(
      `Import payload still contains external Canva references (${remainingCanvaReferences[0].path}).`
    );
  }

  const assetManifest = {
    version: IMPORT_ASSET_MANIFEST_VERSION,
    uploadedAt: new Date().toISOString(),
    summary: normalizeManifestSummary(manifestAssets),
    assets: manifestAssets,
  };

  return {
    imageDataUrl: safeImageDataUrl,
    thumbnailDataUrl: safeThumbnailDataUrl,
    fabricData: sanitizedFabricData,
    assetManifest,
    warnings,
    changed,
  };
}
