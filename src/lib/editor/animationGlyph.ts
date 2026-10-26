/**
 * Port of the mobile app's per-glyph / per-word / typewriter text math:
 *   • LayerAnimationGlyphMotion.kt  (glyphMotionIndices, glyphVisual, activeWordIndex, …)
 *   • the typewriter functions in LayerAnimationVisualRuntime.kt (revealedCharOffset, …)
 *
 * These are the pieces the Phase-1 web preview couldn't honour. They are PURE (no rendering) so
 * they parity-test against the mobile golden exactly like the visual runtime does; the Konva
 * renderer consumes their output.
 *
 * Char iteration is by UTF-16 unit (`text[i]`, matching Kotlin's `for (c in text)`), NOT code
 * points — so the ordinals line up with the mobile source for the BMP scripts we ship (Arabic,
 * Latin).
 */
import { cubicBezierEase } from "./animationCurves";

// ── typewriter cadence (verbatim constants) ────────────────────────────────
export const ANDALUSI_FIRST_UNIT_MS = 160;
export const ANDALUSI_CHAR_CADENCE_MS = 160;
export const ANDALUSI_WORD_CADENCE_MS = 640;
export const ANDALUSI_ONE_WORD_CADENCE_MS = 720;
export const ANDALUSI_TYPEWRITER_TYPING_FRACTION = 0.64;

export type TextRevealMode = "CHARS" | "WORDS" | "CURSOR";

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/** Their authored cadence, compressed only when [unitCount] units couldn't finish in budget. */
export function andalusiUnitCadenceMs(authoredMs: number, unitCount: number, durationMs: number): number {
  if (unitCount <= 1) return authoredMs;
  const budget = Math.max(1, durationMs) * ANDALUSI_TYPEWRITER_TYPING_FRACTION - ANDALUSI_FIRST_UNIT_MS;
  return Math.max(1, Math.min(authoredMs, budget / (unitCount - 1)));
}

function cadenceForMode(mode: TextRevealMode): number {
  return mode === "WORDS" ? ANDALUSI_WORD_CADENCE_MS : ANDALUSI_CHAR_CADENCE_MS;
}

/** For each whitespace-delimited word, the char index at the END of its trailing whitespace. */
export function wordBoundaryCharIndices(text: string): number[] {
  const boundaries: number[] = [];
  const n = text.length;
  let i = 0;
  while (i < n && /\s/.test(text[i])) i += 1; // leading whitespace folds into the first word
  while (i < n) {
    while (i < n && !/\s/.test(text[i])) i += 1; // consume the word
    while (i < n && /\s/.test(text[i])) i += 1; // consume trailing spaces
    boundaries.push(i);
  }
  return boundaries;
}

/** How many units (glyphs, or words in WORDS mode) have popped in by [progress]. */
export function revealedUnitCount(
  progress: number,
  mode: TextRevealMode,
  durationMs: number,
  unitCount: number
): number {
  if (unitCount <= 0) return 0;
  const duration = Math.max(1, durationMs);
  const elapsedMs = clamp(progress, 0, 1) * duration;
  if (elapsedMs < ANDALUSI_FIRST_UNIT_MS) return 0;
  const cadence = andalusiUnitCadenceMs(cadenceForMode(mode), unitCount, duration);
  return clamp(Math.floor((elapsedMs - ANDALUSI_FIRST_UNIT_MS) / cadence) + 1, 0, unitCount);
}

/** The char offset the text should be revealed up to (the renderer clips at this glyph). */
export function revealedCharOffset(
  progress: number,
  mode: TextRevealMode,
  durationMs: number,
  text: string
): number {
  if (text.length === 0) return 0;
  if (mode === "CHARS" || mode === "CURSOR") {
    return revealedUnitCount(progress, mode, durationMs, text.length);
  }
  const boundaries = wordBoundaryCharIndices(text);
  const shown = revealedUnitCount(progress, mode, durationMs, boundaries.length);
  if (shown <= 0) return 0;
  return boundaries[Math.min(shown - 1, boundaries.length - 1)];
}

// ── CapCut's letter pacings (the slot's `typePacing` param) ─────────────────
// Read from CapCut's own text-animation scripts (2026-10-22). Units are ALL the text's characters
// in order, line breaks included (a break takes its own beat — matched frame by frame against
// CapCut on "Aziza\n&\nAmmar"); p is the slot's 0..1 progress.
//   1 "Type 2" (PrinterTwo.lua): unit u fades in on sinIn from sinIn(u/n)·¾ of the effect, over
//     quinticOut(u/n)·¼ of it.
//   2 "Random Typewriter" (PrinterOne.lua): even slots of 1/n; the letter in its slot steps 0.33 →
//     0.66 → 1 (CapCut also scrambles that letter's glyph — not drawn).
//   3 "Typewriter" (TextAnim.lua): CapCut's typing rhythm (a 14-value weight table, the second one
//     when a letter gets ≥ 150 ms), typed over the first 1/1.2 of the effect; a letter pops in
//     whole at 90 % of its slot.
// The app computes the same in LayerAnimationVisualRuntime.kt (typewriterCharAlphas).
export const TYPE_PACING_TYPE2 = 1;
export const TYPE_PACING_RANDOM = 2;
export const TYPE_PACING_RHYTHM = 3;
const CAPCUT_TYPING_RHYTHM = [0.86, 1.35, 0.62, 5.2, 0.25, 0.96, 0.35, 4.55, 0.03, 0.82, 0.2, 1.26, 0.36, 0.1];
const CAPCUT_TYPING_RHYTHM_SLOW = [0.86, 1.35, 0.62, 2.2, 0.25, 0.96, 0.35, 2.55, 0.03, 0.82, 0.2, 1.26, 0.36, 0.1];

const sinIn = (x: number) => 1 - Math.cos((clamp(x, 0, 1) * Math.PI) / 2);
const quinticOut = (x: number) => 1 - Math.pow(1 - clamp(x, 0, 1), 5);

/** Each unit's opacity at [progress] for pacing [pacing] (n units). */
export function typewriterUnitAlphas(pacing: number, progress: number, durationMs: number, n: number): number[] {
  const alphas = new Array<number>(Math.max(0, n)).fill(0);
  if (n <= 0) return alphas;
  const p = clamp(progress, 0, 1);
  if (p >= 1) return alphas.fill(1);
  if (pacing === TYPE_PACING_TYPE2) {
    for (let u = 1; u <= n; u += 1) {
      const start = sinIn(u / n) * 0.75;
      const length = quinticOut(u / n) * 0.25;
      alphas[u - 1] = length > 0 ? sinIn((p - start) / length) : p >= start ? 1 : 0;
    }
  } else if (pacing === TYPE_PACING_RANDOM) {
    if (p <= 0) return alphas;
    const slot = 1 / n;
    const current = Math.ceil(p / slot);
    const step = Math.floor((p % slot) / (slot / 3));
    for (let u = 1; u <= n; u += 1) {
      alphas[u - 1] = u < current ? 1 : u === current ? Math.min(1, (step + 1) * 0.33) : 0;
    }
  } else if (pacing === TYPE_PACING_RHYTHM) {
    const table = Math.max(1, durationMs) / 1000 / n >= 0.15 ? CAPCUT_TYPING_RHYTHM_SLOW : CAPCUT_TYPING_RHYTHM;
    const weights = Array.from({ length: n }, (_, k) => table[k % table.length]);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const q = 1.2 * p;
    let start = 0;
    for (let u = 0; u < n; u += 1) {
      const share = weights[u] / total;
      alphas[u] = q >= start + 0.9 * share ? 1 : 0;
      start += share;
    }
  } else {
    return alphas.fill(1);
  }
  return alphas;
}

/** Per-character opacity of [text] (every character is a unit), or null without a pacing. */
export function typewriterCharAlphas(
  pacing: number | undefined,
  progress: number,
  durationMs: number,
  text: string
): number[] | null {
  if (!pacing) return null;
  return typewriterUnitAlphas(pacing, progress, durationMs, text.length);
}

/** The revealed share of the text's WIDTH (char-index approximation). */
export function revealFraction(
  progress: number,
  mode: TextRevealMode,
  durationMs: number,
  text: string
): number {
  const n = text.length;
  if (n <= 0) return 1;
  return revealedCharOffset(progress, mode, durationMs, text) / n;
}

// ── per-glyph / per-word motion (verbatim constants) ───────────────────────
const GLYPH_STAGGER_FRAMES = 3.5;
const GLYPH_ENTRANCE_FRAMES = 10.5;
const GLYPH_COMP_FRAMES = 50;
const GLYPH_RISE_EM = 0.328;
const GLYPH_SCALE_FROM = 0.722;
const GLYPH_WIGGLE_EM = 0.282;
const GLYPH_WIGGLE_STAGGER_FRAMES = 6.7;
const glyphEntrance = (t: number) => cubicBezierEase(t, 0, 0, 0.49, 1);
const wiggleUp = (t: number) => cubicBezierEase(t, 0.31, 0, 0.69, 1);
const wiggleDown = (t: number) => cubicBezierEase(t, 0.167, 0, 0.833, 1);

export interface GlyphVisual {
  alpha: number;
  /** Vertical offset as a fraction of line height; positive is downward. */
  translateYEm: number;
  scale: number;
}
const REST: GlyphVisual = { alpha: 1, translateYEm: 0, scale: 1 };
export function glyphIsAtRest(g: GlyphVisual): boolean {
  return g.alpha >= 0.999 && g.translateYEm === 0 && g.scale === 1;
}

export function isPerGlyphMotion(type: string): boolean {
  switch (type) {
    case "CH_POSITION_FADE":
    case "CH_SCALE_FADE":
    case "CH_WIGGLE_Y":
    case "ONE_WORD":
    case "ASCEND":
      return true;
    default:
      return false;
  }
}

export interface GlyphMotionIndices {
  glyphOrdinal: number[];
  wordOrdinal: number[];
  glyphCount: number;
  wordCount: number;
}

export function glyphMotionIndices(text: string): GlyphMotionIndices {
  const glyphOrdinal: number[] = [];
  const wordOrdinal: number[] = [];
  let glyphs = 0;
  let words = 0;
  let insideWord = false;
  for (let i = 0; i < text.length; i += 1) {
    if (/\s/.test(text[i])) {
      glyphOrdinal.push(-1);
      wordOrdinal.push(-1);
      if (insideWord) {
        words += 1;
        insideWord = false;
      }
    } else {
      glyphOrdinal.push(glyphs);
      glyphs += 1;
      insideWord = true;
      wordOrdinal.push(words);
    }
  }
  return { glyphOrdinal, wordOrdinal, glyphCount: glyphs, wordCount: insideWord ? words + 1 : words };
}

/** Their 3.5-frame stagger, compressed only when the string won't otherwise finish in time. */
function glyphStaggerFrames(count: number): number {
  if (count <= 1) return GLYPH_STAGGER_FRAMES;
  const lastStart = GLYPH_COMP_FRAMES - GLYPH_ENTRANCE_FRAMES;
  return Math.max(0.01, Math.min(GLYPH_STAGGER_FRAMES, lastStart / (count - 1)));
}

/** How far unit [index]'s own 10.5-frame entrance has run at [frame]. */
function glyphLocalProgress(frame: number, index: number, count: number): number {
  const elapsed = frame - index * glyphStaggerFrames(count);
  if (elapsed <= 0) return 0;
  if (elapsed >= GLYPH_ENTRANCE_FRAMES) return 1;
  return glyphEntrance(elapsed / GLYPH_ENTRANCE_FRAMES);
}

/** Which word ONE_WORD is showing at [progress], or -1 before the first. */
export function activeWordIndex(progress: number, durationMs: number, wordCount: number): number {
  if (wordCount <= 0) return -1;
  const duration = Math.max(1, durationMs);
  const elapsed = clamp(progress, 0, 1) * duration;
  if (elapsed < ANDALUSI_FIRST_UNIT_MS) return -1;
  const cadence = andalusiUnitCadenceMs(ANDALUSI_ONE_WORD_CADENCE_MS, wordCount, duration);
  return clamp(Math.floor((elapsed - ANDALUSI_FIRST_UNIT_MS) / cadence), 0, wordCount - 1);
}

/** The visual for glyph [index] of [count], or null for non-glyph types. */
export function glyphVisual(
  type: string,
  progress: number,
  durationMs: number,
  index: number,
  count: number,
  wordIndex = 0,
  wordCount = 1
): GlyphVisual | null {
  if (!isPerGlyphMotion(type) || count <= 0) return null;
  const frame = clamp(progress, 0, 1) * GLYPH_COMP_FRAMES;
  switch (type) {
    case "CH_POSITION_FADE": {
      const local = glyphLocalProgress(frame, index, count);
      return { ...REST, alpha: local, translateYEm: (1 - local) * GLYPH_RISE_EM };
    }
    case "CH_SCALE_FADE": {
      const local = glyphLocalProgress(frame, index, count);
      return { ...REST, alpha: local, scale: GLYPH_SCALE_FROM + local * (1 - GLYPH_SCALE_FROM) };
    }
    case "CH_WIGGLE_Y": {
      const phaseFrames = (count - 1 - index) * GLYPH_WIGGLE_STAGGER_FRAMES;
      const phase = (((frame + phaseFrames) % GLYPH_COMP_FRAMES) + GLYPH_COMP_FRAMES) % GLYPH_COMP_FRAMES / GLYPH_COMP_FRAMES;
      const bob = phase < 0.5 ? wiggleUp(phase * 2) : 1 - wiggleDown((phase - 0.5) * 2);
      return { ...REST, translateYEm: (0.5 - bob) * GLYPH_WIGGLE_EM };
    }
    case "ONE_WORD": {
      const active = activeWordIndex(progress, durationMs, wordCount);
      return { ...REST, alpha: wordIndex === active ? 1 : 0 };
    }
    case "ASCEND": {
      const local = glyphLocalProgress(frame, Math.max(0, wordIndex), wordCount);
      return { ...REST, alpha: local, translateYEm: (1 - local) * GLYPH_RISE_EM };
    }
    default:
      return null;
  }
}

// ── per-word single-line layout (for the ASCEND / ONE_WORD renderer) ────────
export interface WordBox {
  text: string;
  wordIndex: number;
  x: number;
  width: number;
}

/** Words in logical order, matching glyphMotionIndices' wordCount. Empty for blank text. */
export function splitWordsForMotion(text: string): string[] {
  const trimmed = text.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/);
}

/**
 * Lay N measured words onto ONE line, honouring block alignment and RTL visual order (word 0 is
 * the RIGHT-most in RTL). Positions are the left x of each word in the layer's local box. Pure so
 * it unit-tests; the renderer supplies the measured widths and applies each word's glyph visual.
 * Multi-line text is NOT handled here — the caller falls back for anything that would wrap.
 */
export function layoutWordsSingleLine(
  words: { text: string; width: number }[],
  spaceWidth: number,
  boxWidth: number,
  align: "left" | "center" | "right",
  rtl: boolean
): WordBox[] {
  const n = words.length;
  if (n === 0) return [];
  const total = words.reduce((s, w) => s + w.width, 0) + spaceWidth * (n - 1);
  const start = align === "center" ? (boxWidth - total) / 2 : align === "right" ? boxWidth - total : 0;
  const out: WordBox[] = [];
  if (!rtl) {
    let x = start;
    for (let i = 0; i < n; i += 1) {
      out.push({ text: words[i].text, wordIndex: i, x, width: words[i].width });
      x += words[i].width + spaceWidth;
    }
  } else {
    // RTL: the first logical word sits at the RIGHT edge of the content block.
    let xRight = start + total;
    for (let i = 0; i < n; i += 1) {
      xRight -= words[i].width;
      out.push({ text: words[i].text, wordIndex: i, x: xRight, width: words[i].width });
      xRight -= spaceWidth;
    }
  }
  return out;
}
