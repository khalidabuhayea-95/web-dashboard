// The one text-effect renderer: the dashboard preview, the editor canvas and every export
// (PNG, recorded MP4, thumbnails — they all draw the editor's Konva scene) paint through
// applyTextEffect(), so what an admin tunes is what a design shows and what it exports.
//
// Canvas 2D only. The browser's own fillText shapes the text, so Arabic joins, ligatures
// and bidi come out exactly as in plain text; nothing here shapes glyphs by hand.
//
// Every layer is composed OFFSCREEN and only the finished lettering reaches the target:
// blend modes and `source-atop` clips would otherwise mix with whatever is already on the
// target (the page background behind the text in the editor).
//
//   F (fill)    glyphs in the base colour → material on top (gradient / pattern / texture
//               blended with its mode and opacity) → bevel rims → sheen, clipped to F
//               → inlay (optional): F becomes a rim grown outward by `inlay.outset`, and a
//               second material fills the glyphs shrunk by `inlay.inset`, recessed by an
//               inner shadow, with seeded sparkles
//   C (compose) stroke under F
//   target      C, with the drop shadow
//
// Sizes in the spec are fractions of the font size (see spec.js); this module turns them
// into layout units with `layout.fontSize`.

import { normalizeTextEffectSpec } from "./spec";

export type TextEffectRun = {
  text: string;
  /** Position in layout units; `x` is the run's LEFT edge (textAlign "left"). */
  x: number;
  y: number;
  /** CSS font shorthand, e.g. `700 64px "Noto Kufi Arabic"`. */
  font: string;
  /** Tracking in layout units. */
  letterSpacing?: number;
};

export type TextEffectLayout = {
  runs: TextEffectRun[];
  /** Reference size for the spec's fractional units (the layer's font size). */
  fontSize: number;
  direction?: "ltr" | "rtl";
  /** How each run's `y` is read. Default "alphabetic". */
  textBaseline?: CanvasTextBaseline;
  /** The text's box: the texture covers it and gradients span it. */
  bounds: { x: number; y: number; width: number; height: number };
};

export type TextEffectInput = {
  /** A stored spec; normalized here, so a malformed one degrades instead of throwing. */
  spec: unknown;
  /** The loaded texture: an image, or a playing <video> (its current frame is drawn). */
  texture?: CanvasImageSource | null;
  /** The loaded tile for `pattern` fills. */
  pattern?: CanvasImageSource | null;
  /** The loaded inlay material (`spec.inlay`), e.g. diamond pavé. */
  inlayTexture?: CanvasImageSource | null;
};

export type TextEffectOptions = {
  /** 0–1, multiplies the texture's opacity (the editor's intensity slider). Default 1. */
  intensity?: number;
  /** Replaces the spec's tint for "bw" textures (the user's colour). */
  tintColor?: string;
  /** Replaces the spec's base fill colour. */
  baseColor?: string;
  /** Device pixels per layout unit for the offscreen layers. Default: read from ctx. */
  pixelRatio?: number;
  /** Canvas factory (tests, workers). Default: OffscreenCanvas, else a DOM canvas. */
  createCanvas?: (width: number, height: number) => EffectCanvas;
};

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type EffectCanvas = (HTMLCanvasElement | OffscreenCanvas) & { width: number; height: number };

const MAX_OFFSCREEN_SIDE = 4096;

type NormalizedSpec = ReturnType<typeof normalizeTextEffectSpec>;

/** The draw rect that makes a `sourceW × sourceH` image cover `box`, zoomed by `scale`, centred. */
export function coverRect(
  sourceWidth: number,
  sourceHeight: number,
  box: { x: number; y: number; width: number; height: number },
  scale = 1
) {
  const sw = Math.max(1, Number(sourceWidth) || 1);
  const sh = Math.max(1, Number(sourceHeight) || 1);
  const factor = Math.max(box.width / sw, box.height / sh) * Math.max(0.01, Number(scale) || 1);
  const width = sw * factor;
  const height = sh * factor;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/** Linear-gradient endpoints across `box` at `angle` degrees (90 = top → bottom), CSS-style. */
export function gradientEndpoints(angle: number, box: { x: number; y: number; width: number; height: number }) {
  const radians = ((Number(angle) || 0) * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  // Half the box's extent along the gradient direction, so the ramp spans corner to corner.
  const half = (Math.abs(box.width * dx) + Math.abs(box.height * dy)) / 2;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return { x0: cx - dx * half, y0: cy - dy * half, x1: cx + dx * half, y1: cy + dy * half };
}

/** How far (layout units) the effect can paint outside the glyph box: stroke, shadow, bevel. */
export function effectPadding(specInput: unknown, fontSize: number) {
  const spec = normalizeTextEffectSpec(specInput);
  const size = Math.max(1, Number(fontSize) || 1);
  const outset = spec.inlay.enabled ? spec.inlay.outset * size : 0;
  const stroke = spec.stroke.width * size * 2 + outset;
  const shadow = spec.shadow.enabled
    ? spec.shadow.blur * size * 2 + Math.max(Math.abs(spec.shadow.offsetX), Math.abs(spec.shadow.offsetY)) * size
    : 0;
  // Glyphs overhang their nominal box (swashes, diacritics); keep a font-relative margin.
  return Math.ceil(Math.max(stroke, shadow + outset) + size * 0.35);
}

/**
 * Moves `point` onto the target's device-pixel grid when the transform is axis-aligned and the
 * layers render at the target's own scale, so their pixels land 1:1 on the target's.
 */
function snapToDevicePixels(ctx: Ctx2D, point: { x: number; y: number }, ratio: number) {
  try {
    const m = ctx.getTransform();
    if (Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9 || Math.abs(m.a - ratio) > 1e-6 || Math.abs(m.d - ratio) > 1e-6) {
      return point;
    }
    return { x: (Math.floor(m.a * point.x + m.e) - m.e) / m.a, y: (Math.floor(m.d * point.y + m.f) - m.f) / m.d };
  } catch (_error) {
    return point;
  }
}

/** Device pixels per unit of `ctx`'s current transform (zoom × devicePixelRatio). */
function readPixelRatio(ctx: Ctx2D) {
  try {
    const m = ctx.getTransform();
    return Math.max(0.05, Math.hypot(m.a, m.b) || 1);
  } catch (_error) {
    return 1;
  }
}

function defaultCanvas(width: number, height: number): EffectCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height) as EffectCanvas;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as EffectCanvas;
}

function sourceSize(source: CanvasImageSource | null | undefined) {
  if (!source) return null;
  const s = source as unknown as {
    videoWidth?: number;
    videoHeight?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number | { baseVal?: { value: number } };
    height?: number | { baseVal?: { value: number } };
    readyState?: number;
  };
  if (typeof s.videoWidth === "number") {
    // A <video> with no decoded frame yet draws nothing; let the caller fall back.
    if (!(s.videoWidth > 0) || Number(s.readyState) < 2) return null;
    return { width: s.videoWidth, height: Number(s.videoHeight) || s.videoWidth };
  }
  const width = Number(s.naturalWidth) || (typeof s.width === "number" ? s.width : 0);
  const height = Number(s.naturalHeight) || (typeof s.height === "number" ? s.height : 0);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Paints `layout` with a text effect onto `ctx`, in `ctx`'s current coordinate space.
 * Returns false (and paints nothing) when there is nothing to draw.
 */
export function applyTextEffect(
  ctx: Ctx2D,
  layout: TextEffectLayout,
  effect: TextEffectInput,
  options: TextEffectOptions = {}
): boolean {
  if (options.createCanvas) return paintEffect(ctx, layout, effect, options, options.createCanvas);
  // The offscreen layers are reused between paints: a playing timeline repaints every frame, and
  // a large title's five layers are megabytes each.
  const borrowed: EffectCanvas[] = [];
  try {
    return paintEffect(ctx, layout, effect, options, (width, height) => {
      const canvas = borrowCanvas(width, height);
      borrowed.push(canvas);
      return canvas;
    });
  } finally {
    for (const canvas of borrowed) if (canvasPool.length < MAX_POOLED_CANVASES) canvasPool.push(canvas);
  }
}

const MAX_POOLED_CANVASES = 8;
const canvasPool: EffectCanvas[] = [];

function borrowCanvas(width: number, height: number): EffectCanvas {
  const canvas = canvasPool.pop();
  if (!canvas) return defaultCanvas(width, height);
  const context = canvas.getContext("2d") as (Ctx2D & { reset?: () => void }) | null;
  if (canvas.width === width && canvas.height === height && typeof context?.reset === "function") {
    context.reset();
  } else {
    // Assigning a size clears the bitmap and resets the context state.
    canvas.width = width;
    canvas.height = height;
  }
  return canvas;
}

function paintEffect(
  ctx: Ctx2D,
  layout: TextEffectLayout,
  effect: TextEffectInput,
  options: TextEffectOptions,
  create: (width: number, height: number) => EffectCanvas
): boolean {
  const runs = (layout?.runs || []).filter((run) => run && String(run.text || "").length > 0);
  if (!runs.length || !layout.bounds) return false;
  const spec = normalizeTextEffectSpec(effect?.spec) as NormalizedSpec;
  const fontSize = Math.max(1, Number(layout.fontSize) || 1);

  const pad = effectPadding(spec, fontSize);
  let ratio = Math.max(0.05, Number(options.pixelRatio) || readPixelRatio(ctx));
  const origin = snapToDevicePixels(ctx, { x: layout.bounds.x - pad, y: layout.bounds.y - pad }, ratio);
  ratio = Math.min(
    ratio,
    MAX_OFFSCREEN_SIDE / Math.max(1, layout.bounds.width + pad * 2),
    MAX_OFFSCREEN_SIDE / Math.max(1, layout.bounds.height + pad * 2)
  );
  const pxWidth = Math.max(1, Math.ceil((layout.bounds.x + layout.bounds.width + pad - origin.x) * ratio));
  const pxHeight = Math.max(1, Math.ceil((layout.bounds.y + layout.bounds.height + pad - origin.y) * ratio));
  // The layers are drawn back at exactly their pixel size (no resampling): a whole-pixel canvas
  // squeezed into a fractional box would blur and drift the glyphs by a fraction of a pixel.
  const unitWidth = pxWidth / ratio;
  const unitHeight = pxHeight / ratio;

  const layer = () => {
    const canvas = create(pxWidth, pxHeight);
    const context = canvas.getContext("2d") as Ctx2D | null;
    if (!context) return null;
    context.setTransform(ratio, 0, 0, ratio, -origin.x * ratio, -origin.y * ratio);
    return { canvas, context };
  };

  // Every glyph pass goes through here, so all of them share one shaping/placement.
  const paintGlyphs = (
    context: Ctx2D,
    paint: (run: TextEffectRun) => void,
    style: { dx?: number; dy?: number } = {}
  ) => {
    for (const run of runs) {
      context.save();
      context.font = run.font;
      context.direction = layout.direction === "rtl" ? "rtl" : "ltr";
      context.textAlign = "left";
      context.textBaseline = layout.textBaseline || "alphabetic";
      const spacing = Number(run.letterSpacing) || 0;
      if (spacing && "letterSpacing" in context) {
        (context as Ctx2D & { letterSpacing: string }).letterSpacing = `${spacing}px`;
      }
      context.translate(style.dx || 0, style.dy || 0);
      paint(run);
      context.restore();
    }
  };
  const fillGlyphs = (context: Ctx2D, fillStyle: string | CanvasGradient | CanvasPattern, style = {}) => {
    context.fillStyle = fillStyle;
    paintGlyphs(context, (run) => context.fillText(run.text, run.x, run.y), style);
  };
  // The body of the main material: the glyphs, grown by the inlay's rim outset when there is one.
  const outset = spec.inlay.enabled ? spec.inlay.outset * fontSize : 0;
  const shapeGlyphs = (context: Ctx2D, fillStyle: string | CanvasGradient | CanvasPattern, style = {}) => {
    fillGlyphs(context, fillStyle, style);
    if (outset <= 0) return;
    context.save();
    context.lineJoin = "round";
    context.lineWidth = outset * 2;
    context.strokeStyle = fillStyle;
    paintGlyphs(context, (run) => context.strokeText(run.text, run.x, run.y), style);
    context.restore();
  };

  const fill = layer();
  if (!fill) return false;
  const F = fill.context;

  const kind = spec.fill.kind;
  const texture = spec.fill.texture;
  const tint = isCssColor(options.tintColor) ? String(options.tintColor) : texture.tint;
  const baseColor = isCssColor(options.baseColor)
    ? String(options.baseColor)
    : kind === "texture" && texture.renderMode === "bw"
      ? tint
      : spec.fill.color;

  if (kind === "gradient" && spec.fill.stops.length >= 2) {
    const ends = gradientEndpoints(spec.fill.angle, layout.bounds);
    const gradient = F.createLinearGradient(ends.x0, ends.y0, ends.x1, ends.y1);
    for (const [offset, color] of spec.fill.stops) gradient.addColorStop(offset, color);
    shapeGlyphs(F, gradient);
  } else if (kind === "pattern" && effect?.pattern && sourceSize(effect.pattern)) {
    const pattern = F.createPattern(effect.pattern, "repeat");
    if (pattern) {
      const size = sourceSize(effect.pattern)!;
      const scale = (spec.fill.patternScale * fontSize) / size.height;
      // Anchored to the text's box, so the tiles move with the text, not the page.
      pattern.setTransform?.(new DOMMatrix([scale, 0, 0, scale, layout.bounds.x, layout.bounds.y]));
      shapeGlyphs(F, pattern);
    } else {
      shapeGlyphs(F, baseColor);
    }
  } else {
    shapeGlyphs(F, baseColor);
  }

  const textureSource = kind === "texture" ? effect?.texture : null;
  const textureSize = sourceSize(textureSource);
  const opacity = texture.opacity * clamp01(options.intensity ?? 1);
  if (textureSource && textureSize && opacity > 0) {
    const tex = layer();
    if (tex) {
      const T = tex.context;
      const rect = coverRect(textureSize.width, textureSize.height, layout.bounds, texture.scale);
      T.drawImage(textureSource, rect.x, rect.y, rect.width, rect.height);
      if (texture.renderMode === "bw") {
        // Greyscale × tint, then restore the texture's own alpha.
        T.globalCompositeOperation = "multiply";
        T.fillStyle = tint;
        T.fillRect(rect.x, rect.y, rect.width, rect.height);
        T.globalCompositeOperation = "destination-in";
        T.drawImage(textureSource, rect.x, rect.y, rect.width, rect.height);
      }
      // Clip the material to the glyph SHAPE before blending, so blend modes never touch
      // anything outside the letters — and a see-through base (glass) does not thin the
      // material too.
      T.globalCompositeOperation = "destination-in";
      shapeGlyphs(T, "#000");
      F.save();
      F.globalCompositeOperation = texture.blendMode as GlobalCompositeOperation;
      F.globalAlpha = opacity;
      drawLayer(F, tex.canvas, origin, unitWidth, unitHeight);
      F.restore();
    }
  }

  if (spec.bevel.enabled && spec.bevel.depth > 0) {
    const depth = spec.bevel.depth * fontSize;
    const softness = spec.bevel.softness * depth;
    for (const [color, dx, dy] of [
      [spec.bevel.light, depth, depth],
      [spec.bevel.dark, -depth, -depth],
    ] as const) {
      const rim = layer();
      if (!rim) continue;
      // Glyphs minus themselves shifted away from the light = the rim facing the light.
      shapeGlyphs(rim.context, color);
      rim.context.globalCompositeOperation = "destination-out";
      shapeGlyphs(rim.context, "#000", { dx, dy });
      F.save();
      F.globalCompositeOperation = "source-atop";
      if (softness > 0 && "filter" in F) F.filter = `blur(${softness * ratio}px)`;
      drawLayer(F, rim.canvas, origin, unitWidth, unitHeight);
      F.restore();
    }
  }

  if (spec.sheen.enabled) {
    F.save();
    F.globalCompositeOperation = "source-atop";
    F.lineJoin = "round";
    F.lineWidth = Math.max(1 / ratio, spec.sheen.width * fontSize);
    F.strokeStyle = spec.sheen.color;
    paintGlyphs(F, (run) => F.strokeText(run.text, run.x, run.y), { dy: spec.sheen.offsetY * fontSize });
    F.restore();
  }

  if (spec.inlay.enabled) {
    const inlay = layer();
    if (inlay) {
      const I = inlay.context;
      const conf = spec.inlay;
      // The seat: the glyphs shrunk by the rim band.
      fillGlyphs(I, conf.color);
      if (conf.inset > 0) {
        I.save();
        I.globalCompositeOperation = "destination-out";
        I.lineJoin = "round";
        I.lineWidth = conf.inset * fontSize * 2;
        I.strokeStyle = "#000";
        paintGlyphs(I, (run) => I.strokeText(run.text, run.x, run.y));
        I.restore();
      }

      const source = effect?.inlayTexture || null;
      const size = sourceSize(source);
      const inlayOpacity = conf.texture.opacity;
      if (source && size && inlayOpacity > 0) {
        const mat = layer();
        if (mat) {
          const M = mat.context;
          const area = {
            x: layout.bounds.x - pad,
            y: layout.bounds.y - pad,
            width: layout.bounds.width + pad * 2,
            height: layout.bounds.height + pad * 2,
          };
          if (conf.texture.fit === "cover") {
            const rect = coverRect(size.width, size.height, layout.bounds, conf.texture.scale);
            M.drawImage(source, rect.x, rect.y, rect.width, rect.height);
          } else {
            // Tiles anchored to the text's box, `scale` × font size tall, so the stones keep
            // their size whatever the box. drawImage (not createPattern) works everywhere.
            const tileH = Math.max(1 / ratio, conf.texture.scale * fontSize);
            const tileW = (tileH * size.width) / size.height;
            const startX = layout.bounds.x - Math.ceil((layout.bounds.x - area.x) / tileW) * tileW;
            const startY = layout.bounds.y - Math.ceil((layout.bounds.y - area.y) / tileH) * tileH;
            let drawn = 0;
            for (let y = startY; y < area.y + area.height && drawn < 4000; y += tileH) {
              for (let x = startX; x < area.x + area.width && drawn < 4000; x += tileW) {
                M.drawImage(source, x, y, tileW, tileH);
                drawn += 1;
              }
            }
          }
          if (conf.texture.renderMode === "bw") {
            M.globalCompositeOperation = "multiply";
            M.fillStyle = conf.texture.tint;
            M.fillRect(area.x, area.y, area.width, area.height);
          }
          // Clip to the seat, then lay it over the seat colour.
          M.globalCompositeOperation = "destination-in";
          drawLayer(M, inlay.canvas, origin, unitWidth, unitHeight);
          I.save();
          I.globalCompositeOperation = conf.texture.blendMode as GlobalCompositeOperation;
          I.globalAlpha = inlayOpacity;
          drawLayer(I, mat.canvas, origin, unitWidth, unitHeight);
          I.restore();
        }
      }

      if (conf.innerShadow.enabled) {
        // Everything but the seat, drawn only for its shadow: the rim's lip falls on the inlay.
        const hole = layer();
        if (hole) {
          const H = hole.context;
          H.save();
          H.setTransform(1, 0, 0, 1, 0, 0);
          H.fillStyle = "#000";
          H.fillRect(0, 0, pxWidth, pxHeight);
          H.restore();
          H.globalCompositeOperation = "destination-out";
          drawLayer(H, inlay.canvas, origin, unitWidth, unitHeight);
          I.save();
          I.globalCompositeOperation = "source-atop";
          // Shadows are in device pixels of THIS layer (its transform is `ratio`).
          I.shadowColor = conf.innerShadow.color;
          I.shadowBlur = conf.innerShadow.blur * fontSize * ratio;
          I.shadowOffsetX = conf.innerShadow.offsetX * fontSize * ratio;
          I.shadowOffsetY = conf.innerShadow.offsetY * fontSize * ratio;
          drawLayer(I, hole.canvas, origin, unitWidth, unitHeight);
          I.restore();
        }
      }

      if (conf.sparkles.count > 0) {
        I.save();
        I.globalCompositeOperation = "source-atop";
        let state = conf.sparkles.seed;
        const random = () => {
          state = (state * 16807) % 2147483647;
          return state / 2147483647;
        };
        for (let k = 0; k < conf.sparkles.count; k += 1) {
          const x = layout.bounds.x + random() * layout.bounds.width;
          const y = layout.bounds.y + random() * layout.bounds.height;
          const radius = conf.sparkles.size * fontSize * (0.6 + random() * 0.8);
          const glow = I.createRadialGradient(x, y, 0, x, y, radius);
          glow.addColorStop(0, conf.sparkles.color);
          glow.addColorStop(1, "rgba(255,255,255,0)");
          I.fillStyle = glow;
          I.fillRect(x - radius, y - radius, radius * 2, radius * 2);
          I.strokeStyle = conf.sparkles.color;
          I.lineWidth = Math.max(1 / ratio, radius * 0.06);
          I.beginPath();
          I.moveTo(x - radius * 1.8, y);
          I.lineTo(x + radius * 1.8, y);
          I.moveTo(x, y - radius * 1.8);
          I.lineTo(x, y + radius * 1.8);
          I.stroke();
        }
        I.restore();
      }

      drawLayer(F, inlay.canvas, origin, unitWidth, unitHeight);
    }
  }

  let finished = fill;
  if (spec.stroke.width > 0) {
    const compose = layer();
    if (compose) {
      const C = compose.context;
      C.lineJoin = "round";
      C.lineCap = "round";
      // Strokes straddle the outline; double it so the authored width shows OUTSIDE the glyph.
      C.lineWidth = spec.stroke.width * fontSize * 2 + outset * 2;
      C.strokeStyle = spec.stroke.color;
      paintGlyphs(C, (run) => C.strokeText(run.text, run.x, run.y));
      drawLayer(C, fill.canvas, origin, unitWidth, unitHeight);
      finished = compose;
    }
  }

  ctx.save();
  if (spec.shadow.enabled) {
    // Canvas shadows are in device pixels and ignore the transform; scale them by hand.
    const deviceRatio = readPixelRatio(ctx);
    ctx.shadowColor = spec.shadow.color;
    ctx.shadowBlur = spec.shadow.blur * fontSize * deviceRatio;
    ctx.shadowOffsetX = spec.shadow.offsetX * fontSize * deviceRatio;
    ctx.shadowOffsetY = spec.shadow.offsetY * fontSize * deviceRatio;
  }
  drawLayer(ctx, finished.canvas, origin, unitWidth, unitHeight);
  ctx.restore();
  return true;
}

// Draws a full offscreen layer back at its place in layout units.
function drawLayer(
  context: Ctx2D,
  canvas: EffectCanvas,
  origin: { x: number; y: number },
  width: number,
  height: number
) {
  context.drawImage(canvas as CanvasImageSource, origin.x, origin.y, width, height);
}

function clamp01(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function isCssColor(value: unknown) {
  return typeof value === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(value.trim());
}

export type SimpleTextLayoutInput = {
  text: string;
  /** CSS font shorthand at `fontSize`. */
  font: string;
  fontSize: number;
  /** Line box height as a multiple of font size. Default 1.25. */
  lineHeight?: number;
  align?: "left" | "center" | "right";
  direction?: "ltr" | "rtl";
  letterSpacing?: number;
  /** The box the lines are aligned in (its x / width) and stacked from (its y). */
  box: { x: number; y: number; width: number };
};

/**
 * Lays plain multi-line text out the way the editor's text boxes do (one line per "\n",
 * aligned inside the box, stacked by line height, baseline mid-line) — for previews and
 * thumbnails that have no Konva node to ask. Measures with `measureCtx`, so widths are the
 * browser's own shaped widths.
 */
export function layoutSimpleText(measureCtx: Ctx2D, input: SimpleTextLayoutInput): TextEffectLayout {
  const fontSize = Math.max(1, Number(input.fontSize) || 1);
  const lineHeightPx = fontSize * (Number(input.lineHeight) > 0 ? Number(input.lineHeight) : 1.25);
  const spacing = Number(input.letterSpacing) || 0;
  const lines = String(input.text || "").split("\n");
  measureCtx.save();
  measureCtx.font = input.font;
  measureCtx.direction = input.direction === "rtl" ? "rtl" : "ltr";
  if (spacing && "letterSpacing" in measureCtx) {
    (measureCtx as Ctx2D & { letterSpacing: string }).letterSpacing = `${spacing}px`;
  }
  const runs: TextEffectRun[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  lines.forEach((line, index) => {
    const width = line ? measureCtx.measureText(line).width : 0;
    const free = input.box.width - width;
    const x =
      input.align === "right" ? input.box.x + free : input.align === "left" ? input.box.x : input.box.x + free / 2;
    if (line) {
      runs.push({ text: line, x, y: input.box.y + index * lineHeightPx + lineHeightPx / 2, font: input.font, letterSpacing: spacing });
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + width);
    }
  });
  measureCtx.restore();
  const height = lines.length * lineHeightPx;
  return {
    runs,
    fontSize,
    direction: input.direction === "rtl" ? "rtl" : "ltr",
    textBaseline: "middle",
    bounds: Number.isFinite(minX)
      ? { x: minX, y: input.box.y, width: Math.max(1, maxX - minX), height }
      : { x: input.box.x, y: input.box.y, width: Math.max(1, input.box.width), height },
  };
}
