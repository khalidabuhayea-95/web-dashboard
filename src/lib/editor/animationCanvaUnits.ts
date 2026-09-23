/**
 * Canva's text writing styles (نمط الكتابة: character / word / line) for Fade, Blur, Succession and
 * Neon — docs/canva-animation-parity.md §8.4. Pure functions, mirrored by name in the app
 * (`canvaTextUnits`, `canvaUnitVisual`, `canvaUnitElementScale`) and replayed against its golden
 * in animationParamsParity.test.ts.
 *
 *  • Units — a port of Canva's text-unit iterator (`crf`): every paragraph contributes a PSEUDO
 *    newline item (whitespace, on the paragraph's first line) and then its graphemes. Word and
 *    line indices advance exactly as Canva's do, so whitespace and pseudo items OCCUPY units while
 *    drawing nothing — the first real unit starts one stagger step late, as in Canva.
 *  • Schedules — the per-unit tween lists of Canva's Fade (`Crf`), Blur (`gsf`), Succession
 *    (`ttf`: `ptf`/`qtf` per unit plus the element scale `rtf`/`stf`) and Neon (`Gsf` running
 *    `Esf`/`Fsf` per unit), fitted to the slot window with `$qf`/`Yqf`/`Zqf` (floors included) and,
 *    for Neon, de-overlapped with `Gqf`. They are evaluated with the `Xpf` hold rule at
 *    τ = progress · durationMs, where progress is the raw ENTRANCE progress p or the raw EXIT
 *    progress u of the slot (the resolver's `glyphMotion.rawProgress`).
 */
import {
  CANVA_EASE,
  canvaDedupeTweens,
  canvaFitUnitSchedule,
  canvaLerp,
  canvaSeededRandom,
  canvaSortTweens,
  canvaTweenListValue,
  type CanvaTween,
} from "./animationCanvaTweens";
import { isCanvaCombiningMark } from "./animationCanvaMarks";

/** Canva's writing styles as stored in the `unit` param (their config `ID`). */
export const CANVA_UNIT_CHARACTER = 1;
export const CANVA_UNIT_WORD = 2;
export const CANVA_UNIT_LINE = 3;

/** The types that play per unit when a writing style is set (§8.4). */
export function isCanvaUnitType(type: string): boolean {
  return type === "FADE" || type === "BLUR" || type === "SUCCESSION" || type === "NEON";
}

/** A usable writing style (1, 2 or 3), or null for "whole element" / anything unknown. */
export function canvaUnitMode(value: unknown): 1 | 2 | 3 | null {
  const mode = Number(value);
  return mode === 1 || mode === 2 || mode === 3 ? mode : null;
}

// ── Graphemes ───────────────────────────────────────────────────────────────────────────────────

const ZWJ = 0x200d;
/**
 * Canva's `asi = /\s/` exactly — JavaScript's whitespace, written out so no engine's Unicode version
 * can move it: it INCLUDES U+FEFF and EXCLUDES U+0085, unlike the Unicode White_Space property.
 * Must stay identical to `isCanvaWhiteSpace` in the app's LayerAnimationCanvaUnits.kt.
 */
const WHITE_SPACE = /[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/;
/**
 * Canva's CJK test (`$ri`), range for range: CJK ideographs, CJK punctuation, hiragana, katakana
 * (+ phonetic extensions, circled/squared katakana, half-width), and the three supplementary
 * code points it lists (U+1B000, U+1B001, U+1F200). Canva tests it UNANCHORED on the grapheme.
 */
const CJK =
  /[\u4e00-\u9fcc]|[\u3000-\u303f]|[\u3041-\u3096\u309d-\u309f]|\ud82c\udc01|\ud83c\ude00|[\u30a1-\u30fa\u30fd-\u30ff\u31f0-\u31ff\u32d0-\u32fe\u3300-\u3357\uff66-\uff6f\uff71-\uff9d]|\ud82c\udc00/;

function isVariationSelector(codePoint: number) {
  return (
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}

/**
 * The graphemes of one paragraph, by the rule both platforms implement (§8.4) — deliberately NOT
 * Intl.Segmenter, whose answer depends on the browser's ICU: a cluster is a base code point plus
 * every following combining mark (Mn/Mc/Me, from the app's own Unicode table — Arabic tashkeel
 * included) and variation selector; a ZWJ joins the cluster before it AND pulls the next code point
 * in. Nothing else joins (emoji modifiers, regional-indicator pairs and Hangul jamo split).
 */
export function canvaGraphemes(paragraph: string): string[] {
  const clusters: string[] = [];
  let joinNext = false;
  for (const char of paragraph) {
    const codePoint = char.codePointAt(0) ?? 0;
    const attaches =
      clusters.length > 0 &&
      (joinNext ||
        codePoint === ZWJ ||
        isVariationSelector(codePoint) ||
        isCanvaCombiningMark(codePoint));
    if (attaches) clusters[clusters.length - 1] += char;
    else clusters.push(char);
    joinNext = codePoint === ZWJ;
  }
  return clusters;
}

// ── Units ───────────────────────────────────────────────────────────────────────────────────────

/** One item of Canva's unit iteration: a paragraph's pseudo newline, or one of its graphemes. */
export interface CanvaTextItem {
  /** The grapheme, or "\n" for a paragraph's pseudo item. */
  text: string;
  /** True for the pseudo newline each paragraph starts with. */
  pseudo: boolean;
  /** Paragraph index (0-based). */
  paragraph: number;
  /** UTF-16 offset of the grapheme in the text; a pseudo item points at its paragraph start. */
  offset: number;
  whitespace: boolean;
  cjk: boolean;
}

/**
 * Every REAL grapheme of a text with its Canva unit — the app's `CanvaTextUnitMap`. Pseudo items
 * are not graphemes, but they occupy units, which is why [unitCount] can exceed the last
 * grapheme's unit + 1.
 */
export interface CanvaTextUnits {
  /** The real graphemes in text order (paragraph separators are not graphemes). */
  graphemes: string[];
  /** UTF-16 offset of each grapheme in the text. */
  graphemeStarts: number[];
  /** Whitespace graphemes occupy a unit but draw nothing. */
  graphemeIsBlank: boolean[];
  /** Canva's unit index (`trb`) of each grapheme. */
  unitOfGrapheme: number[];
  /** The last ITEM's unit + 1 (pseudo items included). */
  unitCount: number;
}

/**
 * The items Canva iterates for [text]: `(text + "\n").split("\n")` minus the last piece gives the
 * paragraphs (Canva's text always ends in a newline; ours does not), each contributing a pseudo
 * newline and then its graphemes.
 */
export function canvaTextItems(text: string): CanvaTextItem[] {
  const paragraphs = `${text}\n`.split("\n");
  paragraphs.pop();
  const items: CanvaTextItem[] = [];
  let offset = 0;
  paragraphs.forEach((paragraph, index) => {
    items.push({ text: "\n", pseudo: true, paragraph: index, offset, whitespace: true, cjk: false });
    let local = offset;
    for (const grapheme of canvaGraphemes(paragraph)) {
      items.push({
        text: grapheme,
        pseudo: false,
        paragraph: index,
        offset: local,
        whitespace: WHITE_SPACE.test(grapheme),
        cjk: CJK.test(grapheme),
      });
      local += grapheme.length;
    }
    offset += paragraph.length + 1;
  });
  return items;
}

/**
 * Canva's unit numbering (`crf.next`) for [text] at writing style [unit]:
 *   word  w₀ = 0, wⱼ = wⱼ₋₁ + (itemⱼ₋₁ is whitespace or CJK, or cjk(j−1) ≠ cjk(j) ? 1 : 0);
 *   char  uⱼ = j;  word uⱼ = wⱼ;  line u₀ = 0, uⱼ = uⱼ₋₁ + (lineⱼ₋₁ < lineⱼ ? 1 : 0);
 * any other style keeps every unit at 0. [graphemeLines] is the renderer's own layout: the line of
 * every REAL grapheme in [CanvaTextUnits.graphemes] order (absent = one line). A paragraph's pseudo
 * item takes its first grapheme's line; an EMPTY paragraph's takes the line of the item before it
 * (Canva's line finder `qrf` only ever starts a line on a visible character, never on a newline).
 */
export function canvaTextUnits(
  text: string,
  unit: number,
  graphemeLines?: ArrayLike<number> | null
): CanvaTextUnits {
  const lineOf = (index: number) => {
    const line = graphemeLines ? Number(graphemeLines[index]) : 0;
    return Number.isFinite(line) ? line : 0;
  };
  const result: CanvaTextUnits = {
    graphemes: [],
    graphemeStarts: [],
    graphemeIsBlank: [],
    unitOfGrapheme: [],
    unitCount: 0,
  };
  let items = 0;
  let previousWhitespace = false;
  let previousCjk = false;
  let previousLine = 0;
  let word = 0;
  let current = 0;
  const advance = (whitespace: boolean, cjk: boolean, line: number) => {
    if (items > 0) {
      if (previousWhitespace || previousCjk || previousCjk !== cjk) word += 1;
      if (unit === CANVA_UNIT_CHARACTER) current = items;
      else if (unit === CANVA_UNIT_WORD) current = word;
      else if (unit === CANVA_UNIT_LINE) current = previousLine < line ? current + 1 : current;
      else current = 0;
    }
    previousWhitespace = whitespace;
    previousCjk = cjk;
    previousLine = line;
    items += 1;
    return current;
  };

  const paragraphs = `${text}\n`.split("\n");
  paragraphs.pop();
  let paragraphOffset = 0;
  for (const paragraph of paragraphs) {
    const clusters = canvaGraphemes(paragraph);
    const pseudoLine =
      clusters.length > 0 ? lineOf(result.graphemes.length) : items > 0 ? previousLine : 0;
    advance(true, false, pseudoLine);
    let local = paragraphOffset;
    for (const grapheme of clusters) {
      const whitespace = WHITE_SPACE.test(grapheme);
      const cjk = CJK.test(grapheme);
      const u = advance(whitespace, cjk, lineOf(result.graphemes.length));
      result.graphemes.push(grapheme);
      result.graphemeStarts.push(local);
      result.graphemeIsBlank.push(whitespace);
      result.unitOfGrapheme.push(u);
      local += grapheme.length;
    }
    paragraphOffset += paragraph.length + 1;
  }
  result.unitCount = current + 1;
  return result;
}

/** Where one wrapped line of a renderer's layout sits in the text (UTF-16 offsets, end exclusive). */
export interface CanvaWrappedLineRange {
  start: number;
  end: number;
  paragraph: number;
}

/**
 * Maps a renderer's wrapped [lines] (in order — each line's text and whether it closes its
 * paragraph, as Konva's `textArr` entries carry; without the flag a line closes its paragraph once
 * nothing but whitespace is left) back onto [text]. Wrapping trims the whitespace at a break, so a
 * line's text is found from where the previous line ended.
 */
export function canvaWrappedLineRanges(
  text: string,
  lines: ReadonlyArray<{ text: string; lastInParagraph?: boolean }>
): CanvaWrappedLineRange[] {
  const paragraphs = text.split("\n");
  const ranges: CanvaWrappedLineRange[] = [];
  let lineIndex = 0;
  let paragraphStart = 0;
  for (let p = 0; p < paragraphs.length && lineIndex < lines.length; p += 1) {
    const paragraph = paragraphs[p];
    let cursor = 0;
    while (lineIndex < lines.length) {
      const line = lines[lineIndex];
      const found = line.text.length > 0 ? paragraph.indexOf(line.text, cursor) : cursor;
      const start = found < 0 ? cursor : found;
      const end = Math.min(paragraph.length, start + line.text.length);
      ranges.push({ start: paragraphStart + start, end: paragraphStart + end, paragraph: p });
      cursor = end;
      lineIndex += 1;
      if (line.lastInParagraph ?? paragraph.slice(cursor).trim().length === 0) break;
    }
    paragraphStart += paragraph.length + 1;
  }
  return ranges;
}

/**
 * The line of every real grapheme of [text] (in [canvaTextUnits]' order) for the renderer's
 * wrapped [lines]: a grapheme sits on the line whose text contains it; whitespace trimmed at a
 * break stays on the line it followed (leading whitespace on the paragraph's first line); a
 * grapheme the layout dropped (past a fixed height) continues on the last line.
 */
export function canvaGraphemeLines(
  text: string,
  lines: ReadonlyArray<{ text: string; lastInParagraph?: boolean }>
): number[] {
  const ranges = canvaWrappedLineRanges(text, lines);
  const lastLine = Math.max(0, lines.length - 1);
  const paragraphs = text.split("\n");
  const result: number[] = [];
  let paragraphStart = 0;
  paragraphs.forEach((paragraph, p) => {
    const own = ranges
      .map((range, index) => ({ range, index }))
      .filter((entry) => entry.range.paragraph === p);
    let offset = paragraphStart;
    for (const grapheme of canvaGraphemes(paragraph)) {
      let line = lastLine;
      if (own.length > 0) {
        line = own[0].index;
        for (const entry of own) {
          if (entry.range.start <= offset) line = entry.index;
          if (offset >= entry.range.start && offset < entry.range.end) break;
        }
      }
      result.push(line);
      offset += grapheme.length;
    }
    paragraphStart += paragraph.length + 1;
  });
  return result;
}

// ── Per-unit schedules ──────────────────────────────────────────────────────────────────────────

export interface CanvaUnitVisual {
  alpha: number;
  /** Blur radius in em — multiply by the glyph's font size (§8.4). */
  blurEm: number;
  /** Scale about the glyph's own centre. */
  scale: number;
}

const UNIT_REST: CanvaUnitVisual = { alpha: 1, blurEm: 0, scale: 1 };

export interface CanvaUnitScheduleInput {
  type: string;
  /** Stretch the schedule to fill the slot (an explicit Canva duration) instead of only shrinking. */
  fill: boolean;
  intensity: number;
  /** Canva's hash product (`seed` param), for Neon's per-unit offsets. */
  seed?: number | null;
  durationMs: number;
  exiting: boolean;
  unitCount: number;
}

export interface CanvaUnitSchedule {
  durationMs: number;
  /** Per unit, its fitted tween list sorted for `Xpf`. */
  units: CanvaTween[][];
  /** Succession's element scale tween (`rtf` in, `stf` out); null for the other types. */
  element: CanvaTween[] | null;
}

/** Canva's Vd slider rides on `intensity = 0.5 + Vd` (§6); per-unit styles read it back. */
function unitSlider(intensity: number) {
  const value = Number.isFinite(intensity) ? intensity : 1;
  return Math.max(0, Math.min(1, value - 0.5));
}

/** The seed Neon hashes when the spec carries none: 1, i.e. the bare `|cos(u)|`. */
function unitSeed(seed: number | null | undefined) {
  return seed !== undefined && seed !== null && Number.isFinite(seed) ? seed : 1;
}

/** Canva's Neon intro for one element or unit (`Esf`): linear opacity flashes, in ms. */
export function canvaNeonIntroTweens(delay: number, duration: number, vd: number, xh: number): CanvaTween[] {
  const c = duration / canvaLerp(10, 26, vd);
  const flashes = Math.floor(canvaLerp(1, 4, vd));
  const even = xh % 2 === 0;
  const tween = (from: number, to: number, at: number, length: number): CanvaTween => ({
    delay: at,
    duration: length,
    start: { opacity: from },
    end: { opacity: to },
    easing: CANVA_EASE.LINEAR,
  });
  const tweens: CanvaTween[] = [];
  let f = delay;
  for (let h = 0; h < flashes; h += 1) {
    if (h % 2 === 0) {
      tweens.push(tween(0, 1, f, c * 3), even ? tween(1, 0, f + c * 4, c) : tween(0, 0, f + c * 4, c));
      f += c * 5;
    } else {
      const hold = even ? 1 : 0.75;
      tweens.push(tween(hold, hold, f + c * 1, c), tween(0, 0, f + c * 3, c));
      f += c * 4;
    }
  }
  tweens.push(xh % 2 ? tween(0, 1, f + c * 5, c * 4) : tween(0, 1, f + c * 4, c * 3));
  return tweens;
}

/** Canva's Neon outro for one element or unit (`Fsf`), in ms. */
export function canvaNeonOutroTweens(delay: number, duration: number, vd: number, xh: number): CanvaTween[] {
  const tween = (from: number, to: number, at: number, length: number): CanvaTween => ({
    delay: at,
    duration: length,
    start: { opacity: from },
    end: { opacity: to },
    easing: CANVA_EASE.LINEAR,
  });
  if (duration <= 0) return [tween(1, 0, delay, 0)];
  const d = duration / canvaLerp(4, 8, vd);
  return xh % 2 === 0
    ? [
        tween(1, 1, delay + 1, 1),
        tween(0, 0, delay + 1 + d * 1.1, Math.max(0, d * 0.9 - 1)),
        tween(0.5, 0.5, delay + d * 3, d),
        tween(0, 0, delay + d * 5, d),
      ]
    : [tween(1, 0.5, delay + d, d * 2), tween(0.5, 0, delay + d * 4, d * 0.1)];
}

/**
 * Neon's per-unit start offsets (`Gsf`): 100 ms for the first unit, then `lerp(−100, 300, r(u))`
 * added at every unit change, r being Canva's seeded random of the unit index. Unit indices rise
 * by exactly one at each change, so the offset of unit u is the running sum up to u.
 */
function neonUnitOffsets(unitCount: number, seed: number): number[] {
  const offsets: number[] = [];
  let e = 100;
  for (let u = 0; u < unitCount; u += 1) {
    if (u > 0) e += canvaLerp(-100, 300, canvaSeededRandom(u, seed));
    offsets.push(e);
  }
  return offsets;
}

/** The raw (unfitted) tween list of unit [u] for one leg. */
function rawUnitTweens(
  type: string,
  exiting: boolean,
  u: number,
  vd: number,
  neonOffset: number
): CanvaTween[] {
  switch (type) {
    case "FADE":
      return [
        exiting
          ? { delay: 125 * u, duration: 500, start: { opacity: 1 }, end: { opacity: 0 }, easing: CANVA_EASE.IN_QUAD }
          : { delay: 125 * u, duration: 500, start: { opacity: 0 }, end: { opacity: 1 }, easing: CANVA_EASE.OUT_QUAD },
      ];
    case "BLUR":
      return [
        exiting
          ? {
              delay: 100 * u,
              duration: 400,
              start: { opacity: 1, blur: 0 },
              end: { opacity: 0, blur: 0.2 },
              easing: CANVA_EASE.IN_QUAD,
            }
          : {
              delay: 100 * u,
              duration: 400,
              start: { opacity: 0, blur: 0.2 },
              end: { opacity: 1, blur: 0 },
              easing: CANVA_EASE.OUT_QUAD,
            },
      ];
    case "SUCCESSION": {
      const from = 0.8 - 0.4 * vd;
      return [
        exiting
          ? {
              delay: 100 * u,
              duration: 400,
              start: { opacity: 1, blur: 0, scale: 1 },
              end: { opacity: 0, blur: 0.2, scale: from },
              easing: CANVA_EASE.IN_QUAD,
            }
          : {
              delay: 100 * u,
              duration: 400,
              start: { opacity: 0, blur: 0.2, scale: from },
              end: { opacity: 1, blur: 0, scale: 1 },
              easing: CANVA_EASE.OUT_QUAD,
            },
      ];
    }
    case "NEON": {
      const delay = Math.max(0, neonOffset);
      return exiting
        ? canvaNeonOutroTweens(delay, 500, vd, u)
        : canvaNeonIntroTweens(delay, 500, vd, u);
    }
    default:
      return [];
  }
}

/**
 * The whole per-unit schedule of one slot, fitted to [0, durationMs]; null for a type without
 * writing styles. A text always has at least one unit (its pseudo newline), as in the app.
 */
export function canvaUnitSchedule(input: CanvaUnitScheduleInput): CanvaUnitSchedule | null {
  if (!isCanvaUnitType(input.type)) return null;
  const unitCount = Math.max(1, Math.floor(Number.isFinite(input.unitCount) ? input.unitCount : 1));
  const durationMs = Math.max(1, Number.isFinite(input.durationMs) ? input.durationMs : 1);
  const vd = unitSlider(input.intensity);
  const offsets = input.type === "NEON" ? neonUnitOffsets(unitCount, unitSeed(input.seed)) : [];
  const raw: CanvaTween[][] = [];
  for (let u = 0; u < unitCount; u += 1) {
    raw.push(rawUnitTweens(input.type, input.exiting, u, vd, offsets[u] ?? 0));
  }
  // Neon always fits (Canva passes no fit/fill for it); the others fill on an explicit duration.
  const mode = input.type !== "NEON" && input.fill ? "fill" : "fit";
  let fitted = canvaFitUnitSchedule(raw, durationMs, mode);
  if (input.type === "NEON") fitted = fitted.map((list) => canvaDedupeTweens(list));

  let element: CanvaTween[] | null = null;
  if (input.type === "SUCCESSION") {
    // `rtf`/`stf`: the element scale spans the first unit's start to the last unit's end.
    const first = fitted[0][0];
    const last = fitted[fitted.length - 1][0];
    const from = 0.9 - (0.9 - 0.6) * vd;
    element = [
      {
        delay: first.delay,
        duration: last.delay - first.delay + last.duration,
        start: { scale: input.exiting ? 1 : from },
        end: { scale: input.exiting ? from : 1 },
        easing: input.exiting ? CANVA_EASE.IN_QUAD : CANVA_EASE.OUT_QUAD,
      },
    ];
  }
  return { durationMs, units: fitted.map((list) => canvaSortTweens(list)), element };
}

/**
 * Unit [unitIndex] of [schedule] at raw progress [progress] (τ = progress · durationMs); an index
 * outside the schedule reads its nearest unit, as the app's does.
 */
export function canvaUnitVisualAt(
  schedule: CanvaUnitSchedule,
  unitIndex: number,
  progress: number
): CanvaUnitVisual {
  const last = schedule.units.length - 1;
  const list = schedule.units[Math.max(0, Math.min(last, Math.floor(unitIndex) || 0))];
  if (!list || list.length === 0) return { ...UNIT_REST };
  const t = Math.max(0, Math.min(1, progress)) * schedule.durationMs;
  return {
    alpha: Math.max(0, Math.min(1, canvaTweenListValue(list, "opacity", t))),
    blurEm: Math.max(0, canvaTweenListValue(list, "blur", t)),
    scale: canvaTweenListValue(list, "scale", t),
  };
}

/** Succession's element scale at raw progress [progress]; 1 for every other type. */
export function canvaUnitElementScaleAt(schedule: CanvaUnitSchedule, progress: number): number {
  if (!schedule.element) return 1;
  const t = Math.max(0, Math.min(1, progress)) * schedule.durationMs;
  return canvaTweenListValue(schedule.element, "scale", t);
}

const SCHEDULE_CACHE = new Map<string, CanvaUnitSchedule | null>();
const SCHEDULE_CACHE_LIMIT = 64;

/** [canvaUnitSchedule], memoised — a renderer asks for the same schedule every frame. */
export function cachedCanvaUnitSchedule(input: CanvaUnitScheduleInput): CanvaUnitSchedule | null {
  const key = [
    input.type,
    input.fill ? 1 : 0,
    input.intensity,
    input.seed ?? "",
    input.durationMs,
    input.exiting ? 1 : 0,
    input.unitCount,
  ].join("|");
  if (SCHEDULE_CACHE.has(key)) return SCHEDULE_CACHE.get(key) ?? null;
  const schedule = canvaUnitSchedule(input);
  if (SCHEDULE_CACHE.size >= SCHEDULE_CACHE_LIMIT) {
    const oldest = SCHEDULE_CACHE.keys().next().value;
    if (oldest !== undefined) SCHEDULE_CACHE.delete(oldest);
  }
  SCHEDULE_CACHE.set(key, schedule);
  return schedule;
}

/**
 * One unit's visual (§8.4), by the app's name and argument order: [rawProgress] is the slot's own
 * clock — p on the way in, u on the way out. Rest for a style other than 1–3 or a type without
 * writing styles; the style itself does not change the timing (only the unit index and count do).
 */
export function canvaUnitVisual(
  type: string,
  unit: number,
  fill: boolean,
  intensity: number,
  seed: number | null | undefined,
  durationMs: number,
  exiting: boolean,
  rawProgress: number,
  unitIndex: number,
  unitCount: number
): CanvaUnitVisual {
  if (canvaUnitMode(unit) === null) return { ...UNIT_REST };
  const schedule = canvaUnitSchedule({ type, fill, intensity, seed, durationMs, exiting, unitCount });
  return schedule ? canvaUnitVisualAt(schedule, unitIndex, rawProgress) : { ...UNIT_REST };
}

/** Succession's element scale (§8.4), by the app's name and argument order; 1 for every other type. */
export function canvaUnitElementScale(
  type: string,
  unit: number,
  fill: boolean,
  intensity: number,
  seed: number | null | undefined,
  durationMs: number,
  exiting: boolean,
  rawProgress: number,
  unitCount: number
): number {
  if (canvaUnitMode(unit) === null || type !== "SUCCESSION") return 1;
  const schedule = canvaUnitSchedule({ type, fill, intensity, seed, durationMs, exiting, unitCount });
  return schedule ? canvaUnitElementScaleAt(schedule, rawProgress) : 1;
}

/**
 * Whether a text renderer should play [type] per unit for [text] — or fall back to the
 * whole-element state the resolver returns. Canva's only text guard is Succession's
 * `stream.length < 2`, and its stream is the text PLUS a trailing newline, so only an EMPTY text
 * falls back (the app's `drawsCanvaUnits`: `text.length + 1 >= 2`).
 */
export function canvaUnitsApplyToText(type: string, text: string): boolean {
  if (!isCanvaUnitType(type)) return false;
  return type !== "SUCCESSION" || text.length + 1 >= 2;
}
