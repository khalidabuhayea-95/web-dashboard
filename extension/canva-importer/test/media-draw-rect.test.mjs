// Canva re-minifies the image record's crop box key with releases (`sb` → `xb` → `wb`). A stale
// name read no crop at all, and a 90°-turned photo then had its slice measured on screen and came
// in squeezed (DAHPQABmz_M). The lookup goes by SHAPE; this runs the block as shipped.
//
//   node --test extension/canva-importer/test/media-draw-rect.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-fiber-main.js"), "utf8");
const start = source.indexOf("// ── canva-media-draw-rect:start");
const end = source.indexOf("// ── canva-media-draw-rect:end");
assert.ok(start >= 0 && end > start, "canva-media-draw-rect markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.findMediaDrawRect = findMediaDrawRect;`, context);
const find = (record) => {
  const rect = context.findMediaDrawRect(record);
  return rect === null ? null : JSON.parse(JSON.stringify(rect));
};

const box = { top: -353.657, left: 0, width: 1418.55, height: 945.109, rotation: 0 };

test("reads the current key and every earlier one", () => {
  for (const key of ["wb", "xb", "sb"]) {
    assert.deepEqual(find({ media: { id: "M1" }, [key]: box }), box);
  }
});

test("finds a renamed key by its shape, and ignores look-alikes", () => {
  assert.deepEqual(find({ media: { id: "M1" }, Hj: { type: "RESOLVED", id: "M2" }, zq: box }), box);
  assert.equal(find({ media: { id: "M1" }, Hj: { type: "RESOLVED" }, mf: {} }), null);
  assert.equal(find({ zq: { top: "1", left: 0, width: 1, height: 1 } }), null);
  assert.equal(find(null), null);
});
