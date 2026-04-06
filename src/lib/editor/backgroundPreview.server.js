import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

export const DEFAULT_BACKGROUND_PREVIEW_MAX_DIMENSION = 512;

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 20_000;

let sharpPromise = null;

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeUrl(value) {
  const source = sanitizeText(value);
  if (!source) return "";
  try {
    const parsed = new URL(source);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function sanitizePathSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeMimeType(value) {
  return sanitizeText(value).toLowerCase() || "application/octet-stream";
}

function getDefaultBucket() {
  return process.env.EDITOR_MEDIA_BUCKET || "editor-media";
}

function inferContentType(url, headerValue) {
  const normalizedHeader = normalizeMimeType(headerValue);
  if (normalizedHeader && normalizedHeader !== "application/octet-stream") {
    return normalizedHeader.split(";")[0].trim();
  }
  const source = String(url || "").toLowerCase();
  if (/\.png(?:$|[?#])/i.test(source)) return "image/png";
  if (/\.jpe?g(?:$|[?#])/i.test(source)) return "image/jpeg";
  if (/\.webp(?:$|[?#])/i.test(source)) return "image/webp";
  if (/\.gif(?:$|[?#])/i.test(source)) return "image/gif";
  if (/\.svg(?:$|[?#])/i.test(source)) return "image/svg+xml";
  return "application/octet-stream";
}

function extensionFromMimeType(mimeType) {
  const source = normalizeMimeType(mimeType);
  if (source.includes("png")) return "png";
  if (source.includes("jpeg") || source.includes("jpg")) return "jpg";
  if (source.includes("webp")) return "webp";
  if (source.includes("gif")) return "gif";
  if (source.includes("svg")) return "svg";
  return "bin";
}

function createStorageAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
}

async function ensurePublicBucket(admin, bucket) {
  const { data, error } = await admin.storage.getBucket(bucket);
  if (error) {
    const created = await admin.storage.createBucket(bucket, {
      public: true,
      fileSizeLimit: "104857600",
    });
    if (created.error && !String(created.error.message || "").toLowerCase().includes("exists")) {
      throw created.error;
    }
    return;
  }

  if (data && data.public === false) {
    await admin.storage.updateBucket(bucket, {
      public: true,
      fileSizeLimit: "104857600",
    });
  }
}

function preferredPreviewMimeType({ inputMimeType = "", format = "", hasAlpha = false }) {
  const normalizedInput = normalizeMimeType(inputMimeType);
  const normalizedFormat = sanitizeText(format).toLowerCase();

  if (normalizedFormat === "webp" || normalizedInput.includes("webp")) return "image/webp";
  if (hasAlpha || normalizedFormat === "png" || normalizedFormat === "svg" || normalizedInput.includes("png")) {
    return "image/png";
  }
  return "image/jpeg";
}

async function loadSharp() {
  if (sharpPromise) return sharpPromise;

  sharpPromise = import("sharp")
    .then((module) => module?.default || module)
    .catch((error) => {
      sharpPromise = null;
      throw error;
    });

  return sharpPromise;
}

export async function downloadRemoteAsset(url, { timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS } = {}) {
  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) {
    throw new Error("Asset URL is required.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(safeUrl, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "image/*,application/octet-stream,*/*",
      },
    });

    if (!response.ok) {
      throw new Error(`Download failed (${response.status}).`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      bytes,
      mimeType: inferContentType(safeUrl, response.headers.get("content-type")),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function createBackgroundPreview({
  bytes,
  mimeType,
  maxDimension = DEFAULT_BACKGROUND_PREVIEW_MAX_DIMENSION,
} = {}) {
  const inputBytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const inputMimeType = normalizeMimeType(mimeType);
  const safeMaxDimension = Math.max(64, Math.round(Number(maxDimension) || DEFAULT_BACKGROUND_PREVIEW_MAX_DIMENSION));

  if (!inputBytes.length || !inputMimeType.startsWith("image/")) {
    return {
      generated: false,
      bytes: inputBytes,
      mimeType: inputMimeType,
      width: null,
      height: null,
    };
  }

  try {
    const sharp = await loadSharp();
    const image = sharp(inputBytes, {
      animated: false,
      pages: 1,
      limitInputPixels: false,
    });
    const metadata = await image.metadata();
    const width = Number.isFinite(Number(metadata?.width)) ? Number(metadata.width) : null;
    const height = Number.isFinite(Number(metadata?.height)) ? Number(metadata.height) : null;

    if (!width || !height) {
      return {
        generated: false,
        bytes: inputBytes,
        mimeType: inputMimeType,
        width,
        height,
      };
    }

    if (String(metadata?.format || "").toLowerCase() === "gif" || Number(metadata?.pages || 1) > 1) {
      return {
        generated: false,
        bytes: inputBytes,
        mimeType: inputMimeType,
        width,
        height,
      };
    }

    if (Math.max(width, height) <= safeMaxDimension) {
      return {
        generated: false,
        bytes: inputBytes,
        mimeType: inputMimeType,
        width,
        height,
      };
    }

    const outputMimeType = preferredPreviewMimeType({
      inputMimeType,
      format: metadata?.format,
      hasAlpha: Boolean(metadata?.hasAlpha),
    });

    let pipeline = image.resize({
      width: safeMaxDimension,
      height: safeMaxDimension,
      fit: "inside",
      withoutEnlargement: true,
    });

    if (outputMimeType === "image/png") {
      pipeline = pipeline.png({ compressionLevel: 9 });
    } else if (outputMimeType === "image/webp") {
      pipeline = pipeline.webp({ quality: 82 });
    } else {
      pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
    }

    const outputBytes = await pipeline.toBuffer();
    const outputMetadata = await sharp(outputBytes, {
      animated: false,
      pages: 1,
      limitInputPixels: false,
    }).metadata();

    return {
      generated: true,
      bytes: outputBytes,
      mimeType: outputMimeType,
      width: Number.isFinite(Number(outputMetadata?.width)) ? Number(outputMetadata.width) : width,
      height: Number.isFinite(Number(outputMetadata?.height)) ? Number(outputMetadata.height) : height,
    };
  } catch {
    return {
      generated: false,
      bytes: inputBytes,
      mimeType: inputMimeType,
      width: null,
      height: null,
    };
  }
}

export async function uploadBackgroundPreviewToStorage({
  ownerId,
  sourceAssetId,
  bytes,
  mimeType,
  bucket = getDefaultBucket(),
} = {}) {
  const safeOwnerId = sanitizePathSegment(ownerId) || "system";
  const safeSourceAssetId = sanitizePathSegment(sourceAssetId) || "background";
  const safeMimeType = normalizeMimeType(mimeType) || "image/png";
  const extension = extensionFromMimeType(safeMimeType);
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const objectPath = `users/${safeOwnerId}/elements/background-previews/${yyyy}/${mm}/${dd}/${safeSourceAssetId}-${randomUUID()}.${extension}`;

  const admin = createStorageAdminClient();
  await ensurePublicBucket(admin, bucket);

  const { error } = await admin.storage.from(bucket).upload(objectPath, bytes, {
    contentType: safeMimeType,
    upsert: false,
    cacheControl: "31536000",
  });
  if (error) {
    throw new Error(error.message || "Failed to upload background preview.");
  }

  const { data } = admin.storage.from(bucket).getPublicUrl(objectPath);
  const publicUrl = sanitizeUrl(data?.publicUrl);
  if (!publicUrl) {
    throw new Error("Background preview URL is unavailable.");
  }

  return publicUrl;
}
