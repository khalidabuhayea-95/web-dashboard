import prisma from "@/lib/prisma";
import { createLogger } from "@/lib/logging/logger";
import {
  deleteObjects,
  getPublicStorageBucketName,
  parsePublicObjectKey,
} from "@/lib/storage/objectStorage.server";

const logger = createLogger("storage.assetReferences");

/**
 * Shared "is this object still in use?" check for delete paths.
 *
 * Storage objects are shared freely — the same Freepik image can back several imported rows,
 * and a template's `data` embeds whatever the designer dropped on the canvas. So a delete may
 * only remove an object once NOTHING left in the database points at it.
 *
 * REFERENCE_SOURCES is the safety boundary: every column anywhere that can hold a storage key
 * must be listed. Adding a new url-bearing column without adding it here turns live assets into
 * "orphans" that the next delete throws away. scripts/cleanup-orphan-media.ts keeps the same
 * list for its bulk sweep.
 *
 * Call this AFTER the owning row is deleted, so the row being removed does not count as a
 * reference to itself.
 */
const REFERENCE_SOURCES = [
  `SELECT 1 FROM "Template" WHERE POSITION($1 IN COALESCE("thumbnailDataUrl",'')) > 0
     OR POSITION($1 IN COALESCE("previewVideoUrl",'')) > 0
     OR POSITION($1 IN COALESCE("previewPosterUrl",'')) > 0
     OR POSITION($1 IN COALESCE("pageThumbnails"::text,'')) > 0
     OR POSITION($1 IN data::text) > 0`,
  `SELECT 1 FROM "TemplateRevision" WHERE POSITION($1 IN snapshot::text) > 0`,
  `SELECT 1 FROM editor_element_assets WHERE POSITION($1 IN COALESCE(asset_url,'')) > 0
     OR POSITION($1 IN COALESCE(thumbnail_url,'')) > 0
     OR POSITION($1 IN COALESCE(source_payload::text,'')) > 0`,
  `SELECT 1 FROM editor_background_assets WHERE POSITION($1 IN COALESCE(asset_url,'')) > 0
     OR POSITION($1 IN COALESCE(thumbnail_url,'')) > 0
     OR POSITION($1 IN COALESCE(source_payload::text,'')) > 0`,
  `SELECT 1 FROM "FontFile" WHERE POSITION($1 IN COALESCE("publicUrl",'')) > 0
     OR COALESCE("storagePath",'') = $1`,
  `SELECT 1 FROM "FontFamily" WHERE POSITION($1 IN COALESCE("previewImageUrl",'')) > 0
     OR POSITION($1 IN COALESCE("previewImageDarkUrl",'')) > 0`,
  `SELECT 1 FROM "AiTemplate" WHERE POSITION($1 IN COALESCE("beforeUrl",'')) > 0
     OR POSITION($1 IN COALESCE("afterUrl",'')) > 0
     OR POSITION($1 IN COALESCE("thumbUrl",'')) > 0`,
  `SELECT 1 FROM "MagicTool" WHERE POSITION($1 IN COALESCE("beforeUrl",'')) > 0
     OR POSITION($1 IN COALESCE("afterUrl",'')) > 0
     OR POSITION($1 IN COALESCE("thumbUrl",'')) > 0`,
  `SELECT 1 FROM "GalleryImage" WHERE POSITION($1 IN url) > 0`,
  `SELECT 1 FROM "TextEffect" WHERE POSITION($1 IN COALESCE("previewUrl",'')) > 0`,
  `SELECT 1 FROM "AppSetting" WHERE POSITION($1 IN value::text) > 0`,
  `SELECT 1 FROM "PushCampaign" WHERE POSITION($1 IN payload::text) > 0`,
  `SELECT 1 FROM "StoreNotification" WHERE POSITION($1 IN payload::text) > 0`,
];

export async function isStorageKeyReferenced(key) {
  const safeKey = String(key || "").trim();
  if (!safeKey) return true;

  const sql = `SELECT COUNT(*)::int AS count FROM (${REFERENCE_SOURCES.join(" UNION ALL ")}) refs`;
  const rows = await prisma.$queryRawUnsafe(sql, safeKey);
  return Number(rows?.[0]?.count || 0) > 0;
}

/**
 * Narrows `keys` to the ones nothing references any more. A key whose check throws is treated
 * as still referenced — leaving a stray object behind is recoverable, deleting a live one is not.
 */
export async function filterUnreferencedKeys(keys) {
  const unique = Array.from(
    new Set((Array.isArray(keys) ? keys : []).map((key) => String(key || "").trim()).filter(Boolean))
  );

  const deletable = [];
  for (const key of unique) {
    try {
      if (!(await isStorageKeyReferenced(key))) deletable.push(key);
    } catch (_error) {
      // Keep the object.
    }
  }
  return deletable;
}

/**
 * The one delete-side entry point: given the public URLs a row owned, remove every object
 * nothing else references. Call it AFTER the row is gone. Never throws — by then the delete
 * has happened, and a storage hiccup must not turn it into a reported failure; the stray is
 * recoverable via scripts/cleanup-orphan-media.ts.
 *
 * Also used on REPLACE: pass the previous URLs after a new upload has been written to the row,
 * and the superseded objects go away instead of piling up under fresh uuid keys.
 */
export async function deleteStorageForUrls(urls, context = {}) {
  const keys = Array.from(
    new Set(
      (Array.isArray(urls) ? urls : [])
        .map((url) => parsePublicObjectKey(String(url || "")))
        .filter(Boolean)
    )
  );
  if (keys.length === 0) return { requested: 0, deleted: 0 };

  try {
    const deletable = await filterUnreferencedKeys(keys);
    if (deletable.length > 0) {
      await deleteObjects(getPublicStorageBucketName(), deletable);
    }
    return { requested: keys.length, deleted: deletable.length };
  } catch (error) {
    logger.warn("Storage cleanup failed", {
      ...context,
      keys: keys.length,
      error: error instanceof Error ? error.message : String(error || ""),
    });
    return { requested: keys.length, deleted: 0 };
  }
}

/**
 * Bucket-aware variant for rows that record (bucket, key) directly — font files may live in a
 * non-public bucket, where a public URL does not exist to parse. Reference checks are by key.
 */
export async function deleteStorageObjects(items, context = {}) {
  const byBucket = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const bucket = String(item?.bucket || "").trim() || getPublicStorageBucketName();
    const key = String(item?.key || "").trim();
    if (!key) return;
    if (!byBucket.has(bucket)) byBucket.set(bucket, new Set());
    byBucket.get(bucket).add(key);
  });

  let requested = 0;
  let deleted = 0;
  for (const [bucket, keySet] of byBucket) {
    const keys = Array.from(keySet);
    requested += keys.length;
    try {
      const deletable = await filterUnreferencedKeys(keys);
      if (deletable.length > 0) await deleteObjects(bucket, deletable);
      deleted += deletable.length;
    } catch (error) {
      logger.warn("Storage cleanup failed", {
        ...context,
        bucket,
        keys: keys.length,
        error: error instanceof Error ? error.message : String(error || ""),
      });
    }
  }
  return { requested, deleted };
}
