// A model-rebuilt text's font size when its runs name several. The block is evaluated straight out
// of canva-scraper.js between its marker comments.
//
// DAHNlANrhmQ's «عَمَّ الْفَرَح وَالنُّورَ فِي دَارِنَا» (scene 2, never on the page at a captured
// moment): its runs say 14.92 on the letters and 156.65 on the paragraph mark; Canva draws 156.65,
// and the import came in at 11.45 px (14.92 × 0.768) — a speck in the middle of the page.
//
//   node --test extensions/canva-importer/test/model-text-size.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-model-text-size:start");
const end = source.indexOf("// ── canva-model-text-size:end");
assert.ok(start >= 0 && end > start, "canva-model-text-size markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.pick = pickModelTextFontSize;`, context);
const pick = (input) => context.pick(input);

const scale = 886.0677242741302 / 1154.167085486567;

test("the size whose line fits the box wins over a stale run size", () => {
  const size = pick({
    fontSize: 14.9194,
    fontSizes: [14.9194, 156.654],
    boxHeight: 144.07586479581857,
    scale,
    text: "عَمَّ الْفَرَح وَالنُّورَ فِي دَارِنَا \n",
  });
  assert.equal(size, 156.654);
  assert.ok(Math.abs(size * scale - 120.26) < 0.1);
});

test("a wrapped or multi-line box still picks the paragraph size", () => {
  // Two lines of 156.65 need ~376 px; the candidates are an order of magnitude apart.
  assert.equal(pick({ fontSize: 14.9, fontSizes: [14.9, 156.65], boxHeight: 376, scale: 1, text: "a\nb" }), 156.65);
});

test("one size, or no box, keeps the first size exactly as before", () => {
  assert.equal(pick({ fontSize: 44, fontSizes: undefined, boxHeight: 300, scale: 1, text: "x" }), 44);
  assert.equal(pick({ fontSize: 44, fontSizes: [44], boxHeight: 300, scale: 1, text: "x" }), 44);
  assert.equal(pick({ fontSize: 44, fontSizes: [44, 90], boxHeight: 0, scale: 1, text: "x" }), 44);
  assert.equal(pick({ fontSize: 0, fontSizes: undefined, boxHeight: 100, scale: 1, text: "x" }), 0);
});

test("a genuinely small text with a big stray size stays small", () => {
  // A 60 px box of 44 px text (1.2 line) with a stray 160: the box decides.
  assert.equal(pick({ fontSize: 44, fontSizes: [44, 160], boxHeight: 53, scale: 1, text: "x" }), 44);
});
