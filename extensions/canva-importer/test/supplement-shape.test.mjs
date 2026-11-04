// A Canva SHAPE the layer walk rejected for its size on screen is rebuilt by the model supplement.
// DAHZk2fauFU: the 480×2 divider under «دعوة» (0.6 px tall at fit zoom) and the 44×44 calendar and
// clock icons (13.9 px) never reached the import. The block is evaluated straight out of
// canva-scraper.js between its marker comments, so the test exercises the code that ships.
//
//   node --test extensions/canva-importer/test/supplement-shape.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-supplement-shape:start");
const end = source.indexOf("// ── canva-supplement-shape:end");
assert.ok(start >= 0 && end > start, "canva-supplement-shape markers missing");
const context = vm.createContext({});
vm.runInContext(
  `${source.slice(start, end)}\nthis.fields = supplementShapeFields; this.tooSmall = supplementTooSmall;`,
  context
);
const fields = (el, options) => JSON.parse(JSON.stringify(context.fields(el, options) ?? null));
const tooSmall = (type, width, height) => context.tooSmall(type, width, height);

const divider = {
  type: "shape",
  width: 480,
  height: 2,
  shape: { shapeKind: "rect", fillColor: "#a33a48", strokeColor: null, strokeWidth: 0, cornerRadius: 0 },
  vector: null,
};
const calendar = {
  type: "shape",
  width: 44,
  height: 44,
  shape: null,
  vector: { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><path d="M3 4 H21 V23 H3 Z"/></svg>', width: 44, height: 44 },
};
const onPage = { rendered: true, opacity: 1 };

test("a rejected divider comes back as the model's editable rect", () => {
  assert.deepEqual(fields(divider, onPage), { modelShape: divider.shape, fill: "#a33a48" });
});

test("a rejected icon comes back as the model's vector, kept out of the snapshot paths", () => {
  assert.deepEqual(fields(calendar, onPage), {
    modelVectorSvg: calendar.vector.svg,
    snapshotIsLossyFallback: true,
    fill: "",
  });
});

test("nothing for a shape that is not on the page, invisible, or not drawable from the model", () => {
  assert.equal(fields(divider, { rendered: false, opacity: 1 }), null);
  assert.equal(fields(divider, { rendered: true, opacity: 0 }), null);
  assert.equal(fields(divider, { rendered: true, opacity: 0.005 }), null);
  // A photo frame: extractShape and extractVectorShape both leave it out.
  assert.equal(fields({ type: "shape", shape: null, vector: null }, onPage), null);
  assert.equal(fields({ type: "shape", shape: null, vector: { svg: "" } }, onPage), null);
  // Other element types keep their own branches.
  assert.equal(fields({ ...divider, type: "rect" }, onPage), null);
  assert.equal(fields({ ...divider, type: "line" }, onPage), null);
});

test("a shape keeps its thin axis, either way up; other types keep the old size rule", () => {
  assert.equal(tooSmall("shape", 480, 1), false);
  assert.equal(tooSmall("shape", 1, 480), false);
  assert.equal(tooSmall("shape", 1, 1), true);
  // Unchanged: a line keeps a 1 px height, everything else needs more than 1 px both ways.
  assert.equal(tooSmall("line", 480, 1), false);
  assert.equal(tooSmall("line", 1, 480), true);
  assert.equal(tooSmall("text", 480, 1), true);
  assert.equal(tooSmall("rect", 1, 480), true);
  assert.equal(tooSmall("rect", 44, 44), false);
});
