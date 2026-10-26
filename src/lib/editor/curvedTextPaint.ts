/**
 * Draws curved text the way the app does (lib/editor/curvedText.ts has the model): each line is
 * SHAPED WHOLE by the browser — so Arabic joins, ligatures, kerning and bidi are exactly the
 * browser's own straight rendering — then that flat line is bent onto its arc. The app warps the
 * line's vector outline point by point (`wx = p.x − y·sin r`, `wy = p.y + y·cos r`); a canvas has no
 * glyph outlines, so the flat line is drawn once into an offscreen bitmap at the screen's resolution
 * and bent in one-device-pixel columns, each placed on the arc at its own advance and turned to
 * the tangent — the same warp, sampled per column instead of per outline point.
 *
 * Stroke goes under the fill (round joins), a gradient fill is laid over the bent ink's bounds
 * (the app's brush over the warped path's bounds), and the shadow is cast by the finished drawing.
 * Results are cached per text, style and resolution, so a redraw is one drawImage.
 */
import {
  buildCurvedRingStretch,
  containsArabic,
  curvedTextFrame,
  isClosedRingArc,
  placeAtAdvance,
  resolveCurvedArc,
  type CurvedRingStretch,
} from "@/lib/editor/curvedText";
import { gradientFillStyle, layoutRichText, paintRichText, richFontString, richTextFontGeneration, type RichTextInput } from "@/lib/editor/richText";
import { textFillKonvaProps } from "@/lib/editor/textFill";
import type { TextSpan } from "@/lib/editor/textSpans";

export interface CurvedTextPaintInput {
  text: string;
  /** The layer's box (the frame the arcs are centred in). */
  width: number;
  height: number;
  fontSize: number;
  /** Already a CSS family list (resolveCssFontFamily). */
  fontFamily: string;
  fontWeight: string;
  fontStyle: "normal" | "italic";
  lineHeight: number;
  letterSpacing: number;
  color: string;
  stroke: string;
  /** Rendered outline thickness, px (resolveTextStrokeWidthPx). */
  strokeWidthPx: number;
  /** The layer's raw textFill (gradient), or null. */
  textFill: unknown;
  /** Multi-style ranges (families already CSS lists); on a curve only colour, outline and highlight apply. */
  spans: TextSpan[];
  arcDegrees: number;
  ringSpread: number;
  shadow: { color: string; blur: number; offsetX: number; offsetY: number } | null;
}

type SpacedContext = CanvasRenderingContext2D & { letterSpacing?: string; wordSpacing?: string };

let scratch: SpacedContext | null = null;
function scratchContext(): SpacedContext | null {
  if (scratch) return scratch;
  if (typeof document === "undefined") return null;
  scratch = document.createElement("canvas").getContext("2d") as SpacedContext | null;
  return scratch;
}

function fontOf(input: CurvedTextPaintInput) {
  return richFontString({
    fontStyle: input.fontStyle,
    fontWeight: input.fontWeight,
    fontSize: input.fontSize,
    fontFamily: input.fontFamily,
  });
}

function setTextState(ctx: SpacedContext, font: string, rtl: boolean, letterSpacing: number, wordSpacing: number) {
  ctx.font = font;
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${letterSpacing}px`;
  if ("wordSpacing" in ctx) ctx.wordSpacing = `${wordSpacing}px`;
}

export interface CurvedTextLine {
  /** The line as authored. */
  source: string;
  stretch: CurvedRingStretch;
  /** The stretched line's advance, letter and word spacing included. */
  advance: number;
  rtl: boolean;
}

export interface CurvedTextMeasure {
  lines: CurvedTextLine[];
  ascent: number;
  descent: number;
}

/** Each line measured and stretched (the Size slider), as the app does before laying it on its arc. */
export function measureCurvedText(input: CurvedTextPaintInput): CurvedTextMeasure | null {
  const ctx = scratchContext();
  if (!ctx) return null;
  const font = fontOf(input);
  const closed = isClosedRingArc(input.arcDegrees);
  setTextState(ctx, font, false, 0, 0);
  const metrics = ctx.measureText("M");
  const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? input.fontSize * 0.8;
  const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? input.fontSize * 0.2;
  const tatweelWidth = ctx.measureText("ـ").width;
  const lines = String(input.text || "")
    .split("\n")
    .map((source) => {
      const rtl = containsArabic(source);
      setTextState(ctx, font, rtl, input.letterSpacing, 0);
      const natural = ctx.measureText(source).width;
      const stretch = buildCurvedRingStretch(source, input.ringSpread, natural, tatweelWidth, closed);
      setTextState(ctx, font, rtl, input.letterSpacing, stretch.extraWordSpacing);
      const advance = ctx.measureText(stretch.text).width;
      return { source, stretch, advance, rtl };
    });
  setTextState(ctx, font, false, 0, 0);
  return { lines, ascent, descent };
}

/** The box this curved text should have (the app's derived frame), or null before it can be measured. */
export function curvedTextFrameFor(
  input: CurvedTextPaintInput,
  padding?: { x: number; y: number } | null
): { width: number; height: number } | null {
  const measured = measureCurvedText(input);
  if (!measured || measured.lines.length === 0) return null;
  const widest = Math.max(1, ...measured.lines.map((line) => line.advance));
  return curvedTextFrame({
    widestLineAdvance: widest,
    lineCount: measured.lines.length,
    fontSize: input.fontSize,
    lineHeight: input.lineHeight,
    arcDegrees: input.arcDegrees,
    ...(padding ? { paddingX: padding.x, paddingY: padding.y } : {}),
  });
}

// ── drawing ──────────────────────────────────────────────────────────────────────────────────────

const CACHE_LIMIT = 48;
const cache = new Map<string, { canvas: HTMLCanvasElement; margin: number; resolution: number }>();

function newCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

/** Span styles a curve honours — the app's toCurvedPaintRanges: colour, outline, highlight. */
function paintOnlySpans(spans: TextSpan[]): TextSpan[] {
  return spans
    .map((span) => {
      const kept: TextSpan = { start: span.start, end: span.end };
      for (const key of ["color", "stroke", "strokeWidth", "highlightColor", "highlightOpacity"] as const) {
        if (span[key] !== undefined) (kept as unknown as Record<string, unknown>)[key] = span[key];
      }
      return kept;
    })
    .filter((span) => Object.keys(span).length > 2);
}

/** A line's spans, in its own (stretched) offsets: tatweels inserted after a character shift what follows. */
function lineSpans(spans: TextSpan[], lineStart: number, line: CurvedTextLine): TextSpan[] {
  const map: number[] = [];
  let shifted = 0;
  for (let index = 0; index <= line.source.length; index += 1) {
    map.push(index + shifted);
    if (index < line.source.length) shifted += line.stretch.insertedAfter[index] || 0;
  }
  const lineEnd = lineStart + line.source.length;
  return spans
    .filter((span) => span.end > lineStart && span.start < lineEnd)
    .map((span) => ({
      ...span,
      start: map[Math.max(span.start, lineStart) - lineStart],
      // A range that ends after a joining point keeps that point's tatweels.
      end: map[Math.min(span.end, lineEnd) - lineStart],
    }))
    .filter((span) => span.end > span.start);
}

/** The flat line, shaped by the browser, drawn into a bitmap with its baseline at (margin, margin + ascent). */
function drawFlatLine(
  input: CurvedTextPaintInput,
  line: CurvedTextLine,
  lineStart: number,
  measure: CurvedTextMeasure,
  margin: number,
  resolution: number,
  layer: "stroke" | "fill" | "mask"
) {
  const width = (line.advance + margin * 2) * resolution;
  const height = (measure.ascent + measure.descent + margin * 2) * resolution;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext("2d") as SpacedContext | null;
  if (!ctx) return canvas;
  ctx.scale(resolution, resolution);
  const baselineY = margin + measure.ascent;
  const spans = layer === "fill" ? lineSpans(paintOnlySpans(input.spans), lineStart, line) : [];
  if (spans.length > 0) {
    // Ranged colour / outline / highlight: the straight rich painter on the one line.
    const richInput: RichTextInput = {
      text: line.stretch.text,
      width: line.advance + margin * 4,
      height: null,
      fontSize: input.fontSize,
      fontFamily: input.fontFamily,
      fontWeight: input.fontWeight,
      fontStyle: input.fontStyle,
      lineHeight: input.lineHeight,
      align: "left",
      direction: line.rtl ? "rtl" : "ltr",
      letterSpacing: input.letterSpacing,
      color: input.color,
      textDecoration: "",
      stroke: input.stroke,
      strokeWidth: 0,
      spans,
      gradient: null,
    };
    const layout = layoutRichText(richInput, null);
    const first = layout.lines[0];
    if (first) {
      ctx.save();
      ctx.translate(margin - first.x, baselineY - first.baseline);
      paintRichText(ctx, layout, richInput);
      ctx.restore();
      return canvas;
    }
  }
  setTextState(ctx, fontOf(input), line.rtl, input.letterSpacing, line.stretch.extraWordSpacing);
  if (layer === "stroke") {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = input.strokeWidthPx;
    ctx.strokeStyle = input.stroke;
    ctx.strokeText(line.stretch.text, margin, baselineY);
  } else {
    ctx.fillStyle = layer === "mask" ? "#ffffff" : input.color;
    ctx.fillText(line.stretch.text, margin, baselineY);
  }
  return canvas;
}

interface InkBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Bends [flat] onto [arc] into [target], one device-pixel column at a time. Box px map to the
 * target as `resolution × p + offset`. Grows [ink] (box px) by every column it places.
 */
function warpLine(
  target: CanvasRenderingContext2D,
  flat: HTMLCanvasElement,
  arc: ReturnType<typeof resolveCurvedArc>,
  bandTop: number,
  lineMargin: number,
  ascent: number,
  resolution: number,
  offset: number,
  ink: InkBounds
) {
  const columnWidth = 1 / resolution;
  const flatHeight = flat.height / resolution;
  const top = -(lineMargin + ascent);
  for (let column = 0; column < flat.width; column += 1) {
    const advance = column / resolution - lineMargin + columnWidth / 2;
    const p = placeAtAdvance(arc, advance);
    const cos = Math.cos(p.rotation);
    const sin = Math.sin(p.rotation);
    const x = p.x;
    const y = p.y + bandTop;
    target.setTransform(
      resolution * cos,
      resolution * sin,
      -resolution * sin,
      resolution * cos,
      resolution * x + offset,
      resolution * y + offset
    );
    // Each column a hair wider than its slot so neighbours overlap and no seam shows on a bend.
    target.drawImage(flat, column, 0, 1, flat.height, -columnWidth / 2, top, columnWidth * 1.6, flatHeight);
    for (const ly of [top, top + flatHeight]) {
      const cx = x - ly * sin;
      const cy = y + ly * cos;
      if (cx < ink.minX) ink.minX = cx;
      if (cx > ink.maxX) ink.maxX = cx;
      if (cy < ink.minY) ink.minY = cy;
      if (cy > ink.maxY) ink.maxY = cy;
    }
  }
}

function renderCurvedText(input: CurvedTextPaintInput, resolution: number) {
  const measure = measureCurvedText(input);
  if (!measure) return null;
  const lineCount = Math.max(1, measure.lines.length);
  const bandHeight = Math.max(1, input.height) / lineCount;
  const lineMargin = Math.ceil(input.fontSize * 0.6 + input.strokeWidthPx);
  // The bent text may reach past the box (the app does not clip it): give the bitmap room.
  const margin = Math.ceil(input.fontSize * 1.5 + input.strokeWidthPx);
  const width = (Math.max(1, input.width) + margin * 2) * resolution;
  const height = (Math.max(1, input.height) + margin * 2) * resolution;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const offset = margin * resolution;
  const gradientProps = input.textFill ? textFillKonvaProps(input.textFill, 1, 1) : {};
  const hasGradient = Object.keys(gradientProps).length > 0;
  const hasStroke = input.strokeWidthPx > 0 && Boolean(String(input.stroke || "").trim());
  const ink: InkBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const shift = (measure.ascent - measure.descent) / 2;

  const warpAll = (target: CanvasRenderingContext2D, layer: "stroke" | "fill" | "mask") => {
    let lineStart = 0;
    measure.lines.forEach((line, index) => {
      if (line.source.trim()) {
        const arc = resolveCurvedArc(line.advance, input.arcDegrees, input.width, bandHeight, shift);
        const flat = drawFlatLine(input, line, lineStart, measure, lineMargin, resolution, layer);
        warpLine(target, flat, arc, index * bandHeight, lineMargin, measure.ascent, resolution, offset, ink);
      }
      lineStart += line.source.length + 1;
    });
    target.setTransform(1, 0, 0, 1, 0, 0);
  };

  if (hasStroke) warpAll(ctx, "stroke");
  if (hasGradient) {
    const fillCanvas = newCanvas(width, height);
    const fillCtx = fillCanvas.getContext("2d");
    if (fillCtx) {
      warpAll(fillCtx, "mask");
      // The app's brush spans the bent ink's bounds, in page axes.
      const inkWidth = Math.max(1, ink.maxX - ink.minX);
      const inkHeight = Math.max(1, ink.maxY - ink.minY);
      const props = textFillKonvaProps(input.textFill, inkWidth, inkHeight, -ink.minX, -ink.minY);
      fillCtx.setTransform(resolution, 0, 0, resolution, offset, offset);
      fillCtx.globalCompositeOperation = "source-in";
      fillCtx.fillStyle = gradientFillStyle(fillCtx, props) || input.color;
      fillCtx.fillRect(-margin, -margin, width / resolution, height / resolution);
      fillCtx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(fillCanvas, 0, 0);
    }
  } else {
    warpAll(ctx, "fill");
  }
  return { canvas, margin, resolution };
}

/** Steps of ¼ so a zoom gesture does not re-render on every frame; 0.25 … 4. */
function quantizedResolution(scale: number) {
  const value = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return Math.max(0.25, Math.min(4, Math.ceil(value * 4) / 4));
}

/**
 * Paints the curved text in the node's local coordinates (0,0 = the box's top-left). The caller's
 * context carries the node's transform and opacity; the shadow is applied here, in device px.
 */
export function paintCurvedText(ctx: CanvasRenderingContext2D, input: CurvedTextPaintInput) {
  if (typeof document === "undefined" || !String(input.text || "").trim()) return;
  const transform = ctx.getTransform();
  const sceneScale = Math.hypot(transform.a, transform.b) || 1;
  const resolution = quantizedResolution(sceneScale);
  const key = JSON.stringify([input.text, input.width, input.height, input.fontSize, input.fontFamily, input.fontWeight, input.fontStyle, input.lineHeight, input.letterSpacing, input.color, input.stroke, input.strokeWidthPx, input.textFill ?? null, input.spans, input.arcDegrees, input.ringSpread, resolution, richTextFontGeneration()]);
  let entry = cache.get(key);
  if (!entry) {
    const rendered = renderCurvedText(input, resolution);
    if (!rendered) return;
    entry = rendered;
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, entry);
  }
  ctx.save();
  if (input.shadow) {
    ctx.shadowColor = input.shadow.color;
    ctx.shadowBlur = input.shadow.blur * sceneScale;
    ctx.shadowOffsetX = input.shadow.offsetX * sceneScale;
    ctx.shadowOffsetY = input.shadow.offsetY * sceneScale;
  }
  ctx.drawImage(
    entry.canvas,
    -entry.margin,
    -entry.margin,
    entry.canvas.width / entry.resolution,
    entry.canvas.height / entry.resolution
  );
  ctx.restore();
}
