import {
  createInvalidInputError,
  createProcessingFailedError,
  createProviderUnavailableError,
  createUnprocessableImageError,
  createUnsupportedImageTypeError,
} from "./errors";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8];
const WEBP_RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg"]);
const ALLOWED_MASK_MIME_TYPES = new Set(["image/png"]);
const DEFAULT_MAX_LONG_EDGE = 2048;
const MAX_DECODE_PIXELS = 36_000_000;
const MASK_ACTIVE_ALPHA_THRESHOLD = 16;
const MASK_ACTIVE_LUMA_THRESHOLD = 16;
const MASK_ACTIVE_CHANNEL_THRESHOLD = 24;

let canvasLibPromise: Promise<{ createCanvas: any; loadImage: any } | null> | null = null;

type CanvasLike = {
  width: number;
  height: number;
  getContext: (kind: "2d") => any;
  toBuffer: (mimeType?: string, options?: Record<string, unknown>) => Buffer;
};

type DecodedCanvasAsset = {
  canvas: CanvasLike;
  width: number;
  height: number;
  mimeType: string;
  fileName: string;
};

export type NormalizedObjectRemovalAsset = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  width: number;
  height: number;
  size: number;
};

export type NormalizedObjectRemovalInput = {
  image: NormalizedObjectRemovalAsset;
  mask: NormalizedObjectRemovalAsset;
  outputFileName: string;
};

function normalizeMimeType(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function sanitizeFileName(value: unknown, fallback = "image"): string {
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

export function detectObjectRemovalMimeType(bytes: Uint8Array | Buffer, fallbackMimeType = ""): string {
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
    return {
      orientation: 1,
      width: 0,
      height: 0,
    };
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

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

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
      if (width > 0 && height > 0 && orientation > 0) {
        break;
      }
    }

    offset += segmentLength;
  }

  return {
    orientation,
    width,
    height,
  };
}

function shouldApplyManualOrientation({
  orientation,
  encodedWidth,
  encodedHeight,
  loadedWidth,
  loadedHeight,
}: {
  orientation: number;
  encodedWidth: number;
  encodedHeight: number;
  loadedWidth: number;
  loadedHeight: number;
}): boolean {
  if (!orientation || orientation === 1) return false;

  const swaps = orientation >= 5 && orientation <= 8;
  if (swaps && encodedWidth > 0 && encodedHeight > 0) {
    if (loadedWidth === encodedHeight && loadedHeight === encodedWidth) {
      return false;
    }
  }

  return true;
}

function orientedDimensions(width: number, height: number, orientation: number) {
  if (orientation >= 5 && orientation <= 8) {
    return {
      width: height,
      height: width,
    };
  }
  return { width, height };
}

function applyExifTransform(
  context: any,
  orientation: number,
  width: number,
  height: number
) {
  switch (orientation) {
    case 2:
      context.transform(-1, 0, 0, 1, width, 0);
      break;
    case 3:
      context.transform(-1, 0, 0, -1, width, height);
      break;
    case 4:
      context.transform(1, 0, 0, -1, 0, height);
      break;
    case 5:
      context.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      context.transform(0, 1, -1, 0, height, 0);
      break;
    case 7:
      context.transform(0, -1, -1, 0, height, width);
      break;
    case 8:
      context.transform(0, -1, 1, 0, 0, width);
      break;
    default:
      break;
  }
}

async function decodeToCanvas({
  bytes,
  fallbackMimeType,
  fileName,
  applyExifOrientation,
  allowedMimeTypes,
}: {
  bytes: Buffer;
  fallbackMimeType: string;
  fileName: string;
  applyExifOrientation: boolean;
  allowedMimeTypes: Set<string>;
}): Promise<DecodedCanvasAsset> {
  if (!bytes.length) {
    throw createInvalidInputError("Uploaded file is empty.");
  }

  const canvasLib = await getCanvasLib();
  if (!canvasLib?.createCanvas || !canvasLib?.loadImage) {
    throw createProviderUnavailableError("Image normalization runtime is unavailable.");
  }

  const detectedMimeType = detectObjectRemovalMimeType(bytes, fallbackMimeType);
  if (!allowedMimeTypes.has(detectedMimeType)) {
    throw createUnsupportedImageTypeError("Only PNG and JPEG images are supported for object removal.");
  }

  let image: any;
  try {
    image = await canvasLib.loadImage(createDataUrl(bytes, detectedMimeType));
  } catch (_error) {
    throw createUnprocessableImageError("Uploaded image could not be decoded.");
  }

  const loadedWidth = Math.max(1, Math.round(Number(image?.width || 0)));
  const loadedHeight = Math.max(1, Math.round(Number(image?.height || 0)));
  if (!loadedWidth || !loadedHeight) {
    throw createUnprocessableImageError("Uploaded image dimensions are unavailable.");
  }
  if (loadedWidth * loadedHeight > MAX_DECODE_PIXELS) {
    throw createInvalidInputError("Uploaded image is too large to process safely.");
  }

  let orientation = 1;
  let sourceWidth = loadedWidth;
  let sourceHeight = loadedHeight;
  if (applyExifOrientation && detectedMimeType === "image/jpeg") {
    const jpegMeta = parseJpegMetadata(bytes);
    if (
      shouldApplyManualOrientation({
        orientation: jpegMeta.orientation,
        encodedWidth: jpegMeta.width,
        encodedHeight: jpegMeta.height,
        loadedWidth,
        loadedHeight,
      })
    ) {
      orientation = jpegMeta.orientation;
      sourceWidth = jpegMeta.width || loadedWidth;
      sourceHeight = jpegMeta.height || loadedHeight;
    }
  }

  const nextDimensions = orientedDimensions(sourceWidth, sourceHeight, orientation);
  const canvas = canvasLib.createCanvas(nextDimensions.width, nextDimensions.height) as CanvasLike;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  if (orientation !== 1) {
    applyExifTransform(context, orientation, nextDimensions.width, nextDimensions.height);
  }
  context.drawImage(image, 0, 0, sourceWidth, sourceHeight);

  return {
    canvas,
    width: nextDimensions.width,
    height: nextDimensions.height,
    mimeType: detectedMimeType,
    fileName,
  };
}

function fitInside(width: number, height: number, maxLongEdge: number) {
  const safeWidth = Math.max(1, Math.round(width || 1));
  const safeHeight = Math.max(1, Math.round(height || 1));
  const longEdge = Math.max(safeWidth, safeHeight);
  if (longEdge <= maxLongEdge) {
    return {
      width: safeWidth,
      height: safeHeight,
    };
  }

  const scale = maxLongEdge / longEdge;
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

async function renderScaledCanvas(sourceCanvas: CanvasLike, width: number, height: number): Promise<CanvasLike> {
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

async function renderNormalizedImageAsset(
  sourceCanvas: CanvasLike,
  mimeType: string,
  fileName: string,
  width: number,
  height: number
): Promise<NormalizedObjectRemovalAsset> {
  const outputCanvas =
    sourceCanvas.width === width && sourceCanvas.height === height
      ? sourceCanvas
      : await renderScaledCanvas(sourceCanvas, width, height);
  const outputBytes = encodeCanvas(outputCanvas, mimeType);
  const extension = mimeType === "image/jpeg" ? "jpg" : "png";
  const safeFileName = `${fileBaseName(fileName, "image")}.${extension}`;

  return {
    bytes: outputBytes,
    mimeType,
    fileName: safeFileName,
    width,
    height,
    size: outputBytes.length,
  };
}

async function renderNormalizedMaskAsset(
  sourceCanvas: CanvasLike,
  fileName: string,
  width: number,
  height: number
): Promise<NormalizedObjectRemovalAsset> {
  const outputCanvas =
    sourceCanvas.width === width && sourceCanvas.height === height
      ? sourceCanvas
      : await renderScaledCanvas(sourceCanvas, width, height);
  const context = outputCanvas.getContext("2d");
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  let activePixels = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const alpha = pixels[index + 3];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const isActive =
      alpha >= MASK_ACTIVE_ALPHA_THRESHOLD &&
      (luma >= MASK_ACTIVE_LUMA_THRESHOLD ||
        Math.max(r, g, b) >= MASK_ACTIVE_CHANNEL_THRESHOLD);

    if (isActive) {
      pixels[index] = 255;
      pixels[index + 1] = 255;
      pixels[index + 2] = 255;
      pixels[index + 3] = 255;
      activePixels += 1;
    } else {
      pixels[index] = 0;
      pixels[index + 1] = 0;
      pixels[index + 2] = 0;
      pixels[index + 3] = 255;
    }
  }

  if (activePixels === 0) {
    throw createInvalidInputError("Removal mask must contain at least one selected pixel.");
  }

  context.putImageData(imageData, 0, 0);
  const outputBytes = outputCanvas.toBuffer("image/png");

  return {
    bytes: outputBytes,
    mimeType: "image/png",
    fileName: `${fileBaseName(fileName, "mask")}.png`,
    width,
    height,
    size: outputBytes.length,
  };
}

export async function normalizeObjectRemovalInput({
  imageBytes,
  imageMimeType,
  imageFileName,
  maskBytes,
  maskMimeType,
  maskFileName,
  maxLongEdge = DEFAULT_MAX_LONG_EDGE,
}: {
  imageBytes: Buffer;
  imageMimeType?: string;
  imageFileName?: string;
  maskBytes: Buffer;
  maskMimeType?: string;
  maskFileName?: string;
  maxLongEdge?: number;
}): Promise<NormalizedObjectRemovalInput> {
  const decodedImage = await decodeToCanvas({
    bytes: Buffer.isBuffer(imageBytes) ? imageBytes : Buffer.from(imageBytes || []),
    fallbackMimeType: normalizeMimeType(imageMimeType),
    fileName: sanitizeFileName(imageFileName, "image"),
    applyExifOrientation: true,
    allowedMimeTypes: ALLOWED_IMAGE_MIME_TYPES,
  });
  const decodedMask = await decodeToCanvas({
    bytes: Buffer.isBuffer(maskBytes) ? maskBytes : Buffer.from(maskBytes || []),
    fallbackMimeType: normalizeMimeType(maskMimeType),
    fileName: sanitizeFileName(maskFileName, "mask"),
    applyExifOrientation: false,
    allowedMimeTypes: ALLOWED_MASK_MIME_TYPES,
  });

  if (decodedImage.width !== decodedMask.width || decodedImage.height !== decodedMask.height) {
    throw createInvalidInputError("Image and mask must have the same dimensions.");
  }

  const targetSize = fitInside(
    decodedImage.width,
    decodedImage.height,
    Math.max(256, Math.round(Number(maxLongEdge) || DEFAULT_MAX_LONG_EDGE))
  );

  const image = await renderNormalizedImageAsset(
    decodedImage.canvas,
    decodedImage.mimeType,
    decodedImage.fileName,
    targetSize.width,
    targetSize.height
  );
  const mask = await renderNormalizedMaskAsset(
    decodedMask.canvas,
    decodedMask.fileName,
    targetSize.width,
    targetSize.height
  );

  return {
    image,
    mask,
    outputFileName: `${fileBaseName(decodedImage.fileName, "image")}-object-removed.png`,
  };
}
