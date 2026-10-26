// A one-line text with a Canva Background effect gets its box hugged to its ink, shifted by its
// alignment, so the pill the editor and the app draw around the BOX matches the one Canva draws
// around the ink. The block is evaluated straight out of canva-scraper.js between its marker
// comments, so the test exercises the code that ships.
//
//   node --test extensions/canva-importer/test/text-background-hug.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-text-background-hug:start");
const end = source.indexOf("// ── canva-text-background-hug:end");
assert.ok(start >= 0 && end > start, "canva-text-background-hug markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.hug = hugTextBoxToInk;`, context);
const hug = (input) => JSON.parse(JSON.stringify(context.hug(input)));

test("the yellow label: a centred 873 px box hugs its 380 px ink around the same centre", () => {
  const box = hug({ x: 104, width: 873, inkWidth: 380, lineCount: 1, align: "center" });
  assert.deepEqual(box, { x: 104 + (873 - 382) / 2, width: 382 });
});

test("right-aligned text keeps its right edge; left-aligned its left edge", () => {
  assert.deepEqual(hug({ x: 405, width: 585, inkWidth: 180, lineCount: 1, align: "right" }), { x: 405 + 585 - 182, width: 182 });
  assert.deepEqual(hug({ x: 405, width: 585, inkWidth: 180, lineCount: 1, align: "left" }), { x: 405, width: 182 });
});

test("multi-line texts, boxes already snug, and missing ink keep their box", () => {
  assert.deepEqual(hug({ x: 10, width: 500, inkWidth: 380, lineCount: 2, align: "center" }), { x: 10, width: 500 });
  assert.deepEqual(hug({ x: 10, width: 382, inkWidth: 380, lineCount: 1, align: "center" }), { x: 10, width: 382 });
  assert.deepEqual(hug({ x: 10, width: 300, inkWidth: 380, lineCount: 1, align: "center" }), { x: 10, width: 300 });
  assert.deepEqual(hug({ x: 10, width: 500, inkWidth: 0, lineCount: 1, align: "center" }), { x: 10, width: 500 });
});
