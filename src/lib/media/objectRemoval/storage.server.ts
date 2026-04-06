import { createLogger } from "@/lib/logging/logger";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  createProcessingFailedError,
  createProviderUnavailableError,
} from "./errors";

const INPUT_BUCKET = process.env.OBJECT_REMOVE_INPUT_BUCKET || "mobile-media-processing";
const OUTPUT_BUCKET =
  process.env.OBJECT_REMOVE_OUTPUT_BUCKET || process.env.EDITOR_MEDIA_BUCKET || "editor-media";
const DEFAULT_INPUT_URL_EXPIRY_SECONDS = 15 * 60;
const DEFAULT_FILE_SIZE_LIMIT = `${50 * 1024 * 1024}`;

const logger = createLogger("media.object-remove.storage");

type StoredObject = {
  bucket: string;
  path: string;
};

type UploadStoredAssetInput = {
  jobId: string;
  kind: "image" | "mask" | "output";
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  width?: number;
  height?: number;
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
  return `object-remove/jobs/${year}/${month}/${day}/${safeJobId}/${kind}-${safeBase}.${extension}`;
}

async function ensureBucket(bucket: string, isPublic: boolean) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.getBucket(bucket);
  if (error) {
    const created = await admin.storage.createBucket(bucket, {
      public: isPublic,
      fileSizeLimit: DEFAULT_FILE_SIZE_LIMIT,
    });
    if (created.error && !String(created.error.message || "").toLowerCase().includes("exists")) {
      throw createProviderUnavailableError(created.error.message || "Failed to prepare storage bucket.");
    }
    return;
  }

  if (data && data.public !== isPublic) {
    const updated = await admin.storage.updateBucket(bucket, {
      public: isPublic,
      fileSizeLimit: DEFAULT_FILE_SIZE_LIMIT,
    });
    if (updated.error) {
      throw createProviderUnavailableError(updated.error.message || "Failed to update storage bucket.");
    }
  }
}

async function uploadBytesToBucket(bucket: string, objectPath: string, bytes: Buffer, mimeType: string) {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(bucket).upload(objectPath, bytes, {
    contentType: mimeType || "application/octet-stream",
    cacheControl: "3600",
    upsert: false,
  });

  if (error) {
    throw createProcessingFailedError(error.message || "Failed to upload object removal asset.");
  }
}

export async function uploadObjectRemovalInputAsset(input: UploadStoredAssetInput) {
  await ensureBucket(INPUT_BUCKET, false);
  const path = makeObjectPath(input.jobId, input.kind, input.fileName, input.mimeType);
  await uploadBytesToBucket(INPUT_BUCKET, path, input.bytes, input.mimeType);

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

export async function createObjectRemovalSignedInputUrl(
  asset: StoredObject,
  expiresInSeconds = DEFAULT_INPUT_URL_EXPIRY_SECONDS
) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(asset.bucket)
    .createSignedUrl(asset.path, Math.max(60, Math.round(Number(expiresInSeconds) || DEFAULT_INPUT_URL_EXPIRY_SECONDS)));

  if (error || !data?.signedUrl) {
    throw createProviderUnavailableError(error?.message || "Failed to create signed input URL.");
  }

  return String(data.signedUrl || "").trim();
}

export async function uploadObjectRemovalOutputAsset(input: UploadStoredAssetInput) {
  await ensureBucket(OUTPUT_BUCKET, true);
  const path = makeObjectPath(input.jobId, input.kind, input.fileName, input.mimeType);
  await uploadBytesToBucket(OUTPUT_BUCKET, path, input.bytes, input.mimeType);

  const admin = createAdminClient();
  const { data } = admin.storage.from(OUTPUT_BUCKET).getPublicUrl(path);
  const assetUrl = String(data?.publicUrl || "").trim();
  if (!assetUrl) {
    throw createProcessingFailedError("Object removal output URL is unavailable.");
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

export async function deleteObjectRemovalStoredObjects(items: StoredObject[] = []) {
  const admin = createAdminClient();
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
      const { error } = await admin.storage.from(bucket).remove(paths);
      if (error) {
        logger.warn("Failed to delete object removal temp assets", {
          bucket,
          paths,
          error: error.message,
        });
      }
    })
  );
}
