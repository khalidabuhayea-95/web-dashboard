import { db as prisma } from "./db";
import { logger } from "@/lib/logging/logger";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  createPrivateSignedDownloadUrl,
  createSignedUploadPartUrl,
  createSignedUploadUrl,
  deleteObjects,
  getUserDesignsBucketName,
  headObject,
  isNoSuchUpload,
  listObjectKeys,
  listUploadedParts,
} from "@/lib/storage/objectStorage.server";

import {
  MAX_DESIGN_MEDIA_FILE_BYTES,
  UNREFERENCED_MEDIA_GRACE_MS,
  expectedPartBytes,
  multipartPlan,
} from "./config.js";
import { DesignSyncCodes, DesignSyncError } from "./errors";
import { withLibraryLock } from "./library.server";
import { computeUsedBytes, getStorageSummary, resolveStorageLimit, type StorageSummary, type SyncUser } from "./quota.server";
import { isValidSha256, normalizeContentType, toSafeInt } from "./validation";

/** Long enough to START a large upload on a slow link; the signature is checked when it starts. */
const UPLOAD_URL_TTL_SECONDS = 60 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;
const MAX_FILES_PER_PREPARE = 200;

export function userMediaPrefix(mobileUserId: string): string {
  return `users/${mobileUserId}/`;
}

/** One object per (user, content hash): the same photo is stored once however many designs use it. */
export function userMediaKey(mobileUserId: string, sha256: string): string {
  return `${userMediaPrefix(mobileUserId)}media/${sha256}`;
}

export type PreparedFile = {
  sha256: string;
  /**
   * "ready": the server already holds it — skip. "upload": PUT the file to `uploadUrl`.
   * "multipart": a large file — ask `media/parts` which parts to PUT, then `complete`.
   */
  status: "ready" | "upload" | "multipart";
  sizeBytes: number;
  contentType: string;
  uploadUrl?: string;
  partBytes?: number;
  partCount?: number;
};

type RequestedFile = { sha256: string; sizeBytes: number; contentType: string };

function parseRequestedFiles(input: unknown): RequestedFile[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "files must be a non-empty array.");
  }
  if (input.length > MAX_FILES_PER_PREPARE) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, `At most ${MAX_FILES_PER_PREPARE} files per request.`);
  }
  const bySha = new Map<string, RequestedFile>();
  for (const entry of input) {
    const source = (entry ?? {}) as Record<string, unknown>;
    const sha256 = String(source.sha256 ?? "").trim().toLowerCase();
    const sizeBytes = toSafeInt(source.sizeBytes);
    const contentType = normalizeContentType(source.contentType);
    if (!isValidSha256(sha256) || sizeBytes === null || sizeBytes <= 0 || !contentType) {
      throw new DesignSyncError(400, DesignSyncCodes.INVALID, "Each file needs sha256, sizeBytes and contentType.");
    }
    if (sizeBytes > MAX_DESIGN_MEDIA_FILE_BYTES) {
      throw new DesignSyncError(413, DesignSyncCodes.FILE_TOO_LARGE, "A file is too large to sync.", {
        sha256,
        maxBytes: MAX_DESIGN_MEDIA_FILE_BYTES,
      });
    }
    bySha.set(sha256, { sha256, sizeBytes, contentType });
  }
  return Array.from(bySha.values());
}

/**
 * Step 1 of pushing a design: the device lists the files the design needs (by content hash) and
 * learns which ones the server lacks, with a signed URL to PUT each of those to.
 *
 * ★The quota is decided HERE, all-or-nothing for the request: either every missing file fits and
 * is reserved (as a `pending` row, which already counts toward the user's storage), or none is —
 * a design must never end up half-uploaded because its last video did not fit.
 */
export async function prepareMediaUploads(
  user: SyncUser,
  filesInput: unknown,
): Promise<{ files: PreparedFile[]; storage: StorageSummary }> {
  const requested = parseRequestedFiles(filesInput);
  const { limitBytes, tier } = await resolveStorageLimit(user);

  const outcome = await withLibraryLock(user.id, async (tx) => {
    const existing = await tx.userMediaObject.findMany({
      where: { mobileUserId: user.id, sha256: { in: requested.map((file) => file.sha256) } },
      select: { sha256: true, sizeBytes: true, contentType: true, status: true },
    });
    const known = new Map(existing.map((row) => [row.sha256, row]));
    const fresh = requested.filter((file) => !known.has(file.sha256));
    const usedBytes = await computeUsedBytes(tx, user.id);
    const addedBytes = fresh.reduce((total, file) => total + file.sizeBytes, 0);
    if (addedBytes > 0 && usedBytes + addedBytes > limitBytes) {
      throw new DesignSyncError(409, DesignSyncCodes.QUOTA_EXCEEDED, "Cloud storage is full.", {
        storage: { usedBytes, limitBytes, tier },
        neededBytes: addedBytes,
      });
    }
    if (fresh.length > 0) {
      await tx.userMediaObject.createMany({
        data: fresh.map((file) => ({
          mobileUserId: user.id,
          sha256: file.sha256,
          sizeBytes: BigInt(file.sizeBytes),
          contentType: file.contentType,
          storageKey: userMediaKey(user.id, file.sha256),
          status: "pending",
        })),
      });
    }
    return {
      // What the SERVER recorded wins over what this request says: the upload URL is signed for
      // the recorded size and type, and a second device must send exactly those.
      files: requested.map((file) => {
        const row = known.get(file.sha256);
        return row
          ? {
              sha256: file.sha256,
              status: row.status === "ready" ? ("ready" as const) : ("upload" as const),
              sizeBytes: Number(row.sizeBytes),
              contentType: row.contentType,
            }
          : { sha256: file.sha256, status: "upload" as const, sizeBytes: file.sizeBytes, contentType: file.contentType };
      }),
      storage: { usedBytes: usedBytes + addedBytes, limitBytes, tier },
    };
  });

  const bucket = getUserDesignsBucketName();
  const files: PreparedFile[] = [];
  for (const file of outcome.files) {
    if (file.status === "ready") {
      files.push(file);
      continue;
    }
    // Large files go up in parts (media/parts). Nothing is created in storage until the device
    // asks for them, so a prepare that is never followed costs nothing but the reservation.
    const plan = multipartPlan(file.sizeBytes);
    if (plan) {
      files.push({ ...file, status: "multipart", partBytes: plan.partBytes, partCount: plan.partCount });
      continue;
    }
    files.push({
      ...file,
      uploadUrl: await createSignedUploadUrl(bucket, userMediaKey(user.id, file.sha256), {
        contentLength: file.sizeBytes,
        contentType: file.contentType,
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      }),
    });
  }
  return { files, storage: outcome.storage };
}

export type PartsPlan = {
  sha256: string;
  partBytes: number;
  partCount: number;
  /** Parts storage already holds at the right size: never sent again. */
  uploadedParts: number[];
  /** One signed URL per missing part, in order. Each PUT must carry exactly `sizeBytes`. */
  parts: { partNumber: number; sizeBytes: number; uploadUrl: string }[];
};

/**
 * A large file's upload, from wherever it stopped: which parts storage already has (asked of
 * storage, not remembered by the device — so it survives the app, or the phone, restarting) and a
 * signed URL for each part still missing. Starts the multipart upload on the first call, and a
 * fresh one when storage no longer knows the old one (completed elsewhere, or expired).
 */
export async function prepareMediaParts(user: SyncUser, shaInput: unknown): Promise<PartsPlan> {
  const sha256 = String(shaInput ?? "").trim().toLowerCase();
  if (!isValidSha256(sha256)) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "sha256 must be a SHA-256 hex string.");
  }
  const row = await prisma.userMediaObject.findUnique({
    where: { mobileUserId_sha256: { mobileUserId: user.id, sha256 } },
    select: { sizeBytes: true, contentType: true, status: true, storageKey: true, uploadId: true },
  });
  if (!row) {
    throw new DesignSyncError(404, DesignSyncCodes.MEDIA_MISSING, "Prepare this file first.", { sha256s: [sha256] });
  }
  const sizeBytes = Number(row.sizeBytes);
  const plan = multipartPlan(sizeBytes);
  if (!plan) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "This file is uploaded in one request, not in parts.");
  }
  if (row.status === "ready") {
    return { sha256, ...plan, uploadedParts: Array.from({ length: plan.partCount }, (_, index) => index + 1), parts: [] };
  }

  const bucket = getUserDesignsBucketName();
  let uploadId = row.uploadId;
  let uploaded: { partNumber: number; sizeBytes: number }[] = [];
  if (uploadId) {
    try {
      uploaded = await listUploadedParts(bucket, row.storageKey, uploadId);
    } catch (error) {
      if (!isNoSuchUpload(error)) throw error;
      uploadId = null;
    }
  }
  if (!uploadId) {
    uploadId = await createMultipartUpload(bucket, row.storageKey, row.contentType);
    uploaded = [];
    await prisma.userMediaObject.updateMany({
      where: { mobileUserId: user.id, sha256, status: "pending" },
      data: { uploadId, partBytes: plan.partBytes },
    });
  }

  // A part of the wrong size (a different cut from an older build) counts as missing.
  const have = new Set(
    uploaded
      .filter((part) => part.sizeBytes === expectedPartBytes(sizeBytes, plan.partBytes, part.partNumber))
      .map((part) => part.partNumber),
  );
  const parts: PartsPlan["parts"] = [];
  for (let partNumber = 1; partNumber <= plan.partCount; partNumber++) {
    if (have.has(partNumber)) continue;
    const partSize = expectedPartBytes(sizeBytes, plan.partBytes, partNumber);
    parts.push({
      partNumber,
      sizeBytes: partSize,
      uploadUrl: await createSignedUploadPartUrl(bucket, row.storageKey, {
        uploadId,
        partNumber,
        contentLength: partSize,
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      }),
    });
  }
  return { sha256, ...plan, uploadedParts: Array.from(have).sort((a, b) => a - b), parts };
}

/**
 * Joins a large file's parts once every one is in storage. False while any is missing (the device
 * asks media/parts again). Clears the upload id either way the upload ends.
 */
async function completeMultipart(mobileUserId: string, sha256: string, storageKey: string, sizeBytes: number, uploadId: string): Promise<boolean> {
  const plan = multipartPlan(sizeBytes);
  if (!plan) return false;
  const bucket = getUserDesignsBucketName();
  let parts: { partNumber: number; sizeBytes: number; etag: string }[];
  try {
    parts = await listUploadedParts(bucket, storageKey, uploadId);
  } catch (error) {
    if (!isNoSuchUpload(error)) throw error;
    // Gone from storage: completed by an earlier request whose reply was lost, or expired. The
    // HEAD that follows tells which.
    await prisma.userMediaObject.updateMany({ where: { mobileUserId, sha256 }, data: { uploadId: null } });
    return true;
  }
  const byNumber = new Map(parts.map((part) => [part.partNumber, part]));
  for (let partNumber = 1; partNumber <= plan.partCount; partNumber++) {
    const part = byNumber.get(partNumber);
    if (!part || part.sizeBytes !== expectedPartBytes(sizeBytes, plan.partBytes, partNumber)) return false;
  }
  await completeMultipartUpload(
    bucket,
    storageKey,
    uploadId,
    Array.from({ length: plan.partCount }, (_, index) => byNumber.get(index + 1)!),
  );
  await prisma.userMediaObject.updateMany({ where: { mobileUserId, sha256 }, data: { uploadId: null } });
  return true;
}

export type CompletedFile = { sha256: string; status: "ready" | "missing" | "size_mismatch" };

function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return (
    candidate?.$metadata?.httpStatusCode === 404 ||
    candidate?.name === "NotFound" ||
    candidate?.name === "NoSuchKey"
  );
}

/**
 * Step 2: the device says "I uploaded these". The server does not take its word — it asks storage
 * for each object and marks it `ready` only if it is there at the reserved size. A design can
 * only be written once every file it references is `ready`.
 */
export async function completeMediaUploads(user: SyncUser, hashesInput: unknown): Promise<{ files: CompletedFile[] }> {
  if (!Array.isArray(hashesInput) || hashesInput.length === 0 || hashesInput.length > MAX_FILES_PER_PREPARE) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "sha256s must be a non-empty array.");
  }
  const hashes = Array.from(new Set(hashesInput.map((value) => String(value ?? "").trim().toLowerCase())));
  if (!hashes.every(isValidSha256)) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "sha256s must be SHA-256 hex strings.");
  }

  const rows = await prisma.userMediaObject.findMany({
    where: { mobileUserId: user.id, sha256: { in: hashes } },
    select: { sha256: true, sizeBytes: true, status: true, storageKey: true, uploadId: true },
  });
  const known = new Map(rows.map((row) => [row.sha256, row]));
  const bucket = getUserDesignsBucketName();
  const files: CompletedFile[] = [];

  for (const sha256 of hashes) {
    const row = known.get(sha256);
    if (!row) {
      files.push({ sha256, status: "missing" });
      continue;
    }
    if (row.status === "ready") {
      files.push({ sha256, status: "ready" });
      continue;
    }
    if (row.uploadId && !(await completeMultipart(user.id, sha256, row.storageKey, Number(row.sizeBytes), row.uploadId))) {
      files.push({ sha256, status: "missing" });
      continue;
    }
    let actualSize: number | null = null;
    try {
      const head = await headObject(bucket, row.storageKey);
      actualSize = Number(head?.ContentLength ?? -1);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (actualSize === null) {
      files.push({ sha256, status: "missing" });
      continue;
    }
    if (actualSize !== Number(row.sizeBytes)) {
      // The signed content-length makes this unreachable through our URL; if it happens anyway
      // the object is not what was reserved, so neither it nor its reservation is kept.
      await deleteObjects(bucket, [row.storageKey]).catch(() => undefined);
      await prisma.userMediaObject.deleteMany({ where: { mobileUserId: user.id, sha256, status: "pending" } });
      files.push({ sha256, status: "size_mismatch" });
      continue;
    }
    await prisma.userMediaObject.updateMany({
      where: { mobileUserId: user.id, sha256, status: "pending" },
      data: { status: "ready", readyAt: new Date() },
    });
    files.push({ sha256, status: "ready" });
  }
  return { files };
}

export type MediaManifestEntry = { sha256: string; sizeBytes: number; contentType: string; url: string };

/** Signed download URLs for the files a design references — what the device needs to open it. */
export async function buildMediaManifest(mobileUserId: string, hashes: string[]): Promise<MediaManifestEntry[]> {
  if (hashes.length === 0) return [];
  const rows = await prisma.userMediaObject.findMany({
    where: { mobileUserId, sha256: { in: hashes }, status: "ready" },
    select: { sha256: true, sizeBytes: true, contentType: true, storageKey: true },
  });
  const bucket = getUserDesignsBucketName();
  const manifest: MediaManifestEntry[] = [];
  for (const row of rows) {
    manifest.push({
      sha256: row.sha256,
      sizeBytes: Number(row.sizeBytes),
      contentType: row.contentType,
      url: await createPrivateSignedDownloadUrl(bucket, row.storageKey, DOWNLOAD_URL_TTL_SECONDS),
    });
  }
  return manifest;
}

/**
 * Removes media objects (storage first, then their rows) that no design of the user references
 * any more. With [candidates], only those hashes are considered and age does not matter — used
 * right after a purge or an edit dropped them, so emptying the Trash frees space at once. Without,
 * it sweeps anything unreferenced for longer than the grace period: uploads whose design was
 * never written.
 *
 * Best-effort: a storage failure leaves the rows (and their quota) for the next sweep rather than
 * orphaning objects nobody is charged for.
 */
export async function removeUnreferencedMedia(
  mobileUserId: string,
  candidates?: string[],
): Promise<number> {
  if (candidates && candidates.length === 0) return 0;
  try {
    const cutoff = new Date(Date.now() - UNREFERENCED_MEDIA_GRACE_MS);
    const rows = await prisma.userMediaObject.findMany({
      where: {
        mobileUserId,
        ...(candidates ? { sha256: { in: candidates } } : { createdAt: { lt: cutoff } }),
      },
      select: { sha256: true, storageKey: true, uploadId: true },
      take: 200,
    });
    if (rows.length === 0) return 0;
    const inUse = await referencedHashes(prisma, mobileUserId, rows.map((row) => row.sha256));
    const orphans = rows.filter((row) => !inUse.has(row.sha256));
    if (orphans.length === 0) return 0;

    const bucket = getUserDesignsBucketName();
    // A large file abandoned mid-upload: its parts are not an object yet, so DeleteObjects would
    // leave them billed until the bucket's lifecycle rule expires them.
    for (const orphan of orphans) {
      if (orphan.uploadId) await abortMultipartUpload(bucket, orphan.storageKey, orphan.uploadId);
    }
    await deleteObjects(bucket, orphans.map((row) => row.storageKey));
    // Re-check inside the delete: a design written a moment ago may reference one of them now.
    const removed = await withLibraryLock(mobileUserId, async (tx) => {
      const keep = await referencedHashes(tx, mobileUserId, orphans.map((row) => row.sha256));
      const gone = orphans.filter((row) => !keep.has(row.sha256)).map((row) => row.sha256);
      if (gone.length === 0) return 0;
      const result = await tx.userMediaObject.deleteMany({ where: { mobileUserId, sha256: { in: gone } } });
      return result.count;
    });
    return removed;
  } catch (error) {
    logger.warn("Design media sweep failed; will retry on a later request", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Account deletion: every object under the user's prefix. The database rows cascade with the
 * MobileUser row; nothing else removes the files.
 */
export async function deleteAllUserMedia(mobileUserId: string): Promise<number> {
  const bucket = getUserDesignsBucketName();
  // Uploads still in parts are not listed as objects: abort them so nothing stays behind.
  const open = await prisma.userMediaObject.findMany({
    where: { mobileUserId, uploadId: { not: null } },
    select: { storageKey: true, uploadId: true },
  });
  for (const upload of open) {
    await abortMultipartUpload(bucket, upload.storageKey, upload.uploadId!).catch(() => undefined);
  }
  const keys = await listObjectKeys(bucket, { prefix: userMediaPrefix(mobileUserId) });
  for (let index = 0; index < keys.length; index += 1000) {
    await deleteObjects(bucket, keys.slice(index, index + 1000));
  }
  return keys.length;
}

/**
 * Which of [hashes] something of the user still needs: a design (UserDesignMedia) or an installed
 * font (UserFont). ★Both count — a font file is referenced by no design, and without this check the
 * 24-hour sweep deleted every synced font.
 */
async function referencedHashes(
  db: Pick<typeof prisma, "userDesignMedia" | "userFont">,
  mobileUserId: string,
  hashes: string[],
): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const [designRefs, fontRefs] = await Promise.all([
    db.userDesignMedia.findMany({
      where: { mobileUserId, sha256: { in: hashes } },
      select: { sha256: true },
      distinct: ["sha256"],
    }),
    db.userFont.findMany({
      where: { mobileUserId, sha256: { in: hashes }, deletedAt: null },
      select: { sha256: true },
    }),
  ]);
  return new Set([...designRefs.map((row) => row.sha256), ...fontRefs.map((row) => row.sha256)]);
}

export { getStorageSummary };
