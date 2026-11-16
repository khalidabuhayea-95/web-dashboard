import assert from "node:assert/strict";
import test from "node:test";

import {
  LABEL_TO_COMBO,
  argmaxAt,
  attachToOriginal,
  encode,
  modelCharacters,
  stripForPrediction,
} from "./ichkilPipeline.js";

const FATHA = "َ";
const SHADDA_DAMMA = "ُّ";

function logitsFor(labels) {
  const out = new Float32Array(labels.length * 16);
  labels.forEach((label, i) => {
    out[i * 16 + label] = 1;
  });
  return out;
}

test("strips every diacritic and tatweel, keeps letters, spaces and line breaks", () => {
  assert.equal(stripForPrediction("كُلُّ عَامٍ\nوَأَنْتُمْ بِخَيْـرٍ"), "كل عام\nوأنتم بخير");
  assert.equal(stripForPrediction("ذَٰلِكَ"), "ذلك"); // dagger alif
  assert.equal(stripForPrediction("ٱلْقُرْءَانُ ۚ"), "ٱلقرءان "); // Quranic sign gone, wasla kept
});

test("the model sees normalized characters one-to-one with the original", () => {
  const base = "ٱلله\nیک";
  const chars = modelCharacters(base);
  assert.equal(chars.length, Array.from(base).length);
  // alif wasla → alif, line break → space, Persian yeh → yeh, keheh → kaf (as the Python package).
  assert.deepEqual(chars, ["ا", "ل", "ل", "ه", " ", "ي", "ك"]);
});

test("encode maps out-of-vocabulary characters to <unk>", () => {
  assert.deepEqual(encode(["ا", "☃"], { ا: 5 }, 1), [5, 1]);
});

test("argmax: the first maximum wins ties", () => {
  assert.equal(argmaxAt([0, 3, 3, 1], 0, 4), 1);
  assert.equal(argmaxAt([9, 9, 0, 5, 7, 7], 2, 4), 2);
});

test("marks go on the original characters; non-letters pass through", () => {
  const base = "رب\nٱ";
  const chars = modelCharacters(base);
  const out = attachToOriginal(base, chars, logitsFor([7, 0, 0, 2]));
  assert.equal(out, `ر${"َّ"}ب\nٱ${FATHA}`);
  assert.equal(LABEL_TO_COMBO[8], SHADDA_DAMMA);
});
