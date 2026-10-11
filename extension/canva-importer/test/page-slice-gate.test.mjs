// Whether a layer is on the page enough to import. The block is evaluated straight out of
// canva-scraper.js between its marker comments, so the test exercises the code that ships.
//
// DAHR4D4QJR4's white torn-paper strips hang mostly above and below the page: 17% and 6% of their
// own boxes show, which the old "20% of itself" rule dropped, yet they paint the page's torn top
// and bottom edges (11% and 4% of the page).
//
//   node --test extension/canva-importer/test/page-slice-gate.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-page-slice-gate:start");
const end = source.indexOf("// ── canva-page-slice-gate:end");
assert.ok(start >= 0 && end > start, "canva-page-slice-gate markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.gate = layerShowsOnPage;`, context);
const gate = (input) => context.gate(input);

const PAGE = 341 * 606;

test("the torn strips: a sliver of themselves, a real share of the page", () => {
  assert.equal(gate({ coverage: 57 / 340, visibleArea: 402 * 57, pageArea: PAGE }), true);
  assert.equal(gate({ coverage: 19 / 340, visibleArea: 402 * 19, pageArea: PAGE }), true);
});

test("a layer showing a fifth of itself passes as before", () => {
  assert.equal(gate({ coverage: 0.2, visibleArea: 10, pageArea: PAGE }), true);
  assert.equal(gate({ coverage: 1, visibleArea: 1, pageArea: PAGE }), true);
});

test("a layer parked beside the page with a hairline on it is still dropped", () => {
  assert.equal(gate({ coverage: 0.01, visibleArea: 300 * 2, pageArea: PAGE }), false);
  assert.equal(gate({ coverage: 0.19, visibleArea: PAGE * 0.019, pageArea: PAGE }), false);
});

test("missing numbers never admit a layer", () => {
  assert.equal(gate({ coverage: undefined, visibleArea: undefined, pageArea: 0 }), false);
  assert.equal(gate({ coverage: NaN, visibleArea: 5000, pageArea: NaN }), false);
});
