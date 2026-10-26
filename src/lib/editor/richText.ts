/**
 * Drawing a multi-style text layer (lib/editor/textSpans.ts) on the canvas.
 *
 * Two layouts, chosen by what the spans change:
 *
 *  • PAINT-only spans (colour, outline, decoration, highlight) leave every glyph where the plain
 *    text puts it, so the layout IS Konva's: its wrapped lines (`textArr`), its baseline, its
 *    alignment. Each line is painted WHOLE once per paint style and clipped to that style's glyph
 *    boxes — measured by the browser's own layout (DOM ranges), so bidi runs, ligatures and Arabic
 *    joining land exactly where the canvas draws them, and a colour change in the middle of an
 *    Arabic word keeps the word joined. Unstyled parts are pixel-identical to the plain <Text>.
 *
 *  • METRIC spans (font, weight, italic, size, letter spacing) move glyphs, so the lines are wrapped
 *    here — Konva's own algorithm (longest prefix that fits, back to the last space or dash, trim),
 *    measuring each run in its own font — and every line gets the height of the text's biggest run:
 *    line height = layer lineHeight × the largest font size in the TEXT (one line height the app's
 *    engines express exactly), all runs of a line on one alphabetic baseline centred like Konva's
 *    (lineTop + lineH/2 + (ascent − descent)/2 of the line's biggest font).
 *    Runs are placed by the browser's layout of the line (spans in an isolated off-screen element)
 *    and drawn piece by piece; where a run boundary splits a joined Arabic word, a ZWJ on each side
 *    keeps the letters' joining forms.
 *
 * Highlight band: one rounded rect per run piece, as wide as the piece's glyph boxes plus 0.1 em on
 * each side, 1.2 em tall centred on the line box, radius 0.25 em (em = the run's font size). The
 * app draws the same band.
 */
import Konva from "konva";
import { stringToArray } from "konva/lib/shapes/Text";
// Side effect: Konva measures RTL letter spacing the way it draws it (kept identical here).
import "@/lib/editor/konvaTextPatches";

import { canvaWrappedLineRanges } from "@/lib/editor/animationCanvaUnits";
import { isCanvaCombiningMark } from "@/lib/editor/animationCanvaMarks";
import { resolveTextStrokeWidthPx } from "@/lib/editor/textStroke";
import {
  resolveTextRunStyle,
  textSpanBaseStyle,
  textSpanRuns,
  textSpansAffectLayout,
  type ResolvedTextRunStyle,
  type TextSpan,
} from "@/lib/editor/textSpans";

export const TEXT_HIGHLIGHT_HEIGHT_EM = 1.2;
export const TEXT_HIGHLIGHT_PADDING_X_EM = 0.1;
export const TEXT_HIGHLIGHT_RADIUS_EM = 0.25;

export interface RichTextInput {
  text: string;
  /** The box width = the wrap column. */
  width: number;
  /** The box height (Konva drops lines past it); null for an unconstrained measurement. */
  height: number | null;
  fontSize: number;
  /** Already a CSS family list (resolveCssFontFamily). */
  fontFamily: string;
  fontWeight: string;
  fontStyle: "normal" | "italic";
  lineHeight: number;
  align: "left" | "center" | "right" | "justify";
  direction: "rtl" | "ltr";
  letterSpacing: number;
  color: string;
  textDecoration: string;
  stroke: string;
  /** 0–100 (lib/editor/textStroke.ts). */
  strokeWidth: number;
  /** Span `fontFamily` values already resolved to CSS family lists. */
  spans: TextSpan[];
  /** Konva gradient props for the layer's fill (textFillKonvaProps), or null for flat colour. */
  gradient?: Record<string, unknown> | null;
}

type Interval = [number, number];

interface RichPiece {
  /** Source offsets. */
  start: number;
  end: number;
  /** What is drawn (the source slice, with ZWJ context where a joined word is split). */
  drawText: string;
  style: ResolvedTextRunStyle;
  font: string;
  direction: "rtl" | "ltr";
  /** Glyph boxes, relative to the line's left edge. */
  intervals: Interval[];
}

interface RichLine {
  start: number;
  end: number;
  text: string;
  /** Left edge (alignment offset), layer px. */
  x: number;
  width: number;
  top: number;
  height: number;
  baseline: number;
  pieces: RichPiece[];
  /** Konva's per-letter path (LTR with letter spacing or justify): each letter on its own. */
  letters: Array<{ text: string; x: number; style: ResolvedTextRunStyle }> | null;
}

export interface RichTextLayout {
  /** True when the lines are Konva's (paint-only spans): each line is painted whole and clipped. */
  konvaLines: boolean;
  font: string;
  base: ResolvedTextRunStyle;
  lines: RichLine[];
  /** Widest line. */
  width: number;
  /** All line boxes stacked. */
  height: number;
}

// ── Fonts ─────────────────────────────────────────────────────────────────────────────────────────

let fontGeneration = 0;
let fontListenerInstalled = false;

/** Bumps whenever the document finishes loading fonts: a layout measured before is stale. */
export function richTextFontGeneration(): number {
  if (!fontListenerInstalled && typeof document !== "undefined" && document.fonts?.addEventListener) {
    fontListenerInstalled = true;
    document.fonts.addEventListener("loadingdone", () => {
      fontGeneration += 1;
      LAYOUT_CACHE.clear();
      METRICS_CACHE.clear();
    });
  }
  return fontGeneration;
}

/** The weight/style part of Konva's font shorthand ("700", "italic 400") — CanvasEditor's rule. */
export function richKonvaFontStyle(fontStyle: string, fontWeight: string) {
  const parsed = Number.parseInt(String(fontWeight || "").replace(/[^\d]/g, ""), 10);
  const weight = Number.isFinite(parsed)
    ? Math.max(100, Math.min(900, parsed))
    : /bold/i.test(String(fontWeight || ""))
      ? 700
      : 400;
  return fontStyle === "italic" ? `italic ${weight}` : String(weight);
}

/** Konva's normalizeFontFamily: quote families with spaces. */
function quoteFamilies(family: string) {
  return String(family || "")
    .split(",")
    .map((part) => {
      const name = part.trim();
      return name.includes(" ") && !/["']/.test(name) ? `"${name}"` : name;
    })
    .join(", ");
}

/** Konva's `_getContextFont()` for a run. */
export function richFontString(style: Pick<ResolvedTextRunStyle, "fontStyle" | "fontWeight" | "fontSize" | "fontFamily">) {
  return `${richKonvaFontStyle(style.fontStyle, style.fontWeight)} normal ${style.fontSize}px ${quoteFamilies(style.fontFamily)}`;
}

/** Every `weight style family` a text needs loaded (`document.fonts.load` descriptors, 16px). */
export function richTextFontDescriptors(input: Pick<RichTextInput, "fontFamily" | "fontWeight" | "fontStyle" | "fontSize" | "spans" | "text" | "color" | "letterSpacing" | "textDecoration" | "stroke" | "strokeWidth">) {
  const base = baseStyleOf(input as RichTextInput);
  const seen = new Set<string>();
  const descriptors: string[] = [];
  for (const run of textSpanRuns(input.text, input.spans)) {
    const style = resolveTextRunStyle(base, run.style);
    const descriptor = richFontString({ ...style, fontSize: 16 });
    if (!seen.has(descriptor)) {
      seen.add(descriptor);
      descriptors.push(descriptor);
    }
  }
  return descriptors;
}

// ── Measuring ─────────────────────────────────────────────────────────────────────────────────────

type SpacedContext = CanvasRenderingContext2D & { letterSpacing?: string };

let measureContext: SpacedContext | null = null;

function context2d(): SpacedContext | null {
  if (!measureContext && typeof document !== "undefined") {
    measureContext = document.createElement("canvas").getContext("2d") as SpacedContext | null;
  }
  return measureContext;
}

/** Konva's width rule (with the RTL letter-spacing patch): what a run of [text] advances. */
function measureRun(font: string, letterSpacing: number, direction: "rtl" | "ltr", text: string): number {
  const ctx = context2d();
  if (!ctx || !text) return 0;
  ctx.font = font;
  if (letterSpacing !== 0 && direction === "rtl" && "letterSpacing" in ctx) {
    ctx.direction = "rtl";
    ctx.letterSpacing = `${letterSpacing}px`;
    const width = ctx.measureText(text).width;
    ctx.letterSpacing = "0px";
    ctx.direction = "ltr";
    return width;
  }
  return ctx.measureText(text).width + letterSpacing * text.length;
}

const METRICS_CACHE = new Map<string, { ascent: number; descent: number }>();

function fontMetrics(font: string, fontSize: number) {
  const cached = METRICS_CACHE.get(font);
  if (cached) return cached;
  const ctx = context2d();
  let ascent = fontSize * 0.8;
  let descent = fontSize * 0.2;
  if (ctx) {
    ctx.font = font;
    ctx.textBaseline = "alphabetic";
    const metrics = ctx.measureText("M");
    ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? ascent;
    descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? descent;
  }
  const result = { ascent, descent };
  METRICS_CACHE.set(font, result);
  return result;
}

// ── Arabic joining across run boundaries ─────────────────────────────────────────────────────────

const ZWJ = "‍";

// Right-joining Arabic letters (Unicode ArabicShaping "R"): they join the letter BEFORE them only.
const RIGHT_JOINING = new Set<number>([
  0x622, 0x623, 0x624, 0x625, 0x627, 0x629, 0x62f, 0x630, 0x631, 0x632, 0x648, 0x671, 0x672, 0x673, 0x675,
  0x676, 0x677, 0x688, 0x689, 0x68a, 0x68b, 0x68c, 0x68d, 0x68e, 0x68f, 0x690, 0x691, 0x692, 0x693, 0x694,
  0x695, 0x696, 0x697, 0x698, 0x699, 0x6c0, 0x6c3, 0x6c4, 0x6c5, 0x6c6, 0x6c7, 0x6c8, 0x6c9, 0x6ca, 0x6cb,
  0x6cd, 0x6cf, 0x6d2, 0x6d3, 0x6d5, 0x6ee, 0x6ef, 0x759, 0x75a, 0x75b, 0x76b, 0x76c, 0x771, 0x773, 0x774,
  0x778, 0x779, 0x8aa, 0x8ab, 0x8ac, 0x8ae, 0x8b1, 0x8b2, 0x8b9,
]);

type JoiningType = "D" | "R" | "C" | "T" | "U";

function joiningType(codePoint: number): JoiningType {
  if (codePoint === 0x200d || codePoint === 0x640) return "C";
  if (isCanvaCombiningMark(codePoint)) return "T";
  if (RIGHT_JOINING.has(codePoint)) return "R";
  if (codePoint === 0x621 || codePoint === 0x674) return "U";
  if (
    (codePoint >= 0x620 && codePoint <= 0x64a) ||
    (codePoint >= 0x66e && codePoint <= 0x6d3) ||
    (codePoint >= 0x6fa && codePoint <= 0x6fc) ||
    codePoint === 0x6ff ||
    (codePoint >= 0x750 && codePoint <= 0x77f) ||
    (codePoint >= 0x8a0 && codePoint <= 0x8c9)
  ) {
    return "D";
  }
  return "U";
}

/** True when the letters either side of [boundary] are joined in the full text. */
function joinedAcross(text: string, boundary: number) {
  if (boundary <= 0 || boundary >= text.length) return false;
  let before = boundary - 1;
  while (before >= 0 && joiningType(text.charCodeAt(before)) === "T") before -= 1;
  let after = boundary;
  while (after < text.length && joiningType(text.charCodeAt(after)) === "T") after += 1;
  if (before < 0 || after >= text.length) return false;
  const left = joiningType(text.charCodeAt(before));
  const right = joiningType(text.charCodeAt(after));
  return (left === "D" || left === "C") && (right === "D" || right === "R" || right === "C");
}

/** The slice [start, end) of [text] with a ZWJ wherever a joined word continues past either end. */
function withJoiningContext(text: string, start: number, end: number) {
  const slice = text.slice(start, end);
  return `${joinedAcross(text, start) ? ZWJ : ""}${slice}${joinedAcross(text, end) ? ZWJ : ""}`;
}

// ── Direction runs ────────────────────────────────────────────────────────────────────────────────

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHAR = /\p{L}/u;

/**
 * [start, end) cut where the strong direction changes (Arabic/Hebrew letters vs other letters);
 * digits, spaces and punctuation stay with the run before them. Each piece is then laid and drawn
 * in its own direction, so the bidi order the browser gives the line is never fought.
 */
function directionPieces(text: string, start: number, end: number, fallback: "rtl" | "ltr") {
  const pieces: Array<{ start: number; end: number; direction: "rtl" | "ltr" }> = [];
  let pieceStart = start;
  let current: "rtl" | "ltr" | null = null;
  let offset = start;
  for (const char of text.slice(start, end)) {
    const strong: "rtl" | "ltr" | null = RTL_CHAR.test(char) ? "rtl" : LTR_CHAR.test(char) ? "ltr" : null;
    if (strong && current && strong !== current) {
      pieces.push({ start: pieceStart, end: offset, direction: current });
      pieceStart = offset;
    }
    if (strong) current = strong;
    offset += char.length;
  }
  if (end > pieceStart) pieces.push({ start: pieceStart, end, direction: current ?? fallback });
  return pieces;
}

// ── Browser layout of one line ────────────────────────────────────────────────────────────────────

/**
 * The glyph boxes of each segment of one line as the browser lays the line out (bidi reordering,
 * shaping and joining across segments included), relative to the line's left edge, and the line's
 * width. Falls back to summed canvas widths without a DOM.
 */
function measureLineSegments(
  segments: Array<{ text: string; font: string; letterSpacing: number; direction: "rtl" | "ltr" }>,
  direction: "rtl" | "ltr",
  wordSpacing = 0
): { intervals: Interval[][]; width: number } {
  if (typeof document === "undefined" || !document.body) {
    const widths = segments.map((segment) => measureRun(segment.font, segment.letterSpacing, segment.direction, segment.text));
    const total = widths.reduce((sum, width) => sum + width, 0);
    let cursor = direction === "rtl" ? total : 0;
    const intervals = widths.map((width) => {
      if (direction === "rtl") {
        cursor -= width;
        return [[cursor, cursor + width] as Interval];
      }
      cursor += width;
      return [[cursor - width, cursor] as Interval];
    });
    return { intervals, width: total };
  }
  const host = document.createElement("span");
  host.style.cssText =
    "position:absolute;left:-100000px;top:0;visibility:hidden;white-space:pre;display:inline-block;pointer-events:none;unicode-bidi:isolate;font-kerning:normal;";
  host.style.direction = direction;
  if (wordSpacing) host.style.wordSpacing = `${wordSpacing}px`;
  const children = segments.map((segment) => {
    const child = document.createElement("span");
    child.style.font = segment.font;
    child.style.letterSpacing = `${segment.letterSpacing}px`;
    child.textContent = segment.text;
    host.appendChild(child);
    return child;
  });
  document.body.appendChild(host);
  try {
    const box = host.getBoundingClientRect();
    const range = document.createRange();
    const intervals = children.map((child) => {
      const node = child.firstChild;
      if (!node) return [];
      range.selectNodeContents(node);
      return Array.from(range.getClientRects())
        .filter((rect) => rect.width > 0)
        .map((rect) => [rect.left - box.left, rect.right - box.left] as Interval);
    });
    return { intervals, width: box.width };
  } finally {
    host.remove();
  }
}

/** Glyph boxes of [ranges] of a single-font line (CanvaUnitText's measureGlyphIntervals). */
function measureUniformIntervals(
  lineText: string,
  font: string,
  letterSpacing: number,
  direction: "rtl" | "ltr",
  ranges: Interval[]
): Interval[][] {
  if (typeof document === "undefined" || !document.body) {
    const total = measureRun(font, letterSpacing, direction, lineText);
    return ranges.map(([start, end]) => {
      const a = measureRun(font, letterSpacing, direction, lineText.slice(0, start));
      const b = measureRun(font, letterSpacing, direction, lineText.slice(0, end));
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

// ── Layout ────────────────────────────────────────────────────────────────────────────────────────

const LAYOUT_CACHE = new Map<string, RichTextLayout>();
const LAYOUT_CACHE_LIMIT = 64;

function baseStyleOf(input: RichTextInput): ResolvedTextRunStyle {
  return textSpanBaseStyle({
    fontFamily: input.fontFamily,
    fontWeight: input.fontWeight,
    fontStyle: input.fontStyle,
    fontSize: input.fontSize,
    color: input.color,
    letterSpacing: input.letterSpacing,
    textDecoration: input.textDecoration,
    stroke: input.stroke,
    strokeWidth: input.strokeWidth,
  });
}

function alignOffset(align: RichTextInput["align"], boxWidth: number, lineWidth: number) {
  if (align === "right") return boxWidth - lineWidth;
  if (align === "center") return (boxWidth - lineWidth) / 2;
  return 0;
}

/** Paint-only spans: Konva's own lines, each run's glyph boxes on them. */
function layoutOnKonvaLines(input: RichTextInput, base: ResolvedTextRunStyle): RichTextLayout {
  const node = new Konva.Text({
    text: input.text,
    width: input.width,
    ...(input.height !== null ? { height: input.height } : {}),
    fontSize: input.fontSize,
    fontFamily: input.fontFamily,
    fontStyle: richKonvaFontStyle(input.fontStyle, input.fontWeight),
    fontVariant: "normal",
    lineHeight: input.lineHeight,
    align: input.align,
    direction: input.direction,
    letterSpacing: input.letterSpacing,
    wrap: "word",
  });
  const konvaLines = node.textArr.map((line) => ({
    text: line.text,
    width: line.width,
    lastInParagraph: line.lastInParagraph,
  }));
  const lineHeightPx = input.lineHeight * input.fontSize;
  const legacy = Boolean((Konva as unknown as { legacyTextRendering?: boolean }).legacyTextRendering);
  let firstBaseline = lineHeightPx / 2;
  if (!legacy) {
    const metrics = node.measureSize("M");
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
    firstBaseline = (ascent - descent) / 2 + lineHeightPx / 2;
  }
  const font = node._getContextFont();
  node.destroy();

  const runs = textSpanRuns(input.text, input.spans);
  const ranges = canvaWrappedLineRanges(input.text, konvaLines);
  const perLetter = input.direction !== "rtl" && (input.letterSpacing !== 0 || input.align === "justify");
  let width = 0;
  const lines: RichLine[] = konvaLines.map((line, index) => {
    const range = ranges[index] ?? { start: 0, end: 0, paragraph: 0 };
    const x = alignOffset(input.align, input.width, line.width);
    width = Math.max(width, line.width);
    const top = index * lineHeightPx;
    const baseline = firstBaseline + (konvaLines.length > 1 ? index * lineHeightPx : 0);
    const owned = runs
      .filter((run) => run.end > range.start && run.start < range.end)
      .map((run) => ({
        start: Math.max(run.start, range.start),
        end: Math.min(run.end, range.end),
        style: resolveTextRunStyle(base, run.style),
      }));

    if (perLetter) {
      // Konva's per-letter path: its own letters, advanced exactly as it advances them.
      const letters: NonNullable<RichLine["letters"]> = [];
      const spaces = line.text.split(" ").length - 1;
      const pieces: RichPiece[] = [];
      let cursorX = 0;
      let offset = range.start;
      for (const letter of stringToArray(line.text)) {
        if (letter === " " && !line.lastInParagraph && input.align === "justify" && spaces > 0) {
          cursorX += (input.width - line.width) / spaces;
        }
        const advance = measureRun(font, 0, "ltr", letter);
        const owner = owned.find((entry) => offset >= entry.start && offset < entry.end);
        const style = owner?.style ?? base;
        letters.push({ text: letter, x: cursorX, style });
        const last = pieces[pieces.length - 1];
        const interval: Interval = [cursorX, cursorX + advance];
        if (last && last.style === style) last.intervals.push(interval);
        else pieces.push({ start: offset, end: offset + letter.length, drawText: letter, style, font, direction: "ltr", intervals: [interval] });
        cursorX += advance + input.letterSpacing;
        offset += letter.length;
      }
      return { start: range.start, end: range.end, text: line.text, x, width: line.width, top, height: lineHeightPx, baseline, pieces, letters };
    }

    const intervals = measureUniformIntervals(
      line.text,
      font,
      input.letterSpacing,
      input.direction,
      owned.map((entry) => [entry.start - range.start, entry.end - range.start] as Interval)
    );
    const pieces: RichPiece[] = owned.map((entry, i) => ({
      start: entry.start,
      end: entry.end,
      drawText: input.text.slice(entry.start, entry.end),
      style: entry.style,
      font,
      direction: input.direction,
      intervals: intervals[i] ?? [],
    }));
    return { start: range.start, end: range.end, text: line.text, x, width: line.width, top, height: lineHeightPx, baseline, pieces, letters: null };
  });
  return { konvaLines: true, font, base, lines, width, height: lines.length * lineHeightPx };
}

interface MeasuredRun {
  start: number;
  end: number;
  style: ResolvedTextRunStyle;
  font: string;
}

/** What [start, end) advances, each run in its own font (Konva's per-substring width rule). */
function measureRange(text: string, runs: MeasuredRun[], start: number, end: number, direction: "rtl" | "ltr") {
  let width = 0;
  for (const run of runs) {
    if (run.end <= start || run.start >= end) continue;
    const from = Math.max(run.start, start);
    const to = Math.min(run.end, end);
    // Joining context only INSIDE the measured range: at its own ends the substring stands alone,
    // exactly as Konva measures a candidate line.
    const slice = `${from > start && joinedAcross(text, from) ? ZWJ : ""}${text.slice(from, to)}${to < end && joinedAcross(text, to) ? ZWJ : ""}`;
    width += measureRun(run.font, run.style.letterSpacing, direction, slice);
  }
  return width;
}

/**
 * Konva's word wrap (Text._setTextData) over [paragraphStart, paragraphEnd) with a rich width
 * function: the longest grapheme prefix that fits, broken back to the last space or dash, trailing
 * whitespace trimmed off the line and leading whitespace off the rest. Unlike Konva, a column too
 * narrow for even one grapheme still advances by one, so no text is dropped.
 */
function wrapParagraph(
  text: string,
  runs: MeasuredRun[],
  paragraphStart: number,
  paragraphEnd: number,
  maxWidth: number | null,
  direction: "rtl" | "ltr"
): Array<{ start: number; end: number; width: number; lastInParagraph: boolean }> {
  const lines: Array<{ start: number; end: number; width: number; lastInParagraph: boolean }> = [];
  const push = (start: number, end: number) => {
    let trimmedEnd = end;
    while (trimmedEnd > start && /\s/.test(text[trimmedEnd - 1])) trimmedEnd -= 1;
    lines.push({ start, end: trimmedEnd, width: measureRange(text, runs, start, trimmedEnd, direction), lastInParagraph: false });
  };
  let lineStart = paragraphStart;
  const fullWidth = measureRange(text, runs, paragraphStart, paragraphEnd, direction);
  if (maxWidth === null || fullWidth <= maxWidth) {
    lines.push({ start: paragraphStart, end: paragraphEnd, width: fullWidth, lastInParagraph: true });
    return lines;
  }
  while (lineStart < paragraphEnd) {
    const graphemes = stringToArray(text.slice(lineStart, paragraphEnd));
    const offsets: number[] = [0];
    for (const grapheme of graphemes) offsets.push(offsets[offsets.length - 1] + grapheme.length);
    let low = 0;
    let high = graphemes.length;
    let matchCount = 0;
    let matchWidth = 0;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const width = measureRange(text, runs, lineStart, lineStart + offsets[mid + 1], direction);
      if (width <= maxWidth) {
        low = mid + 1;
        matchCount = mid + 1;
        matchWidth = width;
      } else {
        high = mid;
      }
    }
    if (matchCount === 0) matchCount = 1;
    let breakCount = matchCount;
    const next = graphemes[matchCount];
    if (!(next !== undefined && (next === " " || next === "-") && matchWidth <= maxWidth)) {
      let lastBreak = -1;
      for (let index = 0; index < matchCount; index += 1) {
        if (graphemes[index] === " " || graphemes[index] === "-") lastBreak = index;
      }
      if (lastBreak + 1 > 0) breakCount = lastBreak + 1;
    }
    push(lineStart, lineStart + offsets[breakCount]);
    let restStart = lineStart + offsets[breakCount];
    while (restStart < paragraphEnd && /\s/.test(text[restStart]) && text[restStart] !== "\n") restStart += 1;
    if (restStart >= paragraphEnd) break;
    const restWidth = measureRange(text, runs, restStart, paragraphEnd, direction);
    if (restWidth <= maxWidth) {
      lines.push({ start: restStart, end: paragraphEnd, width: restWidth, lastInParagraph: true });
      return lines;
    }
    lineStart = restStart;
  }
  if (lines.length > 0) lines[lines.length - 1].lastInParagraph = true;
  return lines;
}

/** Metric spans: lines wrapped here, each run measured and placed in its own font. */
function layoutMetric(input: RichTextInput, base: ResolvedTextRunStyle, wrapWidth: number | null): RichTextLayout {
  const text = input.text;
  const runs: MeasuredRun[] = textSpanRuns(text, input.spans).map((run) => {
    const style = resolveTextRunStyle(base, run.style);
    return { start: run.start, end: run.end, style, font: richFontString(style) };
  });
  const baseFont = richFontString(base);
  const wrapped: Array<{ start: number; end: number; width: number; lastInParagraph: boolean }> = [];
  let paragraphStart = 0;
  for (const paragraph of text.split("\n")) {
    const paragraphEnd = paragraphStart + paragraph.length;
    wrapped.push(...wrapParagraph(text, runs, paragraphStart, paragraphEnd, wrapWidth, input.direction));
    paragraphStart = paragraphEnd + 1;
  }

  const textMaxSize = runs.reduce((size, run) => Math.max(size, run.style.fontSize), 0) || base.fontSize;
  const lines: RichLine[] = [];
  let top = 0;
  let width = 0;
  for (const line of wrapped) {
    const owned = runs.filter((run) => run.end > line.start && run.start < line.end);
    const styleAtStart = runs.find((run) => line.start >= run.start && line.start < run.end) ?? runs.find((run) => run.start >= line.start);
    const sizing = owned.length > 0 ? owned : styleAtStart ? [styleAtStart] : [];
    // Every line is as tall as the text's biggest run (lineHeight × that size) — one line height
    // for the whole text, which every one of the app's text engines (Compose, StaticLayout,
    // UILabel) expresses exactly, so both sides stack lines identically.
    const maxSize = textMaxSize;
    let ascent = 0;
    let descent = 0;
    for (const run of sizing.length > 0 ? sizing : [{ font: baseFont, style: base } as MeasuredRun]) {
      const metrics = fontMetrics(run.font, run.style.fontSize);
      ascent = Math.max(ascent, metrics.ascent);
      descent = Math.max(descent, metrics.descent);
    }
    const height = input.lineHeight * maxSize;
    const baseline = top + height / 2 + (ascent - descent) / 2;

    const segments: Array<{ start: number; end: number; run: MeasuredRun; direction: "rtl" | "ltr" }> = [];
    for (const run of owned) {
      const from = Math.max(run.start, line.start);
      const to = Math.min(run.end, line.end);
      for (const piece of directionPieces(text, from, to, input.direction)) {
        segments.push({ start: piece.start, end: piece.end, run, direction: piece.direction });
      }
    }
    const spaces = (text.slice(line.start, line.end).match(/ /g) ?? []).length;
    const justifySpacing =
      input.align === "justify" && !line.lastInParagraph && wrapWidth !== null && spaces > 0
        ? Math.max(0, (wrapWidth - line.width) / spaces)
        : 0;
    // Measured WITH the joining context the pieces are drawn with: across a change of font or
    // size the browser shapes each side on its own, so a split word would otherwise be measured
    // in its unjoined forms and drawn (narrower) in its joined ones, leaving a gap.
    const measured = measureLineSegments(
      segments.map((segment) => ({
        text: withJoiningContext(text, segment.start, segment.end),
        font: segment.run.font,
        letterSpacing: segment.run.style.letterSpacing,
        direction: segment.direction,
      })),
      input.direction,
      justifySpacing
    );
    const lineWidth = measured.width || line.width;
    const pieces: RichPiece[] = segments.map((segment, index) => ({
      start: segment.start,
      end: segment.end,
      drawText: withJoiningContext(text, segment.start, segment.end),
      style: segment.run.style,
      font: segment.run.font,
      direction: segment.direction,
      intervals: measured.intervals[index] ?? [],
    }));
    const boxWidth = wrapWidth ?? lineWidth;
    lines.push({
      start: line.start,
      end: line.end,
      text: text.slice(line.start, line.end),
      x: alignOffset(input.align === "justify" ? "left" : input.align, boxWidth, lineWidth),
      width: lineWidth,
      top,
      height,
      baseline,
      pieces,
      letters: null,
    });
    width = Math.max(width, line.width);
    top += height;
  }
  return { konvaLines: false, font: baseFont, base, lines, width, height: top };
}

/**
 * The layout of a multi-style text in its box (cached per input and loaded-font generation). Pass
 * `wrapWidth: null` to measure it unconstrained (the snug-fit's auto width).
 */
export function layoutRichText(input: RichTextInput, wrapWidth: number | null = input.width): RichTextLayout {
  const key = JSON.stringify([input, wrapWidth, richTextFontGeneration()]);
  const cached = LAYOUT_CACHE.get(key);
  if (cached) return cached;
  const base = baseStyleOf(input);
  const layout = textSpansAffectLayout(input.spans)
    ? layoutMetric(input, base, wrapWidth)
    : layoutOnKonvaLines({ ...input, width: wrapWidth ?? input.width }, base);
  if (LAYOUT_CACHE.size >= LAYOUT_CACHE_LIMIT) {
    const oldest = LAYOUT_CACHE.keys().next().value;
    if (oldest !== undefined) LAYOUT_CACHE.delete(oldest);
  }
  LAYOUT_CACHE.set(key, layout);
  return layout;
}

/**
 * The box a multi-style text needs: its widest line and the stacked line boxes. Null without a DOM
 * canvas. Only used for METRIC spans; paint-only spans measure exactly like the plain text.
 */
export function measureRichTextBox(
  input: RichTextInput,
  wrapWidth: number | null
): { lineWidth: number; height: number; lineCount: number } | null {
  if (typeof document === "undefined" || !input.text || !(input.fontSize > 0)) return null;
  const base = baseStyleOf(input);
  const layout = layoutMetric({ ...input, height: null }, base, wrapWidth);
  if (!Number.isFinite(layout.width) || !Number.isFinite(layout.height)) return null;
  return { lineWidth: layout.width, height: layout.height, lineCount: Math.max(1, layout.lines.length) };
}

// ── Painting ──────────────────────────────────────────────────────────────────────────────────────

export function gradientFillStyle(ctx: CanvasRenderingContext2D, props: Record<string, unknown> | null | undefined) {
  if (!props) return null;
  const stops = (props.fillLinearGradientColorStops ?? props.fillRadialGradientColorStops) as Array<number | string> | undefined;
  if (!Array.isArray(stops) || stops.length < 4) return null;
  let gradient: CanvasGradient;
  if (props.fillPriority === "radial-gradient") {
    const start = props.fillRadialGradientStartPoint as { x: number; y: number };
    const end = props.fillRadialGradientEndPoint as { x: number; y: number };
    gradient = ctx.createRadialGradient(
      start.x,
      start.y,
      Number(props.fillRadialGradientStartRadius) || 0,
      end.x,
      end.y,
      Number(props.fillRadialGradientEndRadius) || 1
    );
  } else {
    const start = props.fillLinearGradientStartPoint as { x: number; y: number };
    const end = props.fillLinearGradientEndPoint as { x: number; y: number };
    gradient = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
  }
  for (let index = 0; index + 1 < stops.length; index += 2) {
    gradient.addColorStop(Math.max(0, Math.min(1, Number(stops[index]) || 0)), String(stops[index + 1]));
  }
  return gradient;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** One highlight band per piece (merged across the piece's glyph boxes). */
function paintHighlights(ctx: CanvasRenderingContext2D, line: RichLine) {
  for (const piece of line.pieces) {
    const style = piece.style;
    if (!style.highlightColor || !(style.highlightOpacity > 0) || piece.intervals.length === 0) continue;
    const em = style.fontSize;
    const left = Math.min(...piece.intervals.map((interval) => interval[0]));
    const right = Math.max(...piece.intervals.map((interval) => interval[1]));
    const height = em * TEXT_HIGHLIGHT_HEIGHT_EM;
    const padX = em * TEXT_HIGHLIGHT_PADDING_X_EM;
    const centre = line.top + line.height / 2;
    ctx.save();
    ctx.globalAlpha *= style.highlightOpacity;
    ctx.fillStyle = style.highlightColor;
    ctx.beginPath();
    roundedRect(ctx, line.x + left - padX, centre - height / 2, right - left + padX * 2, height, em * TEXT_HIGHLIGHT_RADIUS_EM);
    ctx.fill();
    ctx.restore();
  }
}

function strokePx(style: ResolvedTextRunStyle) {
  return style.stroke ? resolveTextStrokeWidthPx(style.strokeWidth, style.fontSize) : 0;
}

/** Paint identity of a run on Konva lines: everything that is not metric. */
function paintKey(style: ResolvedTextRunStyle) {
  return [style.color, style.stroke, style.strokeWidth, style.textDecoration].join("\u0000");
}

function setTextState(ctx: SpacedContext, font: string, direction: "rtl" | "ltr", letterSpacing: number) {
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  ctx.direction = direction;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${letterSpacing}px`;
}

function paintDecoration(
  ctx: CanvasRenderingContext2D,
  style: ResolvedTextRunStyle,
  x0: number,
  x1: number,
  baseline: number,
  fill: string | CanvasGradient
) {
  const decoration = style.textDecoration;
  if (!decoration) return;
  ctx.save();
  ctx.strokeStyle = fill;
  ctx.lineWidth = style.fontSize / 15;
  if (decoration.includes("underline")) {
    const y = baseline + Math.round(style.fontSize / 4);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }
  if (decoration.includes("line-through")) {
    const y = baseline - Math.round(style.fontSize / 4);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** A whole Konva line, once per paint style, each clipped to its glyph boxes. */
function paintKonvaLine(
  ctx: SpacedContext,
  line: RichLine,
  layout: RichTextLayout,
  input: RichTextInput,
  fillOf: (style: ResolvedTextRunStyle) => string | CanvasGradient
) {
  const pad = line.height;
  const groups = new Map<string, { style: ResolvedTextRunStyle; intervals: Interval[] }>();
  for (const piece of line.pieces) {
    const key = paintKey(piece.style);
    const group = groups.get(key) ?? { style: piece.style, intervals: [] };
    group.intervals.push(...piece.intervals);
    groups.set(key, group);
  }
  const baseKey = paintKey(layout.base);
  const overrides = [...groups.entries()].filter(([key]) => key !== baseKey).map(([, group]) => group);
  const excluded = overrides.flatMap((group) => group.intervals);
  const clipTo = (intervals: Interval[], grow: number) => {
    ctx.beginPath();
    for (const [a, b] of intervals) ctx.rect(line.x + a - grow, line.top - pad, b - a + grow * 2, line.height + pad * 2);
    ctx.clip();
  };
  const clipBase = () => {
    if (excluded.length === 0) return;
    ctx.beginPath();
    ctx.rect(-input.width - pad, line.top - pad, input.width * 3 + pad * 2, line.height + pad * 2);
    for (const [a, b] of excluded) ctx.rect(line.x + a, line.top - pad, b - a, line.height + pad * 2);
    ctx.clip("evenodd");
  };
  const paint = (style: ResolvedTextRunStyle, mode: "stroke" | "fill") => {
    setTextState(ctx, layout.font, input.direction, input.letterSpacing);
    ctx.textAlign = "left";
    if (mode === "stroke") {
      ctx.lineWidth = strokePx(style);
      ctx.strokeStyle = style.stroke;
      ctx.miterLimit = 2;
      ctx.lineJoin = "round";
      ctx.strokeText(line.text, line.x, line.baseline);
    } else {
      ctx.fillStyle = fillOf(style);
      ctx.fillText(line.text, line.x, line.baseline);
    }
  };
  const all = [{ style: layout.base, intervals: null as Interval[] | null }, ...overrides.map((group) => ({ style: group.style, intervals: group.intervals }))];
  // Every outline first, then every fill: a neighbour's outline never covers a glyph (Konva's
  // fillAfterStrokeEnabled for the whole text). An outlined range's clip reaches half its outline
  // past its glyph boxes so its outer edges are not shaved off.
  for (const entry of all) {
    const width = strokePx(entry.style);
    if (!(width > 0)) continue;
    ctx.save();
    if (entry.intervals) clipTo(entry.intervals, width / 2 + 1);
    else clipBase();
    paint(entry.style, "stroke");
    ctx.restore();
  }
  for (const entry of all) {
    ctx.save();
    if (entry.intervals) clipTo(entry.intervals, 0);
    else clipBase();
    paint(entry.style, "fill");
    ctx.restore();
  }
  // Decorations under each piece's own boxes.
  for (const piece of line.pieces) {
    if (!piece.style.textDecoration || piece.intervals.length === 0) continue;
    const left = Math.min(...piece.intervals.map((interval) => interval[0]));
    const right = Math.max(...piece.intervals.map((interval) => interval[1]));
    paintDecoration(ctx, piece.style, line.x + left, line.x + right, line.baseline, fillOf(piece.style));
  }
}

function paintLetters(
  ctx: SpacedContext,
  line: RichLine,
  layout: RichTextLayout,
  fillOf: (style: ResolvedTextRunStyle) => string | CanvasGradient
) {
  const letters = line.letters ?? [];
  setTextState(ctx, layout.font, "ltr", 0);
  ctx.textAlign = "left";
  for (const letter of letters) {
    const width = strokePx(letter.style);
    if (!(width > 0)) continue;
    ctx.lineWidth = width;
    ctx.strokeStyle = letter.style.stroke;
    ctx.miterLimit = 2;
    ctx.lineJoin = "round";
    ctx.strokeText(letter.text, line.x + letter.x, line.baseline);
  }
  for (const letter of letters) {
    ctx.fillStyle = fillOf(letter.style);
    ctx.fillText(letter.text, line.x + letter.x, line.baseline);
  }
  for (const piece of line.pieces) {
    if (!piece.style.textDecoration || piece.intervals.length === 0) continue;
    const left = Math.min(...piece.intervals.map((interval) => interval[0]));
    const right = Math.max(...piece.intervals.map((interval) => interval[1]));
    paintDecoration(ctx, piece.style, line.x + left, line.x + right, line.baseline, fillOf(piece.style));
  }
}

/** A metric line: each piece in its own font, at the box the browser gave it. */
function paintMetricLine(
  ctx: SpacedContext,
  line: RichLine,
  fillOf: (style: ResolvedTextRunStyle) => string | CanvasGradient
) {
  const place = (piece: RichPiece) => {
    if (piece.intervals.length === 0) return null;
    const left = Math.min(...piece.intervals.map((interval) => interval[0]));
    const right = Math.max(...piece.intervals.map((interval) => interval[1]));
    setTextState(ctx, piece.font, piece.direction, piece.style.letterSpacing);
    ctx.textAlign = piece.direction === "rtl" ? "right" : "left";
    return { left, right, x: line.x + (piece.direction === "rtl" ? right : left) };
  };
  for (const piece of line.pieces) {
    const width = strokePx(piece.style);
    if (!(width > 0)) continue;
    const spot = place(piece);
    if (!spot) continue;
    ctx.lineWidth = width;
    ctx.strokeStyle = piece.style.stroke;
    ctx.miterLimit = 2;
    ctx.lineJoin = "round";
    ctx.strokeText(piece.drawText, spot.x, line.baseline);
  }
  for (const piece of line.pieces) {
    const spot = place(piece);
    if (!spot) continue;
    ctx.fillStyle = fillOf(piece.style);
    ctx.fillText(piece.drawText, spot.x, line.baseline);
    if (piece.style.textDecoration) {
      paintDecoration(ctx, piece.style, line.x + spot.left, line.x + spot.right, line.baseline, fillOf(piece.style));
    }
  }
}

/**
 * Paints [layout] in the text node's local coordinates (0,0 = the box's top-left). The caller's
 * context already carries the node's transform, opacity and shadow.
 */
export function paintRichText(rawContext: CanvasRenderingContext2D, layout: RichTextLayout, input: RichTextInput) {
  const ctx = rawContext as SpacedContext;
  const gradient = gradientFillStyle(ctx, input.gradient);
  const fillOf = (style: ResolvedTextRunStyle): string | CanvasGradient =>
    gradient && style.color === layout.base.color ? gradient : style.color;
  ctx.save();
  for (const line of layout.lines) paintHighlights(ctx, line);
  for (const line of layout.lines) {
    ctx.save();
    if (line.letters) paintLetters(ctx, line, layout, fillOf);
    else if (layout.konvaLines) paintKonvaLine(ctx, line, layout, input, fillOf);
    else paintMetricLine(ctx, line, fillOf);
    ctx.restore();
  }
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.restore();
}

/**
 * Where each character range of a laid-out text sits, as line-local boxes — the inline editor and
 * hit tests use it. Offsets outside every line return no boxes.
 */
export function richTextRangeBoxes(layout: RichTextLayout, start: number, end: number) {
  const boxes: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const line of layout.lines) {
    for (const piece of line.pieces) {
      if (piece.end <= start || piece.start >= end) continue;
      for (const [a, b] of piece.intervals) {
        boxes.push({ x: line.x + a, y: line.top, width: b - a, height: line.height });
      }
    }
  }
  return boxes;
}

// ── Curved ───────────────────────────────────────────────────────────────────────────────────────

interface CurvedGlyph {
  drawText: string;
  style: ResolvedTextRunStyle;
  font: string;
  direction: "rtl" | "ltr";
  /** Glyph box along the laid-out (straight) line, left → right. */
  left: number;
  right: number;
}

export interface CurvedRichTextLayout {
  base: ResolvedTextRunStyle;
  glyphs: CurvedGlyph[];
  /** The straight line's width = the arc length the text fills. */
  totalAdvance: number;
  /** Where the base font's baseline sits below the arc line (glyph middles ride the arc). */
  baselineOffset: number;
}

const CURVED_CACHE = new Map<string, CurvedRichTextLayout>();

/**
 * A multi-style CURVED text laid out as one straight line by the browser (newlines read as
 * spaces, as on the plain curve): each grapheme's box along that line, in its own font. The arc
 * maps those boxes onto the circle (the app's smooth curve: glyphs placed by their advance along
 * the laid-out line, which already resolved RTL and bidi). Each grapheme is drawn on its own with
 * a ZWJ on any joined side, so Arabic keeps its joining forms around the curve.
 */
export function layoutCurvedRichText(input: RichTextInput): CurvedRichTextLayout {
  const key = JSON.stringify([input, richTextFontGeneration()]);
  const cached = CURVED_CACHE.get(key);
  if (cached) return cached;
  const text = input.text.replace(/\n/g, " ");
  const base = baseStyleOf(input);
  const runs: MeasuredRun[] = textSpanRuns(text, input.spans).map((run) => {
    const style = resolveTextRunStyle(base, run.style);
    return { start: run.start, end: run.end, style, font: richFontString(style) };
  });
  const segments: Array<{ start: number; end: number; run: MeasuredRun; direction: "rtl" | "ltr" }> = [];
  for (const run of runs) {
    for (const piece of directionPieces(text, run.start, run.end, input.direction)) {
      segments.push({ start: piece.start, end: piece.end, run, direction: piece.direction });
    }
  }
  const glyphs: CurvedGlyph[] = [];
  let totalAdvance = 0;
  const graphemesOf = (start: number, end: number) => {
    const list: Array<{ start: number; end: number }> = [];
    let offset = start;
    for (const grapheme of stringToArray(text.slice(start, end))) {
      list.push({ start: offset, end: offset + grapheme.length });
      offset += grapheme.length;
    }
    return list;
  };
  if (typeof document !== "undefined" && document.body) {
    const host = document.createElement("span");
    host.style.cssText =
      "position:absolute;left:-100000px;top:0;visibility:hidden;white-space:pre;display:inline-block;pointer-events:none;unicode-bidi:isolate;font-kerning:normal;";
    host.style.direction = input.direction;
    const children = segments.map((segment) => {
      const child = document.createElement("span");
      child.style.font = segment.run.font;
      child.style.letterSpacing = `${segment.run.style.letterSpacing}px`;
      const lead = joinedAcross(text, segment.start) ? ZWJ : "";
      child.textContent = withJoiningContext(text, segment.start, segment.end);
      host.appendChild(child);
      return { child, lead: lead.length };
    });
    document.body.appendChild(host);
    try {
      const box = host.getBoundingClientRect();
      totalAdvance = box.width;
      const range = document.createRange();
      segments.forEach((segment, index) => {
        const { child, lead } = children[index];
        const node = child.firstChild;
        if (!node) return;
        for (const grapheme of graphemesOf(segment.start, segment.end)) {
          range.setStart(node, lead + grapheme.start - segment.start);
          range.setEnd(node, lead + grapheme.end - segment.start);
          const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
          if (rects.length === 0) continue;
          const left = Math.min(...rects.map((rect) => rect.left)) - box.left;
          const right = Math.max(...rects.map((rect) => rect.right)) - box.left;
          glyphs.push({
            drawText: withJoiningContext(text, grapheme.start, grapheme.end),
            style: segment.run.style,
            font: segment.run.font,
            direction: segment.direction,
            left,
            right,
          });
        }
      });
    } finally {
      host.remove();
    }
  }
  const metrics = fontMetrics(richFontString(base), base.fontSize);
  const layout: CurvedRichTextLayout = {
    base,
    glyphs,
    totalAdvance,
    baselineOffset: (metrics.ascent - metrics.descent) / 2,
  };
  if (CURVED_CACHE.size >= LAYOUT_CACHE_LIMIT) {
    const oldest = CURVED_CACHE.keys().next().value;
    if (oldest !== undefined) CURVED_CACHE.delete(oldest);
  }
  CURVED_CACHE.set(key, layout);
  return layout;
}

/**
 * Paints a curved multi-style text on the app's arc (lib/editor/textCurve.ts's CurvedTextArc):
 * every grapheme at the point its centre's advance reaches, turned to the tangent, all on the base
 * font's baseline circle — a bigger range rises above the line exactly as it does straight. A
 * highlighted range gets a band that follows the circle.
 */
export function paintCurvedRichText(
  rawContext: CanvasRenderingContext2D,
  layout: CurvedRichTextLayout,
  arc: { axisX: number; baselineY: number; radius: number; halfSweepRad: number; bendDirection: number },
  input: RichTextInput
) {
  const ctx = rawContext as SpacedContext;
  const gradient = gradientFillStyle(ctx, input.gradient);
  const fillOf = (style: ResolvedTextRunStyle): string | CanvasGradient =>
    gradient && style.color === layout.base.color ? gradient : style.color;
  const total = Math.max(1, layout.totalAdvance);
  const thetaAt = (advance: number) =>
    Math.max(-arc.halfSweepRad, Math.min(arc.halfSweepRad, (advance - total / 2) / arc.radius));
  // A point `lift` px along the glyph's own down direction from the arc at angle theta.
  const pointAt = (theta: number, lift: number) => {
    const radius = arc.radius - arc.bendDirection * lift;
    return {
      x: arc.axisX + radius * Math.sin(theta),
      y: arc.baselineY + arc.bendDirection * (arc.radius - radius * Math.cos(theta)),
    };
  };

  ctx.save();
  // Highlight bands: consecutive glyphs of one highlight style merged into one band.
  let band: { style: ResolvedTextRunStyle; left: number; right: number } | null = null;
  const flushBand = () => {
    if (!band) return;
    const { style, left, right } = band;
    const em = style.fontSize;
    const padX = em * TEXT_HIGHLIGHT_PADDING_X_EM;
    const own = fontMetrics(richFontString(style), style.fontSize);
    const middle = layout.baselineOffset - (own.ascent - own.descent) / 2;
    const half = (em * TEXT_HIGHLIGHT_HEIGHT_EM) / 2;
    const from = thetaAt(left - padX);
    const to = thetaAt(right + padX);
    const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 0.04));
    ctx.save();
    ctx.globalAlpha *= style.highlightOpacity;
    ctx.fillStyle = style.highlightColor;
    ctx.beginPath();
    for (let step = 0; step <= steps; step += 1) {
      const point = pointAt(from + ((to - from) * step) / steps, middle - half);
      if (step === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    for (let step = steps; step >= 0; step -= 1) {
      const point = pointAt(from + ((to - from) * step) / steps, middle + half);
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    band = null;
  };
  const ordered = [...layout.glyphs].sort((a, b) => a.left - b.left);
  for (const glyph of ordered) {
    const style = glyph.style;
    if (style.highlightColor && style.highlightOpacity > 0) {
      if (band && band.style.highlightColor === style.highlightColor && band.style.fontSize === style.fontSize && glyph.left - band.right < style.fontSize * 0.6) {
        band.right = Math.max(band.right, glyph.right);
      } else {
        flushBand();
        band = { style, left: glyph.left, right: glyph.right };
      }
    } else {
      flushBand();
    }
  }
  flushBand();

  const place = (glyph: CurvedGlyph) => {
    const theta = thetaAt((glyph.left + glyph.right) / 2);
    const point = pointAt(theta, 0);
    ctx.translate(point.x, point.y);
    ctx.rotate(theta * arc.bendDirection);
    setTextState(ctx, glyph.font, glyph.direction, 0);
    ctx.textAlign = "center";
  };
  for (const glyph of layout.glyphs) {
    const width = strokePx(glyph.style);
    if (!(width > 0)) continue;
    ctx.save();
    place(glyph);
    ctx.lineWidth = width;
    ctx.strokeStyle = glyph.style.stroke;
    ctx.miterLimit = 2;
    ctx.lineJoin = "round";
    ctx.strokeText(glyph.drawText, 0, layout.baselineOffset);
    ctx.restore();
  }
  for (const glyph of layout.glyphs) {
    ctx.save();
    place(glyph);
    ctx.fillStyle = fillOf(glyph.style);
    ctx.fillText(glyph.drawText, 0, layout.baselineOffset);
    ctx.restore();
  }
  ctx.restore();
}
