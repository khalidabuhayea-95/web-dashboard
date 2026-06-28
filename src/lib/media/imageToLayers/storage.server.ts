import { createLogger } from "@/lib/logging/logger";
import {
  createSignedDownloadUrl,
  deleteObjects,
  getPrivateStorageBucketName,
  getPublicStorageBucketName,
  uploadObject,
} from "@/lib/storage/objectStorage.server";

import { createProcessingFailedError, createProviderUnavailableError } from "./errors";

const INPUT_BUCKET = getPrivateStorageBucketName();
// Layer images are loaded directly by the editor/mobile app as `imageUri`, so
// they must live in the public, long-cached bucket like other template assets.
const OUTPUT_BUCKET = getPublicStorageBucketName();
const DEFAULT_INPUT_URL_EXPIRY_SECONDS = 15 * 60;

const logger = createLogger("media.image-to-layers.storage");

type StoredObject = {
  bucket: string;
  path: string;
};

function sanitizePathSegment(value: unknown, fallback = "file"): string {
  const safeValue = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return safeValue || fallback;
}

function normalizeMimeType(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function extensionFromMimeType(mimeType: string): string {
  const normalized = normalizeMimeType(mimeType);
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  return "bin";
}

function makeObjectPath(jobId: string, kind: string, fileName: string, mimeType: string) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const safeJobId = sanitizePathSegment(jobId, "job");
  const safeBase = sanitizePathSegment(fileName.replace(/\.[^.]+$/, ""), kind);
  const extension = extensionFromMimeType(mimeType);
  return `image-to-layers/jobs/${year}/${month}/${day}/${safeJobId}/${kind}-${safeBase}.${extension}`;
}

async function uploadBytesToBucket(
  bucket: string,
  objectPath: string,
  bytes: Buffer,
  mimeType: string,
  cacheControl: string
) {
  try {
    return await uploadObject({
      bucket,
      key: objectPath,
      body: bytes,
      contentType: mimeType || "application/octet-stream",
      cacheControl,
      upsert: false,
    });
  } catch (error) {
    throw createProcessingFailedError(
      error instanceof Error ? error.message : "Failed to upload image layering asset."
    );
  }
}

export async function uploadImageToLayersInputAsset(input: {
  jobId: string;
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  width?: number;
  height?: number;
}) {
  const path = makeObjectPath(input.jobId, "image", input.fileName, input.mimeType);
  await uploadBytesToBucket(INPUT_BUCKET, path, input.bytes, input.mimeType, "public, max-age=3600");

  return {
    bucket: INPUT_BUCKET,
    path,
    mimeType: input.mimeType,
    fileName: input.fileName,
    width: Number(input.width || 0),
    height: Number(input.height || 0),
    size: input.bytes.length,
  };
}

export async function createImageToLayersSignedInputUrl(
  asset: StoredObject,
  expiresInSeconds = DEFAULT_INPUT_URL_EXPIRY_SECONDS
) {
  try {
    return await createSignedDownloadUrl(
      asset.bucket,
      asset.path,
      Math.max(60, Math.round(Number(expiresInSeconds) || DEFAULT_INPUT_URL_EXPIRY_SECONDS))
    );
  } catch (error) {
    throw createProviderUnavailableError(
      error instanceof Error ? error.message : "Failed to create signed input URL."
    );
  }
}

export async function uploadImageToLayersLayerAsset(input: {
  jobId: string;
  index: number;
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  width?: number;
  height?: number;
}) {
  const kind = `layer-${String(input.index).padStart(2, "0")}`;
  const path = makeObjectPath(input.jobId, kind, input.fileName, input.mimeType);
  const uploaded = await uploadBytesToBucket(
    OUTPUT_BUCKET,
    path,
    input.bytes,
    input.mimeType,
    "public, max-age=31536000, immutable"
  );
  const assetUrl = String(uploaded.url || "").trim();
  if (!assetUrl) {
    throw createProcessingFailedError("Image layer output URL is unavailable.");
  }

  return {
    bucket: OUTPUT_BUCKET,
    path,
    assetUrl,
    mimeType: input.mimeType,
    fileName: input.fileName,
    width: Number(input.width || 0),
    height: Number(input.height || 0),
    size: input.bytes.length,
  };
}

export async function deleteImageToLayersStoredObjects(items: StoredObject[] = []) {
  const grouped = new Map<string, string[]>();

  for (const item of items) {
    const bucket = String(item?.bucket || "").trim();
    const path = String(item?.path || "").trim();
    if (!bucket || !path) continue;
    const current = grouped.get(bucket) || [];
    current.push(path);
    grouped.set(bucket, current);
  }

  await Promise.all(
    Array.from(grouped.entries()).map(async ([bucket, paths]) => {
      try {
        await deleteObjects(bucket, paths);
      } catch (error) {
        logger.warn("Failed to delete image layering temp assets", {
          bucket,
          paths,
          error: error instanceof Error ? error.message : String(error || ""),
        });
      }
    })
  );
}
