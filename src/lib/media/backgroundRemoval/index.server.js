import { convertGifWhiteToTransparent } from "../gifChromaKey.server.js";
import {
  createInvalidInputError,
  createUnsupportedImageTypeError,
} from "./errors.js";
import { removeRasterBackgroundWithLocalEdgeFlood } from "./providers/localEdgeFlood.server.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8];
const GIF87A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

const DEFAULT_GIF_OPTIONS = {
  threshold: 242,
  chromaTolerance: 24,
  softness: 16,
  minWhiteRatio: 0.08,
  fringeThreshold: 220,
  fringeTolerance: 42,
  fringeBrightThreshold: 196,
  fringeBrightSpreadTolerance: 96,
  edgeDematteDistance: 2,
  edgeDematteRadius: 5,
  edgeDematteMinBrightnessDelta: 6,
  edgeDematteMinWhitenessDelta: 12,
  edgeDematteMinColorDelta: 12,
  edgeDematteSpreadSlack: 64,
  edgeRecolorRadius: 3,
  edgeRecolorLumaThreshold: 150,
  edgeRecolorSpreadThreshold: 58,
  edgeRecolorMinDelta: 34,
};

function normalizeMimeType(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesSignature(bytes, signature) {
  if (!(bytes instanceof Uint8Array) || bytes.length < signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return false;
  }
  return true;
}

export function detectBackgroundRemovalMimeType(bytes, fallbackMimeType = "") {
  const buffer = bytes instanceof Uint8Array ? bytes : Buffer.from(bytes || []);
  if (matchesSignature(buffer, PNG_SIGNATURE)) return "image/png";
  if (matchesSignature(buffer, JPEG_SIGNATURE)) return "image/jpeg";
  if (matchesSignature(buffer, GIF87A_SIGNATURE) || matchesSignature(buffer, GIF89A_SIGNATURE)) {
    return "image/gif";
  }
  return normalizeMimeType(fallbackMimeType);
}

export async function removeBackground(input = {}) {
  const rawBytes = input?.bytes;
  const bytes = Buffer.isBuffer(rawBytes)
    ? rawBytes
    : rawBytes instanceof Uint8Array
    ? Buffer.from(rawBytes)
    : Buffer.from(rawBytes || []);

  if (bytes.length === 0) {
    throw createInvalidInputError("Missing image bytes.");
  }

  const mimeType = detectBackgroundRemovalMimeType(bytes, input?.mimeType);
  const strategy = String(input?.strategy || "auto").trim().toLowerCase();

  if (strategy === "gif-white-key" || mimeType === "image/gif") {
    const converted = await convertGifWhiteToTransparent(bytes, {
      ...DEFAULT_GIF_OPTIONS,
      ...(input?.gifOptions && typeof input.gifOptions === "object" ? input.gifOptions : {}),
    });
    return {
      bytes: converted?.bytes?.length ? converted.bytes : bytes,
      mimeType: converted?.mimeType || "image/gif",
      width: 0,
      height: 0,
      fileName: String(input?.fileName || "image-no-bg.gif")
        .replace(/\.[a-z0-9]+$/i, "")
        .concat("-no-bg.gif"),
      strategy: "gif-white-key",
      provider: "gif-chroma-key",
      removedBackground: Boolean(converted?.bytes?.length),
    };
  }

  if (mimeType === "image/png" || mimeType === "image/jpeg") {
    return removeRasterBackgroundWithLocalEdgeFlood({
      bytes,
      mimeType,
      fileName: input?.fileName,
      maxSide: input?.maxSide,
    });
  }

  throw createUnsupportedImageTypeError("Only PNG, JPEG, and GIF images are supported.");
}
