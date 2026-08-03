import { randomUUID } from "node:crypto";

import { toMobileProjectSlim } from "@/lib/templates/mobileProject";

// PSD → mobile-template converter.
//
// Strategy (hybrid):
//   • Text layers  -> editable Fabric text objects (re-typeable, with font name,
//     size, color, alignment extracted from the PSD type-tool data).
//   • Everything else (pixels, shapes, smart objects) -> the layer's rendered
//     pixels from ag-psd, encoded as a PNG data-URL Fabric image object placed at
//     the layer's bounds.
// The resulting Fabric objects are fed through the existing `toMobileProjectSlim`,
// which is the same converter that GET /api/mobile/templates/{id} uses, so the
// output is exactly the editor's mobile-layer format.
//
// This module is intentionally self-contained: it uploads nothing and touches no
// DB. Rasters are inlined as data URLs so the "does the converter work?" tool has
// no storage/lifecycle coupling. The real Freepik integration can later swap the
// data URLs for uploaded object-storage URLs.

type AnyLayer = Record<string, any>;

// ---- lazy native deps (match index.server.ts: never import at module eval) ----

let agPsdPromise: Promise<any> | null = null;
async function getAgPsd() {
  if (!agPsdPromise) {
    agPsdPromise = (async () => {
      // initialize-canvas wires ag-psd to the node `canvas` package so every
      // layer comes back with a rendered `.canvas`. Must run before readPsd.
      await import("ag-psd/initialize-canvas");
      return import("ag-psd");
    })();
  }
  return agPsdPromise;
}

let canvasLibPromise: Promise<{ createCanvas: any } | null> | null = null;
async function getCanvasLib() {
  if (!canvasLibPromise) {
    canvasLibPromise = import("canvas")
      .then((m: any) => ({ createCanvas: m.createCanvas }))
      .catch(() => null);
  }
  return canvasLibPromise;
}

// Cap inlined raster resolution so the JSON payload stays sane for a test tool.
const RASTER_MAX_EDGE = 1600;
const COMPOSITE_MAX_EDGE = 900;
// Guard against pathological PSDs with thousands of layers.
const MAX_EMITTED_LAYERS = 120;

// ---- small helpers ----

function num(value: any, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toDataUrl(buffer: Buffer, mime = "image/png"): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function clampByte(value: any): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(255, Math.round(n)));
}

// ag-psd text fillColor is typically { r, g, b } in 0-255. Returns an rgb()
// string that mobileProject's normalizeHex/rgbaToHexWithOpacity understands.
function fillColorToRgb(color: any): string | null {
  if (!color || typeof color !== "object") return null;
  const r = clampByte(color.r);
  const g = clampByte(color.g);
  const b = clampByte(color.b);
  if (r === null || g === null || b === null) return null;
  return `rgb(${r}, ${g}, ${b})`;
}

// ag-psd blend-mode name -> the css-ish token mobileProject.mapBlendMode expects.
const BLEND_MODE_MAP: Record<string, string> = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  colorDodge: "color-dodge",
  colorBurn: "color-burn",
  softLight: "soft-light",
  hardLight: "hard-light",
  difference: "difference",
  exclusion: "exclusion",
};

function mapPsdBlendMode(value: any): string | null {
  const key = String(value || "normal");
  const mapped = BLEND_MODE_MAP[key];
  if (!mapped || mapped === "source-over") return null;
  return mapped;
}

function normalizeJustification(value: any): string {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("center")) return "center";
  if (raw.includes("right")) return "right";
  if (raw.includes("justify")) return "justify";
  return "left";
}

// Resolve the effective type style, preferring the layer-level style and falling
// back to the first style run (some PSDs only populate the run).
function resolveTextStyle(text: AnyLayer): AnyLayer {
  const runStyle =
    Array.isArray(text?.styleRuns) && text.styleRuns.length ? text.styleRuns[0]?.style : null;
  return { ...(runStyle || {}), ...(text?.style || {}) };
}

// PSDs reference a font by its PostScript name (e.g. "Poppins-Bold", "ArialMT",
// "Montserrat-SemiBoldItalic"). Reduce it to a base family that matches the app's
// FontFamily catalog (whose keys drop spaces/case/hyphens), plus weight/slant.
// The catalog is name-based, so "Poppins-Bold" must become "Poppins" to resolve.
function parsePostScriptFontName(psName: string): { family: string; bold: boolean; italic: boolean } {
  const raw = String(psName || "").trim().replace(/^['"]+|['"]+$/g, "");
  if (!raw) return { family: "", bold: false, italic: false };
  const lower = raw.toLowerCase();
  const bold = /(bold|black|heavy|extrabold|ultrabold|semibold|demibold)/.test(lower);
  const italic = /(italic|oblique)/.test(lower);

  // "Family-Variant" → keep the part before the first hyphen (covers most
  // Google-Fonts-style PostScript names). Then drop a trailing foundry suffix
  // like "MT"/"PSMT" (Arial, Times) that carries no hyphen. Avoid stripping
  // glued weight tokens without a hyphen — "Display"/"Black"/"Condensed" are
  // often part of the real family (Playfair Display, Archivo Black).
  let family = raw;
  const dash = raw.indexOf("-");
  if (dash > 1) family = raw.slice(0, dash);
  family = family.replace(/(PSMT|MT)$/, "").trim();
  if (family.length < 2) family = raw;
  return { family, bold, italic };
}

// Draw a source canvas into a (possibly smaller) canvas and return a PNG data URL.
async function canvasToDataUrl(
  canvas: any,
  maxEdge: number
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (!canvas || !canvas.width || !canvas.height) return null;
  const width = Math.max(1, Math.round(canvas.width));
  const height = Math.max(1, Math.round(canvas.height));
  const longEdge = Math.max(width, height);

  if (longEdge <= maxEdge) {
    return { dataUrl: toDataUrl(canvas.toBuffer("image/png")), width, height };
  }

  const lib = await getCanvasLib();
  if (!lib?.createCanvas) {
    // No downscaler available — return full-res rather than nothing.
    return { dataUrl: toDataUrl(canvas.toBuffer("image/png")), width, height };
  }
  const scale = maxEdge / longEdge;
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  const scaled = lib.createCanvas(targetW, targetH);
  const ctx = scaled.getContext("2d");
  ctx.drawImage(canvas, 0, 0, targetW, targetH);
  return { dataUrl: toDataUrl(scaled.toBuffer("image/png")), width: targetW, height: targetH };
}

function layerHasEffects(layer: AnyLayer): boolean {
  const fx = layer?.effects;
  if (!fx || typeof fx !== "object") return false;
  // ag-psd exposes an `effects` object with per-effect entries; treat any
  // non-disabled entry as present. (Effects are NOT baked into layer pixels.)
  return Object.entries(fx).some(([key, value]) => {
    if (key === "scale") return false;
    if (Array.isArray(value)) return value.some((entry) => entry && entry.enabled !== false);
    return Boolean(value) && (value as any).enabled !== false;
  });
}

function layerIsVector(layer: AnyLayer): boolean {
  return Boolean(layer?.vectorMask || layer?.vectorFill || layer?.vectorStroke || layer?.vectorOrigination);
}

// ---- types ----

export type PsdSourceLayer = {
  index: number;
  kind: "text" | "image";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  blendMode: string | null;
  hasEffects: boolean;
  hasMask: boolean;
  // text-only
  text?: string;
  fontName?: string;
  fontPostScript?: string;
  fontSize?: number;
  colorHex?: string;
  alignment?: string;
};

export type PsdConversionStats = {
  docWidth: number;
  docHeight: number;
  totalLeafLayers: number;
  emitted: number;
  textCount: number;
  imageCount: number;
  groups: number;
  skippedHidden: number;
  skippedEmpty: number;
  layersWithEffects: number;
  layersWithMask: number;
  vectorLayersRasterized: number;
  fontsUsed: string[];
  truncated: boolean;
};

export type PsdConversionResult = {
  name: string;
  docWidth: number;
  docHeight: number;
  // Raw Fabric document (objects carry data-URL rasters) — used by the import
  // path to persist a template. The preview API strips this to avoid doubling
  // the payload (the same data URLs are already in `project.layers`).
  fabricData: { version: string; background: any; objects: any[] };
  project: { canvasWidth: number; canvasHeight: number; background: any; layers: any[] };
  composite: string | null;
  sourceLayers: PsdSourceLayer[];
  stats: PsdConversionStats;
  warnings: string[];
};

// ---- core conversion ----

export async function convertPsdToMobileProject(
  buffer: Buffer,
  options: { name?: string } = {}
): Promise<PsdConversionResult> {
  const { readPsd, getCompositeCanvas } = await getAgPsd();

  const psd = readPsd(buffer, {
    skipLayerImageData: false,
    skipCompositeImageData: false,
    skipThumbnail: true,
    useImageData: false,
  });

  const docWidth = Math.max(1, Math.round(num(psd.width, 1)));
  const docHeight = Math.max(1, Math.round(num(psd.height, 1)));

  const stats: PsdConversionStats = {
    docWidth,
    docHeight,
    totalLeafLayers: 0,
    emitted: 0,
    textCount: 0,
    imageCount: 0,
    groups: 0,
    skippedHidden: 0,
    skippedEmpty: 0,
    layersWithEffects: 0,
    layersWithMask: 0,
    vectorLayersRasterized: 0,
    fontsUsed: [],
    truncated: false,
  };
  const fontsSet = new Set<string>();
  const objects: AnyLayer[] = [];
  const sourceLayers: PsdSourceLayer[] = [];

  // Flatten the PSD layer tree depth-first. ag-psd preserves the file's storage
  // order (bottom → top), so pushing in natural order makes array index == zIndex
  // with later objects painted on top — matching the Fabric/mobile convention.
  // (If a test file ever renders inverted, reverse `objects`/`sourceLayers`
  // before mapping.)
  async function walk(layers: AnyLayer[], ctx: { hidden: boolean; opacity: number }) {
    for (const layer of Array.isArray(layers) ? layers : []) {
      if (objects.length >= MAX_EMITTED_LAYERS) {
        stats.truncated = true;
        return;
      }

      const effHidden = ctx.hidden || Boolean(layer?.hidden);
      const rawOpacity = typeof layer?.opacity === "number" ? layer.opacity : 1;
      const effOpacity = Math.max(0, Math.min(1, ctx.opacity * rawOpacity));

      // Group / folder — recurse, folding hidden + opacity into descendants.
      if (Array.isArray(layer?.children) && layer.children.length > 0) {
        stats.groups += 1;
        await walk(layer.children, { hidden: effHidden, opacity: effOpacity });
        continue;
      }

      stats.totalLeafLayers += 1;

      if (effHidden) {
        stats.skippedHidden += 1;
        continue;
      }

      const isText = Boolean(layer?.text && typeof layer.text.text === "string");
      const left = Math.round(num(layer?.left, 0));
      const top = Math.round(num(layer?.top, 0));
      const right = Math.round(num(layer?.right, left));
      const bottom = Math.round(num(layer?.bottom, top));
      const boundsW = Math.max(0, right - left);
      const boundsH = Math.max(0, bottom - top);

      const hasEffects = layerHasEffects(layer);
      const hasMask = Boolean(layer?.mask || layer?.clipping);
      if (hasEffects) stats.layersWithEffects += 1;
      if (hasMask) stats.layersWithMask += 1;

      const index = objects.length;
      const id = `psd-layer-${index}`;

      if (isText) {
        const text = String(layer.text.text || "").replace(/\r\n?/g, "\n").replace(/\u0003/g, "\n");
        const style = resolveTextStyle(layer.text);
        const transform = Array.isArray(layer.text.transform) ? layer.text.transform : [1, 0, 0, 1, 0, 0];
        const scaleY = Math.hypot(num(transform[2], 0), num(transform[3], 1)) || 1;
        const angle = (Math.atan2(num(transform[1], 0), num(transform[0], 1)) * 180) / Math.PI;

        const rawFontName = String(style?.font?.name || "").trim();
        const parsedFont = parsePostScriptFontName(rawFontName);
        const fontFamily = parsedFont.family || "Arial";
        const lineCount = Math.max(1, text.split("\n").length);
        const rawSize = num(style?.fontSize, 0);
        const fontSize = rawSize > 0 ? rawSize * scaleY : Math.max(8, Math.round(boundsH / lineCount));
        const colorRgb = fillColorToRgb(style?.fillColor);
        const alignment = normalizeJustification(
          layer.text?.paragraphStyle?.justification ??
            layer.text?.paragraphStyleRuns?.[0]?.style?.justification
        );
        const bold = parsedFont.bold || Boolean(style?.fauxBold);
        const italic = parsedFont.italic || Boolean(style?.fauxItalic);
        const leading = num(style?.leading, 0);
        const lineHeight = leading > 0 && rawSize > 0 ? leading / rawSize : undefined;

        if (fontFamily) fontsSet.add(fontFamily);

        objects.push({
          id,
          type: "textbox",
          layerType: "text",
          left,
          top,
          width: Math.max(1, boundsW),
          height: Math.max(1, boundsH),
          scaleX: 1,
          scaleY: 1,
          angle,
          originX: "left",
          originY: "top",
          opacity: effOpacity,
          text,
          fontFamily,
          fontName: fontFamily,
          fontSize,
          fill: colorRgb || "#000000",
          textAlign: alignment,
          fontWeight: bold ? "bold" : "normal",
          fontStyle: italic ? "italic" : "normal",
          ...(lineHeight ? { lineHeight } : {}),
        });

        stats.emitted += 1;
        stats.textCount += 1;
        sourceLayers.push({
          index,
          kind: "text",
          name: String(layer?.name || `Text ${index}`),
          x: left,
          y: top,
          width: boundsW,
          height: boundsH,
          opacity: effOpacity,
          blendMode: mapPsdBlendMode(layer?.blendMode),
          hasEffects,
          hasMask,
          text,
          fontName: fontFamily,
          fontPostScript: rawFontName || undefined,
          fontSize: Math.round(fontSize),
          colorHex: colorRgb || undefined,
          alignment,
        });
        continue;
      }

      // Non-text: rasterize the layer's rendered pixels.
      if (!layer?.canvas || boundsW < 1 || boundsH < 1) {
        stats.skippedEmpty += 1;
        continue;
      }
      if (layerIsVector(layer)) stats.vectorLayersRasterized += 1;

      const encoded = await canvasToDataUrl(layer.canvas, RASTER_MAX_EDGE);
      if (!encoded) {
        stats.skippedEmpty += 1;
        continue;
      }

      const blendMode = mapPsdBlendMode(layer?.blendMode);
      objects.push({
        id,
        type: "image",
        layerType: "image",
        left,
        top,
        width: Math.max(1, boundsW),
        height: Math.max(1, boundsH),
        scaleX: 1,
        scaleY: 1,
        angle: 0,
        originX: "left",
        originY: "top",
        opacity: effOpacity,
        src: encoded.dataUrl,
        sourceWidth: encoded.width,
        sourceHeight: encoded.height,
        sourceHasAlpha: true,
        ...(blendMode ? { mediaBlendMode: blendMode } : {}),
      });

      stats.emitted += 1;
      stats.imageCount += 1;
      sourceLayers.push({
        index,
        kind: "image",
        name: String(layer?.name || `Layer ${index}`),
        x: left,
        y: top,
        width: boundsW,
        height: boundsH,
        opacity: effOpacity,
        blendMode,
        hasEffects,
        hasMask,
      });
    }
  }

  await walk(psd.children || [], { hidden: false, opacity: 1 });

  stats.fontsUsed = Array.from(fontsSet).sort();

  const fabricData = {
    version: "7.0.0",
    background: { type: "color", color: "#FFFFFF" },
    objects,
  };

  const syntheticTemplate = {
    id: `psd-${randomUUID()}`,
    name: options.name || String(psd.name || "").trim() || "Imported PSD",
    version: 1,
    canvasSize: { width: docWidth, height: docHeight },
    category: "general",
    subCategory: "general",
    data: fabricData,
  };

  const project = toMobileProjectSlim(syntheticTemplate, { fabricData });

  const compositeSource = psd.canvas || (typeof getCompositeCanvas === "function" ? getCompositeCanvas(psd) : null);
  const composite = await canvasToDataUrl(compositeSource, COMPOSITE_MAX_EDGE);

  const warnings = buildWarnings(stats);

  return {
    name: syntheticTemplate.name,
    docWidth,
    docHeight,
    fabricData,
    project,
    composite: composite?.dataUrl || null,
    sourceLayers,
    stats,
    warnings,
  };
}

function buildWarnings(stats: PsdConversionStats): string[] {
  const warnings: string[] = [];
  if (stats.emitted === 0) {
    warnings.push("No visible layers were extracted. The PSD may be a single flattened image or fully hidden.");
  }
  if (stats.fontsUsed.length > 0) {
    warnings.push(
      `Fonts are matched to your catalog by family name (PSDs don't embed font files). See the font list below for which resolve vs. are missing.`
    );
  }
  if (stats.layersWithEffects > 0) {
    warnings.push(
      `${stats.layersWithEffects} layer(s) use Photoshop effects (drop shadow, glow, stroke). These are NOT baked into the layer pixels, so appearance may differ from the composite.`
    );
  }
  if (stats.layersWithMask > 0) {
    warnings.push(
      `${stats.layersWithMask} layer(s) use masks/clipping; rendering uses Photoshop's rasterized pixels for those layers.`
    );
  }
  if (stats.vectorLayersRasterized > 0) {
    warnings.push(
      `${stats.vectorLayersRasterized} vector/shape layer(s) were rasterized to PNG (not re-editable as vectors).`
    );
  }
  if (stats.truncated) {
    warnings.push(
      `Layer count exceeded the ${MAX_EMITTED_LAYERS}-layer cap; extra layers were skipped. Deeply layered PSDs may need flattening first.`
    );
  }
  return warnings;
}
