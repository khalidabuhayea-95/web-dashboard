import {
  createInvalidInputError,
  createProcessingFailedError,
  createProviderUnavailableError,
  createUnsupportedImageTypeError,
} from "./errors";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8];
const WEBP_RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg"]);
const DEFAULT_MAX_TARGET_EDGE = 1440;
const MAX_DECODE_PIXELS = 36_000_000;

let canvasLibPromise: Promise<{ createCanvas: any; loadImage: any } | null> | null = null;

type CanvasLike = {
  width: number;
  height: number;
  getContext: (kind: "2d") => any;
  toBuffer: (mimeType?: string, options?: Record<string, unknown>) => Buffer;
};

type NormalizedAiExpandAsset = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  width: number;
  height: number;
  size: number;
};

export type NormalizedAiExpandInput = {
  image: NormalizedAiExpandAsset;
  providerCanvasImage: NormalizedAiExpandAsset;
  providerMask: NormalizedAiExpandAsset;
  targetWidth: number;
  targetHeight: number;
  placedImageWidth: number;
  placedImageHeight: number;
  placedImageX: number;
  placedImageY: number;
  requiresExpansion: boolean;
  outputFileName: string;
};

function normalizeMimeType(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function sanitizeFileName(value: unknown, fallback = "image"): string {
  const safeName = String(value || "")
    .trim()
    .replace(/^.*[\\/]/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return safeName || fallback;
}

function fileBaseName(value: unknown, fallback = "image"): string {
  const safeName = sanitizeFileName(value, fallback);
  return safeName.replace(/\.[a-z0-9]+$/i, "") || fallback;
}

function matchesSignature(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.length < signature.length + offset) {
    return false;
  }
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false;
  }
  return true;
}

function detectMimeType(bytes: Uint8Array | Buffer, fallbackMimeType = ""): string {
  const buffer = bytes instanceof Uint8Array ? bytes : Buffer.from(bytes || []);
  if (matchesSignature(buffer, PNG_SIGNATURE)) return "image/png";
  if (matchesSignature(buffer, JPEG_SIGNATURE)) return "image/jpeg";
  if (matchesSignature(buffer, WEBP_RIFF_SIGNATURE) && matchesSignature(buffer, WEBP_WEBP_SIGNATURE, 8)) {
    return "image/webp";
  }
  return normalizeMimeType(fallbackMimeType);
}

function createDataUrl(bytes: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
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

function readUInt16(buffer: Buffer, offset: number, littleEndian: boolean): number {
  if (offset + 2 > buffer.length) return 0;
  return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function readUInt32(buffer: Buffer, offset: number, littleEndian: boolean): number {
  if (offset + 4 > buffer.length) return 0;
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function parseExifOrientation(buffer: Buffer): number {
  if (buffer.length < 14) return 1;
  const byteOrder = buffer.toString("ascii", 0, 2);
  const littleEndian = byteOrder === "II";
  const bigEndian = byteOrder === "MM";
  if (!littleEndian && !bigEndian) return 1;

  const fixed = readUInt16(buffer, 2, littleEndian);
  if (fixed !== 0x2a) return 1;

  const ifdOffset = readUInt32(buffer, 4, littleEndian);
  if (!ifdOffset || ifdOffset + 2 > buffer.length) return 1;

  const entryCount = readUInt16(buffer, ifdOffset, littleEndian);
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    if (entryOffset + 12 > buffer.length) break;
    const tag = readUInt16(buffer, entryOffset, littleEndian);
    if (tag !== 0x0112) continue;

    const type = readUInt16(buffer, entryOffset + 2, littleEndian);
    const count = readUInt32(buffer, entryOffset + 4, littleEndian);
    if (type === 3 && count === 1) {
      const valueOffset = entryOffset + 8;
      const orientation = readUInt16(buffer, valueOffset, littleEndian);
      if (orientation >= 1 && orientation <= 8) return orientation;
    }
  }

  return 1;
}

function parseJpegMetadata(bytes: Buffer): { orientation: number; width: number; height: number } {
  if (!matchesSignature(bytes, JPEG_SIGNATURE)) {
    return { orientation: 1, width: 0, height: 0 };
  }

  let offset = 2;
  let orientation = 1;
  let width = 0;
  let height = 0;

  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;

    if (offset + 1 >= bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;

    if (marker === 0xe1 && segmentLength >= 10) {
      const exifHeader = bytes.toString("ascii", offset + 2, offset + 8);
      if (exifHeader === "Exif\u0000\u0000") {
        const exifBuffer = bytes.subarray(offset + 8, offset + segmentLength);
        orientation = parseExifOrientation(exifBuffer);
      }
    }

    const isSofMarker =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSofMarker && segmentLength >= 7) {
      height = bytes.readUInt16BE(offset + 3);
      width = bytes.readUInt16BE(offset + 5);
      if (width > 0 && height > 0 && orientation > 0) break;
    }

    offset += segmentLength;
  }

  return { orientation, width, height };
}

function orientedDimensions(width: number, height: number, orientation: number) {
  if (orientation >= 5 && orientation <= 8) {
    return { width: height, height: width };
  }
  return { width, height };
}

function applyExifTransform(context: any, orientation: number, width: number, height: number) {
  switch (orientation) {
    case 2:
      context.translate(width, 0);
      context.scale(-1, 1);
      break;
    case 3:
      context.translate(width, height);
      context.rotate(Math.PI);
      break;
    case 4:
      context.translate(0, height);
      context.scale(1, -1);
      break;
    case 5:
      context.rotate(0.5 * Math.PI);
      context.scale(1, -1);
      break;
    case 6:
      context.rotate(0.5 * Math.PI);
      context.translate(0, -height);
      break;
    case 7:
      context.rotate(0.5 * Math.PI);
      context.translate(width, -height);
      context.scale(-1, 1);
      break;
    case 8:
      context.rotate(-0.5 * Math.PI);
      context.translate(-width, 0);
      break;
    default:
      break;
  }
}

async function decodeToCanvas({
  bytes,
  fallbackMimeType,
  fileName,
}: {
  bytes: Buffer;
  fallbackMimeType: string;
  fileName: string;
}) {
  if (!bytes.length) {
    throw createInvalidInputError("Image upload must not be empty.");
  }

  const detectedMimeType = detectMimeType(bytes, fallbackMimeType);
  if (!ALLOWED_IMAGE_MIME_TYPES.has(detectedMimeType)) {
    throw createUnsupportedImageTypeError("Only PNG and JPEG images are supported for AI Expand.");
  }

  const canvasLib = await getCanvasLib();
  if (!canvasLib?.loadImage || !canvasLib?.createCanvas) {
    throw createProviderUnavailableError("Image normalization runtime is unavailable.");
  }

  const sourceImage = await canvasLib
    .loadImage(createDataUrl(bytes, detectedMimeType))
    .catch((_error) => null);
  if (!sourceImage?.width || !sourceImage?.height) {
    throw createInvalidInputError("Could not decode the image.");
  }

  const parsedMetadata =
    detectedMimeType === "image/jpeg"
      ? parseJpegMetadata(bytes)
      : { orientation: 1, width: sourceImage.width, height: sourceImage.height };
  const orientation = parsedMetadata.orientation || 1;
  const dimensions = orientedDimensions(sourceImage.width, sourceImage.height, orientation);
  const pixels = dimensions.width * dimensions.height;
  if (pixels > MAX_DECODE_PIXELS) {
    throw createInvalidInputError("Image is too large to process.");
  }

  const canvas = canvasLib.createCanvas(dimensions.width, dimensions.height) as CanvasLike;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  if (orientation !== 1) {
    applyExifTransform(context, orientation, dimensions.width, dimensions.height);
  }
  context.drawImage(sourceImage, 0, 0, sourceImage.width, sourceImage.height);

  return {
    canvas,
    width: dimensions.width,
    height: dimensions.height,
    mimeType: detectedMimeType,
    fileName,
  };
}

function fitInside(width: number, height: number, maxWidth: number, maxHeight: number, { allowUpscale = false } = {}) {
  const safeWidth = Math.max(1, Math.round(width || 1));
  const safeHeight = Math.max(1, Math.round(height || 1));
  const widthScale = maxWidth / safeWidth;
  const heightScale = maxHeight / safeHeight;
  let scale = Math.min(widthScale, heightScale);
  if (!allowUpscale) {
    scale = Math.min(scale, 1);
  }
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function encodeCanvas(canvas: CanvasLike, mimeType: string): Buffer {
  try {
    if (mimeType === "image/jpeg") {
      return canvas.toBuffer(mimeType, { quality: 0.92 });
    }
    return canvas.toBuffer(mimeType);
  } catch (_error) {
    throw createProcessingFailedError("Failed to encode normalized image.");
  }
}

async function renderScaledCanvas(sourceCanvas: CanvasLike, width: number, height: number) {
  if (sourceCanvas.width === width && sourceCanvas.height === height) {
    return sourceCanvas;
  }

  const canvasLib = await getCanvasLib();
  if (!canvasLib?.createCanvas) {
    throw createProviderUnavailableError("Image normalization runtime is unavailable.");
  }

  const canvas = canvasLib.createCanvas(width, height) as CanvasLike;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceCanvas as any, 0, 0, width, height);
  return canvas;
}

async function renderNormalizedAsset(
  sourceCanvas: CanvasLike,
  mimeType: string,
  fileName: string,
  width: number,
  height: number
): Promise<NormalizedAiExpandAsset> {
  const outputCanvas =
    sourceCanvas.width === width && sourceCanvas.height === height
      ? sourceCanvas
      : await renderScaledCanvas(sourceCanvas, width, height);
  const bytes = encodeCanvas(outputCanvas, mimeType);
  const extension = mimeType === "image/jpeg" ? "jpg" : "png";

  return {
    bytes,
    mimeType,
    fileName: `${fileBaseName(fileName, "image")}.${extension}`,
    width,
    height,
    size: bytes.length,
  };
}

function parseTargetDimension(value: unknown, label: string) {
  const normalized = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isSafeInteger(normalized) || normalized < 64) {
    throw createInvalidInputError(`${label} must be an integer of at least 64.`);
  }
  if (normalized > DEFAULT_MAX_TARGET_EDGE) {
    throw createInvalidInputError(`${label} must not exceed ${DEFAULT_MAX_TARGET_EDGE}.`);
  }
  return normalized;
}

export async function normalizeAiExpandInput({
  imageBytes,
  imageMimeType,
  imageFileName,
  targetWidth,
  targetHeight,
}: {
  imageBytes: Buffer;
  imageMimeType?: string;
  imageFileName?: string;
  targetWidth: number;
  targetHeight: number;
}): Promise<NormalizedAiExpandInput> {
  const safeTargetWidth = parseTargetDimension(targetWidth, "targetWidth");
  const safeTargetHeight = parseTargetDimension(targetHeight, "targetHeight");

  const decodedImage = await decodeToCanvas({
    bytes: Buffer.isBuffer(imageBytes) ? imageBytes : Buffer.from(imageBytes || []),
    fallbackMimeType: normalizeMimeType(imageMimeType),
    fileName: sanitizeFileName(imageFileName, "image"),
  });

  const fitted = fitInside(
    decodedImage.width,
    decodedImage.height,
    safeTargetWidth,
    safeTargetHeight,
    { allowUpscale: false }
  );
  const placedImageX = Math.max(0, Math.floor((safeTargetWidth - fitted.width) / 2));
  const placedImageY = Math.max(0, Math.floor((safeTargetHeight - fitted.height) / 2));
  const requiresExpansion =
    placedImageX > 0 ||
    placedImageY > 0 ||
    fitted.width < safeTargetWidth ||
    fitted.height < safeTargetHeight;

  const canvasLib = await getCanvasLib();
  if (!canvasLib?.createCanvas) {
    throw createProviderUnavailableError("Image normalization runtime is unavailable.");
  }

  const scaledImageCanvas = await renderScaledCanvas(decodedImage.canvas, fitted.width, fitted.height);
  const previewCanvas = canvasLib.createCanvas(safeTargetWidth, safeTargetHeight) as CanvasLike;
  const previewContext = previewCanvas.getContext("2d");
  previewContext.fillStyle = "#000000";
  previewContext.fillRect(0, 0, safeTargetWidth, safeTargetHeight);
  previewContext.drawImage(
    scaledImageCanvas as any,
    placedImageX,
    placedImageY,
    fitted.width,
    fitted.height
  );

  const maskCanvas = canvasLib.createCanvas(safeTargetWidth, safeTargetHeight) as CanvasLike;
  const maskContext = maskCanvas.getContext("2d");
  maskContext.fillStyle = "#ffffff";
  maskContext.fillRect(0, 0, safeTargetWidth, safeTargetHeight);
  maskContext.fillStyle = "#000000";
  maskContext.fillRect(placedImageX, placedImageY, fitted.width, fitted.height);

  const normalizedImage = await renderNormalizedAsset(
    decodedImage.canvas,
    decodedImage.mimeType,
    decodedImage.fileName,
    decodedImage.width,
    decodedImage.height
  );
  const providerCanvasImage = await renderNormalizedAsset(
    previewCanvas,
    "image/png",
    decodedImage.fileName,
    safeTargetWidth,
    safeTargetHeight
  );
  const providerMask = await renderNormalizedAsset(
    maskCanvas,
    "image/png",
    `${fileBaseName(decodedImage.fileName, "image")}-mask.png`,
    safeTargetWidth,
    safeTargetHeight
  );

  return {
    image: normalizedImage,
    providerCanvasImage,
    providerMask,
    targetWidth: safeTargetWidth,
    targetHeight: safeTargetHeight,
    placedImageWidth: fitted.width,
    placedImageHeight: fitted.height,
    placedImageX,
    placedImageY,
    requiresExpansion,
    outputFileName: `${fileBaseName(decodedImage.fileName, "image")}-expanded.png`,
  };
}
