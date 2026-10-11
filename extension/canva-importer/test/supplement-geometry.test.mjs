// A model-supplemented element: DOM rect (page-space bounding box) or model box (own frame, but
// group-local when nested)? The block is evaluated straight out of canva-scraper.js between its
// marker comments, so the test exercises the code that ships.
//
// DAHFEg4hhOk: two ribbons turned 64.5° and 29°, mostly off-page, were picked up by the supplement
// and stretched into their rotated footprints at 0°.
//
//   node --test extension/canva-importer/test/supplement-geometry.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-supplement-geometry:start");
const end = source.indexOf("// ── canva-supplement-geometry:end");
assert.ok(start >= 0 && end > start, "canva-supplement-geometry markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.usesDom = supplementUsesDomRect;`, context);
const usesDom = (input) => context.usesDom(input);

const ribbon = { hasDomRect: true, nestedInGroup: false, rotation: 64.5, modelWidth: 570.2, modelHeight: 1140.1 };

test("a turned top-level element keeps its model frame and angle", () => {
  assert.equal(usesDom(ribbon), false);
  assert.equal(usesDom({ ...ribbon, rotation: 29 }), false);
  assert.equal(usesDom({ ...ribbon, rotation: -90 }), false);
});

test("nested, unrotated or box-less elements keep the DOM rect as before", () => {
  // The round-11 bullet-list divider: nested in a group that turns it 90°.
  assert.equal(usesDom({ ...ribbon, nestedInGroup: true, rotation: 90 }), true);
  assert.equal(usesDom({ ...ribbon, rotation: 0 }), true);
  assert.equal(usesDom({ ...ribbon, rotation: 0.3 }), true);
  assert.equal(usesDom({ ...ribbon, modelWidth: 0 }), true);
});

test("without a usable DOM rect the model box is all there is", () => {
  assert.equal(usesDom({ ...ribbon, hasDomRect: false }), false);
  assert.equal(usesDom({ ...ribbon, hasDomRect: false, rotation: 0 }), false);
});
