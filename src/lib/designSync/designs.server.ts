import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { db as prisma } from "./db";
import { logger } from "@/lib/logging/logger";

import {
  DESIGN_SCHEMA_VERSION,
  DESIGN_TRASH_RETENTION_MS,
  MAX_DESIGN_DOCUMENT_BYTES,
} from "./config.js";
import { DesignSyncCodes, DesignSyncError } from "./errors";
import { withLibraryLock } from "./library.server";
import { buildMediaManifest, removeUnreferencedMedia, userMediaKey, type MediaManifestEntry } from "./media.server";
import { createPrivateSignedDownloadUrl, getUserDesignsBucketName } from "@/lib/storage/objectStorage.server";
import { inspectPortableDocument } from "./portableRefs";
import { computeUsedBytes, getStorageSummary, resolveStorageLimit, type StorageSummary, type SyncUser } from "./quota.server";
import {
  cleanName,
  isValidMutationId,
  isValidSha256,
  isValidSyncId,
  MAX_DESIGN_NAME_LENGTH,
  MAX_FOLDER_NAME_LENGTH,
  toSafeInt,
} from "./validation";
import { decideDesignWrite } from "./writeDecision";
import { listFontRowsSince, toFontHeaders, type FontHeader, type FontRow } from "./fonts.server";

const COLOR_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,23}$/;
const DEFAULT_CHANGES_LIMIT = 200;
const MAX_CHANGES_LIMIT = 500;

// ---- Wire shapes -------------------------------------------------------------------------------

export type DesignHeader = {
  id: string;
  name: string;
  revision: number;
  changeSeq: number;
  schemaVersion: number;
  contentHash: string;
  clientCreatedAt: number;
  clientUpdatedAt: number;
  folderId: string | null;
  /** Epoch ms the device moved it to the Trash; null = live. */
  deletedAt: number | null;
  /** True once it is gone for good; a tombstone, with no document behind it. */
  purged: boolean;
  jsonBytes: number;
  /** The preview the device rendered with the current document; null when it sent none. */
  thumbnailSha256: string | null;
  /** A short-lived link to that preview, so a library shows before any design is downloaded. */
  thumbnailUrl: string | null;
};

export type FolderHeader = {
  id: string;
  name: string;
  colorKey: string;
  revision: number;
  changeSeq: number;
  clientCreatedAt: number;
  clientUpdatedAt: number;
  deleted: boolean;
};

const DESIGN_HEADER_SELECT = {
  id: true,
  name: true,
  revision: true,
  changeSeq: true,
  schemaVersion: true,
  contentHash: true,
  clientCreatedAt: true,
  clientUpdatedAt: true,
  folderId: true,
  deletedAt: true,
  purgedAt: true,
  jsonBytes: true,
  thumbnailSha256: true,
} as const;

type DesignHeaderRow = Prisma.UserDesignGetPayload<{ select: typeof DESIGN_HEADER_SELECT }>;

function toDesignHeader(row: DesignHeaderRow): DesignHeader {
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    changeSeq: Number(row.changeSeq),
    schemaVersion: row.schemaVersion,
    contentHash: row.contentHash,
    clientCreatedAt: Number(row.clientCreatedAt),
    clientUpdatedAt: Number(row.clientUpdatedAt),
    folderId: row.folderId,
    deletedAt: row.deletedAt === null ? null : Number(row.deletedAt),
    purged: row.purgedAt !== null,
    jsonBytes: row.jsonBytes,
    thumbnailSha256: row.purgedAt !== null ? null : row.thumbnailSha256,
    // Signed per response, after the header is built: see withThumbnailUrls.
    thumbnailUrl: null,
  };
}

/** Thumbnail links last longer than media links: a list may sit on screen a while before a scroll. */
const THUMBNAIL_URL_TTL_SECONDS = 6 * 60 * 60;

/**
 * Signs each header's thumbnail link. Signing is a local computation (no request to storage), so a
 * page of 200 headers costs 200 HMACs, not 200 round trips.
 */
async function withThumbnailUrls(mobileUserId: string, headers: DesignHeader[]): Promise<DesignHeader[]> {
  const bucket = getUserDesignsBucketName();
  return Promise.all(
    headers.map(async (header) =>
      header.thumbnailSha256
        ? {
            ...header,
            thumbnailUrl: await createPrivateSignedDownloadUrl(
              bucket,
              userMediaKey(mobileUserId, header.thumbnailSha256),
              THUMBNAIL_URL_TTL_SECONDS,
            ),
          }
        : header,
    ),
  );
}

const FOLDER_SELECT = {
  id: true,
  name: true,
  colorKey: true,
  revision: true,
  changeSeq: true,
  clientCreatedAt: true,
  clientUpdatedAt: true,
  deletedAt: true,
} as const;

type FolderRow = Prisma.UserDesignFolderGetPayload<{ select: typeof FOLDER_SELECT }>;

function toFolderHeader(row: FolderRow): FolderHeader {
  return {
    id: row.id,
    name: row.name,
    colorKey: row.colorKey,
    revision: row.revision,
    changeSeq: Number(row.changeSeq),
    clientCreatedAt: Number(row.clientCreatedAt),
    clientUpdatedAt: Number(row.clientUpdatedAt),
    deleted: row.deletedAt !== null,
  };
}

// ---- Purge -------------------------------------------------------------------------------------

/**
 * Turns designs into tombstones inside the caller's lock: the document and its media links go,
 * the row stays so the user's other devices learn it is gone. Returns the media hashes the
 * purged designs referenced — candidates for immediate removal from storage.
 */
async function purgeDesignsInLock(
  tx: Prisma.TransactionClient,
  nextSeq: () => bigint,
  mobileUserId: string,
  ids: string[],
  mutationId: string | null,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const refs = await tx.userDesignMedia.findMany({
    where: { mobileUserId, designId: { in: ids } },
    select: { sha256: true },
    distinct: ["sha256"],
  });
  await tx.userDesignMedia.deleteMany({ where: { mobileUserId, designId: { in: ids } } });
  const now = new Date();
  for (const id of ids) {
    await tx.userDesign.update({
      where: { mobileUserId_id: { mobileUserId, id } },
      data: {
        data: null,
        jsonBytes: 0,
        contentHash: "",
        purgedAt: now,
        revision: { increment: 1 },
        changeSeq: nextSeq(),
        ...(mutationId ? { lastMutationId: mutationId } : {}),
      },
    });
  }
  return refs.map((row) => row.sha256);
}

/**
 * The Trash's 30 days are counted on the SERVER's clock, from when the server first saw the design
 * trashed — so no device, whatever its clock says, can purge an account's Trash early (or keep it
 * forever). Runs lazily, for one user, whenever that user asks for changes: there is no scheduler.
 */
async function purgeExpiredTrash(mobileUserId: string): Promise<void> {
  const cutoff = new Date(Date.now() - DESIGN_TRASH_RETENTION_MS);
  const expired = await prisma.userDesign.findMany({
    where: { mobileUserId, purgedAt: null, trashedAt: { lt: cutoff } },
    select: { id: true },
    take: 200,
  });
  if (expired.length === 0) return;
  const dropped = await withLibraryLock(mobileUserId, async (tx, nextSeq) => {
    // Re-read under the lock: one of them may have been restored a moment ago.
    const still = await tx.userDesign.findMany({
      where: { mobileUserId, purgedAt: null, trashedAt: { lt: cutoff }, id: { in: expired.map((row) => row.id) } },
      select: { id: true },
    });
    return purgeDesignsInLock(tx, nextSeq, mobileUserId, still.map((row) => row.id), null);
  });
  logger.info("Design sync purged expired Trash", { count: expired.length });
  await removeUnreferencedMedia(mobileUserId, dropped);
}

// ---- Changes -----------------------------------------------------------------------------------

export type ChangesPage = {
  designs: DesignHeader[];
  folders: FolderHeader[];
  /** Installed fonts synced to the account (tombstones included). */
  fonts: FontHeader[];
  /** Pass back as `since` to continue. */
  cursor: number;
  hasMore: boolean;
  storage: StorageSummary;
  /**
   * The device's `since` is beyond anything this library ever numbered: the server's history
   * started over (a database restored from a backup, a library rebuilt). Everything the device
   * believes the server holds may be gone — it must forget that and offer its designs again.
   * `cursor` is then the server's real head.
   */
  reset: boolean;
};

/**
 * Everything of the user's that changed after [sinceInput] — design headers (tombstones included)
 * and folders — oldest change first, in one sequence. Documents are not included; a device fetches
 * the ones whose revision it does not have.
 */
export async function listChanges(user: SyncUser, sinceInput: unknown, limitInput: unknown): Promise<ChangesPage> {
  const since = BigInt(toSafeInt(sinceInput) ?? 0);
  const limit = Math.max(1, Math.min(MAX_CHANGES_LIMIT, toSafeInt(limitInput) ?? DEFAULT_CHANGES_LIMIT));

  await purgeExpiredTrash(user.id);
  // Uploads whose design was never written, older than the grace period.
  await removeUnreferencedMedia(user.id);

  // ★Without this a cursor from before a restore is simply echoed back: the device keeps
  // believing its designs are on the server and never sends them again.
  const library = await prisma.userDesignLibrary.findUnique({
    where: { mobileUserId: user.id },
    select: { changeSeq: true },
  });
  const head = library?.changeSeq ?? BigInt(0);
  if (since > head) {
    return {
      designs: [],
      folders: [],
      fonts: [],
      cursor: Number(head),
      hasMore: false,
      storage: await getStorageSummary(user),
      reset: true,
    };
  }

  const designRows = await prisma.userDesign.findMany({
    where: { mobileUserId: user.id, changeSeq: { gt: since } },
    orderBy: { changeSeq: "asc" },
    take: limit + 1,
    select: DESIGN_HEADER_SELECT,
  });
  const folderRows = await prisma.userDesignFolder.findMany({
    where: { mobileUserId: user.id, changeSeq: { gt: since } },
    orderBy: { changeSeq: "asc" },
    take: limit + 1,
    select: FOLDER_SELECT,
  });

  const fontRows = await listFontRowsSince(user.id, since, limit + 1);

  // One page across every kind, cut at a single sequence number so the cursor is exact.
  type Entry = { seq: bigint; design: DesignHeaderRow | null; folder: FolderRow | null; font: FontRow | null };
  const merged: Entry[] = [
    ...designRows.map((row) => ({ seq: row.changeSeq, design: row, folder: null, font: null })),
    ...folderRows.map((row) => ({ seq: row.changeSeq, design: null, folder: row, font: null })),
    ...fontRows.map((row) => ({ seq: row.changeSeq, design: null, folder: null, font: row })),
  ].sort((left, right) => (left.seq < right.seq ? -1 : left.seq > right.seq ? 1 : 0));
  const page = merged.slice(0, limit);
  const hasMore = merged.length > limit;
  const cursor = page.length > 0 ? Number(page[page.length - 1].seq) : Number(since);

  return {
    designs: await withThumbnailUrls(
      user.id,
      page.flatMap((entry) => (entry.design ? [toDesignHeader(entry.design)] : [])),
    ),
    folders: page.flatMap((entry) => (entry.folder ? [toFolderHeader(entry.folder)] : [])),
    fonts: await toFontHeaders(
      user.id,
      page.flatMap((entry) => (entry.font ? [entry.font] : [])),
    ),
    cursor,
    hasMore,
    storage: await getStorageSummary(user),
    reset: false,
  };
}

// ---- Read --------------------------------------------------------------------------------------

export async function getDesign(
  user: SyncUser,
  id: string,
): Promise<{ design: DesignHeader; data: string; media: MediaManifestEntry[] }> {
  if (!isValidSyncId(id)) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "Invalid design id.");
  }
  const row = await prisma.userDesign.findUnique({
    where: { mobileUserId_id: { mobileUserId: user.id, id } },
    select: { ...DESIGN_HEADER_SELECT, data: true },
  });
  if (!row) {
    throw new DesignSyncError(404, DesignSyncCodes.NOT_FOUND, "Design not found.");
  }
  if (row.purgedAt !== null || row.data === null) {
    throw new DesignSyncError(410, DesignSyncCodes.PURGED, "This design was deleted.", {
      design: toDesignHeader(row),
    });
  }
  const refs = await prisma.userDesignMedia.findMany({
    where: { mobileUserId: user.id, designId: id },
    select: { sha256: true },
  });
  const [design] = await withThumbnailUrls(user.id, [toDesignHeader(row)]);
  return {
    design,
    data: row.data,
    media: await buildMediaManifest(user.id, refs.map((ref) => ref.sha256)),
  };
}

// ---- Write -------------------------------------------------------------------------------------

type ParsedDesignWrite = {
  mutationId: string;
  name: string | null;
  clientCreatedAt: number | null;
  clientUpdatedAt: number | null;
  hasFolder: boolean;
  folderId: string | null;
  hasDeletedAt: boolean;
  deletedAt: number | null;
  schemaVersion: number;
  contentHash: string;
  baseContentHash: string | null;
  /** The document exactly as the app sent it (JSON text), or null for a header-only write. */
  data: string | null;
  jsonBytes: number;
  mediaHashes: string[];
  /** The preview rendered from [data]; null when the device sent none. Only with [data]. */
  thumbnailSha256: string | null;
};

function parseDesignWrite(body: Record<string, unknown>): ParsedDesignWrite {
  const mutationId = String(body.mutationId ?? "").trim();
  if (!isValidMutationId(mutationId)) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "mutationId is required.");
  }
  // ★The document travels as a JSON STRING, not a nested object: it is stored and handed back
  // byte for byte, so its hash is the same on every device, and it never passes through
  // JavaScript's number type on the way.
  const hasData = body.data !== undefined && body.data !== null;
  if (hasData && typeof body.data !== "string") {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "data must be the document as a JSON string.");
  }
  const documentText = hasData ? (body.data as string) : null;

  let jsonBytes = 0;
  let mediaHashes: string[] = [];
  const contentHash = String(body.contentHash ?? "").trim().toLowerCase();
  if (documentText !== null) {
    if (!isValidSha256(contentHash)) {
      throw new DesignSyncError(400, DesignSyncCodes.INVALID, "contentHash is required with data.");
    }
    jsonBytes = Buffer.byteLength(documentText, "utf8");
    if (jsonBytes > MAX_DESIGN_DOCUMENT_BYTES) {
      throw new DesignSyncError(413, DesignSyncCodes.TOO_LARGE, "The design document is too large to sync.", {
        maxBytes: MAX_DESIGN_DOCUMENT_BYTES,
      });
    }
    // The hash is the identity every conflict decision rests on: it must be of THESE bytes.
    if (createHash("sha256").update(documentText, "utf8").digest("hex") !== contentHash) {
      throw new DesignSyncError(400, DesignSyncCodes.INVALID, "contentHash does not match data.");
    }
    let document: unknown;
    try {
      document = JSON.parse(documentText);
    } catch {
      document = null;
    }
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new DesignSyncError(400, DesignSyncCodes.INVALID, "data must be a JSON object.");
    }
    const inspection = inspectPortableDocument(document);
    if (inspection.nonPortableUris.length > 0) {
      // A device path or content:// URI would open on no other device: refuse, do not store.
      throw new DesignSyncError(422, DesignSyncCodes.NON_PORTABLE, "The design references files only this device has.", {
        count: inspection.nonPortableUris.length,
      });
    }
    mediaHashes = inspection.mediaHashes;
  }

  // The preview travels with the document it was rendered from, never on its own: a header-only
  // write leaves it as it is.
  const thumbRaw = body.thumbnailSha256;
  const thumbnailSha256 =
    documentText === null || thumbRaw === null || thumbRaw === undefined || thumbRaw === ""
      ? null
      : String(thumbRaw).trim().toLowerCase();
  if (thumbnailSha256 !== null && !isValidSha256(thumbnailSha256)) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "thumbnailSha256 must be a SHA-256 hex string.");
  }
  // Linked like any media of the design: counted in its storage, kept while the design is, and
  // freed when a newer preview replaces it.
  if (thumbnailSha256 !== null && !mediaHashes.includes(thumbnailSha256)) {
    mediaHashes = [...mediaHashes, thumbnailSha256];
  }

  const baseRaw = body.baseContentHash;
  const baseContentHash =
    baseRaw === null || baseRaw === undefined || baseRaw === "" ? null : String(baseRaw).trim().toLowerCase();
  if (baseContentHash !== null && !isValidSha256(baseContentHash)) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "baseContentHash must be a SHA-256 hex string.");
  }

  const hasFolder = "folderId" in body;
  const folderRaw = body.folderId;
  const folderId = folderRaw === null || folderRaw === undefined || folderRaw === "" ? null : String(folderRaw);
  if (folderId !== null && !isValidSyncId(folderId)) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "Invalid folderId.");
  }

  const hasDeletedAt = "deletedAt" in body;
  const deletedAt = body.deletedAt === null || body.deletedAt === undefined ? null : toSafeInt(body.deletedAt);
  if (hasDeletedAt && body.deletedAt !== null && deletedAt === null) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "deletedAt must be epoch milliseconds or null.");
  }

  const name = "name" in body ? cleanName(body.name, MAX_DESIGN_NAME_LENGTH) : null;
  const schemaVersion = Math.max(1, toSafeInt(body.schemaVersion) ?? DESIGN_SCHEMA_VERSION);

  return {
    mutationId,
    name: name === "" ? null : name,
    clientCreatedAt: toSafeInt(body.clientCreatedAt),
    clientUpdatedAt: toSafeInt(body.clientUpdatedAt),
    hasFolder,
    folderId,
    hasDeletedAt,
    deletedAt,
    schemaVersion,
    contentHash: documentText !== null ? contentHash : "",
    baseContentHash,
    data: documentText,
    jsonBytes,
    mediaHashes,
    thumbnailSha256,
  };
}

/** A folder that does not exist, or was deleted, cannot hold a design: it lands in no folder. */
async function effectiveFolderId(
  tx: Prisma.TransactionClient,
  mobileUserId: string,
  folderId: string | null,
): Promise<string | null> {
  if (folderId === null) return null;
  const folder = await tx.userDesignFolder.findUnique({
    where: { mobileUserId_id: { mobileUserId, id: folderId } },
    select: { deletedAt: true },
  });
  return folder && folder.deletedAt === null ? folderId : null;
}

/** Every file the document references must already be in storage — a design never commits with holes. */
async function assertMediaReady(tx: Prisma.TransactionClient, mobileUserId: string, hashes: string[]): Promise<void> {
  if (hashes.length === 0) return;
  const ready = await tx.userMediaObject.findMany({
    where: { mobileUserId, sha256: { in: hashes }, status: "ready" },
    select: { sha256: true },
  });
  if (ready.length === hashes.length) return;
  const have = new Set(ready.map((row) => row.sha256));
  throw new DesignSyncError(422, DesignSyncCodes.MEDIA_MISSING, "Some of the design's files are not uploaded yet.", {
    sha256s: hashes.filter((hash) => !have.has(hash)),
  });
}

function headerFields(parsed: ParsedDesignWrite, folderId: string | null, wasTrashed: boolean) {
  const trashChange = parsed.hasDeletedAt
    ? parsed.deletedAt === null
      ? { deletedAt: null, trashedAt: null }
      : // Server time for the first move to the Trash; a repeated write does not restart the 30 days.
        { deletedAt: BigInt(parsed.deletedAt), ...(wasTrashed ? {} : { trashedAt: new Date() }) }
    : {};
  return {
    ...(parsed.name !== null ? { name: parsed.name } : {}),
    ...(parsed.clientUpdatedAt !== null ? { clientUpdatedAt: BigInt(parsed.clientUpdatedAt) } : {}),
    ...(parsed.hasFolder ? { folderId } : {}),
    ...trashChange,
    lastMutationId: parsed.mutationId,
  };
}

/**
 * Writes a design: the whole document, or (without `data`) only its header.
 * See writeDecision.ts for what is accepted, what is a conflict, and why.
 */
export async function putDesign(
  user: SyncUser,
  id: string,
  body: unknown,
): Promise<{ design: DesignHeader; storage: StorageSummary }> {
  if (!isValidSyncId(id)) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "Invalid design id.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "Invalid JSON body.");
  }
  const parsed = parseDesignWrite(body as Record<string, unknown>);
  const { limitBytes, tier } = await resolveStorageLimit(user);
  let droppedMedia: string[] = [];

  const header = await withLibraryLock(user.id, async (tx, nextSeq) => {
    const existing = await tx.userDesign.findUnique({
      where: { mobileUserId_id: { mobileUserId: user.id, id } },
      select: { ...DESIGN_HEADER_SELECT, lastMutationId: true, trashedAt: true },
    });
    const decision = decideDesignWrite(
      existing
        ? { contentHash: existing.contentHash, lastMutationId: existing.lastMutationId, purged: existing.purgedAt !== null }
        : null,
      {
        mutationId: parsed.mutationId,
        hasData: parsed.data !== null,
        contentHash: parsed.contentHash,
        baseContentHash: parsed.baseContentHash,
      },
    );

    switch (decision.kind) {
      case "missing":
        throw new DesignSyncError(404, DesignSyncCodes.NOT_FOUND, "Design not found.");
      case "gone":
        throw new DesignSyncError(410, DesignSyncCodes.PURGED, "This design was deleted.", {
          design: toDesignHeader(existing!),
        });
      case "conflict":
        throw new DesignSyncError(409, DesignSyncCodes.CONFLICT, "The design was changed on another device.", {
          design: toDesignHeader(existing!),
        });
      case "replay":
        return toDesignHeader(existing!);

      case "create": {
        if (parsed.name === null) {
          throw new DesignSyncError(400, DesignSyncCodes.INVALID, "name is required for a new design.");
        }
        // A new design is the one document write the quota can refuse: it adds to what is stored.
        // Updates, renames, Trash moves and deletes always go through — a full (or downgraded)
        // account must still be able to tidy up.
        const usedBytes = await computeUsedBytes(tx, user.id);
        if (usedBytes + parsed.jsonBytes > limitBytes) {
          throw new DesignSyncError(409, DesignSyncCodes.QUOTA_EXCEEDED, "Cloud storage is full.", {
            storage: { usedBytes, limitBytes, tier },
            neededBytes: parsed.jsonBytes,
          });
        }
        await assertMediaReady(tx, user.id, parsed.mediaHashes);
        const folderId = await effectiveFolderId(tx, user.id, parsed.folderId);
        const created = await tx.userDesign.create({
          data: {
            mobileUserId: user.id,
            id,
            name: parsed.name,
            data: parsed.data!,
            schemaVersion: parsed.schemaVersion,
            revision: 1,
            contentHash: parsed.contentHash,
            lastMutationId: parsed.mutationId,
            folderId,
            clientCreatedAt: BigInt(parsed.clientCreatedAt ?? parsed.clientUpdatedAt ?? 0),
            clientUpdatedAt: BigInt(parsed.clientUpdatedAt ?? parsed.clientCreatedAt ?? 0),
            deletedAt: parsed.deletedAt === null ? null : BigInt(parsed.deletedAt),
            trashedAt: parsed.deletedAt === null ? null : new Date(),
            jsonBytes: parsed.jsonBytes,
            thumbnailSha256: parsed.thumbnailSha256,
            changeSeq: nextSeq(),
          },
          select: DESIGN_HEADER_SELECT,
        });
        if (parsed.mediaHashes.length > 0) {
          await tx.userDesignMedia.createMany({
            data: parsed.mediaHashes.map((sha256) => ({ mobileUserId: user.id, designId: id, sha256 })),
          });
        }
        return toDesignHeader(created);
      }

      case "apply": {
        await assertMediaReady(tx, user.id, parsed.mediaHashes);
        const folderId = parsed.hasFolder ? await effectiveFolderId(tx, user.id, parsed.folderId) : null;
        const previous = await tx.userDesignMedia.findMany({
          where: { mobileUserId: user.id, designId: id },
          select: { sha256: true },
        });
        const keep = new Set(parsed.mediaHashes);
        droppedMedia = previous.map((row) => row.sha256).filter((sha256) => !keep.has(sha256));
        await tx.userDesignMedia.deleteMany({ where: { mobileUserId: user.id, designId: id } });
        if (parsed.mediaHashes.length > 0) {
          await tx.userDesignMedia.createMany({
            data: parsed.mediaHashes.map((sha256) => ({ mobileUserId: user.id, designId: id, sha256 })),
          });
        }
        const updated = await tx.userDesign.update({
          where: { mobileUserId_id: { mobileUserId: user.id, id } },
          data: {
            data: parsed.data!,
            schemaVersion: parsed.schemaVersion,
            contentHash: parsed.contentHash,
            jsonBytes: parsed.jsonBytes,
            thumbnailSha256: parsed.thumbnailSha256,
            revision: { increment: 1 },
            changeSeq: nextSeq(),
            ...headerFields(parsed, folderId, existing!.trashedAt !== null),
          },
          select: DESIGN_HEADER_SELECT,
        });
        return toDesignHeader(updated);
      }

      case "applyHeaderOnly": {
        const folderId = parsed.hasFolder ? await effectiveFolderId(tx, user.id, parsed.folderId) : null;
        const updated = await tx.userDesign.update({
          where: { mobileUserId_id: { mobileUserId: user.id, id } },
          data: {
            revision: { increment: 1 },
            changeSeq: nextSeq(),
            ...headerFields(parsed, folderId, existing!.trashedAt !== null),
          },
          select: DESIGN_HEADER_SELECT,
        });
        return toDesignHeader(updated);
      }
    }
  });

  // An edit that dropped a photo frees its space now, not after the grace period.
  await removeUnreferencedMedia(user.id, droppedMedia);
  const [signed] = await withThumbnailUrls(user.id, [header]);
  return { design: signed, storage: await getStorageSummary(user) };
}

/**
 * Deletes a design for good: «حذف نهائي» from the Trash on a device. Idempotent — a design the
 * server never held, or already purged, answers success, because the device's goal (it is gone)
 * already holds.
 */
export async function purgeDesign(
  user: SyncUser,
  id: string,
  mutationIdInput: unknown,
): Promise<{ design: DesignHeader | null; storage: StorageSummary }> {
  if (!isValidSyncId(id)) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "Invalid design id.");
  }
  const mutationId = isValidMutationId(mutationIdInput) ? mutationIdInput : null;
  let dropped: string[] = [];
  const header = await withLibraryLock(user.id, async (tx, nextSeq) => {
    const existing = await tx.userDesign.findUnique({
      where: { mobileUserId_id: { mobileUserId: user.id, id } },
      select: DESIGN_HEADER_SELECT,
    });
    if (!existing) return null;
    if (existing.purgedAt !== null) return toDesignHeader(existing);
    dropped = await purgeDesignsInLock(tx, nextSeq, user.id, [id], mutationId);
    const after = await tx.userDesign.findUnique({
      where: { mobileUserId_id: { mobileUserId: user.id, id } },
      select: DESIGN_HEADER_SELECT,
    });
    return after ? toDesignHeader(after) : null;
  });
  await removeUnreferencedMedia(user.id, dropped);
  return { design: header, storage: await getStorageSummary(user) };
}

// ---- Folders -----------------------------------------------------------------------------------

/**
 * Creates or updates a folder. Folders carry no content to lose, so this is plain last-writer-wins:
 * the name and colour that arrive last are the folder's. A folder deleted on another device stays
 * deleted (410) — the device drops its copy and its designs fall back to no folder. The one way
 * back is `revive: true`, sent by the device that deleted it when the user taps «تراجع»: an
 * explicit undo, never a stale device resurrecting a folder by renaming it.
 */
export async function putFolder(user: SyncUser, id: string, body: unknown): Promise<{ folder: FolderHeader }> {
  if (!isValidSyncId(id)) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "Invalid folder id.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "Invalid JSON body.");
  }
  const source = body as Record<string, unknown>;
  const mutationId = String(source.mutationId ?? "").trim();
  const name = cleanName(source.name, MAX_FOLDER_NAME_LENGTH);
  const colorKey = String(source.colorKey ?? "").trim().toLowerCase();
  if (!isValidMutationId(mutationId) || !name || !COLOR_KEY_PATTERN.test(colorKey)) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "mutationId, name and colorKey are required.");
  }
  const clientCreatedAt = BigInt(toSafeInt(source.clientCreatedAt) ?? 0);
  const clientUpdatedAt = BigInt(toSafeInt(source.clientUpdatedAt) ?? 0);

  const folder = await withLibraryLock(user.id, async (tx, nextSeq) => {
    const existing = await tx.userDesignFolder.findUnique({
      where: { mobileUserId_id: { mobileUserId: user.id, id } },
      select: { ...FOLDER_SELECT, lastMutationId: true },
    });
    if (existing && existing.lastMutationId === mutationId) return toFolderHeader(existing);
    const revive = source.revive === true;
    if (existing?.deletedAt && !revive) {
      throw new DesignSyncError(410, DesignSyncCodes.FOLDER_DELETED, "This folder was deleted.", {
        folder: toFolderHeader(existing),
      });
    }
    if (existing && !existing.deletedAt && existing.name === name && existing.colorKey === colorKey) {
      return toFolderHeader(existing);
    }
    const saved = existing
      ? await tx.userDesignFolder.update({
          where: { mobileUserId_id: { mobileUserId: user.id, id } },
          data: {
            name,
            colorKey,
            clientUpdatedAt,
            deletedAt: null,
            lastMutationId: mutationId,
            revision: { increment: 1 },
            changeSeq: nextSeq(),
          },
          select: FOLDER_SELECT,
        })
      : await tx.userDesignFolder.create({
          data: {
            mobileUserId: user.id,
            id,
            name,
            colorKey,
            clientCreatedAt,
            clientUpdatedAt,
            lastMutationId: mutationId,
            revision: 1,
            changeSeq: nextSeq(),
          },
          select: FOLDER_SELECT,
        });
    return toFolderHeader(saved);
  });
  return { folder };
}

/**
 * Deletes a folder ONLY. Its designs stay, in no folder — each is re-stamped so every device
 * learns of the move. (Deleting the designs with it is the device's own business: it trashes
 * them first, as ordinary design writes.)
 */
export async function deleteFolder(user: SyncUser, id: string, mutationIdInput: unknown): Promise<{ folder: FolderHeader | null }> {
  if (!isValidSyncId(id)) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "Invalid folder id.");
  }
  const mutationId = isValidMutationId(mutationIdInput) ? mutationIdInput : null;
  const folder = await withLibraryLock(user.id, async (tx, nextSeq) => {
    const existing = await tx.userDesignFolder.findUnique({
      where: { mobileUserId_id: { mobileUserId: user.id, id } },
      select: FOLDER_SELECT,
    });
    if (!existing) return null;
    if (existing.deletedAt) return toFolderHeader(existing);
    const members = await tx.userDesign.findMany({
      where: { mobileUserId: user.id, folderId: id },
      select: { id: true },
    });
    for (const member of members) {
      await tx.userDesign.update({
        where: { mobileUserId_id: { mobileUserId: user.id, id: member.id } },
        data: { folderId: null, revision: { increment: 1 }, changeSeq: nextSeq() },
      });
    }
    const deleted = await tx.userDesignFolder.update({
      where: { mobileUserId_id: { mobileUserId: user.id, id } },
      data: {
        deletedAt: new Date(),
        revision: { increment: 1 },
        changeSeq: nextSeq(),
        ...(mutationId ? { lastMutationId: mutationId } : {}),
      },
      select: FOLDER_SELECT,
    });
    return toFolderHeader(deleted);
  });
  return { folder };
}
