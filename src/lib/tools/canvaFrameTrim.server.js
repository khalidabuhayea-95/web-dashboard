import {
  getObject,
  getPublicStorageBucketName,
  parsePublicObjectKey,
  uploadObject,
} from "../storage/objectStorage.server.js";

const DEFAULT_ALPHA_THRESHOLD = 8;
const DEFAULT_CACHE_CONTROL = "public, max-age=31536000, immutable";

let canvasLibPromise = null;

function asString(value) {
  return String(value || "").trim();
}

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeMimeType(value) {
  return asString(value).toLowerCase().split(";")[0];
}

function normalizeScale(value) {
  const next = numberOr(value, 1);
  if (Math.abs(next) < 0.0001) return 1;
  return next;
}

function resolveSignedScale(value, flipped = false) {
  return normalizeScale(value) * (flipped ? -1 : 1);
}

function rotateScaledLocalOffset(localX, localY, scaleX, scaleY, rotationDegrees) {
  const radians = (numberOr(rotationDegrees, 0) * Math.PI) / 180;
  const scaledX = localX * scaleX;
  const scaledY = localY * scaleY;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: scaledX * cos - scaledY * sin,
    y: scaledX * sin + scaledY * cos,
  };
}

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

async function objectBodyToBuffer(body) {
  if (!body) return null;
  if (typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }
  if (typeof body.arrayBuffer === "function") {
    return Buffer.from(await body.arrayBuffer());
  }

  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function isImportedCanvaFrameCandidate(object) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return false;
  const frameContent =
    object.frameContent && typeof object.frameContent === "object" && !Array.isArray(object.frameContent)
      ? object.frameContent
      : null;
  if (!frameContent?.src) return false;

  const layerType = asString(object.layerType || object.type).toLowerCase();
  const contentKind = asString(frameContent.kind).toLowerCase();
  if (contentKind === "video") return false;

  return layerType === "frame" || Boolean(object.frameShape) || Boolean(frameContent);
}

export function measureVisibleAlphaBounds(pixels, width, height, alphaThreshold = DEFAULT_ALPHA_THRESHOLD) {
  const safeWidth = Math.max(1, Math.round(numberOr(width, 1)));
  const safeHeight = Math.max(1, Math.round(numberOr(height, 1)));
  const threshold = clamp(Math.round(numberOr(alphaThreshold, DEFAULT_ALPHA_THRESHOLD)), 1, 255);

  let minX = safeWidth;
  let minY = safeHeight;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      const alpha = pixels[(y * safeWidth + x) * 4 + 3];
      if (alpha < threshold) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX, maxY };
}

export function computeFrameTrimGeometry(object, bounds, sourceWidth, sourceHeight) {
  if (!bounds) return null;
  const safeSourceWidth = Math.max(1, Math.round(numberOr(sourceWidth, 1)));
  const safeSourceHeight = Math.max(1, Math.round(numberOr(sourceHeight, 1)));
  const currentWidth = Math.max(1, numberOr(object?.width, safeSourceWidth));
  const currentHeight = Math.max(1, numberOr(object?.height, safeSourceHeight));
  const trimLeftRatio = clamp(bounds.minX / safeSourceWidth, 0, 1);
  const trimTopRatio = clamp(bounds.minY / safeSourceHeight, 0, 1);
  const trimRightRatio = clamp((bounds.maxX + 1) / safeSourceWidth, 0, 1);
  const trimBottomRatio = clamp((bounds.maxY + 1) / safeSourceHeight, 0, 1);
  const trimWidthRatio = trimRightRatio - trimLeftRatio;
  const trimHeightRatio = trimBottomRatio - trimTopRatio;

  if (
    trimLeftRatio <= 0.0001 &&
    trimTopRatio <= 0.0001 &&
    Math.abs(trimWidthRatio - 1) <= 0.0001 &&
    Math.abs(trimHeightRatio - 1) <= 0.0001
  ) {
    return null;
  }

  const scaleX = resolveSignedScale(object?.scaleX, Boolean(object?.flipX));
  const scaleY = resolveSignedScale(object?.scaleY, Boolean(object?.flipY));
  const rotatedOffset = rotateScaledLocalOffset(
    Math.max(0, currentWidth * trimLeftRatio),
    Math.max(0, currentHeight * trimTopRatio),
    scaleX,
    scaleY,
    numberOr(object?.angle, numberOr(object?.rotation, 0))
  );

  const baseLeft = numberOr(object?.left, numberOr(object?.x, 0));
  const baseTop = numberOr(object?.top, numberOr(object?.y, 0));
  const trimmedWidth = Math.max(1, bounds.maxX - bounds.minX + 1);
  const trimmedHeight = Math.max(1, bounds.maxY - bounds.minY + 1);

  return {
    left: baseLeft + rotatedOffset.x,
    top: baseTop + rotatedOffset.y,
    width: Math.max(1, currentWidth * trimWidthRatio),
    height: Math.max(1, currentHeight * trimHeightRatio),
    trimmedWidth,
    trimmedHeight,
    trimLeftRatio,
    trimTopRatio,
    trimWidthRatio,
    trimHeightRatio,
  };
}

function applyFrameTrimGeometry(object, geometry, nextSourceUrl) {
  const next = {
    ...object,
    left: geometry.left,
    top: geometry.top,
    width: geometry.width,
    height: geometry.height,
    frameContent: {
      ...(object?.frameContent && typeof object.frameContent === "object" ? object.frameContent : {}),
      src: nextSourceUrl || object?.frameContent?.src || "",
      sourceWidth: geometry.trimmedWidth,
      sourceHeight: geometry.trimmedHeight,
      sourceHasAlpha: true,
    },
  };

  if (Object.prototype.hasOwnProperty.call(object || {}, "x")) {
    next.x = geometry.left;
  }
  if (Object.prototype.hasOwnProperty.call(object || {}, "y")) {
    next.y = geometry.top;
  }
  if (Number.isFinite(Number(object?.sourceWidth))) {
    next.sourceWidth = geometry.trimmedWidth;
  }
  if (Number.isFinite(Number(object?.sourceHeight))) {
    next.sourceHeight = geometry.trimmedHeight;
  }

  return next;
}

async function encodeTrimmedCanvas(canvas) {
  // node-canvas has no WebP encoder, so go through sharp. Trimmed frames carry
  // transparency, so this is lossless — which for flat/alpha artwork is also
  // smaller than PNG. Falls back to PNG if sharp is unavailable at runtime.
  const png = canvas.toBuffer("image/png");
  try {
    const sharp = (await import("sharp")).default;
    const bytes = await sharp(png).webp({ lossless: true, effort: 6 }).toBuffer();
    if (bytes?.length) return { bytes, mimeType: "image/webp" };
  } catch {
    // fall through
  }
  return { bytes: png, mimeType: "image/png" };
}

export async function trimTransparentPaddingForImportedFrameObject(
  object,
  {
    bucket = getPublicStorageBucketName(),
    alphaThreshold = DEFAULT_ALPHA_THRESHOLD,
    cacheControl = DEFAULT_CACHE_CONTROL,
  } = {}
) {
  if (!isImportedCanvaFrameCandidate(object)) {
    return { changed: false, reason: "not-a-frame-candidate" };
  }

  const sourceUrl = asString(object?.frameContent?.src);
  const key = parsePublicObjectKey(sourceUrl);
  if (!key) {
    return { changed: false, reason: "frame-content-is-not-a-public-storage-object" };
  }

  const downloaded = await getObject(bucket, key);
  const sourceBytes = await objectBodyToBuffer(downloaded?.Body);
  const sourceMimeType = normalizeMimeType(downloaded?.ContentType);
  if (!sourceBytes?.length) {
    return { changed: false, reason: "frame-content-is-empty" };
  }
  if (!sourceMimeType.startsWith("image/") || sourceMimeType.includes("svg")) {
    return { changed: false, reason: "frame-content-is-not-a-raster-image" };
  }

  const canvasLib = await getCanvasLib();
  if (!canvasLib?.createCanvas || !canvasLib?.loadImage) {
    return { changed: false, reason: "canvas-runtime-unavailable" };
  }

  let image;
  try {
    image = await canvasLib.loadImage(sourceBytes);
  } catch {
    return { changed: false, reason: "failed-to-decode-frame-content-image" };
  }

  const sourceWidth = Math.max(1, Math.round(numberOr(image?.width, 1)));
  const sourceHeight = Math.max(1, Math.round(numberOr(image?.height, 1)));
  const canvas = canvasLib.createCanvas(sourceWidth, sourceHeight);
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, sourceWidth, sourceHeight);
  context.drawImage(image, 0, 0, sourceWidth, sourceHeight);

  let imageData;
  try {
    imageData = context.getImageData(0, 0, sourceWidth, sourceHeight);
  } catch {
    return { changed: false, reason: "failed-to-read-frame-content-pixels" };
  }

  const bounds = measureVisibleAlphaBounds(imageData.data, sourceWidth, sourceHeight, alphaThreshold);
  const geometry = computeFrameTrimGeometry(object, bounds, sourceWidth, sourceHeight);
  if (!bounds || !geometry) {
    return { changed: false, reason: "no-transparent-padding-detected" };
  }

  const trimmedCanvas = canvasLib.createCanvas(geometry.trimmedWidth, geometry.trimmedHeight);
  const trimmedContext = trimmedCanvas.getContext("2d");
  trimmedContext.clearRect(0, 0, geometry.trimmedWidth, geometry.trimmedHeight);
  trimmedContext.drawImage(
    image,
    bounds.minX,
    bounds.minY,
    geometry.trimmedWidth,
    geometry.trimmedHeight,
    0,
    0,
    geometry.trimmedWidth,
    geometry.trimmedHeight
  );

  const encoded = await encodeTrimmedCanvas(trimmedCanvas);
  await uploadObject({
    bucket,
    key,
    body: encoded.bytes,
    contentType: encoded.mimeType,
    cacheControl,
    upsert: true,
    skipExistenceCheck: true,
  });

  return {
    changed: true,
    object: applyFrameTrimGeometry(object, geometry, sourceUrl),
    trimmedWidth: geometry.trimmedWidth,
    trimmedHeight: geometry.trimmedHeight,
    mimeType: encoded.mimeType,
  };
}
