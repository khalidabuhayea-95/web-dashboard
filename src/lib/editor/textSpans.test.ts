/**
 * Multi-style text spans: the range model the editor, the Canva import, the mobile payload and the
 * app share (lib/editor/textSpans.ts).
 *
 *   node --import tsx --test src/lib/editor/textSpans.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  applyTextSpanStyle,
  clearTextSpanKeys,
  normalizeTextSpans,
  reconcileTextSpansForPatch,
  remapTextSpansForEdit,
  resolveTextRunStyle,
  scaleTextSpans,
  snapTextRange,
  textGraphemeBoundaries,
  textSpanBaseStyle,
  textSpanFontFamilies,
  textSpanRuns,
  textSpansAffectLayout,
  textSpanStyleOfRange,
} from "@/lib/editor/textSpans";

// Canva DAHQBJ7cipQ: one paragraph, four runs alternating white / yellow.
const DELIVERY = "طلّب أونلاين وخليك مرتاح… إحنا نوصل لعندك وين ما كنت.";
const YELLOW = "#ffbf51";
const firstYellow = DELIVERY.indexOf("وخليك");
const firstYellowEnd = DELIVERY.indexOf("…");
const secondYellow = DELIVERY.indexOf("وين");

test("normalizes spans: clamps, sorts, merges identical neighbours, drops empty and unusable ones", () => {
  const spans = normalizeTextSpans(
    [
      { start: secondYellow, end: 999, color: "#FFBF51" },
      { start: firstYellow, end: firstYellowEnd, color: YELLOW },
      { start: 3, end: 3, color: "#ff0000" },
      { start: 0, end: 2, color: "not a colour" },
      { start: 0, end: 4, fontSize: -5, highlightOpacity: 0.5 },
      null,
    ],
    DELIVERY
  );
  assert.deepEqual(spans, [
    { start: firstYellow, end: firstYellowEnd, color: YELLOW },
    { start: secondYellow, end: DELIVERY.length, color: YELLOW },
  ]);
  assert.deepEqual(normalizeTextSpans([{ start: 0, end: 3, color: "#fff" }, { start: 3, end: 6, color: "#ffffff" }], "abcdefgh"), [
    { start: 0, end: 6, color: "#ffffff" },
  ]);
  assert.deepEqual(normalizeTextSpans("nope", DELIVERY), []);
});

test("never splits a letter from its tashkeel or a surrogate pair", () => {
  // "طلّب": the shadda (U+0651) sits on the lam at index 1.
  const boundaries = textGraphemeBoundaries("طلّب");
  assert.deepEqual(boundaries, [0, 1, 3, 4]);
  assert.deepEqual(snapTextRange("طلّب", 1, 2), [1, 3]);
  // A span that starts ON a mark: the cluster takes its letter's (first unit's) style.
  assert.deepEqual(normalizeTextSpans([{ start: 2, end: 4, color: "#ff0000" }], "طلّب"), [
    { start: 3, end: 4, color: "#ff0000" },
  ]);
  // A selection that starts on a mark widens to the whole letter.
  assert.deepEqual(applyTextSpanStyle([], "طلّب", 2, 4, { color: "#ff0000" }), [{ start: 1, end: 4, color: "#ff0000" }]);
  assert.deepEqual(snapTextRange("a😀b", 2, 3), [1, 3]);
});

test("applies a style to a range, and styling it back to the layer's value removes the span", () => {
  const base = textSpanBaseStyle({ fontFamily: "IBM Plex Sans Arabic", fontWeight: "700", fontSize: 32, color: "#ffffff" });
  let spans = applyTextSpanStyle([], DELIVERY, firstYellow, firstYellowEnd, { color: "#FFBF51" }, base);
  assert.deepEqual(spans, [{ start: firstYellow, end: firstYellowEnd, color: YELLOW }]);
  spans = applyTextSpanStyle(spans, DELIVERY, firstYellow, firstYellow + 5, { fontSize: 48 }, base);
  assert.deepEqual(spans, [
    { start: firstYellow, end: firstYellow + 5, color: YELLOW, fontSize: 48 },
    { start: firstYellow + 5, end: firstYellowEnd, color: YELLOW },
  ]);
  spans = applyTextSpanStyle(spans, DELIVERY, firstYellow, firstYellowEnd, { color: "#FFFFFF", fontSize: 32 }, base);
  assert.deepEqual(spans, []);
  // undefined clears a key wherever it is set in the range.
  spans = applyTextSpanStyle([{ start: 0, end: 4, color: "#ff0000", fontWeight: "400" }], "abcdefgh", 0, 2, { color: undefined }, base);
  assert.deepEqual(spans, [
    { start: 0, end: 2, fontWeight: "400" },
    { start: 2, end: 4, color: "#ff0000", fontWeight: "400" },
  ]);
});

test("runs cover the whole text and resolve over the layer's base", () => {
  const spans = [
    { start: firstYellow, end: firstYellowEnd, color: YELLOW },
    { start: secondYellow, end: DELIVERY.length, color: YELLOW },
  ];
  const runs = textSpanRuns(DELIVERY, spans);
  assert.deepEqual(
    runs.map((run) => [DELIVERY.slice(run.start, run.end), run.style.color ?? null]),
    [
      ["طلّب أونلاين ", null],
      ["وخليك مرتاح", YELLOW],
      ["… إحنا نوصل لعندك ", null],
      ["وين ما كنت.", YELLOW],
    ]
  );
  const base = textSpanBaseStyle({ fontFamily: "Hacen", fontSize: 40, color: "#ffffff", fontWeight: 700 });
  const resolved = resolveTextRunStyle(base, runs[1].style);
  assert.equal(resolved.color, YELLOW);
  assert.equal(resolved.fontWeight, "700");
  assert.equal(resolved.fontSize, 40);
  assert.equal(textSpansAffectLayout(spans), false);
  assert.equal(textSpansAffectLayout([{ start: 0, end: 2, fontSize: 60 }]), true);
});

test("an edit carries the spans along: typing inherits the letter before, typing over a selection keeps its style", () => {
  const spans = [{ start: 6, end: 11, color: "#ff0000" }]; // "hello world" → "world" red
  const text = "hello world";
  // Typing at the end of the red word extends it.
  assert.deepEqual(remapTextSpansForEdit(spans, text, "hello worlds"), [{ start: 6, end: 12, color: "#ff0000" }]);
  // Typing before it shifts it.
  assert.deepEqual(remapTextSpansForEdit(spans, text, "oh hello world"), [{ start: 9, end: 14, color: "#ff0000" }]);
  // Typing right before the red word (after the space) stays plain.
  assert.deepEqual(remapTextSpansForEdit(spans, text, "hello big world"), [{ start: 10, end: 15, color: "#ff0000" }]);
  // Replacing the red word keeps it red.
  assert.deepEqual(remapTextSpansForEdit(spans, text, "hello there"), [{ start: 6, end: 11, color: "#ff0000" }]);
  // Deleting it removes the span.
  assert.deepEqual(remapTextSpansForEdit(spans, text, "hello "), []);
  // A new paragraph's first letter takes the style after the caret, not the newline's.
  assert.deepEqual(remapTextSpansForEdit([{ start: 0, end: 3, color: "#00ff00" }], "abc\ndef", "abc\nXdef"), [
    { start: 0, end: 3, color: "#00ff00" },
  ]);
});

test("whole-layer edits keep spans coherent", () => {
  const element = {
    type: "text",
    text: "hello world",
    fontSize: 40,
    textSpans: [{ start: 6, end: 11, color: "#ff0000", fontSize: 80 }],
  };
  // A new layer colour recolours every word.
  assert.deepEqual(reconcileTextSpansForPatch(element, { color: "#000000", fill: "#000000" }), {
    color: "#000000",
    fill: "#000000",
    textSpans: [{ start: 6, end: 11, fontSize: 80 }],
  });
  // A new layer size keeps the span twice the body.
  assert.deepEqual(reconcileTextSpansForPatch(element, { fontSize: 20 }), {
    fontSize: 20,
    textSpans: [{ start: 6, end: 11, color: "#ff0000", fontSize: 40 }],
  });
  // New text remaps.
  assert.deepEqual(reconcileTextSpansForPatch(element, { text: "big hello world" }), {
    text: "big hello world",
    textSpans: [{ start: 10, end: 15, color: "#ff0000", fontSize: 80 }],
  });
  // Geometry-only patches and layers without spans pass through untouched.
  const geometry = { x: 10, width: 300 };
  assert.equal(reconcileTextSpansForPatch(element, geometry), geometry);
  assert.equal("textSpans" in reconcileTextSpansForPatch({ ...element, textSpans: [] }, { color: "#000" }), false);
  // An explicit textSpans wins.
  const explicit = { textSpans: [] };
  assert.equal(reconcileTextSpansForPatch(element, explicit), explicit);
});

test("scale, clear, families and the shared style of a selection", () => {
  const spans = [
    { start: 0, end: 4, fontSize: 30, letterSpacing: 2, fontFamily: "Cairo" },
    { start: 4, end: 8, color: "#ff0000", fontFamily: "cairo" },
  ];
  assert.deepEqual(scaleTextSpans(spans, 2), [
    { start: 0, end: 4, fontSize: 60, letterSpacing: 4, fontFamily: "Cairo" },
    { start: 4, end: 8, color: "#ff0000", fontFamily: "cairo" },
  ]);
  assert.deepEqual(scaleTextSpans(spans, 2, { letterSpacing: false })[0], {
    start: 0,
    end: 4,
    fontSize: 60,
    letterSpacing: 2,
    fontFamily: "Cairo",
  });
  assert.deepEqual(clearTextSpanKeys(spans, "abcdefgh", ["fontFamily", "letterSpacing"]), [
    { start: 0, end: 4, fontSize: 30 },
    { start: 4, end: 8, color: "#ff0000" },
  ]);
  assert.deepEqual(textSpanFontFamilies(spans), ["Cairo"]);
  assert.deepEqual(textSpanStyleOfRange(spans, "abcdefgh", 0, 3), { fontSize: 30, letterSpacing: 2, fontFamily: "Cairo" });
  assert.deepEqual(textSpanStyleOfRange(spans, "abcdefgh", 2, 6), {});
});
