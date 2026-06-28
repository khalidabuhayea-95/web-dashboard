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
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DEFAULT_MAX_LONG_EDGE = 1536;
const MAX_DECODE_PIXELS = 36_000_000;

let canvasLibPromise: Promise<{ createCanvas: any; loadImage: any } | null> | null = null;

type CanvasLike = {
  width: number;
  height: number;
  getContext: (kind: "2d") => any;
  toBuffer: (mimeType?: string, options?: Record<string, unknown>) => Buffer;
};

export type NormalizedImageToLayersInput = {
  providerImage: {
    bytes: Buffer;
    mimeType: string;
    fileName: string;
    width: number;
    height: number;
    size: number;
  };
  sourceWidth: number;
  sourceHeight: number;
  outputBaseName: string;
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
  return sanitizeFileName(value, fallback).replace(/\.[a-z0-9]+$/i, "") || fallback;
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

function fitInside(width: number, height: number, maxLongEdge: number) {
  const safeWidth = Math.max(1, Math.round(width || 1));
  const safeHeight = Math.max(1, Math.round(height || 1));
  const longEdge = Math.max(safeWidth, safeHeight);
  if (longEdge <= maxLongEdge) {
    return { width: safeWidth, height: safeHeight };
  }
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

// Decode the upload, cap its size, and re-encode to a clean PNG to hand to the
// provider. Re-encoding bakes a consistent format; qwen-image-layered resizes
// internally regardless, so we only guard against oversized inputs here.
export async function normalizeImageToLayersInput({
  imageBytes,
  imageMimeType,
  imageFileName,
  maxLongEdge = DEFAULT_MAX_LONG_EDGE,
}: {
  imageBytes: Buffer;
  imageMimeType?: string;
  imageFileName?: string;
  maxLongEdge?: number;
}): Promise<NormalizedImageToLayersInput> {
  const bytes = Buffer.isBuffer(imageBytes) ? imageBytes : Buffer.from(imageBytes || []);
  if (!bytes.length) {
    throw createInvalidInputError("Uploaded file is empty.");
  }

  const detectedMimeType = detectMimeType(bytes, normalizeMimeType(imageMimeType));
  if (!ALLOWED_IMAGE_MIME_TYPES.has(detectedMimeType)) {
    throw createUnsupportedImageTypeError("Only PNG, JPEG, and WebP images are supported.");
  }

  const canvasLib = await getCanvasLib();
  if (!canvasLib?.createCanvas || !canvasLib?.loadImage) {
    throw createProviderUnavailableError("Image normalization runtime is unavailable.");
  }

  const fileName = sanitizeFileName(imageFileName, "image");

  let image: any;
  try {
    image = await canvasLib.loadImage(createDataUrl(bytes, detectedMimeType));
  } catch (_error) {
    throw createUnprocessableImageError("Uploaded image could not be decoded.");
  }

  const sourceWidth = Math.max(1, Math.round(Number(image?.width || 0)));
  const sourceHeight = Math.max(1, Math.round(Number(image?.height || 0)));
  if (!sourceWidth || !sourceHeight) {
    throw createUnprocessableImageError("Uploaded image dimensions are unavailable.");
  }
  if (sourceWidth * sourceHeight > MAX_DECODE_PIXELS) {
    throw createInvalidInputError("Uploaded image is too large to process safely.");
  }

  const target = fitInside(
    sourceWidth,
    sourceHeight,
    Math.max(256, Math.round(Number(maxLongEdge) || DEFAULT_MAX_LONG_EDGE))
  );

  const canvas = canvasLib.createCanvas(target.width, target.height) as CanvasLike;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, target.width, target.height);

  let providerBytes: Buffer;
  try {
    providerBytes = canvas.toBuffer("image/png");
  } catch (_error) {
    throw createProcessingFailedError("Failed to encode normalized image.");
  }

  return {
    providerImage: {
      bytes: providerBytes,
      mimeType: "image/png",
      fileName: `${fileBaseName(fileName, "image")}.png`,
      width: target.width,
      height: target.height,
      size: providerBytes.length,
    },
    sourceWidth,
    sourceHeight,
    outputBaseName: fileBaseName(fileName, "image"),
  };
}
