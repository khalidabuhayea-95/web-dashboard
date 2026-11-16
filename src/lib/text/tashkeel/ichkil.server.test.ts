/**
 * ichkil in Node must give exactly what the reference Python package gives. The fixture is the
 * Python package's own output (ichkil 1.1.0 / model 0.3.0) for 88 texts: our 72 benchmark texts
 * (greetings, du'a, verses, template texts) plus punctuation, digits, Latin and one-letter cases.
 *
 * Needs the model file (21 MB). It is skipped unless the model is already on disk:
 * `node scripts/fetch-tashkeel-model.mjs` locally, and a CI step before the tests.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ichkilModelPath } from "./ichkilModel.js";

const fixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "__fixtures__/ichkil-parity.json"), "utf8"),
) as { cases: Array<{ input: string; expected: string }> };

const modelReady = existsSync(ichkilModelPath());
const skip = modelReady ? false : "ichkil model not downloaded (node scripts/fetch-tashkeel-model.mjs)";

test("byte-identical to the Python reference on every fixture text", { skip }, async () => {
  const { ichkilDiacritize } = await import("./ichkil.server");
  const mismatches = [];
  for (const { input, expected } of fixture.cases) {
    const actual = await ichkilDiacritize(input);
    if (actual !== expected) mismatches.push({ input, expected, actual });
  }
  assert.deepEqual(mismatches, [], `${mismatches.length}/${fixture.cases.length} differ`);
  assert.ok(fixture.cases.length >= 80);
});

test("keeps the user's own characters: line breaks, alif wasla, existing marks are re-predicted", { skip }, async () => {
  const { ichkilDiacritize } = await import("./ichkil.server");
  const multiline = await ichkilDiacritize("اللهم\nإنك عفو");
  assert.equal(multiline.split("\n").length, 2, "the line break survives");
  assert.equal(multiline.replace(/[ً-ْ]/g, ""), "اللهم\nإنك عفو");

  const wasla = await ichkilDiacritize("بسم ٱلله");
  assert.ok(wasla.includes("ٱ"), "alif wasla stays alif wasla");

  // Already-marked input is stripped and re-diacritized, not double-marked.
  const marked = await ichkilDiacritize("كُلُّ عام");
  assert.equal(marked.replace(/[ً-ْ]/g, ""), "كل عام");
  assert.ok(!/[ً-ْ]{3,}/.test(marked), "no stacked marks");
});

test("a few milliseconds per text once loaded", { skip }, async () => {
  const { ichkilDiacritize } = await import("./ichkil.server");
  await ichkilDiacritize("تحميل");
  const started = performance.now();
  for (let i = 0; i < 20; i += 1) await ichkilDiacritize("بمناسبة حلول عيد الفطر السعيد نتقدم بأحر التهاني");
  const perText = (performance.now() - started) / 20;
  assert.ok(perText < 100, `took ${perText.toFixed(1)} ms per text`);
});
