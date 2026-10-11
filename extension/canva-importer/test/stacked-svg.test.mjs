// A Canva table paints its cell fills and its grid lines as separate SVGs; stacking them into one
// document keeps both. The block is evaluated straight out of canva-scraper.js between its marker
// comments, so the test exercises the code that ships. (DAHP0JQMv10's timetable imported with
// fills only — the biggest SVG won and the lines were lost.)
//
//   node --test extension/canva-importer/test/stacked-svg.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-stacked-svg:start");
const end = source.indexOf("// ── canva-stacked-svg:end");
assert.ok(start >= 0 && end > start, "canva-stacked-svg markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.build = buildStackedSvgMarkup;`, context);
const build = (...args) => context.build(...args);

test("fills then lines, each nested at its own box, filling it exactly", () => {
  const fills = '<svg viewBox="0 0 998 468" class="a"><path fill="#ffefc9" d="M0 0h998v78H0z"/></svg>';
  const lines = '<svg viewBox="0 0 998 468" width="10" height="10" preserveAspectRatio="xMidYMid"><path stroke="#726555" d="M0 78h998"/></svg>';
  const markup = build([{ markup: fills, x: 0, y: 0, width: 998, height: 468 }, { markup: lines, x: 0, y: 0, width: 998, height: 468 }], 998, 468);
  assert.match(markup, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*width="998" height="468" viewBox="0 0 998 468">/);
  const nested = markup.match(/<svg[^>]*>/g);
  assert.equal(nested.length, 3);
  // The fills come first (drawn under the lines), each nested svg carries the box it was measured at,
  // and the lines' own width/height/aspect attributes are replaced rather than doubled.
  assert.ok(markup.indexOf("#ffefc9") < markup.indexOf("#726555"));
  assert.match(nested[1], /class="a"[^>]*x="0" y="0" width="998" height="468" preserveAspectRatio="none"/);
  assert.match(nested[2], /viewBox="0 0 998 468"\s+x="0" y="0" width="998" height="468" preserveAspectRatio="none"/);
  assert.equal((nested[2].match(/width=/g) || []).length, 1);
});

test("an item offset inside the layer keeps its offset, scaled by the caller", () => {
  const markup = build([{ markup: "<svg><rect/></svg>", x: 12.5, y: 7, width: 100, height: 20 }], 200, 50);
  assert.match(markup, /<svg x="12\.5" y="7" width="100" height="20" preserveAspectRatio="none"><rect\/><\/svg>/);
});

test("nothing drawable gives nothing", () => {
  assert.equal(build([], 10, 10), "");
  assert.equal(build([{ markup: "<div/>", x: 0, y: 0, width: 1, height: 1 }], 10, 10), "");
  assert.equal(build(null, 10, 10), "");
});
