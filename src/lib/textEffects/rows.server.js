import {
  restorePublicObjectUrlFromClient,
  rewritePublicObjectUrlForClient,
} from "@/lib/storage/objectStorage.server";

const URL_COLUMNS = ["previewUrl", "textureUrl", "textureVideoUrl", "inlayTextureUrl"];

/**
 * A TextEffect row with its R2 files moved behind the same-origin storage proxy.
 * R2 sends no CORS headers, so a canvas that draws a texture straight from R2 is
 * tainted — the preview can't save a thumbnail and the editor can't export. The
 * mobile API keeps the absolute URLs (no canvas, no CORS there).
 */
export function textEffectRowForBrowser(row) {
  if (!row) return row;
  const next = { ...row };
  for (const column of URL_COLUMNS) {
    if (next[column]) next[column] = rewritePublicObjectUrlForClient(next[column]);
  }
  const fill = next.spec && typeof next.spec === "object" ? next.spec.fill : null;
  if (fill && typeof fill.patternUrl === "string" && fill.patternUrl) {
    next.spec = { ...next.spec, fill: { ...fill, patternUrl: rewritePublicObjectUrlForClient(fill.patternUrl) } };
  }
  return next;
}

/** The inverse, for a URL a browser client sends back. */
export function textEffectUrlFromBrowser(value) {
  return restorePublicObjectUrlFromClient(value);
}

/** A spec a browser client sends back: its proxied pattern URL restored, so the row keeps R2's. */
export function textEffectSpecFromBrowser(spec) {
  const fill = spec && typeof spec === "object" ? spec.fill : null;
  if (!fill || typeof fill.patternUrl !== "string" || !fill.patternUrl) return spec;
  return { ...spec, fill: { ...fill, patternUrl: restorePublicObjectUrlFromClient(fill.patternUrl) } };
}
