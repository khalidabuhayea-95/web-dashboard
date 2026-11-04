/**
 * Text effects in the editor (the dashboard's "التأثيرات" catalog applied to a text layer).
 *
 * A layer stores only `textEffect: { effectId, overrides }` — the slug and the user's intensity /
 * colour — never the spec or the texture, so an admin re-tuning an effect updates every design
 * that uses it. The canvas paints the layer through the SHARED renderer
 * (lib/textEffects/applyTextEffect.ts), fed by the exact line layout Konva.Text would draw; every
 * export draws the same scene, so exports match the canvas by construction.
 *
 * v1 limits — these layers keep their plain fill: curved text, multi-style text whose ranges
 * change the layout (another font or size), and per-letter / per-word animated text.
 */
import Konva from "konva";
import { useEffect, useSyncExternalStore } from "react";

import { getCachedImage, preloadImage } from "@/lib/editor/imageCache";
import { applyTextEffect, type TextEffectLayout } from "@/lib/textEffects/applyTextEffect";

export type EditorTextEffectOverrides = {
  /** 0–1: how strongly the texture shows over the base colour. Default 1. */
  intensity?: number;
  /** The user's colour for a "bw" (greyscale) texture. */
  tintColor?: string;
};

export type EditorTextEffect = {
  /** The effect's slug (TextEffect.slug, the catalog item's `id`). */
  effectId: string;
  overrides?: EditorTextEffectOverrides;
};

/** One catalog entry, as `/api/editor/text-effects` serves it (serializeTextEffect's shape). */
export type TextEffectCatalogItem = {
  id: string;
  titleEn: string;
  titleAr: string;
  category: string;
  isPremium: boolean;
  previewUrl: string | null;
  textureUrl: string | null;
  textureVideoUrl: string | null;
  inlayTextureUrl?: string | null;
  spec: {
    fill?: {
      kind?: string;
      patternUrl?: string;
      texture?: { renderMode?: string; tint?: string; url?: string; videoUrl?: string };
    };
    inlay?: { enabled?: boolean; texture?: { url?: string } };
  } & Record<string, unknown>;
};

const isColor = (value: unknown): value is string =>
  typeof value === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(value.trim());

/** The stored field, cleaned: unknown keys dropped, intensity clamped, a bad colour removed. */
export function normalizeEditorTextEffect(value: unknown): EditorTextEffect | null {
  if (!value || typeof value !== "object") return null;
  const source = value as { effectId?: unknown; overrides?: unknown };
  const effectId = String(source.effectId || "").trim();
  if (!effectId) return null;
  const raw = (source.overrides && typeof source.overrides === "object" ? source.overrides : {}) as Record<string, unknown>;
  const overrides: EditorTextEffectOverrides = {};
  const intensity = Number(raw.intensity);
  if (Number.isFinite(intensity)) overrides.intensity = Math.max(0, Math.min(1, intensity));
  if (isColor(raw.tintColor)) overrides.tintColor = raw.tintColor.trim();
  return Object.keys(overrides).length ? { effectId, overrides } : { effectId };
}

// ---- the catalog: fetched once per page load, shared by every scene and the toolbar ----------

type CatalogSnapshot = ReadonlyMap<string, TextEffectCatalogItem> | null;

let catalog: CatalogSnapshot = null;
let catalogList: TextEffectCatalogItem[] = [];
let catalogLoad: Promise<CatalogSnapshot> | null = null;
const catalogListeners = new Set<() => void>();

/** Loads the published effects (once; a failed load can be retried by calling again). */
export function loadTextEffectCatalog(): Promise<CatalogSnapshot> {
  if (catalog) return Promise.resolve(catalog);
  if (catalogLoad) return catalogLoad;
  if (typeof window === "undefined") return Promise.resolve(null);
  catalogLoad = fetch("/api/editor/text-effects", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      const items = Array.isArray(payload?.effects) ? (payload.effects as TextEffectCatalogItem[]) : [];
      catalogList = items;
      catalog = new Map(items.map((item) => [item.id, item]));
      for (const item of items) {
        for (const url of [textureImageUrl(item), inlayTextureImageUrl(item)]) {
          if (url) void preloadImage(url, "anonymous");
        }
      }
      catalogListeners.forEach((listener) => listener());
      return catalog;
    })
    .catch(() => null)
    .finally(() => {
      catalogLoad = null;
    });
  return catalogLoad;
}

function subscribeCatalog(listener: () => void) {
  catalogListeners.add(listener);
  return () => {
    catalogListeners.delete(listener);
  };
}

/** The catalog by id, or null until it has loaded. Starts the load on first use. */
export function useTextEffectCatalog(): CatalogSnapshot {
  const snapshot = useSyncExternalStore(subscribeCatalog, () => catalog, () => null);
  useEffect(() => {
    void loadTextEffectCatalog();
  }, []);
  return snapshot;
}

/** The catalog in the admin's order (the strip order). */
export function useTextEffectCatalogList(): TextEffectCatalogItem[] {
  useSyncExternalStore(subscribeCatalog, () => catalog, () => null);
  useEffect(() => {
    void loadTextEffectCatalog();
  }, []);
  return catalogList;
}

export function getTextEffectCatalogItem(effectId: string | null | undefined) {
  return effectId && catalog ? catalog.get(effectId) || null : null;
}

// ---- textures -------------------------------------------------------------------------------

export function textureImageUrl(item: TextEffectCatalogItem | null | undefined) {
  if (!item || item.spec?.fill?.kind !== "texture") return "";
  return String(item.spec.fill.texture?.url || "").trim();
}

export function textureVideoUrl(item: TextEffectCatalogItem | null | undefined) {
  if (!item || item.spec?.fill?.kind !== "texture") return "";
  return String(item.spec.fill.texture?.videoUrl || "").trim();
}

/** The inlay's material image (e.g. diamond pavé), when the effect has an inlay. */
export function inlayTextureImageUrl(item: TextEffectCatalogItem | null | undefined) {
  if (!item || !item.spec?.inlay?.enabled) return "";
  return String(item.spec.inlay.texture?.url || "").trim();
}

function patternUrl(item: TextEffectCatalogItem) {
  return item.spec?.fill?.kind === "pattern" ? String(item.spec.fill.patternUrl || "").trim() : "";
}

/** Everything the paint needs is loaded (catalog entry + still texture / pattern). */
export async function ensureTextEffectAssets(effectId: string): Promise<TextEffectCatalogItem | null> {
  await loadTextEffectCatalog();
  const item = getTextEffectCatalogItem(effectId);
  if (!item) return null;
  await Promise.all(
    [textureImageUrl(item), patternUrl(item), inlayTextureImageUrl(item)]
      .filter(Boolean)
      .map((url) => preloadImage(url, "anonymous"))
  );
  return item;
}

/**
 * Whether a layer can be painted with its effect. Layers that cannot keep their plain fill (see
 * the module note) — the toolbar says so instead of offering a control that does nothing.
 */
export function textEffectUnsupportedReason(element: {
  textCurveEnabled?: boolean;
  textCurveAmount?: number;
  textCurveArcDegrees?: number;
  spansAffectLayout?: boolean;
}): "curved" | "mixed-layout" | null {
  const curved =
    Boolean(element.textCurveEnabled) &&
    (Math.abs(Number(element.textCurveAmount) || 0) > 0.5 || Math.abs(Number(element.textCurveArcDegrees) || 0) > 0.5);
  if (curved) return "curved";
  if (element.spansAffectLayout) return "mixed-layout";
  return null;
}

// ---- Konva.Text → the renderer's layout ------------------------------------------------------

/**
 * The lines exactly where Konva.Text's own `_sceneFunc` puts them: its wrapped `textArr`, its
 * padding / vertical align / align offsets and its baseline (alphabetic with the font-box centring
 * of Konva ≥ 10, or "middle" under legacy rendering). Justified lines are drawn start-aligned.
 */
export function konvaTextEffectLayout(node: Konva.Text): TextEffectLayout | null {
  const lines = node.textArr || [];
  if (!node.text() || !lines.length) return null;
  const padding = Number(node.padding()) || 0;
  const fontSize = Math.max(1, Number(node.fontSize()) || 1);
  const lineHeightPx = (Number(node.lineHeight()) || 1) * fontSize;
  const totalWidth = Number(node.width()) || 0;
  const direction = node.direction() === "rtl" ? "rtl" : "ltr";
  const align = node.align();
  const verticalAlign = node.verticalAlign();
  let alignY = 0;
  if (verticalAlign === "middle") alignY = (node.height() - lines.length * lineHeightPx - padding * 2) / 2;
  else if (verticalAlign === "bottom") alignY = node.height() - lines.length * lineHeightPx - padding * 2;

  const legacy = Boolean((Konva as unknown as { legacyTextRendering?: boolean }).legacyTextRendering);
  let firstBaseline = lineHeightPx / 2;
  let textBaseline: CanvasTextBaseline = "middle";
  if (!legacy) {
    const metrics = node.measureSize("M");
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
    firstBaseline = (ascent - descent) / 2 + lineHeightPx / 2;
    textBaseline = "alphabetic";
  }
  const font = node._getContextFont();
  const letterSpacing = Number(node.letterSpacing()) || 0;

  let minX = Infinity;
  let maxX = -Infinity;
  const runs = lines.map((line, index) => {
    const free = totalWidth - line.width - padding * 2;
    const offset =
      align === "right" || (align === "justify" && direction === "rtl")
        ? free
        : align === "center"
          ? free / 2
          : 0;
    const x = padding + offset;
    if (line.text) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + line.width);
    }
    return { text: line.text, x, y: alignY + padding + firstBaseline + index * lineHeightPx, font, letterSpacing };
  });
  if (!Number.isFinite(minX)) return null;
  return {
    runs,
    fontSize,
    direction,
    textBaseline,
    bounds: { x: minX, y: alignY + padding, width: Math.max(1, maxX - minX), height: lines.length * lineHeightPx },
  };
}

/**
 * Paints [node]'s text with [item]'s effect in place of Konva's own glyph pass. Returns false when
 * it painted nothing (no layout yet), so the caller can fall back to the plain text.
 */
export function paintTextEffectOnNode(
  context: Konva.Context,
  node: Konva.Text,
  item: TextEffectCatalogItem,
  effect: EditorTextEffect,
  video?: HTMLVideoElement | null
): boolean {
  const layout = konvaTextEffectLayout(node);
  if (!layout) return false;
  const kind = item.spec?.fill?.kind;
  const videoReady = Boolean(video && video.readyState >= 2 && video.videoWidth > 0);
  const still = kind === "texture" ? getCachedImage(textureImageUrl(item), "anonymous") : undefined;
  const pattern = kind === "pattern" ? getCachedImage(patternUrl(item), "anonymous") : undefined;
  const inlayUrl = inlayTextureImageUrl(item);
  const inlayTexture = inlayUrl ? getCachedImage(inlayUrl, "anonymous") : undefined;
  return applyTextEffect(
    context._context as CanvasRenderingContext2D,
    layout,
    {
      spec: item.spec,
      texture: videoReady ? video : still || null,
      pattern: pattern || null,
      inlayTexture: inlayTexture || null,
    },
    { intensity: effect.overrides?.intensity, tintColor: effect.overrides?.tintColor }
  );
}
