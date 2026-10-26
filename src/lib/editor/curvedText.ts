/**
 * Curved text, the APP's model, line for line (PhotoEditor `model/CurvedTextLayout.kt`,
 * `model/TextJustificationMath.kt`, `presentation/components/ProjectCanvasTextGeometry.kt`):
 *
 *  - every line of the text (split on "\n") rides its own arc, stacked in equal bands of the box;
 *  - a line is shaped WHOLE (joins, ligatures, bidi) and its outline is bent onto the arc — the
 *    arc's radius is whatever makes the line's advance fill `arcDegrees` (L = θ·R), centred on the
 *    box's axis with its sag centred in the band and the ink (ascent−descent middle) on the arc;
 *  - the الحجم/Size slider (`ringSpread`, 0..1) lengthens each line up to 3× — kashida (tatweel)
 *    first inside Arabic words, then wider word gaps; letters are never tracked apart — so the ring
 *    grows without touching the glyphs; a closed ring (|arc| ≥ 359.5°) gets a seam space;
 *  - the box is DERIVED: the arc's bounding box per line, × the line count, plus 0.45 em padding.
 *
 * Pure geometry and text maths; the canvas side (measuring, shaping, bending) is curvedTextPaint.ts.
 */

const DEGREES = Math.PI / 180;

const finiteOr = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// ── The curve value ────────────────────────────────────────────────────────────────────────────

export interface CurvedTextSource {
  textCurveEnabled?: unknown;
  textCurveAmount?: unknown;
  textCurveArcDegrees?: unknown;
  textCurveRingSpread?: unknown;
}

/** The app's activity test: enabled and |arc| > 0.5°. */
export function curvedTextArcDegrees(item: CurvedTextSource | null | undefined): number {
  if (!item || !item.textCurveEnabled) return 0;
  const arc = finiteOr(item.textCurveArcDegrees, 0);
  return Math.abs(arc) > 0.5 ? clamp(arc, -360, 360) : 0;
}

export function curvedTextRingSpread(item: CurvedTextSource | null | undefined): number {
  return clamp(finiteOr(item?.textCurveRingSpread, 0), 0, 1);
}

/** The app's curve slider: −100..100 % of a full circle. */
export function curvePercentFromArc(arcDegrees: number): number {
  return clamp(Math.round((finiteOr(arcDegrees, 0) / 360) * 100), -100, 100);
}

/** The patch the curve slider writes (the app's `arcDegrees = pct/100 × 360`, enabled when ≠ 0). */
export function curvePatchFromPercent(percent: number) {
  const pct = clamp(Math.round(finiteOr(percent, 0)), -100, 100);
  return {
    textCurveEnabled: pct !== 0,
    textCurveArcDegrees: pct !== 0 ? (pct / 100) * 360 : undefined,
    // Kept in step for code that still reads the legacy amount.
    textCurveAmount: pct,
  };
}

// ── The arc ────────────────────────────────────────────────────────────────────────────────────

export interface CurvedArc {
  axisX: number;
  /** y of the apex (θ = 0) baseline, in the band. */
  baselineY: number;
  radius: number;
  halfSweep: number;
  /** +1 dome (∩), −1 valley (∪). */
  bend: number;
  totalAdvance: number;
}

/**
 * The app's `resolveCurvedTextArc`: radius = advance ÷ sweep (sweep clamped to 0.5°..360°), the
 * arc centred on the band's vertical axis with its sag centred, then moved down by
 * [baselineShift] = (ascent − descent) / 2 so the INK, not the baseline, is centred.
 */
export function resolveCurvedArc(
  totalAdvance: number,
  arcDegrees: number,
  containerWidth: number,
  containerHeight: number,
  baselineShift = 0
): CurvedArc {
  const w = Math.max(1, finiteOr(containerWidth, 1));
  const h = Math.max(1, finiteOr(containerHeight, 1));
  const advance = Math.max(1, finiteOr(totalAdvance, 1));
  const bend = finiteOr(arcDegrees, 0) >= 0 ? 1 : -1;
  const sweep = clamp(Math.abs(finiteOr(arcDegrees, 0)), 0.5, 360) * DEGREES;
  const radius = Math.max(1, advance / Math.max(sweep, 0.001));
  const halfSweep = sweep / 2;
  const sag = radius * (1 - Math.cos(halfSweep));
  return {
    axisX: w / 2,
    baselineY: h / 2 - (bend * sag) / 2 + finiteOr(baselineShift, 0),
    radius,
    halfSweep,
    bend,
    totalAdvance: advance,
  };
}

/**
 * The app's `placeAtAdvance`: where the point [advance] px along the laid-out (visual, left →
 * right) line sits on the arc, and the tangent rotation there (radians; θ clamped to the sweep).
 */
export function placeAtAdvance(arc: CurvedArc, advance: number) {
  const theta = clamp((advance - arc.totalAdvance / 2) / arc.radius, -arc.halfSweep, arc.halfSweep);
  return {
    x: arc.axisX + arc.radius * Math.sin(theta),
    y: arc.baselineY + arc.bend * arc.radius * (1 - Math.cos(theta)),
    rotation: theta * arc.bend,
  };
}

/**
 * Bends one point of the flat line (x = advance along it, y = offset from its baseline, y-down)
 * onto the arc: the app's warp, `wx = p.x − y·sin r`, `wy = p.y + y·cos r`.
 */
export function warpPoint(arc: CurvedArc, x: number, y: number) {
  const p = placeAtAdvance(arc, x);
  return { x: p.x - y * Math.sin(p.rotation), y: p.y + y * Math.cos(p.rotation) };
}

/** The app's `resolveCurvedTextArcAabb`: the bounding box of a [flatWidth] × [flatHeight] run bent through [arcDegrees]. */
export function curvedTextArcAabb(flatWidth: number, flatHeight: number, arcDegrees: number) {
  const w = Math.max(1, finiteOr(flatWidth, 1));
  const h = Math.max(1, finiteOr(flatHeight, 1));
  const sweep = clamp(Math.abs(finiteOr(arcDegrees, 0)), 0.5, 360) * DEGREES;
  const radius = Math.max(1, w / Math.max(sweep, 0.001));
  const half = sweep / 2;
  const outer = radius + h / 2;
  const inner = Math.max(radius - h / 2, 0);
  const thetas = [0, half, -half, ...(half >= Math.PI / 2 ? [Math.PI / 2, -Math.PI / 2] : [])];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const theta of thetas) {
    for (const r of [inner, outer]) {
      const x = r * Math.sin(theta);
      const y = radius - r * Math.cos(theta);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, h) };
}

/** Glyph height per line in the app's frame: font × 1.35, never taller than one line box. */
export const CURVED_GLYPH_HEIGHT_TO_FONT_RATIO = 1.35;
/** Frame padding on every side, × font size (a visible background box uses its own padding). */
export const CURVED_OVERLAY_PADDING_TO_FONT_RATIO = 0.45;

/**
 * The box a curved text occupies (the app's `rememberTextLayerNaturalSizePx` + its padding): the
 * widest STRETCHED line's arc bounding box, × the line count, plus [padding] on every side.
 */
export function curvedTextFrame(input: {
  widestLineAdvance: number;
  lineCount: number;
  fontSize: number;
  lineHeight: number;
  arcDegrees: number;
  paddingX?: number;
  paddingY?: number;
}) {
  const font = Math.max(1, finiteOr(input.fontSize, 1));
  const lines = Math.max(1, Math.round(finiteOr(input.lineCount, 1)));
  const glyphHeight = clamp(font * CURVED_GLYPH_HEIGHT_TO_FONT_RATIO, 1, Math.max(1, font * finiteOr(input.lineHeight, 1.2)));
  const perLine = curvedTextArcAabb(input.widestLineAdvance, glyphHeight, input.arcDegrees);
  const padX = finiteOr(input.paddingX, font * CURVED_OVERLAY_PADDING_TO_FONT_RATIO);
  const padY = finiteOr(input.paddingY, font * CURVED_OVERLAY_PADDING_TO_FONT_RATIO);
  return { width: perLine.width + padX * 2, height: perLine.height * lines + padY * 2 };
}

// ── Arabic detection (the app decides direction by content) ──────────────────────────────────

export function containsArabic(text: string): boolean {
  for (const char of String(text || "")) {
    const code = char.codePointAt(0) || 0;
    if (
      (code >= 0x0600 && code <= 0x06ff) ||
      (code >= 0x0750 && code <= 0x077f) ||
      (code >= 0x0870 && code <= 0x089f) ||
      (code >= 0x08a0 && code <= 0x08ff) ||
      (code >= 0xfb50 && code <= 0xfdff) ||
      (code >= 0xfe70 && code <= 0xfeff) ||
      (code >= 0x1ee00 && code <= 0x1eeff)
    ) {
      return true;
    }
  }
  return false;
}

// ── The Size slider: kashida-first stretch (TextJustificationMath.kt) ─────────────────────────

export const ARABIC_TATWEEL = "ـ";
const JUSTIFY_FILL_FACTOR = 0.995;
const JUSTIFY_MIN_DEFICIT_FRACTION = 0.002;
const MAX_RING_GROWTH = 3;

const DUAL_JOINING = new Set([..."بتثجحخسشصضطظعغفقكلمنهيئ", ARABIC_TATWEEL, ..."پچگکی"]);
const JOIN_ACCEPTING = new Set([...DUAL_JOINING, ..."اأإآدذرزوؤةىژے"]);
const ALEF_FORMS = new Set([..."اأإآ"]);
const isArabicMark = (char: string) => {
  const code = char.charCodeAt(0);
  return (code >= 0x064b && code <= 0x065f) || code === 0x0670 || (code >= 0x06d6 && code <= 0x06ed);
};
const isWhitespace = (char: string) => /\s/.test(char);

/** Indices (UTF-16, like Kotlin's) to insert tatweel AFTER within [start, end). Never inside لا. */
export function kashidaInsertionPoints(text: string, start: number, end: number): number[] {
  const points: number[] = [];
  let i = start;
  while (i < end) {
    const char = text[i];
    if (!DUAL_JOINING.has(char)) {
      i += 1;
      continue;
    }
    let insertAfter = i;
    let next = i + 1;
    while (next < end && isArabicMark(text[next])) {
      insertAfter = next;
      next += 1;
    }
    if (next >= end) break;
    const nextBase = text[next];
    if (JOIN_ACCEPTING.has(nextBase) && !(char === "ل" && ALEF_FORMS.has(nextBase))) points.push(insertAfter);
    i += 1;
  }
  return points;
}

/** How much longer the run gets at [ringSpread]: 1 … 3. */
export function ringGrowthFactor(ringSpread: number): number {
  const spread = Number.isFinite(ringSpread) ? clamp(ringSpread, 0, 1) : 0;
  return 1 + spread * (MAX_RING_GROWTH - 1);
}

export function isClosedRingArc(arcDegrees: number): boolean {
  return Number.isFinite(arcDegrees) && Math.abs(arcDegrees) >= 359.5;
}

/** A run with an Arabic joining point or a word gap; a single Latin word has nothing to stretch. */
export function canStretchCurvedRun(text: string): boolean {
  if (kashidaInsertionPoints(text, 0, text.length).length > 0) return true;
  return text.trim().includes(" ");
}

export interface CurvedRingStretch {
  /** The line with its tatweels inserted (and a closed ring's seam space). */
  text: string;
  /** Extra advance for EVERY space, px. */
  extraWordSpacing: number;
  /** For each index of the source line, how many tatweels were inserted after it (span remapping). */
  insertedAfter: number[];
}

/**
 * The app's `buildCurvedRingStretch`: the line lengthened to [ringGrowthFactor]× its
 * [naturalAdvance] — the deficit (× 0.995, skipped under 0.2% of the column) filled with tatweels
 * spread evenly over the joining points (the remainder to the LAST points), and whatever is left
 * spread over the spaces. A closed ring appends a seam space.
 */
export function buildCurvedRingStretch(
  text: string,
  ringSpread: number,
  naturalAdvance: number,
  tatweelWidth: number,
  closedRing = false
): CurvedRingStretch {
  const source = String(text || "");
  const insertedAfter = new Array<number>(source.length).fill(0);
  const factor = ringGrowthFactor(ringSpread);
  if (!source.trim() || !(naturalAdvance > 0)) return { text: source, extraWordSpacing: 0, insertedAfter };
  let extraWordSpacing = 0;
  let stretched = source;
  if (factor > 1) {
    const column = naturalAdvance * factor;
    let start = 0;
    let end = source.length;
    while (start < end && isWhitespace(source[start])) start += 1;
    while (end > start && isWhitespace(source[end - 1])) end -= 1;
    const deficit = (column - naturalAdvance) * JUSTIFY_FILL_FACTOR;
    if (start < end && deficit > column * JUSTIFY_MIN_DEFICIT_FRACTION) {
      const points = kashidaInsertionPoints(source, start, end);
      let remainder = deficit;
      if (points.length > 0 && tatweelWidth > 0.5) {
        const total = Math.floor(deficit / tatweelWidth);
        if (total > 0) {
          const perPoint = Math.floor(total / points.length);
          const bonus = total % points.length;
          points.forEach((insertAfter, index) => {
            insertedAfter[insertAfter] += perPoint + (index >= points.length - bonus ? 1 : 0);
          });
          remainder = deficit - total * tatweelWidth;
        }
      }
      if (remainder > 0.5) {
        let spaces = 0;
        for (let i = start; i < end; i += 1) if (source[i] === " ") spaces += 1;
        if (spaces > 0) extraWordSpacing = remainder / spaces;
      }
      let built = "";
      for (let i = 0; i < source.length; i += 1) built += source[i] + ARABIC_TATWEEL.repeat(insertedAfter[i]);
      stretched = built;
    }
  }
  if (closedRing && !stretched.endsWith(" ")) stretched += " ";
  return { text: stretched, extraWordSpacing, insertedAfter };
}
