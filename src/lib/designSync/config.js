// Limits for cloud sync of user designs. Pure (no server imports): the settings module, the
// routes and the tests all read the same numbers from here.

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

export const DESIGN_STORAGE_TIERS = ["free", "plus", "pro"];

/** Cloud storage per subscription tier, in bytes. Editable from the dashboard (mobile app settings). */
export const DEFAULT_DESIGN_STORAGE_LIMITS = Object.freeze({
  free: 1 * GB,
  plus: 20 * GB,
  pro: 100 * GB,
});

/** No single media file larger than this is synced: a long 4K video fits, one file cannot fill an account. */
export const MAX_DESIGN_MEDIA_FILE_BYTES = 2 * GB;

/** Files above this go up in parts, each signed separately, and resume where a broken upload stopped. */
export const MULTIPART_THRESHOLD_BYTES = 32 * MB;

/** Size of every part but the last (storage requires >= 5 MB). 2 GB = 128 parts. */
export const MULTIPART_PART_BYTES = 16 * MB;

/**
 * How a file of [sizeBytes] is cut, or null when it goes up in one PUT.
 * @param {number} sizeBytes
 * @returns {{ partBytes: number, partCount: number } | null}
 */
export function multipartPlan(sizeBytes) {
  if (!(sizeBytes > MULTIPART_THRESHOLD_BYTES)) return null;
  return { partBytes: MULTIPART_PART_BYTES, partCount: Math.ceil(sizeBytes / MULTIPART_PART_BYTES) };
}

/**
 * The exact size of part [partNumber] (1-based) of a file of [sizeBytes] cut in [partBytes] pieces.
 * @param {number} sizeBytes
 * @param {number} partBytes
 * @param {number} partNumber
 */
export function expectedPartBytes(sizeBytes, partBytes, partNumber) {
  const start = (partNumber - 1) * partBytes;
  return Math.max(0, Math.min(partBytes, sizeBytes - start));
}

/** A design document (the JSON, not its media). Recoloured vectors travel inline, so this is roomy. */
export const MAX_DESIGN_DOCUMENT_BYTES = 8 * MB;

/** The document schema this server understands. A newer app may send a higher one; it is stored as is. */
export const DESIGN_SCHEMA_VERSION = 1;

/** How long a trashed design is kept before the server purges it. Mirrors the app's Trash. */
export const DESIGN_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** How long an uploaded file may sit unreferenced by any design before it is swept. */
export const UNREFERENCED_MEDIA_GRACE_MS = 24 * 60 * 60 * 1000;

const MAX_LIMIT_BYTES = 10 * 1024 * GB;

function normalizeLimit(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(MAX_LIMIT_BYTES, Math.floor(parsed));
}

/**
 * Always fully populated, so a caller never null-checks a partially saved blob.
 * @param {unknown} value
 * @returns {{ limitsBytes: { free: number, plus: number, pro: number } }}
 */
export function normalizeDesignStorageSettings(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const limits =
    source.limitsBytes && typeof source.limitsBytes === "object" && !Array.isArray(source.limitsBytes)
      ? source.limitsBytes
      : {};
  return {
    limitsBytes: {
      free: normalizeLimit(limits.free, DEFAULT_DESIGN_STORAGE_LIMITS.free),
      plus: normalizeLimit(limits.plus, DEFAULT_DESIGN_STORAGE_LIMITS.plus),
      pro: normalizeLimit(limits.pro, DEFAULT_DESIGN_STORAGE_LIMITS.pro),
    },
  };
}

/**
 * The storage limit for a tier. An unknown tier is treated as free — the gate is "is paid",
 * never equality with one paid tier name.
 * @param {unknown} settings mobile app settings (or their designStorage block)
 * @param {string} tier
 */
export function resolveDesignStorageLimitBytes(settings, tier) {
  const block =
    settings && typeof settings === "object" && "designStorage" in settings
      ? settings.designStorage
      : settings;
  const { limitsBytes } = normalizeDesignStorageSettings(block);
  return tier === "pro" ? limitsBytes.pro : tier === "plus" ? limitsBytes.plus : limitsBytes.free;
}
