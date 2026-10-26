/**
 * Multi-style text: style overrides for character RANGES of one text layer ("spans").
 *
 * A text layer keeps its own style (font, size, colour, outline…) as the BASE; `textSpans` lists the
 * ranges that differ from it. The model is the mobile app's TEXT layer `spans` field for field, so a
 * template looks the same on both sides:
 *   - `start`/`end` are UTF-16 offsets into `text` (end exclusive) — the indexing of both JavaScript
 *     and Kotlin strings;
 *   - spans are sorted, never overlap, never empty, and never split a letter from the marks that sit
 *     on it (tashkeel, variation selectors, ZWJ sequences) — boundaries snap to grapheme clusters;
 *   - a span only lists the keys it overrides, and a span that overrides nothing is dropped;
 *   - `fontSize`/`letterSpacing` are px in the layer's own (unscaled) space like the layer's;
 *     `strokeWidth` is the layer's 0–100 outline unit (lib/editor/textStroke.ts), sized by the
 *     span's own font size; `highlightColor`/`highlightOpacity` paint a band behind the range.
 * Paragraph-level settings (alignment, line height, curve, the layer's background box, gradient fill,
 * shadow, animation) stay on the layer.
 *
 * Pure and dependency-free (bar the shared mark table) so the mobile payload mapper and the import
 * routes can use it on the server.
 */
import { isCanvaCombiningMark } from "./animationCanvaMarks";

export type TextSpanDecoration = "" | "underline" | "line-through" | "underline line-through";

export interface TextSpanStyle {
  fontFamily?: string;
  /** "100" … "900" (the layer's own `fontWeight` format). */
  fontWeight?: string;
  fontStyle?: "normal" | "italic";
  /** px, the layer's own space. */
  fontSize?: number;
  color?: string;
  /** px, the layer's own space. */
  letterSpacing?: number;
  textDecoration?: TextSpanDecoration;
  /** Outline colour. */
  stroke?: string;
  /** 0–100, the layer's outline unit, relative to the span's font size. */
  strokeWidth?: number;
  /** Band painted behind the range. */
  highlightColor?: string;
  /** 0..1; 1 when absent. */
  highlightOpacity?: number;
}

export interface TextSpan extends TextSpanStyle {
  start: number;
  end: number;
}

export const TEXT_SPAN_STYLE_KEYS = [
  "fontFamily",
  "fontWeight",
  "fontStyle",
  "fontSize",
  "color",
  "letterSpacing",
  "textDecoration",
  "stroke",
  "strokeWidth",
  "highlightColor",
  "highlightOpacity",
] as const;

export type TextSpanStyleKey = (typeof TEXT_SPAN_STYLE_KEYS)[number];

/** Keys that move glyphs (the layout), not only how they are painted. */
export const TEXT_SPAN_METRIC_KEYS: ReadonlyArray<TextSpanStyleKey> = [
  "fontFamily",
  "fontWeight",
  "fontStyle",
  "fontSize",
  "letterSpacing",
];

/** Every style key fully resolved for one run: the layer's base with the span's overrides on top. */
export interface ResolvedTextRunStyle {
  fontFamily: string;
  fontWeight: string;
  fontStyle: "normal" | "italic";
  fontSize: number;
  color: string;
  letterSpacing: number;
  textDecoration: TextSpanDecoration;
  stroke: string;
  strokeWidth: number;
  highlightColor: string;
  highlightOpacity: number;
}

/** One stretch of text that renders in a single style. */
export interface TextStyleRun {
  start: number;
  end: number;
  /** The span's overrides ({} where the base applies). */
  style: TextSpanStyle;
}

// ── Values ───────────────────────────────────────────────────────────────────────────────────────

const HEX3 = /^#[0-9a-f]{3}$/i;
const HEX_LONG = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CSS_COLOR_FUNCTION = /^(?:rgba?|hsla?)\([^()]*\)$/i;

function roundTo(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeColor(value: unknown): string | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  if (HEX3.test(raw)) {
    return `#${raw
      .slice(1)
      .split("")
      .map((digit) => digit + digit)
      .join("")}`.toLowerCase();
  }
  if (HEX_LONG.test(raw)) return raw.toLowerCase();
  if (CSS_COLOR_FUNCTION.test(raw)) return raw.replace(/\s+/g, " ");
  return undefined;
}

function normalizeWeight(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = String(value).trim().toLowerCase();
  if (raw === "bold") return "700";
  if (raw === "normal" || raw === "regular") return "400";
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return undefined;
  return String(Math.max(1, Math.min(1000, Math.round(numeric))));
}

function normalizeDecoration(value: unknown): TextSpanDecoration | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = String(value).toLowerCase();
  if (raw === "" || raw === "none") return "";
  const underline = raw.includes("underline");
  const lineThrough = raw.includes("line-through") || raw.includes("linethrough");
  if (underline && lineThrough) return "underline line-through";
  if (underline) return "underline";
  if (lineThrough) return "line-through";
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

/** The value [key] normalised, or undefined when it is absent or unusable. */
export function normalizeTextSpanValue(key: TextSpanStyleKey, value: unknown): TextSpanStyle[TextSpanStyleKey] {
  switch (key) {
    case "fontFamily": {
      const family = String(value ?? "").trim();
      return family || undefined;
    }
    case "fontWeight":
      return normalizeWeight(value);
    case "fontStyle":
      return value === "italic" ? "italic" : value === "normal" ? "normal" : undefined;
    case "fontSize": {
      const size = finiteNumber(value);
      return size !== undefined && size > 0 ? roundTo(Math.min(5000, size)) : undefined;
    }
    case "letterSpacing": {
      const spacing = finiteNumber(value);
      return spacing !== undefined ? roundTo(Math.max(-1000, Math.min(1000, spacing))) : undefined;
    }
    case "strokeWidth": {
      const width = finiteNumber(value);
      return width !== undefined ? roundTo(Math.max(0, Math.min(100, width))) : undefined;
    }
    case "highlightOpacity": {
      const opacity = finiteNumber(value);
      return opacity !== undefined ? roundTo(Math.max(0, Math.min(1, opacity))) : undefined;
    }
    case "textDecoration":
      return normalizeDecoration(value);
    case "color":
    case "stroke":
    case "highlightColor":
      return normalizeColor(value);
    default:
      return undefined;
  }
}

/** Only the usable keys of [raw]. */
export function normalizeTextSpanStyle(raw: unknown): TextSpanStyle {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const style: TextSpanStyle = {};
  for (const key of TEXT_SPAN_STYLE_KEYS) {
    const value = normalizeTextSpanValue(key, record[key]);
    if (value !== undefined) (style as Record<string, unknown>)[key] = value;
  }
  return style;
}

function valuesEqual(key: TextSpanStyleKey, a: unknown, b: unknown) {
  const left = normalizeTextSpanValue(key, a);
  const right = normalizeTextSpanValue(key, b);
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) < 1e-6;
  if (key === "fontFamily" && typeof left === "string" && typeof right === "string") {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

function styleKey(style: TextSpanStyle | null | undefined): string {
  if (!style) return "";
  let key = "";
  for (const name of TEXT_SPAN_STYLE_KEYS) {
    const value = (style as Record<string, unknown>)[name];
    if (value !== undefined) key += `${name}=${String(value)}\u0000`;
  }
  return key;
}

function isEmptyStyle(style: TextSpanStyle | null | undefined) {
  return !style || styleKey(style) === "";
}

/** A highlight opacity means nothing without a highlight colour. */
function tidyStyle(style: TextSpanStyle): TextSpanStyle | null {
  const next = { ...style };
  if (next.highlightOpacity !== undefined && !next.highlightColor) delete next.highlightOpacity;
  return isEmptyStyle(next) ? null : next;
}

// ── Graphemes ────────────────────────────────────────────────────────────────────────────────────

const ZWJ = 0x200d;

function isVariationSelector(codePoint: number) {
  return (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || (codePoint >= 0xe0100 && codePoint <= 0xe01ef);
}

/**
 * Offsets where a grapheme cluster starts, plus `text.length`: a letter and the marks on it (and a
 * ZWJ sequence, and a surrogate pair) are never separated — the same clustering as the writing-style
 * units (canvaGraphemes), across the whole text.
 */
export function textGraphemeBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  let offset = 0;
  let joinNext = false;
  for (const char of String(text ?? "")) {
    const codePoint = char.codePointAt(0) ?? 0;
    const attaches =
      boundaries.length > 0 &&
      char !== "\n" &&
      (joinNext || codePoint === ZWJ || isVariationSelector(codePoint) || isCanvaCombiningMark(codePoint));
    if (!attaches) boundaries.push(offset);
    joinNext = codePoint === ZWJ;
    offset += char.length;
  }
  boundaries.push(offset);
  return boundaries;
}

function snapDown(boundaries: number[], offset: number) {
  let result = 0;
  for (const boundary of boundaries) {
    if (boundary > offset) break;
    result = boundary;
  }
  return result;
}

function snapUp(boundaries: number[], offset: number) {
  for (const boundary of boundaries) {
    if (boundary >= offset) return boundary;
  }
  return boundaries[boundaries.length - 1] ?? 0;
}

/** [start, end) widened to whole grapheme clusters and clamped to the text. */
export function snapTextRange(text: string, start: number, end: number): [number, number] {
  const length = String(text ?? "").length;
  const from = Math.max(0, Math.min(length, Math.floor(Number(start) || 0)));
  const to = Math.max(0, Math.min(length, Math.ceil(Number(end) || 0)));
  if (to <= from) return [from, from];
  const boundaries = textGraphemeBoundaries(text);
  return [snapDown(boundaries, from), snapUp(boundaries, to)];
}

// ── Per-character expansion ──────────────────────────────────────────────────────────────────────

type CharStyles = Array<TextSpanStyle | null>;

function expand(spans: ReadonlyArray<TextSpan> | null | undefined, length: number): CharStyles {
  const styles: CharStyles = new Array(length).fill(null);
  for (const span of spans ?? []) {
    const start = Math.max(0, Math.min(length, Math.floor(Number(span?.start) || 0)));
    const end = Math.max(0, Math.min(length, Math.ceil(Number(span?.end) || 0)));
    if (end <= start) continue;
    const style = normalizeTextSpanStyle(span);
    if (isEmptyStyle(style)) continue;
    for (let index = start; index < end; index += 1) {
      styles[index] = styles[index] ? { ...styles[index], ...style } : { ...style };
    }
  }
  return styles;
}

function compress(styles: CharStyles): TextSpan[] {
  const spans: TextSpan[] = [];
  let runStart = 0;
  let runKey = styleKey(styles[0]);
  for (let index = 1; index <= styles.length; index += 1) {
    const key = index < styles.length ? styleKey(styles[index]) : "\u0001end";
    if (key === runKey) continue;
    if (runKey) {
      const style = tidyStyle(styles[runStart] as TextSpanStyle);
      if (style) spans.push({ start: runStart, end: index, ...style });
    }
    runStart = index;
    runKey = key;
  }
  return spans;
}

/** Re-cuts the per-character styles on grapheme boundaries: a cluster takes its first unit's style. */
function snapStyles(text: string, styles: CharStyles): CharStyles {
  const boundaries = textGraphemeBoundaries(text);
  const snapped = styles.slice();
  for (let b = 0; b < boundaries.length - 1; b += 1) {
    const start = boundaries[b];
    const end = boundaries[b + 1];
    for (let index = start + 1; index < end; index += 1) snapped[index] = snapped[start];
  }
  return snapped;
}

// ── Public helpers ───────────────────────────────────────────────────────────────────────────────

/** True when [value] holds at least one span. */
export function hasTextSpans(value: { textSpans?: ReadonlyArray<TextSpan> | null } | null | undefined) {
  return Array.isArray(value?.textSpans) && value!.textSpans!.length > 0;
}

/**
 * The canonical spans for [text]: clamped, snapped to grapheme clusters, later spans winning where
 * input overlaps, identical neighbours merged, empty ones dropped. Never throws.
 */
export function normalizeTextSpans(raw: unknown, text: string): TextSpan[] {
  const value = String(text ?? "");
  if (!Array.isArray(raw) || raw.length === 0 || value.length === 0) return [];
  const spans = raw.filter((span): span is TextSpan => Boolean(span) && typeof span === "object");
  return compress(snapStyles(value, expand(spans, value.length)));
}

/** True when two span lists describe the same styling. */
export function textSpansEqual(a: ReadonlyArray<TextSpan> | null | undefined, b: ReadonlyArray<TextSpan> | null | undefined) {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every(
    (span, index) =>
      span.start === right[index].start &&
      span.end === right[index].end &&
      styleKey(normalizeTextSpanStyle(span)) === styleKey(normalizeTextSpanStyle(right[index]))
  );
}

/** Runs covering the whole text in order, unstyled stretches included (style {}). */
export function textSpanRuns(text: string, spans: ReadonlyArray<TextSpan> | null | undefined): TextStyleRun[] {
  const value = String(text ?? "");
  if (value.length === 0) return [];
  const runs: TextStyleRun[] = [];
  let cursor = 0;
  for (const span of normalizeTextSpans(spans, value)) {
    if (span.start > cursor) runs.push({ start: cursor, end: span.start, style: {} });
    const { start, end, ...style } = span;
    runs.push({ start, end, style });
    cursor = end;
  }
  if (cursor < value.length) runs.push({ start: cursor, end: value.length, style: {} });
  return runs;
}

/** The overrides in effect at [offset] ({} outside every span). */
export function textSpanStyleAt(spans: ReadonlyArray<TextSpan> | null | undefined, offset: number): TextSpanStyle {
  for (const span of spans ?? []) {
    if (offset >= span.start && offset < span.end) {
      const { start: _start, end: _end, ...style } = span;
      return normalizeTextSpanStyle(style);
    }
  }
  return {};
}

/**
 * Sets [patch] on [start, end): a key whose value is undefined/null — or equal to the layer's
 * [base] — removes the override there (so styling a word back to the layer's colour leaves no span).
 */
export function applyTextSpanStyle(
  spans: ReadonlyArray<TextSpan> | null | undefined,
  text: string,
  start: number,
  end: number,
  patch: Partial<Record<TextSpanStyleKey, unknown>>,
  base: Partial<ResolvedTextRunStyle> = {}
): TextSpan[] {
  const value = String(text ?? "");
  const [from, to] = snapTextRange(value, start, end);
  const current = normalizeTextSpans(spans, value);
  if (to <= from) return current;
  const entries = TEXT_SPAN_STYLE_KEYS.filter((key) => key in patch).map((key) => {
    const raw = patch[key];
    const normalized = raw === undefined || raw === null ? undefined : normalizeTextSpanValue(key, raw);
    const clears =
      raw === undefined || raw === null || (normalized !== undefined && valuesEqual(key, normalized, base[key]));
    return { key, value: normalized, clears };
  });
  const styles = expand(current, value.length);
  for (let index = from; index < to; index += 1) {
    const style: Record<string, unknown> = { ...(styles[index] ?? {}) };
    for (const entry of entries) {
      if (entry.clears) delete style[entry.key];
      else if (entry.value !== undefined) style[entry.key] = entry.value;
    }
    styles[index] = isEmptyStyle(style) ? null : (style as TextSpanStyle);
  }
  return compress(styles);
}

/** Removes [keys] from every span — the whole layer took a new value for them. */
export function clearTextSpanKeys(
  spans: ReadonlyArray<TextSpan> | null | undefined,
  text: string,
  keys: ReadonlyArray<TextSpanStyleKey>
): TextSpan[] {
  if (!spans || spans.length === 0) return [];
  const drop = new Set<string>(keys);
  return normalizeTextSpans(
    spans.map((span) => {
      const next: Record<string, unknown> = { ...span };
      for (const key of drop) delete next[key];
      return next;
    }),
    text
  );
}

/** Multiplies the spans' font sizes (and, by default, letter spacing) — the layer was scaled. */
export function scaleTextSpans(
  spans: ReadonlyArray<TextSpan> | null | undefined,
  factor: number,
  options: { letterSpacing?: boolean } = {}
): TextSpan[] {
  if (!spans || spans.length === 0) return [];
  const scale = Number(factor);
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 1e-9) return spans.map((span) => ({ ...span }));
  const scaleSpacing = options.letterSpacing !== false;
  return spans.map((span) => {
    const next: TextSpan = { ...span };
    if (typeof next.fontSize === "number") next.fontSize = roundTo(next.fontSize * scale);
    if (scaleSpacing && typeof next.letterSpacing === "number") next.letterSpacing = roundTo(next.letterSpacing * scale);
    return next;
  });
}

/**
 * The spans after [previousText] became [nextText] (one contiguous edit: typing, deleting, pasting
 * or replacing a selection). Text typed over a selection takes the selection's style; text typed at
 * a caret takes the style of the letter before it (the one after it at a paragraph start).
 */
export function remapTextSpansForEdit(
  spans: ReadonlyArray<TextSpan> | null | undefined,
  previousText: string,
  nextText: string
): TextSpan[] {
  const before = String(previousText ?? "");
  const after = String(nextText ?? "");
  if (!spans || spans.length === 0 || after.length === 0) return [];
  if (before === after) return normalizeTextSpans(spans, after);
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  const styles = expand(normalizeTextSpans(spans, before), before.length);
  const removedStart = prefix;
  const removedEnd = before.length - suffix;
  const insertedLength = after.length - prefix - suffix;
  let inherited: TextSpanStyle | null = null;
  if (removedEnd > removedStart) inherited = styles[removedStart];
  else if (prefix > 0 && before[prefix - 1] !== "\n") inherited = styles[prefix - 1];
  else if (removedEnd < before.length) inherited = styles[removedEnd];
  else if (prefix > 0) inherited = styles[prefix - 1];
  const next: CharStyles = [
    ...styles.slice(0, removedStart),
    ...new Array<TextSpanStyle | null>(Math.max(0, insertedLength)).fill(inherited),
    ...styles.slice(removedEnd),
  ];
  return compress(snapStyles(after, next));
}

/** The layer's own style as the base every span overrides. */
export function textSpanBaseStyle(element: {
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  fontSize?: number;
  color?: string;
  fill?: string;
  letterSpacing?: number;
  textDecoration?: string;
  stroke?: string;
  strokeWidth?: number;
}): ResolvedTextRunStyle {
  return {
    fontFamily: String(element?.fontFamily || "").trim(),
    fontWeight: normalizeWeight(element?.fontWeight) ?? "400",
    fontStyle: element?.fontStyle === "italic" ? "italic" : "normal",
    fontSize: Math.max(1, Number(element?.fontSize) || 1),
    color: String(element?.color || element?.fill || "#000000"),
    letterSpacing: Number(element?.letterSpacing) || 0,
    textDecoration: normalizeDecoration(element?.textDecoration) ?? "",
    stroke: String(element?.stroke || ""),
    strokeWidth: Math.max(0, Math.min(100, Number(element?.strokeWidth) || 0)),
    highlightColor: "",
    highlightOpacity: 1,
  };
}

/** [base] with [override] on top. */
export function resolveTextRunStyle(base: ResolvedTextRunStyle, override: TextSpanStyle | null | undefined): ResolvedTextRunStyle {
  if (!override) return base;
  const resolved = { ...base };
  for (const key of TEXT_SPAN_STYLE_KEYS) {
    const value = (override as Record<string, unknown>)[key];
    if (value !== undefined) (resolved as unknown as Record<string, unknown>)[key] = value;
  }
  if (!override.highlightColor && override.highlightOpacity === undefined) {
    resolved.highlightOpacity = base.highlightOpacity;
  }
  return resolved;
}

/** True when any span changes where glyphs go (font, weight, style, size or spacing). */
export function textSpansAffectLayout(spans: ReadonlyArray<TextSpan> | null | undefined) {
  return (spans ?? []).some((span) =>
    TEXT_SPAN_METRIC_KEYS.some((key) => (span as unknown as Record<string, unknown>)[key] !== undefined)
  );
}

/** Every font family the spans name (not the layer's own). */
export function textSpanFontFamilies(spans: ReadonlyArray<TextSpan> | null | undefined): string[] {
  const families = new Map<string, string>();
  for (const span of spans ?? []) {
    const family = String(span?.fontFamily || "").trim();
    if (family && !families.has(family.toLowerCase())) families.set(family.toLowerCase(), family);
  }
  return [...families.values()];
}

/**
 * The value of each key shared by the whole of [start, end) — what a toolbar shows for a selection.
 * A key styled differently across the range (or partly unstyled) is absent.
 */
export function textSpanStyleOfRange(
  spans: ReadonlyArray<TextSpan> | null | undefined,
  text: string,
  start: number,
  end: number
): TextSpanStyle {
  const value = String(text ?? "");
  const [from, to] = snapTextRange(value, start, end);
  if (to <= from) return textSpanStyleAt(spans, from > 0 ? from - 1 : from);
  const styles = expand(normalizeTextSpans(spans, value), value.length);
  const shared: Record<string, unknown> = { ...(styles[from] ?? {}) };
  for (let index = from + 1; index < to && Object.keys(shared).length > 0; index += 1) {
    const style = (styles[index] ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(shared)) {
      if (style[key] !== shared[key]) delete shared[key];
    }
  }
  return shared as TextSpanStyle;
}

// ── Whole-layer edits ────────────────────────────────────────────────────────────────────────────

/**
 * Layer fields that, set on the WHOLE layer, override the matching span key everywhere — the
 * layer's colour picked with nothing selected recolours every word, as in Canva.
 */
const WHOLE_LAYER_SPAN_KEYS: Record<string, TextSpanStyleKey> = {
  fontFamily: "fontFamily",
  fontWeight: "fontWeight",
  fontStyle: "fontStyle",
  color: "color",
  fill: "color",
  letterSpacing: "letterSpacing",
  textDecoration: "textDecoration",
  stroke: "stroke",
  strokeWidth: "strokeWidth",
};

/**
 * The patch to apply to a text layer with spans so they stay coherent: a new `text` carries the
 * spans along (remapTextSpansForEdit), a whole-layer style value drops that key from the spans, and
 * a new layer font size scales the spans' sizes by the same factor (a heading stays twice its body).
 * A patch that sets `textSpans` itself is taken as is.
 */
export function reconcileTextSpansForPatch<
  P extends Record<string, unknown>,
>(
  element: { type?: string; text?: string; fontSize?: number; textSpans?: ReadonlyArray<TextSpan> | null },
  patch: P
): P {
  if (!element || element.type !== "text" || !hasTextSpans(element)) return patch;
  if (!patch || "textSpans" in patch) return patch;
  const original = element.textSpans as ReadonlyArray<TextSpan>;
  let spans: ReadonlyArray<TextSpan> = original;
  let text = String(element.text ?? "");
  if (typeof patch.text === "string" && patch.text !== text) {
    spans = remapTextSpansForEdit(spans, text, patch.text);
    text = patch.text;
  }
  const cleared = new Set<TextSpanStyleKey>();
  for (const [field, key] of Object.entries(WHOLE_LAYER_SPAN_KEYS)) {
    if (field in patch && patch[field] !== undefined) cleared.add(key);
  }
  if (cleared.size > 0) spans = clearTextSpanKeys(spans, text, [...cleared]);
  const previousSize = Number(element.fontSize);
  const nextSize = Number(patch.fontSize);
  if ("fontSize" in patch && previousSize > 0 && nextSize > 0 && Math.abs(nextSize - previousSize) > 1e-9) {
    spans = scaleTextSpans(spans, nextSize / previousSize, { letterSpacing: false });
  }
  if (spans === original) return patch;
  return { ...patch, textSpans: spans as TextSpan[] };
}
