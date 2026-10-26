// Canva's linear gradient `rotation` → the SVG gradient line the shape rebuild draws. The block is
// evaluated straight out of each of the three files that carry it, so the test exercises the code
// that ships and fails if the copies drift apart.
//
// DAHR9xcvsOU's fade bands are `{type:"linear", rotation:90}` and Canva's DOM draws them
// x1=0 → x2=width at mid-height; the rebuild hard-coded top→bottom, so they faded the wrong way.
//
//   node --test extensions/canva-importer/test/gradient-line.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = ["canva-fiber-main.js", "background.js", "canva-scraper.js"];
const blockOf = (file) => {
  const source = fs.readFileSync(path.join(here, "..", file), "utf8");
  const start = source.indexOf("// ── canva-gradient-line:start");
  const end = source.indexOf("// ── canva-gradient-line:end");
  assert.ok(start >= 0 && end > start, `canva-gradient-line markers missing in ${file}`);
  return source.slice(start, end);
};
const strip = (block) => block.split("\n").map((line) => line.trim()).join("\n");
const lineFns = FILES.map((file) => {
  const context = vm.createContext({});
  vm.runInContext(`${blockOf(file)}\nthis.line = canvaGradientLine;`, context);
  return (value) => JSON.parse(JSON.stringify(context.line(value)));
});
const line = lineFns[0];

test("the block is identical (modulo indentation) in all three files", () => {
  const [first, ...rest] = FILES.map((file) => strip(blockOf(file)));
  rest.forEach((other, index) => assert.equal(other, first, `${FILES[index + 1]} drifted from ${FILES[0]}`));
});

test("no rotation keeps the old top→bottom line", () => {
  assert.deepEqual(line(undefined), { x1: 0.5, y1: 0, x2: 0.5, y2: 1 });
  assert.deepEqual(line(0), { x1: 0.5, y1: 0, x2: 0.5, y2: 1 });
  assert.deepEqual(line("nope"), { x1: 0.5, y1: 0, x2: 0.5, y2: 1 });
});

test("90 runs left→right, as Canva's DOM draws the fade bands", () => {
  assert.deepEqual(line(90), { x1: 0, y1: 0.5, x2: 1, y2: 0.5 });
});

test("180 and 270 reverse the two axes", () => {
  assert.deepEqual(line(180), { x1: 0.5, y1: 1, x2: 0.5, y2: 0 });
  assert.deepEqual(line(270), { x1: 1, y1: 0.5, x2: 0, y2: 0.5 });
  assert.deepEqual(line(-90), line(270));
});

test("an observable rotation is unwrapped; every copy agrees", () => {
  assert.deepEqual(line({ get: () => 90 }), line(90));
  [0, 45, 90, 135, 200].forEach((value) => {
    lineFns.slice(1).forEach((fn) => assert.deepEqual(fn(value), line(value)));
  });
  const diagonal = line(45);
  assert.ok(diagonal.x2 > diagonal.x1 && diagonal.y2 > diagonal.y1, "45° heads to the bottom-right");
});
