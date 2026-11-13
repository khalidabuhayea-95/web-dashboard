// What a synced design document refers to. Pure: shared by the write path and its tests, and the
// counterpart of the app's DesignPortableJson (commonMain/features/sync/domain).
//
// A document travels in "portable" form. A file that lives on the device is written as
//   nayroz-cloud-media:///<sha256>.<ext>
// and uploaded separately; catalog/template media stays an absolute https URL or the relative
// `/api/storage/public/…` form. Anything else in a media field — an absolute device path, a
// content:// URI — would open on no other device, so the write is refused.

export const CLOUD_MEDIA_PREFIX = "nayroz-cloud-media:///";

const CLOUD_MEDIA_REF = /^nayroz-cloud-media:\/\/\/([a-f0-9]{64})(?:\.[A-Za-z0-9]{1,8})?$/;

export type PortableDocumentInspection = {
  /** Distinct media hashes the document references, in first-seen order. */
  mediaHashes: string[];
  /** Media-field values no other device could open (capped, for the error body). */
  nonPortableUris: string[];
};

/** A media reference field: `uri`, or any key ending in `Uri` — the app's own rule. */
function isMediaKey(key: string): boolean {
  return key === "uri" || key.endsWith("Uri");
}

function isPortableNonMediaValue(value: string): boolean {
  if (value === "") return true;
  if (value.startsWith("https://") || value.startsWith("http://")) return true;
  if (value.startsWith("data:")) return true;
  // Catalog media in its relative, origin-free form.
  if (value.startsWith("/api/")) return true;
  return false;
}

export function inspectPortableDocument(data: unknown): PortableDocumentInspection {
  const hashes = new Set<string>();
  const nonPortable: string[] = [];

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === "string") {
        if (!isMediaKey(key)) continue;
        const trimmed = value.trim();
        const match = CLOUD_MEDIA_REF.exec(trimmed);
        if (match) {
          hashes.add(match[1]);
        } else if (!isPortableNonMediaValue(trimmed)) {
          if (nonPortable.length < 5) nonPortable.push(trimmed.slice(0, 120));
        }
      } else {
        visit(value);
      }
    }
  };

  visit(data);
  return { mediaHashes: Array.from(hashes), nonPortableUris: nonPortable };
}
