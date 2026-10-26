// CapCut's letter pacings (the typewriter slot's `typePacing`). The same numbers are pinned in the
// app's TypewriterPacingTest.kt, so both runtimes are held to one table.
//
//   node --import tsx --test src/lib/editor/typewriterPacing.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { typewriterCharAlphas, typewriterUnitAlphas } from "./animationGlyph";

const rounded = (values: number[]) => values.map((value) => Math.round(value * 10_000) / 10_000);

test("Type 2: letters fade in on sinIn, each later and slower than the last", () => {
  assert.deepEqual(rounded(typewriterUnitAlphas(1, 0.3, 3025, 4)), [1, 0.1327, 0, 0]);
  assert.deepEqual(rounded(typewriterUnitAlphas(1, 0.6, 3025, 4)), [1, 1, 0.3489, 0]);
});

test("Random Typewriter: even slots, the current letter stepping a third at a time", () => {
  assert.deepEqual(rounded(typewriterUnitAlphas(2, 0.3, 3467, 4)), [1, 0.33, 0, 0]);
  assert.deepEqual(rounded(typewriterUnitAlphas(2, 0.55, 3467, 4)), [1, 1, 0.33, 0]);
  assert.deepEqual(typewriterUnitAlphas(2, 0, 3467, 4), [0, 0, 0, 0]);
});

test("Typewriter: CapCut's typing rhythm, letters popping in whole", () => {
  assert.deepEqual(typewriterUnitAlphas(3, 0.3, 3061, 11), [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(typewriterUnitAlphas(3, 0.6, 3061, 11), [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
  // ≥ 150 ms a letter picks the slower table.
  assert.deepEqual(typewriterUnitAlphas(3, 0.5, 3000, 4), [1, 1, 1, 0]);
});

test("every pacing ends fully typed; a line break takes a beat of its own", () => {
  for (const pacing of [1, 2, 3]) assert.deepEqual(typewriterUnitAlphas(pacing, 1, 3000, 3), [1, 1, 1]);
  // CapCut's frames of "Aziza\n&\nAmmar" (Typewriter, 2166 → +3061 ms): "Aziz" at 3.3 s, "Aziza"
  // at 3.4 s, no "A" at 4.1 s, "A" at 4.3 s, "Amm" at 4.5 s.
  const typed = (ms: number) =>
    typewriterCharAlphas(3, (ms - 2166) / 3061, 3061, "Aziza\n&\nAmmar")!.filter((alpha) => alpha === 1).length;
  assert.deepEqual([3300, 3400, 4100, 4300, 4500].map(typed), [4, 5, 8, 9, 11]);
  assert.equal(typewriterCharAlphas(undefined, 0.3, 3061, "Aziza"), null);
});
