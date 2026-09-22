/**
 * Perceptual fingerprints for catalogue artwork.
 *
 * ★A plain byte hash is NOT enough here. Freepik resells the same artwork inside several icon
 * packs, so the identical-looking lantern arrives under two ids, from two uploaders, with two
 * different tag sets — and, because each pack was exported separately, usually as two files whose
 * bytes differ. Only a hash of what the image LOOKS like collapses those into one.
 *
 * dHash (difference hash): shrink to 9x8 greyscale, then record whether each pixel is brighter
 * than its right-hand neighbour. 64 bits, robust to re-compression and small palette shifts,
 * and cheap enough to run over a whole preview page.
 */

const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;
// Preview pages repeat heavily (same term, next page, back again), and thumbnails are immutable
// at their URL, so a process-lifetime cache turns almost every re-preview into zero fetches.
const MAX_CACHED_FINGERPRINTS = 4000;
const fingerprintCache = new Map();

let sharpPromise = null;

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

function rememberFingerprint(key, value) {
  if (!key) return value;
  if (fingerprintCache.size >= MAX_CACHED_FINGERPRINTS) {
    // Oldest insertion first — Map preserves insertion order.
    const oldest = fingerprintCache.keys().next().value;
    if (oldest !== undefined) fingerprintCache.delete(oldest);
  }
  fingerprintCache.set(key, value);
  return value;
}

/**
 * 64-bit dHash as 16 hex characters, or "" when the bytes cannot be decoded.
 *
 * Never throws: a fingerprint is an optimisation, and an un-decodable asset must still import.
 */
export async function fingerprintImageBytes(bytes) {
  if (!bytes?.length) return "";

  try {
    const sharp = await loadSharp();
    const raw = await sharp(bytes, { animated: false, limitInputPixels: false })
      // Flatten onto white: transparent artwork is most of this catalogue, and without a
      // known backdrop the alpha edges decode to arbitrary values and two exports of the
      // same icon stop matching.
      .flatten({ background: "#ffffff" })
      .greyscale()
      .resize(HASH_WIDTH, HASH_HEIGHT, { fit: "fill", kernel: "cubic" })
      .raw()
      .toBuffer();

    if (raw.length < HASH_WIDTH * HASH_HEIGHT) return "";

    let bits = "";
    for (let row = 0; row < HASH_HEIGHT; row += 1) {
      for (let column = 0; column < HASH_WIDTH - 1; column += 1) {
        const index = row * HASH_WIDTH + column;
        bits += raw[index] > raw[index + 1] ? "1" : "0";
      }
    }

    let hex = "";
    for (let offset = 0; offset < bits.length; offset += 4) {
      hex += Number.parseInt(bits.slice(offset, offset + 4), 2).toString(16);
    }
    return hex;
  } catch {
    return "";
  }
}

/** Fingerprints a remote thumbnail, memoised by URL. Returns "" on any failure. */
export async function fingerprintImageUrl(url, { timeoutMs = 8000 } = {}) {
  const key = String(url || "").trim();
  if (!key) return "";
  if (fingerprintCache.has(key)) return fingerprintCache.get(key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(key, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return rememberFingerprint(key, "");
    const bytes = Buffer.from(await response.arrayBuffer());
    return rememberFingerprint(key, await fingerprintImageBytes(bytes));
  } catch {
    // Do NOT cache a transient network failure as "no fingerprint" — the next preview retries.
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Drops later items whose artwork already appeared earlier in the same list.
 *
 * Fail-open by design: an item we could not fingerprint is always kept. Hiding an asset because
 * its thumbnail happened to 404 would be a far worse failure than showing a duplicate.
 */
export async function dedupeByArtwork(items, { getUrl, concurrency = 8 } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (list.length < 2) return { items: list, removed: 0 };

  const fingerprints = new Array(list.length).fill("");
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      fingerprints[index] = await fingerprintImageUrl(getUrl(list[index]));
    }
  });
  await Promise.all(workers);

  const seen = new Set();
  const kept = [];
  let removed = 0;
  list.forEach((item, index) => {
    const fingerprint = fingerprints[index];
    if (fingerprint && seen.has(fingerprint)) {
      removed += 1;
      return;
    }
    if (fingerprint) seen.add(fingerprint);
    kept.push(item);
  });

  return { items: kept, removed };
}
