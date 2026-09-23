"use client";

/**
 * Canva's writing styles on the canvas (docs/canva-animation-parity.md §8.4): a text layer whose
 * FADE / BLUR / SUCCESSION / NEON carries a `unit` param plays per character, word or line.
 *
 * The layout is the renderer's OWN — Konva's wrapped lines (`textArr`), so line units and every
 * glyph sit exactly where the static <Text> puts them — and each unit is drawn with its own alpha,
 * blur (blurEm × font size) and scale about its own centre, plus Succession's element scale about
 * the layer centre. Shaping is never broken: a line is always painted WHOLE and each unit is a
 * CLIP of it (Arabic stays joined), with the glyph boxes measured by the browser's own layout
 * (DOM ranges) so bidi runs and ligatures land where the canvas draws them. The one exception is
 * Konva's own per-letter path (left-to-right text with letter spacing or justification), which
 * draws each letter by itself anyway — there the units draw letter by letter the same way.
 *
 * The layer's pose (position, rotation, opacity, a concurrent loop's scale…) is applied by Konva
 * as for any node; previewRuntime already left the slot's whole-element alpha/blur/scale out of
 * it, since the units carry those.
 */
import Konva from "konva";
import { stringToArray } from "konva/lib/shapes/Text";
import { Shape } from "react-konva";

import {
  cachedCanvaUnitSchedule,
  canvaGraphemeLines,
  canvaTextUnits,
  canvaUnitElementScaleAt,
  canvaUnitMode,
  canvaUnitVisualAt,
  canvaWrappedLineRanges,
  type CanvaUnitVisual,
} from "@/lib/editor/animationCanvaUnits";
import type { GlyphMotionSpec } from "@/lib/editor/animationVisual";

export interface CanvaUnitTextStyle {
  text: string;
  width: number;
  height: number;
  fontSize: number;
  /** CSS font-family list, as handed to the static <Text>. */
  fontFamily: string;
  /** Konva's fontStyle ("700", "italic 400"…). */
  fontStyle: string;
  lineHeight: number;
  align: string;
  direction: "rtl" | "ltr";
  letterSpacing: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}

type Interval = [number, number];

interface UnitLine {
  text: string;
  /** Left edge of the line (its alignment offset), layer-local px. */
  x: number;
  /** Top of the line box. */
  top: number;
  /** The y the line is filled at (Konva's baseline). */
  baseline: number;
  /** Clip path: the x intervals of each unit's graphemes on this line, relative to [x]. */
  units: Map<number, Interval[]>;
  /** Konva's per-letter path instead: every letter with its own x and unit. */
  letters: Array<{ text: string; x: number; width: number; unit: number }> | null;
}

interface UnitTextLayout {
  font: string;
  textBaseline: CanvasTextBaseline;
  lineHeightPx: number;
  unitCount: number;
  lines: UnitLine[];
}

// ── Fonts: a layout measured while a family was still loading is stale once it lands ─────────────

let fontGeneration = 0;
let fontListenerInstalled = false;

function currentFontGeneration(): number {
  if (!fontListenerInstalled && typeof document !== "undefined" && document.fonts?.addEventListener) {
    fontListenerInstalled = true;
    document.fonts.addEventListener("loadingdone", () => {
      fontGeneration += 1;
      LAYOUT_CACHE.clear();
    });
  }
  return fontGeneration;
}

// ── Glyph boxes ──────────────────────────────────────────────────────────────────────────────────

let measureContext: CanvasRenderingContext2D | null = null;

function canvasMeasure(font: string, letterSpacing: number, text: string): number {
  if (!measureContext && typeof document !== "undefined") {
    measureContext = document.createElement("canvas").getContext("2d");
  }
  if (!measureContext) return 0;
  measureContext.font = font;
  return measureContext.measureText(text).width + letterSpacing * text.length;
}

/**
 * The x intervals (relative to the line's left edge) of each [ranges] entry of [lineText], as
 * the browser lays the line out — bidi reordering, joining and ligatures included. Falls back to
 * prefix widths without a DOM.
 */
function measureGlyphIntervals(
  lineText: string,
  font: string,
  letterSpacing: number,
  direction: "rtl" | "ltr",
  ranges: Interval[]
): Interval[][] {
  if (typeof document === "undefined" || !document.body) {
    const total = canvasMeasure(font, letterSpacing, lineText);
    return ranges.map(([start, end]) => {
      const a = canvasMeasure(font, letterSpacing, lineText.slice(0, start));
      const b = canvasMeasure(font, letterSpacing, lineText.slice(0, end));
      return [direction === "rtl" ? [total - b, total - a] : [a, b]];
    });
  }
  const host = document.createElement("span");
  host.style.cssText =
    "position:absolute;left:-100000px;top:0;visibility:hidden;white-space:pre;display:inline-block;pointer-events:none;unicode-bidi:isolate;";
  host.style.font = font;
  host.style.letterSpacing = `${letterSpacing}px`;
  host.style.direction = direction;
  host.textContent = lineText;
  document.body.appendChild(host);
  try {
    const node = host.firstChild;
    const left = host.getBoundingClientRect().left;
    const range = document.createRange();
    return ranges.map(([start, end]) => {
      if (!node || end <= start) return [];
      range.setStart(node, start);
      range.setEnd(node, end);
      return Array.from(range.getClientRects())
        .filter((rect) => rect.width > 0)
        .map((rect) => [rect.left - left, rect.right - left] as Interval);
    });
  } finally {
    host.remove();
  }
}

// ── Layout ───────────────────────────────────────────────────────────────────────────────────────

const LAYOUT_CACHE = new Map<string, UnitTextLayout>();
const LAYOUT_CACHE_LIMIT = 48;

function layoutCanvaUnitText(style: CanvaUnitTextStyle, unit: number): UnitTextLayout {
  const key = JSON.stringify([style, unit, currentFontGeneration()]);
  const cached = LAYOUT_CACHE.get(key);
  if (cached) return cached;

  // Konva's own wrapping, so the units sit on exactly the lines the static <Text> draws.
  const node = new Konva.Text({
    text: style.text,
    width: style.width,
    height: style.height,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    fontStyle: style.fontStyle,
    fontVariant: "normal",
    lineHeight: style.lineHeight,
    align: style.align,
    direction: style.direction,
    letterSpacing: style.letterSpacing,
  });
  const lines = node.textArr.map((line) => ({
    text: line.text,
    width: line.width,
    lastInParagraph: line.lastInParagraph,
  }));
  const lineHeightPx = style.lineHeight * style.fontSize;
  const legacy = Boolean((Konva as unknown as { legacyTextRendering?: boolean }).legacyTextRendering);
  let firstBaseline = lineHeightPx / 2;
  if (!legacy) {
    const metrics = node.measureSize("M");
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
    firstBaseline = (ascent - descent) / 2 + lineHeightPx / 2;
  }
  // Konva's own CSS font string, so every measure and fill uses exactly the static text's font.
  const font = node._getContextFont();
  node.destroy();

  const ranges = canvaWrappedLineRanges(style.text, lines);
  const graphemeLines = canvaGraphemeLines(style.text, lines);
  const units = canvaTextUnits(style.text, unit, graphemeLines);
  const perLetter =
    style.direction !== "rtl" && (style.letterSpacing !== 0 || style.align === "justify");

  const laidOut: UnitLine[] = lines.map((line, index) => {
    let x = 0;
    if (style.align === "right") x = style.width - line.width;
    else if (style.align === "center") x = (style.width - line.width) / 2;
    const range = ranges[index] ?? { start: 0, end: 0, paragraph: 0 };
    const top = index * lineHeightPx;
    const baseline = firstBaseline + (lines.length > 1 ? index * lineHeightPx : 0);
    // The graphemes this line actually draws, and their unit.
    const own: Array<{ start: number; end: number; unit: number }> = [];
    units.graphemes.forEach((grapheme, g) => {
      if (graphemeLines[g] !== index || units.graphemeIsBlank[g]) return;
      const start = units.graphemeStarts[g];
      if (start < range.start || start >= range.end) return;
      own.push({ start: start - range.start, end: start - range.start + grapheme.length, unit: units.unitOfGrapheme[g] });
    });

    if (perLetter) {
      // Konva's per-letter path: its own letters, advanced exactly as it advances them.
      const letters: NonNullable<UnitLine["letters"]> = [];
      const spaces = line.text.split(" ").length - 1;
      let cursorX = x;
      let offset = 0;
      for (const letter of stringToArray(line.text)) {
        if (letter === " " && !line.lastInParagraph && style.align === "justify" && spaces > 0) {
          cursorX += (style.width - line.width) / spaces;
        }
        const width = canvasMeasure(font, 0, letter);
        const owner = own.find((entry) => offset >= entry.start && offset < entry.end);
        if (owner) letters.push({ text: letter, x: cursorX, width, unit: owner.unit });
        cursorX += width + style.letterSpacing;
        offset += letter.length;
      }
      return { text: line.text, x, top, baseline, units: new Map(), letters };
    }

    const intervals = measureGlyphIntervals(
      line.text,
      font,
      style.letterSpacing,
      style.direction,
      own.map((entry) => [entry.start, entry.end] as Interval)
    );
    const byUnit = new Map<number, Interval[]>();
    own.forEach((entry, i) => {
      const list = byUnit.get(entry.unit) ?? [];
      list.push(...intervals[i]);
      byUnit.set(entry.unit, list);
    });
    return { text: line.text, x, top, baseline, units: byUnit, letters: null };
  });

  const layout: UnitTextLayout = {
    font,
    textBaseline: legacy ? "middle" : "alphabetic",
    lineHeightPx,
    unitCount: units.unitCount,
    lines: laidOut,
  };
  if (LAYOUT_CACHE.size >= LAYOUT_CACHE_LIMIT) {
    const oldest = LAYOUT_CACHE.keys().next().value;
    if (oldest !== undefined) LAYOUT_CACHE.delete(oldest);
  }
  LAYOUT_CACHE.set(key, layout);
  return layout;
}

// ── Drawing ──────────────────────────────────────────────────────────────────────────────────────

const HIDDEN_ALPHA = 0.001;

function isAtRest(visual: CanvaUnitVisual) {
  return visual.alpha >= 0.999 && visual.blurEm <= 0.0001 && Math.abs(visual.scale - 1) <= 0.0001;
}

let blurCanvas: HTMLCanvasElement | null = null;

function blurSurface(width: number, height: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!blurCanvas) blurCanvas = document.createElement("canvas");
  if (blurCanvas.width < width) blurCanvas.width = width;
  if (blurCanvas.height < height) blurCanvas.height = height;
  return blurCanvas.getContext("2d");
}

function paintText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: CanvaUnitTextStyle,
  layout: UnitTextLayout,
  wholeLine: boolean
) {
  ctx.font = layout.font;
  ctx.textBaseline = layout.textBaseline;
  ctx.textAlign = "left";
  if (style.direction === "rtl") ctx.direction = "rtl";
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if (wholeLine && style.letterSpacing !== 0 && "letterSpacing" in spaced) {
    spaced.letterSpacing = `${style.letterSpacing}px`;
  }
  if (style.stroke && (style.strokeWidth ?? 0) > 0) {
    ctx.lineWidth = style.strokeWidth ?? 0;
    ctx.strokeStyle = style.stroke;
    ctx.miterLimit = 2;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = style.fill;
  ctx.fillText(text, x, y);
}

/** Scales [ctx] by [scale] about ([cx], [cy]). */
function scaleAbout(ctx: CanvasRenderingContext2D, scale: number, cx: number, cy: number) {
  if (scale === 1) return;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
}

/**
 * One unit of a whole-line pass, blurred: its glyphs are clipped sharp onto a scratch surface in
 * device space and composited back through the blur filter, so the haze spreads past the glyph
 * boxes without dragging the neighbouring units' ink along. Returns false when it cannot.
 */
function drawBlurredUnit(
  ctx: CanvasRenderingContext2D,
  line: UnitLine,
  intervals: Interval[],
  visual: CanvaUnitVisual,
  style: CanvaUnitTextStyle,
  layout: UnitTextLayout,
  baseAlpha: number
): boolean {
  if (typeof (ctx as { filter?: unknown }).filter !== "string") return false;
  const radius = visual.blurEm * style.fontSize;
  const pad = layout.lineHeightPx;
  const left = line.x + Math.min(...intervals.map((interval) => interval[0])) - radius * 3;
  const right = line.x + Math.max(...intervals.map((interval) => interval[1])) + radius * 3;
  const top = line.top - pad - radius * 3;
  const bottom = line.top + layout.lineHeightPx + pad + radius * 3;
  const m = ctx.getTransform();
  const corners = [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  const x0 = Math.floor(Math.min(...corners.map((c) => c[0])));
  const y0 = Math.floor(Math.min(...corners.map((c) => c[1])));
  const x1 = Math.ceil(Math.max(...corners.map((c) => c[0])));
  const y1 = Math.ceil(Math.max(...corners.map((c) => c[1])));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0 || width > 8192 || height > 8192) return false;
  const surface = blurSurface(width, height);
  if (!surface) return false;
  surface.save();
  surface.setTransform(1, 0, 0, 1, 0, 0);
  surface.clearRect(0, 0, width, height);
  surface.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
  surface.beginPath();
  for (const [a, b] of intervals) {
    surface.rect(line.x + a, line.top - pad, b - a, layout.lineHeightPx + pad * 2);
  }
  surface.clip();
  paintText(surface, line.text, line.x, line.baseline, style, layout, true);
  surface.restore();

  const deviceScale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = baseAlpha * visual.alpha;
  ctx.filter = `blur(${radius * deviceScale}px)`;
  ctx.drawImage(blurCanvas as HTMLCanvasElement, 0, 0, width, height, x0, y0, width, height);
  ctx.restore();
  return true;
}

function drawWholeLine(
  ctx: CanvasRenderingContext2D,
  line: UnitLine,
  visualOf: (unit: number) => CanvaUnitVisual,
  style: CanvaUnitTextStyle,
  layout: UnitTextLayout,
  baseAlpha: number
) {
  const pad = layout.lineHeightPx;
  const moving: Array<[Interval[], CanvaUnitVisual]> = [];
  const excluded: Interval[] = [];
  let resting = 0;
  for (const [unit, intervals] of line.units) {
    const visual = visualOf(unit);
    if (isAtRest(visual)) {
      resting += 1;
      continue;
    }
    excluded.push(...intervals);
    if (visual.alpha > HIDDEN_ALPHA) moving.push([intervals, visual]);
  }
  // Everything at rest in ONE pass, clipped only to leave out the boxes of the units that are not,
  // so glyph ink that overhangs its box (swashes, italics) survives wherever a neighbour allows.
  if (resting > 0) {
    ctx.save();
    if (excluded.length > 0) {
      ctx.beginPath();
      ctx.rect(-style.width, line.top - pad, style.width * 3, layout.lineHeightPx + pad * 2);
      for (const [a, b] of excluded) ctx.rect(line.x + a, line.top - pad, b - a, layout.lineHeightPx + pad * 2);
      ctx.clip("evenodd");
    }
    paintText(ctx, line.text, line.x, line.baseline, style, layout, true);
    ctx.restore();
  }
  for (const [intervals, visual] of moving) {
    const cx = line.x + (Math.min(...intervals.map((i) => i[0])) + Math.max(...intervals.map((i) => i[1]))) / 2;
    const cy = line.top + layout.lineHeightPx / 2;
    ctx.save();
    scaleAbout(ctx, visual.scale, cx, cy);
    const blurred =
      visual.blurEm * style.fontSize > 0.05 &&
      drawBlurredUnit(ctx, line, intervals, visual, style, layout, baseAlpha);
    if (!blurred) {
      ctx.globalAlpha = baseAlpha * visual.alpha;
      ctx.beginPath();
      for (const [a, b] of intervals) ctx.rect(line.x + a, line.top - pad, b - a, layout.lineHeightPx + pad * 2);
      ctx.clip();
      paintText(ctx, line.text, line.x, line.baseline, style, layout, true);
    }
    ctx.restore();
  }
}

function drawLetters(
  ctx: CanvasRenderingContext2D,
  line: UnitLine,
  visualOf: (unit: number) => CanvaUnitVisual,
  style: CanvaUnitTextStyle,
  layout: UnitTextLayout,
  baseAlpha: number
) {
  const supportsFilter = typeof (ctx as { filter?: unknown }).filter === "string";
  for (const letter of line.letters ?? []) {
    const visual = visualOf(letter.unit);
    if (visual.alpha <= HIDDEN_ALPHA) continue;
    ctx.save();
    ctx.globalAlpha = baseAlpha * visual.alpha;
    scaleAbout(ctx, visual.scale, letter.x + letter.width / 2, line.top + layout.lineHeightPx / 2);
    const radius = visual.blurEm * style.fontSize;
    if (supportsFilter && radius > 0.05) {
      const m = ctx.getTransform();
      ctx.filter = `blur(${radius * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c))}px)`;
    }
    paintText(ctx, letter.text, letter.x, line.baseline, style, layout, false);
    ctx.restore();
  }
}

function drawCanvaUnitText(
  context: Konva.Context,
  layout: UnitTextLayout,
  style: CanvaUnitTextStyle,
  motion: GlyphMotionSpec
) {
  const ctx = context._context;
  const schedule = cachedCanvaUnitSchedule({
    type: motion.type,
    fill: Boolean(motion.fill),
    intensity: motion.intensity ?? 1,
    seed: motion.seed,
    durationMs: motion.durationMs,
    exiting: Boolean(motion.isExiting),
    unitCount: layout.unitCount,
  });
  if (!schedule) return;
  const progress = motion.rawProgress ?? motion.progress;
  const visuals = new Map<number, CanvaUnitVisual>();
  const visualOf = (unit: number) => {
    let visual = visuals.get(unit);
    if (!visual) {
      visual = canvaUnitVisualAt(schedule, unit, progress);
      visuals.set(unit, visual);
    }
    return visual;
  };
  const baseAlpha = ctx.globalAlpha;
  ctx.save();
  // Succession's element scale multiplies the layer's, about the layer centre.
  scaleAbout(ctx, canvaUnitElementScaleAt(schedule, progress), style.width / 2, style.height / 2);
  for (const line of layout.lines) {
    if (line.letters) drawLetters(ctx, line, visualOf, style, layout, baseAlpha);
    else drawWholeLine(ctx, line, visualOf, style, layout, baseAlpha);
  }
  ctx.restore();
}

export default function CanvaUnitText({
  nodeProps,
  style,
  motion,
}: {
  /** The layer's node props (ref, id, pose, handlers…), exactly as the static <Text> gets them. */
  nodeProps: Record<string, unknown>;
  style: CanvaUnitTextStyle;
  motion: GlyphMotionSpec;
}) {
  // Cached per style and loaded-font generation inside layoutCanvaUnitText.
  const layout = layoutCanvaUnitText(style, canvaUnitMode(motion.unit) ?? 1);
  return (
    <Shape
      {...nodeProps}
      width={style.width}
      height={style.height}
      // Never painted by Konva (the scene function draws everything); it only makes the hit
      // region fill, so the layer stays clickable while it plays.
      fill={style.fill}
      sceneFunc={(context) => drawCanvaUnitText(context, layout, style, motion)}
      hitFunc={(context, shape) => {
        context.beginPath();
        context.rect(0, 0, style.width, style.height);
        context.closePath();
        context.fillStrokeShape(shape);
      }}
    />
  );
}
