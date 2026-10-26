// Repeated lines in a text are real when every paragraph sits on its own row; Canva's hidden second
// copy of a paragraph block lands exactly on the first. The block is evaluated straight out of
// canva-scraper.js between its marker comments, so the test exercises the code that ships.
//
// DAHQBfoqED4: a price column of ten "$4.25" paragraphs, 16 px apart, imported as ONE "$4.25".
//
//   node --test extensions/canva-importer/test/paragraph-repeats.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-paragraph-repeats:start");
const end = source.indexOf("// ── canva-paragraph-repeats:end");
assert.ok(start >= 0 && end > start, "canva-paragraph-repeats markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.distinct = paragraphsAreDistinctRows;`, context);
const distinct = (rects) => context.distinct(rects);

test("the price column: ten rows 16 px apart are distinct", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ top: 317 + index * 16, left: 672, height: 16 }));
  assert.equal(distinct(rows), true);
});

test("Canva's doubled paragraph block lands on itself: not distinct", () => {
  const block = [{ top: 100, left: 50, height: 30 }, { top: 130, left: 50, height: 30 }];
  assert.equal(distinct([...block, ...block]), false);
  // Sub-pixel jitter of the copy still counts as the same spot.
  assert.equal(distinct([{ top: 100.2, left: 50, height: 30 }, { top: 99.9, left: 50.3, height: 30.2 }]), false);
});

test("one paragraph, hidden paragraphs or bad input keep the old de-duplication", () => {
  assert.equal(distinct([{ top: 1, left: 1, height: 10 }]), false);
  assert.equal(distinct([{ top: 1, left: 1, height: 10 }, { top: 20, left: 1, height: 0 }]), false);
  assert.equal(distinct(null), false);
});
