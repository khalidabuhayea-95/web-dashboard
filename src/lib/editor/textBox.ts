import Konva from "konva";
// Side effect: the snug-fit measures RTL letter-spacing the way the canvas draws it.
import "@/lib/editor/konvaTextPatches";
import { measureRichTextBox, type RichTextInput } from "@/lib/editor/richText";
import { textSpansAffectLayout, type TextSpan } from "@/lib/editor/textSpans";

/**
 * Everything that changes how a text layer is laid out. Deliberately mirrors the props the
 * on-canvas <Text> node is rendered with, so a measurement here matches the real node exactly.
 */
export interface TextBoxInput {
  text: string;
  fontSize: number;
  /** Already resolved to a CSS family list (see resolveCssFontFamily). */
  fontFamily: string;
  /** Konva font style: "normal" | "bold" | "italic" | "bold italic". */
  fontStyle: string;
  letterSpacing: number;
  lineHeight: number;
  align: "left" | "center" | "right" | "justify";
  direction: "ltr" | "rtl";
  /**
   * Multi-style ranges (lib/editor/textSpans.ts), span families already resolved to CSS lists.
   * Only ranges that change font, weight, size or spacing change the box — those are laid out by
   * lib/editor/richText.ts, exactly as the canvas draws them; anything else measures like plain text.
   */
  spans?: TextSpan[];
}

export interface TextBoxMetrics {
  /** Width of the longest rendered line. */
  lineWidth: number;
  /** Height the lines actually occupy: lineCount × fontSize × lineHeight. */
  height: number;
  lineCount: number;
}

export interface SnugTextBox {
  width: number;
  height: number;
  /**
   * True when the box ended up wrapped tight around the text. Such a box is in "hug the text"
   * mode: the next time anything about the text changes it is re-measured from scratch (auto
   * width) so it grows and shrinks with the glyphs. A box the user deliberately made wider or
   * narrower than its text is NOT hugging, and keeps the width it was given.
   */
  hugging: boolean;
  /**
   * True when a line was wider than the box (a letter wider than its box, which the browser — and
   * the editor, konvaTextPatches.ts — draws overflowing from the START edge). Such a box must grow
   * from that edge, not by `align`, or the glyph slides: see textBoxStartAnchorDeltaX.
   */
  overflowed?: boolean;
}

/**
 * Kept on the right of a snug box. A box sized to the exact measured line width sits right on
 * the wrap threshold, where a sub-pixel rounding difference between two measurement passes is
 * enough to fold the last word onto a new line.
 */
export const TEXT_BOX_WIDTH_EPSILON = 2;

/** How much slack a box may carry and still count as hugging its text (15%). */
const HUG_WIDTH_TOLERANCE = 1.15;

const MEASUREMENT_CACHE_LIMIT = 600;
const measurementCache = new Map<string, TextBoxMetrics>();

/**
 * Measurements are cached because the fit pass re-runs on every element change (dragging an
 * unrelated layer, playhead scrubbing, …) and re-measuring every text layer each time is pure
 * waste. A font swapping in under the same family name would invalidate them, so the editor
 * clears the cache on the document's `loadingdone`.
 */
export function clearTextBoxMeasurementCache() {
  measurementCache.clear();
}

function measurementKey(input: TextBoxInput, wrapWidth: number | null) {
  // NUL-separated: the text is part of the key and can contain any other separator.
  return [
    input.text,
    input.fontSize,
    input.fontFamily,
    input.fontStyle,
    input.letterSpacing,
    input.lineHeight,
    input.align,
    input.direction,
    wrapWidth === null ? "auto" : Math.round(wrapWidth * 100),
    input.spans && input.spans.length > 0 ? JSON.stringify(input.spans) : "",
  ].join("\u0000");
}

/** The rich layout's input for a box measurement (Konva's "italic 700" split back into its parts). */
function richInputFromBox(input: TextBoxInput): RichTextInput {
  const style = String(input.fontStyle || "");
  const weight = style.match(/\d+/)?.[0] ?? (/bold/i.test(style) ? "700" : "400");
  return {
    text: String(input.text ?? ""),
    width: 0,
    height: null,
    fontSize: Number(input.fontSize) || 0,
    fontFamily: input.fontFamily,
    fontWeight: weight,
    fontStyle: /italic/i.test(style) ? "italic" : "normal",
    lineHeight: Number(input.lineHeight) || 1,
    align: input.align,
    direction: input.direction,
    letterSpacing: Number(input.letterSpacing) || 0,
    color: "#000000",
    textDecoration: "",
    stroke: "",
    strokeWidth: 0,
    spans: input.spans ?? [],
  };
}

/**
 * Lays the text out in a throwaway Konva.Text and reports the box it needs. `wrapWidth` is the
 * column the text wraps at; pass null for an unconstrained (single-line-per-paragraph) layout.
 */
/** An off-stage Konva.Text laid out exactly like the on-canvas node; null without a DOM. */
function createMeasureNode(input: TextBoxInput, wrapWidth: number | null): Konva.Text | null {
  const text = String(input.text ?? "");
  const fontSize = Number(input.fontSize) || 0;
  if (!text || fontSize <= 0) return null;
  if (typeof document === "undefined") return null;
  return new Konva.Text({
    text,
    fontSize,
    fontFamily: input.fontFamily,
    fontStyle: input.fontStyle,
    fontVariant: "normal",
    letterSpacing: Number(input.letterSpacing) || 0,
    lineHeight: Number(input.lineHeight) || 1,
    align: input.align,
    direction: input.direction,
    wrap: "word",
    // No `height` on purpose: Konva DROPS wrapped lines that overflow a fixed height, and the
    // whole point here is the height the full text needs.
    ...(wrapWidth !== null && wrapWidth > 0 ? { width: wrapWidth } : {}),
  });
}

/**
 * The lines a text layer renders, top to bottom, as the canvas wraps them (soft wraps resolved),
 * each with its width — merging text layers keeps these so the merged paragraph breaks where the
 * originals did. Null when it can't be laid out (no DOM, empty text).
 */
export function layoutTextLines(
  input: TextBoxInput,
  wrapWidth: number | null = null
): Array<{ text: string; width: number }> | null {
  let node: Konva.Text | null = null;
  try {
    node = createMeasureNode(input, wrapWidth);
    const lines = (node as unknown as { textArr?: Array<{ text?: unknown; width?: unknown }> } | null)?.textArr;
    if (!Array.isArray(lines) || lines.length === 0) return null;
    return lines.map((line) => ({
      text: String(line?.text ?? ""),
      width: Math.max(0, Number(line?.width) || 0),
    }));
  } catch {
    return null;
  } finally {
    node?.destroy();
  }
}

export function measureTextBox(input: TextBoxInput, wrapWidth: number | null = null): TextBoxMetrics | null {
  const text = String(input.text ?? "");
  const fontSize = Number(input.fontSize) || 0;
  if (!text || fontSize <= 0) return null;
  if (typeof document === "undefined") return null;

  const key = measurementKey(input, wrapWidth);
  const cached = measurementCache.get(key);
  if (cached) return cached;

  if (input.spans && textSpansAffectLayout(input.spans)) {
    const metrics = measureRichTextBox(richInputFromBox(input), wrapWidth);
    if (!metrics) return null;
    if (measurementCache.size >= MEASUREMENT_CACHE_LIMIT) measurementCache.clear();
    measurementCache.set(key, metrics);
    return metrics;
  }

  let node: Konva.Text | null = null;
  try {
    node = createMeasureNode(input, wrapWidth);
    if (!node) return null;
    const lines = (node as unknown as { textArr?: unknown[] }).textArr;
    const metrics: TextBoxMetrics = {
      lineWidth: node.getTextWidth(),
      height: node.height(),
      lineCount: Array.isArray(lines) ? Math.max(1, lines.length) : 1,
    };
    if (!Number.isFinite(metrics.lineWidth) || !Number.isFinite(metrics.height)) return null;
    if (measurementCache.size >= MEASUREMENT_CACHE_LIMIT) measurementCache.clear();
    measurementCache.set(key, metrics);
    return metrics;
  } catch {
    return null;
  } finally {
    node?.destroy();
  }
}

/**
 * The box a text layer should occupy so its selection overlay hugs the glyphs.
 *
 * The height is ALWAYS the measured line stack — a text box never carries dead vertical space,
 * and it tracks the font size, line height and wrapping for free. The width is only tightened
 * when the box isn't doing any wrapping work: a box narrower than its text is wrapping it on
 * purpose, and a box much wider than its text was widened on purpose. Pass `boxWidth: null` to
 * re-measure a hugging box from scratch (auto width).
 */
export function resolveSnugTextBox(input: TextBoxInput, boxWidth: number | null): SnugTextBox | null {
  const requestedWidth = boxWidth !== null && boxWidth > 1 ? boxWidth : null;
  let measured = measureTextBox(input, requestedWidth);
  if (!measured) return null;

  const hardLineCount = String(input.text ?? "").split(/\r\n|\r|\n/).length;
  // A box that folds a line is normally the wrap column and is left alone (below). But a box can
  // fold by a hair: an imported box carries Canva's width rounded to whole pixels, and a word that
  // measures 537.04 px in a 537 px box is broken between its last two letters (Konva breaks an
  // over-long word between characters). When the text fits the box within the epsilon once it is
  // measured free of it, the fold is a rounding artefact, not a wrap column, and the box hugs the
  // text instead.
  if (requestedWidth !== null && measured.lineCount > hardLineCount) {
    const unconstrained = measureTextBox(input, null);
    if (
      unconstrained &&
      unconstrained.lineCount <= hardLineCount &&
      unconstrained.lineWidth <= requestedWidth + TEXT_BOX_WIDTH_EPSILON
    ) {
      measured = unconstrained;
    }
  }
  let nextWidth = requestedWidth ?? Math.max(2, Math.ceil(measured.lineWidth) + TEXT_BOX_WIDTH_EPSILON);
  let hugging = false;

  // `lineCount > hardLineCount` means the box width folded a line — it IS the wrap column, so
  // leave it alone. Justified text is stretched to the box width, so tightening it would undo
  // the justification.
  if (measured.lineCount <= hardLineCount && input.align !== "justify") {
    const snugWidth = Math.max(2, Math.ceil(measured.lineWidth) + TEXT_BOX_WIDTH_EPSILON);
    if (requestedWidth === null || requestedWidth <= snugWidth * HUG_WIDTH_TOLERANCE) {
      nextWidth = snugWidth;
      hugging = true;
    }
  }

  const finalMetrics =
    requestedWidth !== null && Math.abs(nextWidth - requestedWidth) < 0.5
      ? measured
      : measureTextBox(input, nextWidth) || measured;

  const overflowed = requestedWidth !== null && measured.lineWidth > requestedWidth + 0.5;
  return {
    width: Math.max(2, nextWidth),
    height: Math.max(1, Math.ceil(finalMetrics.height)),
    hugging,
    ...(overflowed ? { overflowed: true } : {}),
  };
}

/**
 * The box shift for a box whose line overflowed it: the overflowing line was drawn from the box's
 * START edge (right for RTL, left for LTR), so that edge stays put while the box grows to fit it.
 */
export function textBoxStartAnchorDeltaX(direction: TextBoxInput["direction"], previousWidth: number, nextWidth: number) {
  return direction === "rtl" ? (Number(previousWidth) || 0) - (Number(nextWidth) || 0) : 0;
}

/**
 * How far to move the box so the text stays put when the box width changes. Konva positions each
 * line inside the box by `align` alone (direction only shapes the glyphs), so right-aligned text
 * hangs off the right edge and centred text off the middle — both move if only the width changes.
 */
export function textBoxAnchorDeltaX(
  align: TextBoxInput["align"],
  previousWidth: number,
  nextWidth: number
) {
  const delta = (Number(previousWidth) || 0) - (Number(nextWidth) || 0);
  if (align === "right") return delta;
  if (align === "center") return delta / 2;
  return 0;
}
