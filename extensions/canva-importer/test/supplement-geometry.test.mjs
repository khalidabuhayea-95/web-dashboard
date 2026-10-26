// A model-supplemented element: DOM rect (page-space bounding box) or model box (own frame, but
// group-local when nested)? The block is evaluated straight out of canva-scraper.js between its
// marker comments, so the test exercises the code that ships.
//
// DAHFEg4hhOk: two ribbons turned 64.5° and 29°, mostly off-page, were picked up by the supplement
// and stretched into their rotated footprints at 0°.
//
//   node --test extensions/canva-importer/test/supplement-geometry.test.mjs
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
vm.runInContext(
  `${source.slice(start, end)}\nthis.usesDom = supplementUsesDomRect; this.pageFrame = modelElementPageFrame;`,
  context
);
const usesDom = (input) => context.usesDom(input);
const pageFrame = (el, byId) => JSON.parse(JSON.stringify(context.pageFrame(el, byId)));

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

// DAHNZc5myOk: "محـمـد" enters at 4.6 s inside a group at (214.8, 1169.7); captured at 0:00 it has
// no node on the page, and its group-local (382.1, 0) put it at the top of the page.
const names = { left: 214.8, top: 1169.7, width: 650.9, height: 63.4, rotation: 0 };

test("a model-only grouped element lands where its group puts it", () => {
  const frame = pageFrame({ left: 382.1, top: 0, width: 268.8, height: 63.4, rotation: 0, parentId: "LBnames" }, { LBnames: names });
  assert.ok(Math.abs(frame.x - 596.9) < 1e-9 && Math.abs(frame.y - 1169.7) < 1e-9);
  assert.deepEqual([frame.width, frame.height, frame.angle], [268.8, 63.4, 0]);
});

test("a top-level element keeps its own model frame", () => {
  const frame = pageFrame({ left: 253.5, top: 1659.1, width: 550.7, height: 125, rotation: -12 }, {});
  assert.deepEqual(frame, { x: 253.5, y: 1659.1, width: 550.7, height: 125, angle: -12 });
});

test("a turned group turns its children about its own centre", () => {
  // A 200x100 group at (100,100) turned 90°: a child centred in its right half (local centre
  // 150,50) sits 50 px below the group's centre (200,150) once turned.
  const group = { left: 100, top: 100, width: 200, height: 100, rotation: 90 };
  const frame = pageFrame({ left: 140, top: 40, width: 20, height: 20, rotation: 10, parentId: "LBg" }, { LBg: group });
  assert.ok(Math.abs(frame.x + 10 - 200) < 1e-9);
  assert.ok(Math.abs(frame.y + 10 - 200) < 1e-9);
  assert.equal(frame.angle, 100);
});

test("nested groups compose", () => {
  const outer = { left: 10, top: 20, width: 500, height: 500, rotation: 0 };
  const inner = { left: 30, top: 40, width: 100, height: 100, rotation: 0, parentId: "LBouter" };
  const frame = pageFrame({ left: 5, top: 6, width: 10, height: 10, parentId: "LBinner" }, { LBouter: outer, LBinner: inner });
  assert.ok(Math.abs(frame.x - 45) < 1e-9 && Math.abs(frame.y - 66) < 1e-9);
});
