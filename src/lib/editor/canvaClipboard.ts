/**
 * What Canva puts on the clipboard when an element is copied: ONE `text/html` entry holding
 * `<span data-canva-clipboard="…">`, a base64 of the UTF-16LE JSON of the copied elements — no
 * pixels. Each element has its box (top/left/width/height in the source design's px), an optional
 * rotation and, for photos, a media reference (`{"A?":"d","A":"<mediaId>","B":<version>}`) with the
 * rect the media is drawn in. Stock and uploaded photos are served from signed, expiring URLs that
 * cannot be rebuilt from the id, so the Canva Importer extension enriches the clipboard at copy
 * time with `<span data-nayroz-canva-media="…">`: a base64 JSON map of mediaId → the picture's
 * bytes (data URL) and size. Only Canva's own public CDN pattern remains as a fallback.
 */

export interface CanvaClipboardMediaRef {
  id: string;
  version: number;
}

export interface CanvaClipboardRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface CanvaClipboardElement {
  id: string;
  /** Canva's element kind tag: "I" = image, "J" = shape/frame with paths, "T"… = others. */
  kind: string;
  box: CanvaClipboardRect;
  rotation: number;
  media: CanvaClipboardMediaRef | null;
  /** Where the media is drawn, in the element's own units (see `unitsWidth/unitsHeight`). */
  drawRect: CanvaClipboardRect | null;
  /** The coordinate space of `drawRect`: the element box for photos, the path box for shapes. */
  unitsWidth: number;
  unitsHeight: number;
}

export interface CanvaClipboardPayload {
  designWidth: number;
  designHeight: number;
  elements: CanvaClipboardElement[];
}

export interface CanvaClipboardEmbeddedMedia {
  dataUrl: string;
  width: number;
  height: number;
  mimeType: string;
}

export const NAYROZ_CANVA_MEDIA_ATTRIBUTE = "data-nayroz-canva-media";

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Canva's base64 is of the UTF-16LE encoding of the JSON text. */
export function decodeCanvaClipboardBase64(encoded: string): string {
  const safe = String(encoded || "").trim();
  if (!safe) return "";
  let binary = "";
  try {
    binary = typeof atob === "function" ? atob(safe) : Buffer.from(safe, "base64").toString("binary");
  } catch {
    return "";
  }
  let text = "";
  for (let index = 0; index + 1 < binary.length; index += 2) {
    text += String.fromCharCode(binary.charCodeAt(index) | (binary.charCodeAt(index + 1) << 8));
  }
  return text;
}

function readAttribute(html: string, attribute: string): string {
  const match = new RegExp(`${attribute}="([^"]+)"`).exec(String(html || ""));
  return match ? match[1] : "";
}

function rectFrom(value: unknown): CanvaClipboardRect | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const width = num(record.D);
  const height = num(record.C);
  if (!(width > 0) || !(height > 0)) return null;
  return { top: num(record.A), left: num(record.B), width, height };
}

function mediaRefFrom(value: unknown): CanvaClipboardMediaRef | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record["A?"] !== "d") return null;
  const id = String(record.A || "").trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return null;
  return { id, version: Math.max(1, Math.round(num(record.B, 1))) };
}

/**
 * The media fill of an element, wherever Canva nests it: a photo keeps it at `a.B`
 * ({A: mediaRef, B: drawRect}); a shape/frame keeps it on one of its paths at `b[i].B.B`.
 */
function findMediaFill(element: Record<string, unknown>): {
  media: CanvaClipboardMediaRef;
  drawRect: CanvaClipboardRect | null;
  unitsWidth: number;
  unitsHeight: number;
} | null {
  const box = rectFrom(element);
  const content = element.a && typeof element.a === "object" ? (element.a as Record<string, unknown>) : null;
  const direct = content?.B && typeof content.B === "object" ? (content.B as Record<string, unknown>) : null;
  const directMedia = direct ? mediaRefFrom(direct.A) : null;
  if (directMedia) {
    return {
      media: directMedia,
      drawRect: rectFrom(direct?.B),
      unitsWidth: box?.width || 1,
      unitsHeight: box?.height || 1,
    };
  }
  const paths = Array.isArray(element.b) ? element.b : [];
  for (const path of paths) {
    if (!path || typeof path !== "object") continue;
    const fill = (path as Record<string, unknown>).B;
    const inner = fill && typeof fill === "object" ? ((fill as Record<string, unknown>).B as Record<string, unknown> | undefined) : undefined;
    const media = inner ? mediaRefFrom(inner.A) : null;
    if (!media) continue;
    const unitsWidth = num(content?.D, box?.width || 1);
    const unitsHeight = num(content?.C, box?.height || 1);
    return { media, drawRect: rectFrom(inner?.B), unitsWidth: unitsWidth || 1, unitsHeight: unitsHeight || 1 };
  }
  return null;
}

/** Canva's clipboard HTML → the copied elements, or null when it is not a Canva copy. */
export function parseCanvaClipboardHtml(html: string): CanvaClipboardPayload | null {
  const encoded = readAttribute(html, "data-canva-clipboard");
  if (!encoded) return null;
  const json = decodeCanvaClipboardBase64(encoded);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  const rawElements = Array.isArray(root.A) ? root.A : [];
  const elements: CanvaClipboardElement[] = [];
  rawElements.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const element = raw as Record<string, unknown>;
    const box = rectFrom(element);
    if (!box) return;
    const fill = findMediaFill(element);
    elements.push({
      id: String(element._ || `canva-${index + 1}`),
      kind: String(element["A?"] || ""),
      box,
      rotation: num(element.E),
      media: fill?.media || null,
      drawRect: fill?.drawRect || null,
      unitsWidth: fill?.unitsWidth || box.width,
      unitsHeight: fill?.unitsHeight || box.height,
    });
  });
  return {
    designWidth: num(root.B),
    designHeight: num(root.C),
    elements,
  };
}

/** The extension's enrichment: mediaId → picture. Empty when the extension did not run. */
export function parseEmbeddedCanvaMedia(html: string): Record<string, CanvaClipboardEmbeddedMedia> {
  const encoded = readAttribute(html, NAYROZ_CANVA_MEDIA_ATTRIBUTE);
  if (!encoded) return {};
  let json = "";
  try {
    json = typeof atob === "function" ? atob(encoded) : Buffer.from(encoded, "base64").toString("binary");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    try {
      parsed = JSON.parse(json);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object") return {};
  const result: Record<string, CanvaClipboardEmbeddedMedia> = {};
  Object.entries(parsed as Record<string, unknown>).forEach(([id, value]) => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const dataUrl = String(record.dataUrl || "");
    if (!dataUrl.startsWith("data:image/")) return;
    result[id] = {
      dataUrl,
      width: Math.max(0, Math.round(num(record.width))),
      height: Math.max(0, Math.round(num(record.height))),
      mimeType: String(record.mimeType || ""),
    };
  });
  return result;
}

/**
 * Canva's own public CDN for a media id (`/<last 5 of id>/<id>/<version>/s.jpg`). Only some
 * media live there — the rest are signed — so callers treat a failure as "not available".
 */
export function canvaPublicMediaUrl(media: CanvaClipboardMediaRef): string {
  const id = String(media.id || "");
  if (id.length < 6) return "";
  return `https://media-public.canva.com/${id.slice(-5)}/${id}/${Math.max(1, media.version)}/s.jpg`;
}

export interface CanvaPastePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

/**
 * Where a copied photo lands on our page: Canva's box scaled from its design to ours (a copy
 * between same-size designs lands exactly where it was), the picture cropped to what its box
 * showed — the draw rect ∩ the box, in the picture's own pixels — and the rotation kept.
 */
export function placeCanvaPastedImage({
  element,
  payload,
  pageWidth,
  pageHeight,
  sourceWidth,
  sourceHeight,
}: {
  element: CanvaClipboardElement;
  payload: Pick<CanvaClipboardPayload, "designWidth" | "designHeight">;
  pageWidth: number;
  pageHeight: number;
  sourceWidth: number;
  sourceHeight: number;
}): CanvaPastePlacement {
  const scale =
    payload.designWidth > 0 && payload.designHeight > 0
      ? Math.min(pageWidth / payload.designWidth, pageHeight / payload.designHeight)
      : 1;
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const width = Math.max(1, element.box.width * safeScale);
  const height = Math.max(1, element.box.height * safeScale);
  // Centre-anchored: Canva's top/left describe the un-rotated frame, and so does ours.
  const x = element.box.left * safeScale;
  const y = element.box.top * safeScale;

  const source = { width: Math.max(1, sourceWidth), height: Math.max(1, sourceHeight) };
  let crop = { x: 0, y: 0, width: source.width, height: source.height };
  if (element.drawRect) {
    // The box the draw rect lives in (the path box for a shape, the element box for a photo).
    const unitsWidth = Math.max(1, element.unitsWidth);
    const unitsHeight = Math.max(1, element.unitsHeight);
    const draw = element.drawRect;
    const left = Math.max(0, draw.left);
    const top = Math.max(0, draw.top);
    const right = Math.min(unitsWidth, draw.left + draw.width);
    const bottom = Math.min(unitsHeight, draw.top + draw.height);
    if (right - left > 0.5 && bottom - top > 0.5) {
      const sx = source.width / draw.width;
      const sy = source.height / draw.height;
      crop = {
        x: (left - draw.left) * sx,
        y: (top - draw.top) * sy,
        width: (right - left) * sx,
        height: (bottom - top) * sy,
      };
    }
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
    rotation: round(element.rotation || 0),
    cropX: round(crop.x),
    cropY: round(crop.y),
    cropWidth: round(crop.width),
    cropHeight: round(crop.height),
  };
}
