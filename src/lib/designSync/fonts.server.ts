// The user's installed fonts, synced to every device of the account. A font is identified by its
// FILE ("font-<sha256>"): the same file imported on two devices is one font. Designs refer to a font
// by `fontName`, so that name travels exactly as the importing device recorded it.

import { db as prisma } from "./db";
import { DesignSyncCodes, DesignSyncError } from "./errors";
import { withLibraryLock } from "./library.server";
import { removeUnreferencedMedia, userMediaKey } from "./media.server";
import { createPrivateSignedDownloadUrl, getUserDesignsBucketName } from "@/lib/storage/objectStorage.server";
import type { SyncUser } from "./quota.server";
import { cleanName, isValidMutationId, isValidSha256 } from "./validation";

const MAX_FONT_NAME_LENGTH = 120;
/** A day: fonts download in the background of a sync, maybe long after the page was read. */
const FONT_URL_TTL_SECONDS = 24 * 60 * 60;

export type FontHeader = {
  id: string;
  fontName: string;
  displayName: string;
  sha256: string;
  sizeBytes: number;
  revision: number;
  changeSeq: number;
  deleted: boolean;
  /** A short-lived link to the font file; null for a deleted font. */
  downloadUrl: string | null;
};

export const FONT_SELECT = {
  id: true,
  fontName: true,
  displayName: true,
  sha256: true,
  sizeBytes: true,
  revision: true,
  changeSeq: true,
  deletedAt: true,
} as const;

export type FontRow = {
  id: string;
  fontName: string;
  displayName: string;
  sha256: string;
  sizeBytes: bigint;
  revision: number;
  changeSeq: bigint;
  deletedAt: Date | null;
};

export function fontIdFor(sha256: string): string {
  return `font-${sha256}`;
}

export async function toFontHeaders(mobileUserId: string, rows: FontRow[]): Promise<FontHeader[]> {
  const bucket = getUserDesignsBucketName();
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      fontName: row.fontName,
      displayName: row.displayName,
      sha256: row.sha256,
      sizeBytes: Number(row.sizeBytes),
      revision: row.revision,
      changeSeq: Number(row.changeSeq),
      deleted: row.deletedAt !== null,
      downloadUrl: row.deletedAt
        ? null
        : await createPrivateSignedDownloadUrl(bucket, userMediaKey(mobileUserId, row.sha256), FONT_URL_TTL_SECONDS),
    })),
  );
}

/**
 * Adds (or brings back) an installed font. Its file must already be uploaded and ready, like a
 * design's media. Idempotent: the same font sent twice, or by two devices, is one row.
 */
export async function putFont(user: SyncUser, id: string, body: unknown): Promise<{ font: FontHeader }> {
  const source = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const sha256 = String(source.sha256 ?? "").trim().toLowerCase();
  const mutationId = String(source.mutationId ?? "").trim();
  const fontName = cleanName(source.fontName, MAX_FONT_NAME_LENGTH);
  const displayName = cleanName(source.displayName, MAX_FONT_NAME_LENGTH) || fontName;
  if (!isValidSha256(sha256) || id !== fontIdFor(sha256)) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "A font's id is font-<sha256 of its file>.");
  }
  if (!isValidMutationId(mutationId) || !fontName) {
    throw new DesignSyncError(400, DesignSyncCodes.INVALID, "mutationId and fontName are required.");
  }

  const row = await withLibraryLock(user.id, async (tx, nextSeq) => {
    const media = await tx.userMediaObject.findUnique({
      where: { mobileUserId_sha256: { mobileUserId: user.id, sha256 } },
      select: { status: true, sizeBytes: true },
    });
    if (media?.status !== "ready") {
      throw new DesignSyncError(422, DesignSyncCodes.MEDIA_MISSING, "Upload the font file first.", { sha256s: [sha256] });
    }
    const existing = await tx.userFont.findUnique({
      where: { mobileUserId_id: { mobileUserId: user.id, id } },
      select: { ...FONT_SELECT, lastMutationId: true },
    });
    if (existing && (existing.lastMutationId === mutationId || existing.deletedAt === null)) return existing;
    return existing
      ? tx.userFont.update({
          where: { mobileUserId_id: { mobileUserId: user.id, id } },
          data: { deletedAt: null, fontName, displayName, lastMutationId: mutationId, revision: { increment: 1 }, changeSeq: nextSeq() },
          select: FONT_SELECT,
        })
      : tx.userFont.create({
          data: {
            mobileUserId: user.id,
            id,
            fontName,
            displayName,
            sha256,
            sizeBytes: media.sizeBytes,
            lastMutationId: mutationId,
            changeSeq: nextSeq(),
          },
          select: FONT_SELECT,
        });
  });
  const [font] = await toFontHeaders(user.id, [row]);
  return { font };
}

/** Removes a font from the account (a tombstone, so every device learns of it) and frees its file. */
export async function deleteFont(user: SyncUser, id: string, mutationIdInput: unknown): Promise<{ font: FontHeader | null }> {
  const mutationId = isValidMutationId(mutationIdInput) ? mutationIdInput : null;
  const row = await withLibraryLock(user.id, async (tx, nextSeq) => {
    const existing = await tx.userFont.findUnique({
      where: { mobileUserId_id: { mobileUserId: user.id, id } },
      select: FONT_SELECT,
    });
    if (!existing || existing.deletedAt) return existing;
    return tx.userFont.update({
      where: { mobileUserId_id: { mobileUserId: user.id, id } },
      data: { deletedAt: new Date(), revision: { increment: 1 }, changeSeq: nextSeq(), ...(mutationId ? { lastMutationId: mutationId } : {}) },
      select: FONT_SELECT,
    });
  });
  if (!row) return { font: null };
  await removeUnreferencedMedia(user.id, [row.sha256]);
  const [font] = await toFontHeaders(user.id, [row]);
  return { font };
}

export async function listFontRowsSince(mobileUserId: string, since: bigint, take: number): Promise<FontRow[]> {
  return prisma.userFont.findMany({
    where: { mobileUserId, changeSeq: { gt: since } },
    orderBy: { changeSeq: "asc" },
    take,
    select: FONT_SELECT,
  });
}
