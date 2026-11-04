// The text-effect contract: one declarative description of how a text layer is
// painted, rendered natively by the web editor (canvas/Konva) and the mobile
// app (Compose).
//
// Why declarative and not a generated image: the effect has to survive the user
// editing the words afterwards. A baked picture cannot; a fill description can.
// It is also free and instant, which an image generation is not.
//
// CHANGING THIS SHAPE IS A CONTRACT CHANGE. Old app builds will render whatever
// they understand and ignore the rest, so add fields, never repurpose them.
//
// Layer order, painted bottom to top — the same order both platforms must use:
//   shadow  → soft dark copy offset behind the glyphs
//   stroke  → outline drawn under the fill, so it reads as a border
//   fill    → the material itself (gradient bands, a tiled pattern, or a texture
//             image/clip cover-fitted to the text and blended over `fill.color`)
//   bevel   → light rim on the top-left edges, dark rim on the bottom-right
//   sheen   → thin bright rim along the top edge, clipped to the glyphs
//   inlay   → optional second material set INSIDE the glyphs (e.g. diamond pavé in a
//             gold rim): the layers above become the rim — grown outward by
//             `inlay.outset` — and the inlay fills the glyphs shrunk by `inlay.inset`,
//             with a recessed inner shadow and optional sparkles. Its image lives on
//             the row (`inlayTextureUrl`), like the main texture.
//
// Metal reads as metal because of NARROW ALTERNATING BANDS, not one soft ramp:
// a two-stop gold gradient always looks like coloured plastic. Presets below
// keep 7–9 stops for that reason.
//
// The `texture` kind is Andalusi's model: a ready-made material image is clipped to
// the glyphs and blended (normal / multiply / screen / overlay…) over the base colour.
// A "bw" texture is greyscale and takes the user's tint. The image itself lives on the
// row (`textureUrl` / `textureVideoUrl`), never in the spec; serializeTextEffect()
// copies it into `fill.texture` for clients.

export const TEXT_EFFECT_FILL_KINDS = ["gradient", "solid", "pattern", "texture"];

// Canvas compositing names, which are also the names both platforms map from.
export const TEXT_EFFECT_BLEND_MODES = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "hard-light",
  "color-dodge",
  "color-burn",
  "darken",
  "lighten",
  "luminosity",
  "color",
];

// Authoring aliases (Andalusi's asset feed says "multiplyBlendMode", designers say "normal").
const BLEND_MODE_ALIASES = {
  normal: "source-over",
  multiplyblendmode: "multiply",
  screenblendmode: "screen",
  overlayblendmode: "overlay",
  softlightblendmode: "soft-light",
  hardlightblendmode: "hard-light",
};

export const TEXT_EFFECT_RENDER_MODES = ["color", "bw"];

// Suggested categories for the strip's filter chips. Free text is allowed; these are
// what the dashboard offers first.
export const TEXT_EFFECT_CATEGORIES = [
  { value: "gold", labelAr: "ذهبي", labelEn: "Gold" },
  { value: "silver", labelAr: "فضي", labelEn: "Silver" },
  { value: "glass", labelAr: "زجاج", labelEn: "Glass" },
  { value: "threads", labelAr: "خيوط", labelEn: "Threads" },
  { value: "marble", labelAr: "رخام", labelEn: "Marble" },
  { value: "glitter", labelAr: "لمعة", labelEn: "Glitter" },
  { value: "gems", labelAr: "أحجار كريمة", labelEn: "Gems" },
  { value: "neon", labelAr: "نيون", labelEn: "Neon" },
  { value: "shadow", labelAr: "ظل", labelEn: "Shadow" },
];

export const MAX_TEXT_EFFECT_CATEGORY_LENGTH = 40;

export const MAX_TEXT_EFFECT_STOPS = 24;
export const MAX_TEXT_EFFECT_TITLE_LENGTH = 80;

const CLAMP = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const isColor = (value) =>
  typeof value === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(value.trim());

export function normalizeTextEffectBlendMode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (TEXT_EFFECT_BLEND_MODES.includes(raw)) return raw;
  return BLEND_MODE_ALIASES[raw.replace(/[\s_-]/g, "")] || "source-over";
}

export function normalizeTextEffectCategory(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TEXT_EFFECT_CATEGORY_LENGTH);
}

/**
 * Fills every optional field so renderers never null-check, and drops anything
 * malformed rather than throwing — a bad stored spec should degrade to plain
 * text, not break the canvas.
 */
export function normalizeTextEffectSpec(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const fillSource = source.fill && typeof source.fill === "object" ? source.fill : {};

  const kind = TEXT_EFFECT_FILL_KINDS.includes(fillSource.kind) ? fillSource.kind : "gradient";

  const stops = Array.isArray(fillSource.stops)
    ? fillSource.stops
        .map((stop) => {
          if (!Array.isArray(stop) || stop.length < 2) return null;
          const offset = CLAMP(stop[0], 0, 1, null);
          if (offset === null || !isColor(stop[1])) return null;
          return [offset, String(stop[1]).trim()];
        })
        .filter(Boolean)
        .slice(0, MAX_TEXT_EFFECT_STOPS)
        .sort((a, b) => a[0] - b[0])
    : [];

  const fill = {
    kind,
    // 90 = top-to-bottom, the natural direction for metal banding.
    angle: CLAMP(fillSource.angle, 0, 360, 90),
    color: isColor(fillSource.color) ? fillSource.color.trim() : "#111111",
    stops: stops.length >= 2 ? stops : [],
    patternUrl: typeof fillSource.patternUrl === "string" ? fillSource.patternUrl.trim() : "",
    // Texture tiles are authored at some natural size; scale adapts them to the
    // glyph height rather than forcing one font size.
    patternScale: CLAMP(fillSource.patternScale, 0.05, 8, 1),
    texture: normalizeTexture(fillSource.texture),
  };
  // A gradient with too few usable stops is not a gradient; fall back to solid
  // so the layer still paints something deliberate.
  if (fill.kind === "gradient" && !fill.stops.length) fill.kind = "solid";
  if (fill.kind === "pattern" && !fill.patternUrl) fill.kind = "solid";

  const strokeSource = source.stroke && typeof source.stroke === "object" ? source.stroke : {};
  const stroke = {
    // Width is a FRACTION of font size, not pixels — the effect has to look the
    // same at 40px on a phone and 400px on a poster.
    width: CLAMP(strokeSource.width, 0, 0.5, 0),
    color: isColor(strokeSource.color) ? strokeSource.color.trim() : "#000000",
  };

  const shadowSource = source.shadow && typeof source.shadow === "object" ? source.shadow : {};
  const shadow = {
    color: isColor(shadowSource.color) ? shadowSource.color.trim() : "rgba(0,0,0,0.45)",
    blur: CLAMP(shadowSource.blur, 0, 1, 0),
    offsetX: CLAMP(shadowSource.offsetX, -1, 1, 0),
    offsetY: CLAMP(shadowSource.offsetY, -1, 1, 0),
    enabled: Boolean(shadowSource.enabled),
  };

  const sheenSource = source.sheen && typeof source.sheen === "object" ? source.sheen : {};
  const sheen = {
    enabled: Boolean(sheenSource.enabled),
    color: isColor(sheenSource.color) ? sheenSource.color.trim() : "rgba(255,255,255,0.55)",
    width: CLAMP(sheenSource.width, 0, 0.2, 0.016),
    offsetY: CLAMP(sheenSource.offsetY, -0.5, 0.5, -0.016),
  };

  const bevelSource = source.bevel && typeof source.bevel === "object" ? source.bevel : {};
  const bevel = {
    enabled: Boolean(bevelSource.enabled),
    // Rim thickness as a fraction of font size; softness blurs it by up to that much.
    depth: CLAMP(bevelSource.depth, 0, 0.12, 0.025),
    softness: CLAMP(bevelSource.softness, 0, 1, 0.5),
    light: isColor(bevelSource.light) ? bevelSource.light.trim() : "rgba(255,255,255,0.65)",
    dark: isColor(bevelSource.dark) ? bevelSource.dark.trim() : "rgba(0,0,0,0.35)",
  };

  return { version: 1, fill, stroke, shadow, sheen, bevel, inlay: normalizeInlay(source.inlay) };
}

export const TEXT_EFFECT_INLAY_FITS = ["tile", "cover"];

function normalizeInlay(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const textureSource = source.texture && typeof source.texture === "object" ? source.texture : {};
  const shadowSource = source.innerShadow && typeof source.innerShadow === "object" ? source.innerShadow : {};
  const sparkleSource = source.sparkles && typeof source.sparkles === "object" ? source.sparkles : {};
  return {
    enabled: Boolean(source.enabled),
    // Both fractions of font size. inset = rim band kept inside the outline;
    // outset = how far the rim grows outside it, so thin letters keep room for the inlay.
    inset: CLAMP(source.inset, 0, 0.2, 0.03),
    outset: CLAMP(source.outset, 0, 0.2, 0.03),
    color: isColor(source.color) ? source.color.trim() : "#e9edf2",
    texture: {
      ...normalizeTexture(textureSource),
      // "tile": the image repeats at `scale` × font size tall (stones keep their size on
      // any text box); "cover": one image cover-fitted to the text box.
      fit: TEXT_EFFECT_INLAY_FITS.includes(textureSource.fit) ? textureSource.fit : "tile",
      scale: CLAMP(textureSource.scale, 0.1, 6, 0.85),
    },
    innerShadow: {
      enabled: shadowSource.enabled === undefined ? true : Boolean(shadowSource.enabled),
      color: isColor(shadowSource.color) ? shadowSource.color.trim() : "rgba(0,0,0,0.65)",
      blur: CLAMP(shadowSource.blur, 0, 0.3, 0.04),
      offsetX: CLAMP(shadowSource.offsetX, -0.2, 0.2, 0.012),
      offsetY: CLAMP(shadowSource.offsetY, -0.2, 0.2, 0.018),
    },
    sparkles: {
      // Star glints over the inlay; positions come from `seed`, so every render matches.
      count: Math.round(CLAMP(sparkleSource.count, 0, 200, 0)),
      size: CLAMP(sparkleSource.size, 0.005, 0.2, 0.05),
      color: isColor(sparkleSource.color) ? sparkleSource.color.trim() : "rgba(255,255,255,0.95)",
      seed: Math.round(CLAMP(sparkleSource.seed, 1, 100000, 7)),
    },
  };
}

function normalizeTexture(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const renderMode = TEXT_EFFECT_RENDER_MODES.includes(source.renderMode) ? source.renderMode : "color";
  /** @type {{ blendMode: string, opacity: number, renderMode: string, tint: string, scale: number, url?: string, videoUrl?: string }} */
  const texture = {
    blendMode: normalizeTextEffectBlendMode(source.blendMode),
    opacity: CLAMP(source.opacity, 0, 1, 1),
    // "bw": the image is greyscale and takes `tint` (the user's colour in the editor).
    renderMode,
    tint: isColor(source.tint) ? source.tint.trim() : "#d4af37",
    // 1 = cover the text's box exactly; larger zooms the material in.
    scale: CLAMP(source.scale, 0.25, 6, 1),
  };
  // URLs are carried for clients only (serializeTextEffect fills them from the row).
  if (typeof source.url === "string" && source.url.trim()) texture.url = source.url.trim();
  if (typeof source.videoUrl === "string" && source.videoUrl.trim()) texture.videoUrl = source.videoUrl.trim();
  return texture;
}

/**
 * The shape every client receives (editor, mobile, dashboard preview): the normalized
 * spec with the row's texture URLs folded into `fill.texture`, plus the strip fields.
 * The stored spec never holds the URLs, so the row stays the single source of truth.
 */
export function serializeTextEffect(row) {
  const spec = normalizeTextEffectSpec(row && row.spec);
  const textureUrl = String((row && row.textureUrl) || "").trim();
  const textureVideoUrl = String((row && row.textureVideoUrl) || "").trim();
  const inlayTextureUrl = String((row && row.inlayTextureUrl) || "").trim();
  const texture = { ...spec.fill.texture };
  delete texture.url;
  delete texture.videoUrl;
  if (textureUrl) texture.url = textureUrl;
  if (textureVideoUrl) texture.videoUrl = textureVideoUrl;
  const inlayTexture = { ...spec.inlay.texture };
  delete inlayTexture.url;
  delete inlayTexture.videoUrl;
  if (inlayTextureUrl) inlayTexture.url = inlayTextureUrl;
  return {
    id: row && row.slug,
    titleEn: (row && row.titleEn) || "",
    titleAr: (row && row.titleAr) || "",
    category: normalizeTextEffectCategory(row && row.category),
    isPremium: Boolean(row && row.isPremium),
    previewUrl: (row && row.previewUrl) || null,
    textureUrl: textureUrl || null,
    textureVideoUrl: textureVideoUrl || null,
    inlayTextureUrl: inlayTextureUrl || null,
    spec: { ...spec, fill: { ...spec.fill, texture }, inlay: { ...spec.inlay, texture: inlayTexture } },
  };
}

/** The spec as stored: normalized, with any client-side texture URLs stripped. */
export function storableTextEffectSpec(input) {
  const spec = normalizeTextEffectSpec(input);
  const texture = { ...spec.fill.texture };
  delete texture.url;
  delete texture.videoUrl;
  const inlayTexture = { ...spec.inlay.texture };
  delete inlayTexture.url;
  delete inlayTexture.videoUrl;
  return { ...spec, fill: { ...spec.fill, texture }, inlay: { ...spec.inlay, texture: inlayTexture } };
}

// Painting lives in ./applyTextEffect.ts (applyTextEffect), shared by the dashboard preview,
// the editor and every export. This file stays the data contract only, so server routes can
// import it without pulling in any canvas code.
