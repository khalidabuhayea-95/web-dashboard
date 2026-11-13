import type { Prisma } from "@prisma/client";

import { db as prisma } from "./db";
import { resolveUserTier } from "@/lib/billing/subscriptionTier.server";
import { getMobileAppSettings } from "@/lib/settings/mobileAppSettings.server";

import { resolveDesignStorageLimitBytes } from "./config.js";

export type SyncDb = Prisma.TransactionClient | typeof prisma;

export type SyncUser = {
  id: string;
  subscriptionTier?: string | null;
  subscriptionExpiresAt?: Date | string | null;
};

export type StorageSummary = {
  usedBytes: number;
  limitBytes: number;
  /** "free" | "plus" | "pro" — the tier the limit was resolved for. */
  tier: string;
};

/**
 * What counts toward a user's cloud storage: EVERY media object they hold — pending uploads
 * included, so a client cannot park files it never references — plus the JSON of every design
 * that is not purged. A design in the Trash still counts; it is restorable.
 */
export async function computeUsedBytes(db: SyncDb, mobileUserId: string): Promise<number> {
  const media = await db.userMediaObject.aggregate({
    where: { mobileUserId },
    _sum: { sizeBytes: true },
  });
  const designs = await db.userDesign.aggregate({
    where: { mobileUserId, purgedAt: null },
    _sum: { jsonBytes: true },
  });
  return Number(media._sum.sizeBytes ?? 0) + Number(designs._sum.jsonBytes ?? 0);
}

/** The user's limit: their tier's entry in the dashboard-editable mobile app settings. */
export async function resolveStorageLimit(user: SyncUser): Promise<{ limitBytes: number; tier: string }> {
  const settings = await getMobileAppSettings();
  const tier = resolveUserTier(user);
  return { limitBytes: resolveDesignStorageLimitBytes(settings, tier), tier };
}

export async function getStorageSummary(user: SyncUser, db: SyncDb = prisma): Promise<StorageSummary> {
  const { limitBytes, tier } = await resolveStorageLimit(user);
  const usedBytes = await computeUsedBytes(db, user.id);
  return { usedBytes, limitBytes, tier };
}
