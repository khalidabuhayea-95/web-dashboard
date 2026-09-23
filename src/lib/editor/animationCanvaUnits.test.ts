/**
 * Canva's writing styles (docs/canva-animation-parity.md §8.4) and the tween machinery under
 * them: the grapheme rule, Canva's unit numbering (`crf`), the renderer-line mapping, and the
 * per-unit schedules of Fade/Blur/Succession/Neon fitted to their slot. The app mirrors every one
 * of these by name; animationParamsParity.test.ts replays its golden against them.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CANVA_EASE,
  canvaDedupeTweens,
  canvaFitUnitSchedule,
  canvaRampValue,
  canvaScaleTween,
  canvaSeededRandom,
  canvaSortTweens,
  canvaTweenListValue,
  type CanvaTween,
} from "./animationCanvaTweens";
import {
  canvaGraphemeLines,
  canvaGraphemes,
  canvaNeonIntroTweens,
  canvaNeonOutroTweens,
  canvaTextUnits,
  canvaUnitElementScale,
  canvaUnitSchedule,
  canvaUnitVisual,
  canvaUnitsApplyToText,
  canvaWrappedLineRanges,
} from "./animationCanvaUnits";
import { isCanvaCombiningMark } from "./animationCanvaMarks";

function closeTo(actual: number, expected: number, precision = 6, message?: string) {
  const tolerance = Math.pow(10, -precision) / 2;
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    message ?? `expected ${actual} to be close to ${expected} (precision ${precision})`
  );
}

const cp = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
const FATHA = 0x064e;
const SUKUN = 0x0652;
const FATHATAN = 0x064b;
const easeOutQuad = (u: number) => u * (2 - u);
const easeInQuad = (u: number) => u * u;

// ── Graphemes ────────────────────────────────────────────────────────────────────────────────────

test("a grapheme is a base code point plus its combining marks (Arabic tashkeel included)", () => {
  assert.deepEqual(canvaGraphemes("abc"), ["a", "b", "c"]);
  // مَرْحَبًا — every mark stays on the letter before it.
  const marhaban = `م${cp(FATHA)}ر${cp(SUKUN)}ح${cp(FATHA)}ب${cp(FATHATAN)}ا`;
  assert.deepEqual(canvaGraphemes(marhaban), [
    `م${cp(FATHA)}`,
    `ر${cp(SUKUN)}`,
    `ح${cp(FATHA)}`,
    `ب${cp(FATHATAN)}`,
    "ا",
  ]);
  // A mark with nothing before it starts its own cluster.
  assert.deepEqual(canvaGraphemes(`${cp(0x0301)}a`), [cp(0x0301), "a"]);
});

test("a ZWJ joins its neighbours, variation selectors attach, nothing else does", () => {
  const family = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
  assert.deepEqual(canvaGraphemes(family), [family]);
  assert.deepEqual(canvaGraphemes(`${cp(0x2764, 0xfe0f)}x`), [cp(0x2764, 0xfe0f), "x"]);
  // Emoji modifiers and regional indicators are deliberately NOT joined (the shared rule is simple).
  assert.deepEqual(canvaGraphemes(cp(0x1f44b, 0x1f3fd)), [cp(0x1f44b), cp(0x1f3fd)]);
  assert.deepEqual(canvaGraphemes(cp(0x1f1f8, 0x1f1e6)), [cp(0x1f1f8), cp(0x1f1e6)]);
});

test("the combining-mark table is Unicode's M category (the app's own copy)", () => {
  for (const mark of [0x0301, FATHA, SUKUN, FATHATAN, 0x0670, 0x093e, 0x20dd, 0xfe0f, 0xe0100]) {
    assert.equal(isCanvaCombiningMark(mark), true, mark.toString(16));
  }
  for (const other of [0x41, 0x0627, 0x0640, 0x200d, 0x1f3fd, 0x4e2d, 0x10ffff]) {
    assert.equal(isCanvaCombiningMark(other), false, other.toString(16));
  }
});

// ── Units (`crf`) ────────────────────────────────────────────────────────────────────────────────

test("character units: every item is a unit, the paragraph's pseudo newline first", () => {
  const units = canvaTextUnits("ab c", 1);
  assert.deepEqual(units.graphemes, ["a", "b", " ", "c"]);
  assert.deepEqual(units.unitOfGrapheme, [1, 2, 3, 4]);
  assert.deepEqual(units.graphemeIsBlank, [false, false, true, false]);
  assert.deepEqual(units.graphemeStarts, [0, 1, 2, 3]);
  assert.equal(units.unitCount, 5);
});

test("word units advance after whitespace, after every CJK item, and where CJK-ness changes", () => {
  const words = canvaTextUnits("ab cd", 2);
  assert.deepEqual(words.unitOfGrapheme, [1, 1, 1, 2, 2]);
  assert.equal(words.unitCount, 3);
  const cjk = canvaTextUnits("中文ab", 2);
  assert.deepEqual(cjk.unitOfGrapheme, [1, 2, 3, 3]);
  assert.equal(cjk.unitCount, 4);
  // Arabic, with tashkeel riding on its letters.
  const arabic = canvaTextUnits(`مر${cp(FATHA)}حبا بكم`, 2);
  assert.deepEqual(arabic.unitOfGrapheme, [1, 1, 1, 1, 1, 1, 2, 2, 2]);
  assert.equal(arabic.graphemes[1], `ر${cp(FATHA)}`);
  assert.equal(arabic.unitCount, 3);
});

test("whitespace is JavaScript's \\s like Canva's: U+FEFF ends a word, U+0085 does not", () => {
  // The opposite of Unicode's White_Space property; the app's twin test asserts the same numbers.
  assert.deepEqual(canvaTextUnits("ab\uFEFFc", 2).unitOfGrapheme, [1, 1, 1, 2]);
  assert.deepEqual(canvaTextUnits("\uFEFF", 1).graphemeIsBlank, [true]);
  assert.deepEqual(canvaTextUnits("ab\u0085c", 2).unitOfGrapheme, [1, 1, 1, 1]);
  assert.deepEqual(canvaTextUnits("\u0085", 1).graphemeIsBlank, [false]);
});

test("every paragraph contributes a pseudo newline that occupies a unit", () => {
  const chars = canvaTextUnits("ab\ncd", 1);
  assert.deepEqual(chars.graphemes, ["a", "b", "c", "d"]);
  assert.deepEqual(chars.unitOfGrapheme, [1, 2, 4, 5]);
  assert.deepEqual(chars.graphemeStarts, [0, 1, 3, 4]);
  assert.equal(chars.unitCount, 6);
  const words = canvaTextUnits("ab\ncd", 2);
  assert.deepEqual(words.unitOfGrapheme, [1, 1, 2, 2]);
  assert.equal(words.unitCount, 3);
  // An empty text is still one pseudo item — one unit.
  const empty = canvaTextUnits("", 1);
  assert.deepEqual(empty.graphemes, []);
  assert.equal(empty.unitCount, 1);
  // A trailing empty paragraph still counts its pseudo item.
  assert.equal(canvaTextUnits("a\n", 1).unitCount, 3);
});

test("line units follow the renderer's lines; an empty paragraph stays on the line before it", () => {
  const wrapped = canvaTextUnits("ab cd", 3, [0, 0, 0, 1, 1]);
  assert.deepEqual(wrapped.unitOfGrapheme, [0, 0, 0, 1, 1]);
  assert.equal(wrapped.unitCount, 2);
  // ab / (empty) / cd laid out on lines 0, 1 (the empty paragraph's own line) and 2: the empty
  // paragraph's pseudo item takes the PREVIOUS item's line, so it does not open a unit.
  const paragraphs = canvaTextUnits("ab\n\ncd", 3, [0, 0, 2, 2]);
  assert.deepEqual(paragraphs.unitOfGrapheme, [0, 0, 1, 1]);
  assert.equal(paragraphs.unitCount, 2);
  // Without lines everything is on line 0; an unknown style keeps every unit at 0.
  assert.equal(canvaTextUnits("ab cd", 3).unitCount, 1);
  assert.deepEqual(canvaTextUnits("ab", 5).unitOfGrapheme, [0, 0]);
});

test("the renderer's wrapped lines map back onto the text, trimmed whitespace included", () => {
  const text = "hello world foo\n\nbar";
  const lines = [
    { text: "hello world", lastInParagraph: false },
    { text: "foo", lastInParagraph: true },
    { text: "", lastInParagraph: true },
    { text: "bar", lastInParagraph: true },
  ];
  assert.deepEqual(canvaWrappedLineRanges(text, lines), [
    { start: 0, end: 11, paragraph: 0 },
    { start: 12, end: 15, paragraph: 0 },
    { start: 16, end: 16, paragraph: 1 },
    { start: 17, end: 20, paragraph: 2 },
  ]);
  // "hello world" + the space trimmed at the break on line 0, "foo" on 1, "bar" on 3.
  assert.deepEqual(canvaGraphemeLines(text, lines), [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 3, 3, 3,
  ]);
  // Plain line strings (no flags) close their paragraph once it is used up.
  assert.deepEqual(
    canvaGraphemeLines("ab cd", [{ text: "ab" }, { text: "cd" }]),
    [0, 0, 0, 1, 1]
  );
  // Past a fixed height the layout drops lines; their graphemes continue on the last one.
  assert.deepEqual(canvaGraphemeLines("ab\ncd", [{ text: "ab", lastInParagraph: true }]), [0, 0, 0, 0]);
});

// ── The tween machinery ─────────────────────────────────────────────────────────────────────────

test("Canva's list rule: the latest-started tween decides, and between tweens its end holds", () => {
  const tweens: CanvaTween[] = canvaSortTweens([
    { delay: 0, duration: 100, start: { opacity: 0 }, end: { opacity: 1 } },
    { delay: 300, duration: 100, start: { opacity: 0.2 }, end: { opacity: 0.6 } },
  ]);
  closeTo(canvaTweenListValue(tweens, "opacity", 50), 0.5);
  closeTo(canvaTweenListValue(tweens, "opacity", 200), 1, 6, "the first tween's end holds");
  closeTo(canvaTweenListValue(tweens, "opacity", 350), 0.4);
  closeTo(canvaTweenListValue(tweens, "opacity", 1000), 0.6);
  // Before the first tween its START shows; an untouched property rests (1 multiplies, 0 adds).
  const late = canvaSortTweens([{ delay: 100, duration: 100, start: { opacity: 0.3 }, end: { opacity: 1 } }]);
  closeTo(canvaTweenListValue(late, "opacity", 0), 0.3);
  closeTo(canvaTweenListValue(late, "scale", 0), 1);
  closeTo(canvaTweenListValue(late, "blur", 0), 0);
  // A tween that has ended returns its exact end, even on a curve that never quite gets there.
  const expo = [{ delay: 0, duration: 10, start: { scale: 0 }, end: { scale: 1 }, easing: CANVA_EASE.OUT_EXPO }];
  assert.equal(canvaTweenListValue(expo, "scale", 10), 1);
});

test("fitting a unit schedule shrinks (fit) or stretches (fill) it and floors every number", () => {
  const lists: CanvaTween[][] = [0, 1, 2].map((u) => [
    { delay: 125 * u, duration: 500, start: { opacity: 0 }, end: { opacity: 1 } },
  ]);
  // Span 750 into 500: factor 2/3.
  const fit = canvaFitUnitSchedule(lists, 500, "fit");
  assert.deepEqual(fit.map((list) => [list[0].delay, list[0].duration]), [[0, 333], [83, 333], [166, 333]]);
  // A roomy window only FITS — nothing grows — but still floors (a no-op here).
  const roomy = canvaFitUnitSchedule(lists, 5000, "fit");
  assert.deepEqual(roomy.map((list) => list[0].delay), [0, 125, 250]);
  // Fill stretches to exactly the window.
  const fill = canvaFitUnitSchedule(lists, 1500, "fill");
  assert.deepEqual(fill.map((list) => [list[0].delay, list[0].duration]), [[0, 1000], [250, 1000], [500, 1000]]);
  // A duration never drops below 1 ms.
  assert.equal(canvaScaleTween(lists[0][0], 0.0001).duration, 1);
});

test("Canva's de-overlap keeps the later of two colliding tweens", () => {
  const a: CanvaTween = { delay: 0, duration: 100, start: { opacity: 0 }, end: { opacity: 1 } };
  const b: CanvaTween = { delay: 50, duration: 100, start: { opacity: 1 }, end: { opacity: 0 } };
  const c: CanvaTween = { delay: 150, duration: 10, start: { opacity: 0 }, end: { opacity: 0 } };
  // b overlaps a (a is dropped); c only touches b's end, which is not an overlap.
  assert.deepEqual(canvaDedupeTweens([a, b, c]), [c, b]);
});

test("the seeded random is Canva's |cos(s) · P| mod 1", () => {
  closeTo(canvaSeededRandom(3, 1000), Math.abs(Math.cos(3) * 1000) % 1, 12);
  closeTo(canvaSeededRandom(0, 2.5), 0.5, 12);
});

test("a two-stage ramp holds, eases through stage 1, then stage 2 owns its window", () => {
  const ramp = { from: 0.9, to: 1.03, start: 100, duration: 1000, ease: CANVA_EASE.LINEAR, to2: 1, start2: 1100, duration2: 500, ease2: CANVA_EASE.IN_OUT_QUAD };
  closeTo(canvaRampValue(ramp, 0), 0.9);
  closeTo(canvaRampValue(ramp, 600), 0.965);
  closeTo(canvaRampValue(ramp, 1100), 1.03);
  closeTo(canvaRampValue(ramp, 1225), 1.03 + (1 - 1.03) * 0.125);
  assert.equal(canvaRampValue(ramp, 5000), 1);
  // A duration ≤ 0 jumps straight to its end.
  assert.equal(canvaRampValue({ from: 0, to: 40, start: 0, duration: 0, ease: 1 }, 0), 40);
});

// ── Per-unit schedules ──────────────────────────────────────────────────────────────────────────

test("FADE per unit: 500 ms each, 125 ms apart, easeOutQuad in and easeInQuad out", () => {
  const at = (unitIndex: number, ms: number, over: { exiting?: boolean; durationMs?: number } = {}) =>
    canvaUnitVisual("FADE", 1, false, 1, null, over.durationMs ?? 5000, Boolean(over.exiting), ms / (over.durationMs ?? 5000), unitIndex, 4);
  closeTo(at(0, 250).alpha, easeOutQuad(0.5));
  closeTo(at(2, 250).alpha, 0, 6, "unit 2 starts at 250 ms");
  closeTo(at(2, 500).alpha, easeOutQuad(0.5));
  closeTo(at(3, 875).alpha, 1);
  closeTo(at(1, 375, { exiting: true }).alpha, 1 - easeInQuad(0.5));
  // 4 units span 875 ms; a 500 ms slot shrinks them (delays floor(125·u·4/7), duration 285).
  const factor = 500 / 875;
  const d = Math.floor(500 * factor);
  const delay3 = Math.floor(125 * 3 * factor);
  closeTo(at(3, delay3 + d / 2, { durationMs: 500 }).alpha, easeOutQuad((d / 2) / d));
  closeTo(at(3, 500, { durationMs: 500 }).alpha, 1);
});

test("a filled schedule stretches to the explicit duration instead of holding at the end", () => {
  // 3 units span 750 ms; filled into 1500 ms each unit runs 1000 ms from 250·u.
  const filled = (ms: number) => canvaUnitVisual("FADE", 2, true, 1, null, 1500, false, ms / 1500, 2, 3).alpha;
  closeTo(filled(500), 0);
  closeTo(filled(1000), easeOutQuad(0.5));
  closeTo(filled(1500), 1);
});

test("BLUR and SUCCESSION per unit resolve out of a 0.2 em haze; Succession also grows", () => {
  const blur = canvaUnitVisual("BLUR", 1, false, 1, null, 5000, false, 200 / 5000, 0, 3);
  closeTo(blur.alpha, easeOutQuad(0.5));
  closeTo(blur.blurEm, 0.2 * (1 - easeOutQuad(0.5)));
  closeTo(blur.scale, 1);
  // Succession's per-unit scale starts at .8 − .4·Vd (Vd = intensity − .5 → 0.6 at the default).
  const start = canvaUnitVisual("SUCCESSION", 1, false, 1, null, 5000, false, 0, 1, 3);
  closeTo(start.alpha, 0);
  closeTo(start.blurEm, 0.2);
  closeTo(start.scale, 0.6);
  closeTo(canvaUnitVisual("SUCCESSION", 1, false, 1.5, null, 5000, false, 0, 1, 3).scale, 0.4);
  const leaving = canvaUnitVisual("SUCCESSION", 1, false, 1, null, 5000, true, 300 / 5000, 1, 3);
  closeTo(leaving.alpha, 1 - easeInQuad(0.5));
  closeTo(leaving.blurEm, 0.2 * easeInQuad(0.5));
  closeTo(leaving.scale, 1 + (0.6 - 1) * easeInQuad(0.5));
});

test("SUCCESSION's element scale runs .9 − .3·Vd → 1 over the units' whole span", () => {
  // 3 units: span 100·2 + 400 = 600 ms.
  const scale = (ms: number, exiting = false) =>
    canvaUnitElementScale("SUCCESSION", 1, false, 1, null, 5000, exiting, ms / 5000, 3);
  closeTo(scale(0), 0.75);
  closeTo(scale(300), 0.75 + 0.25 * easeOutQuad(0.5));
  closeTo(scale(600), 1);
  closeTo(scale(300, true), 1 - 0.25 * easeInQuad(0.5));
  assert.equal(canvaUnitElementScale("FADE", 1, false, 1, null, 5000, false, 0.1, 3), 1);
});

test("NEON per unit runs Canva's flicker from an offset that starts at 100 ms and walks by the seed", () => {
  const seed = 987654.321;
  const r = (s: number) => Math.abs(Math.cos(s) * seed) % 1;
  const offset1 = 100 + (-100 + 400 * r(1));
  const schedule = canvaUnitSchedule({
    type: "NEON",
    fill: false,
    intensity: 1,
    seed,
    durationMs: 100000,
    exiting: false,
    unitCount: 2,
  });
  assert.ok(schedule);
  // Unit 0: nothing before 100 ms (the first tween's start, 0), then Canva's ramp over 3c.
  const c = 500 / 18;
  const ramp0 = schedule.units[0].find((tween) => tween.delay === 100);
  assert.ok(ramp0, "unit 0's first flash starts at 100 ms");
  assert.equal(ramp0.duration, Math.floor(c * 3));
  closeTo(canvaUnitVisual("NEON", 1, false, 1, seed, 100000, false, 50 / 100000, 0, 2).alpha, 0);
  // Unit 1 starts at 100 + lerp(−100, 300, r(1)), floored, and is odd: dims to 0 hard at 4c.
  const first1 = Math.min(...schedule.units[1].map((tween) => tween.delay));
  assert.equal(first1, Math.floor(Math.max(0, offset1)));
  // Both are lit once their lists have run.
  closeTo(canvaUnitVisual("NEON", 1, false, 1, seed, 100000, false, 1, 0, 2).alpha, 1);
  closeTo(canvaUnitVisual("NEON", 1, false, 1, seed, 100000, false, 1, 1, 2).alpha, 1);
  // Neon always FITS: an explicit fill does not stretch it.
  const filled = canvaUnitSchedule({ type: "NEON", fill: true, intensity: 1, seed, durationMs: 100000, exiting: false, unitCount: 2 });
  assert.deepEqual(filled, schedule);
});

test("NEON's element flicker lists are Canva's Esf/Fsf, parity by index", () => {
  // Default slider: c = 500/18, two flashes; even ends lit at 16c, odd at 18c.
  const even = canvaNeonIntroTweens(0, 500, 0.5, 0);
  const odd = canvaNeonIntroTweens(0, 500, 0.5, 1);
  const c = 500 / 18;
  closeTo(Math.max(...even.map((t) => t.delay + t.duration)), 16 * c, 9);
  closeTo(Math.max(...odd.map((t) => t.delay + t.duration)), 18 * c, 9);
  closeTo(odd.find((t) => t.start.opacity === 0.75)?.delay ?? -1, 6 * c, 9);
  const outEven = canvaNeonOutroTweens(0, 500, 0.5, 0);
  const outOdd = canvaNeonOutroTweens(0, 500, 0.5, 1);
  assert.equal(outEven.length, 4);
  assert.equal(outOdd.length, 2);
  closeTo(outEven[1].delay, 1 + (500 / 6) * 1.1, 9);
  assert.deepEqual(canvaNeonOutroTweens(10, 0, 0.5, 0), [
    { delay: 10, duration: 0, start: { opacity: 1 }, end: { opacity: 0 }, easing: CANVA_EASE.LINEAR },
  ]);
});

test("an unknown style or type rests, and a unit index outside the text reads its nearest unit", () => {
  const rest = { alpha: 1, blurEm: 0, scale: 1 };
  assert.deepEqual(canvaUnitVisual("FADE", 0, false, 1, null, 500, false, 0, 0, 3), rest);
  assert.deepEqual(canvaUnitVisual("FADE", 4, false, 1, null, 500, false, 0, 0, 3), rest);
  assert.deepEqual(canvaUnitVisual("RISE", 1, false, 1, null, 500, false, 0, 0, 3), rest);
  assert.deepEqual(
    canvaUnitVisual("FADE", 1, false, 1, null, 5000, false, 0.2, 9, 3),
    canvaUnitVisual("FADE", 1, false, 1, null, 5000, false, 0.2, 2, 3)
  );
});

// Canva's guard is `stream.length < 2` on a stream that always ends in "\n": one character plays
// per unit, only an empty Succession falls back to the whole element.
test("only an empty Succession falls back to the whole element; the other styles always split", () => {
  assert.equal(canvaUnitsApplyToText("FADE", "a"), true);
  assert.equal(canvaUnitsApplyToText("FADE", ""), true);
  assert.equal(canvaUnitsApplyToText("SUCCESSION", "a"), true);
  assert.equal(canvaUnitsApplyToText("SUCCESSION", ""), false);
  assert.equal(canvaUnitsApplyToText("RISE", "ab"), false);
});
