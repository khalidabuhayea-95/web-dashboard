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
//   fill    → the material itself (gradient bands, or a tiled texture)
//   sheen   → thin bright rim along the top edge, clipped to the glyphs
//
// Metal reads as metal because of NARROW ALTERNATING BANDS, not one soft ramp:
// a two-stop gold gradient always looks like coloured plastic. Presets below
// keep 7–9 stops for that reason.

export const TEXT_EFFECT_FILL_KINDS = ["gradient", "solid", "pattern"];

export const MAX_TEXT_EFFECT_STOPS = 24;
export const MAX_TEXT_EFFECT_TITLE_LENGTH = 80;

const CLAMP = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const isColor = (value) =>
  typeof value === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(value.trim());

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

  return { version: 1, fill, stroke, shadow, sheen };
}

/**
 * Paints one text effect onto a 2D canvas context.
 *
 * Shared by the dashboard preview, the preview-image generator and (next) the
 * editor, so what an admin sees while authoring is what the app draws.
 *
 * `patternImage` is an already-loaded image for pattern fills; callers resolve
 * it because loading differs between browser and server.
 */
export function paintTextEffect(ctx, text, spec, box, patternImage = null) {
  const s = normalizeTextEffectSpec(spec);
  const { x, y, fontSize } = box;

  const draw = (fn) => {
    ctx.save();
    fn();
    ctx.restore();
  };

  if (s.shadow.enabled) {
    draw(() => {
      ctx.fillStyle = s.shadow.color;
      const blur = s.shadow.blur * fontSize;
      if (blur > 0) ctx.filter = `blur(${blur}px)`;
      ctx.fillText(text, x + s.shadow.offsetX * fontSize, y + s.shadow.offsetY * fontSize);
    });
  }

  if (s.stroke.width > 0) {
    draw(() => {
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      // Canvas strokes straddle the path, so double the width to get the
      // authored thickness OUTSIDE the glyph once the fill covers the inside.
      ctx.lineWidth = s.stroke.width * fontSize * 2;
      ctx.strokeStyle = s.stroke.color;
      ctx.strokeText(text, x, y);
    });
  }

  draw(() => {
    ctx.fillStyle = resolveFillStyle(ctx, s, box, patternImage);
    ctx.fillText(text, x, y);
  });

  if (s.sheen.enabled) {
    draw(() => {
      // source-atop clips the rim to the glyphs already painted.
      ctx.globalCompositeOperation = "source-atop";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(1, s.sheen.width * fontSize);
      ctx.strokeStyle = s.sheen.color;
      ctx.strokeText(text, x, y + s.sheen.offsetY * fontSize);
    });
  }
}

function resolveFillStyle(ctx, spec, box, patternImage) {
  const { fill } = spec;
  if (fill.kind === "solid") return fill.color;

  if (fill.kind === "pattern") {
    if (!patternImage) return fill.color;
    const pattern = ctx.createPattern(patternImage, "repeat");
    if (!pattern) return fill.color;
    if (typeof DOMMatrix === "function" && pattern.setTransform) {
      const scale = (fill.patternScale * box.fontSize) / (patternImage.height || box.fontSize);
      pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0]));
    }
    return pattern;
  }

  // Gradient across the glyph band, in the authored direction.
  const { x, y, fontSize, width = fontSize * 4 } = box;
  const radians = (fill.angle * Math.PI) / 180;
  const halfHeight = fontSize * 0.62;
  const dx = Math.cos(radians) * (width / 2);
  const dy = Math.sin(radians) * halfHeight;
  const gradient = ctx.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
  for (const [offset, color] of fill.stops) gradient.addColorStop(offset, color);
  return gradient;
}
