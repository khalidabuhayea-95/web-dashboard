// A Canva GRID element's cells → which clipping boxes form the grid. The block is evaluated
// straight out of canva-scraper.js between its marker comments, so the test exercises the code
// that ships.
//
// DAHQBtMqXd8: one 642x642 grid (screen px) with two 318x642 cells, 6 px apart — a black-and-white
// photo and a colour one. The importer flattened them into one colour photo over both halves.
//
//   node --test extensions/canva-importer/test/grid-cells.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-grid-cells:start");
const end = source.indexOf("// ── canva-grid-cells:end");
assert.ok(start >= 0 && end > start, "canva-grid-cells markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.cells = resolveGridCells;`, context);
const keys = (cells, element) => JSON.parse(JSON.stringify(context.cells(cells, element).map((cell) => cell.key)));

const grid = { left: 507, top: 146, width: 642, height: 642 };
const cell = (key, left, top, width, height) => ({ key, rect: { left, top, width, height } });

test("the before/after grid: two side-by-side cells, left first", () => {
  assert.deepEqual(keys([cell("after", 831, 146, 318, 642), cell("before", 507, 146, 318, 642)], grid), ["before", "after"]);
});

test("a 2x2 grid reads row by row", () => {
  const cells = [cell("d", 831, 470, 318, 318), cell("a", 507, 146, 318, 318), cell("c", 507, 470, 318, 318), cell("b", 831, 146, 318, 318)];
  assert.deepEqual(keys(cells, grid), ["a", "b", "c", "d"]);
});

test("one cell, or stacked copies of one photo, is no grid", () => {
  assert.deepEqual(keys([cell("only", 507, 146, 642, 642)], grid), []);
  // Canva's responsive duplicates sit on the same rect.
  assert.deepEqual(keys([cell("low", 507, 146, 642, 642), cell("high", 507, 146, 642, 642)], grid), []);
});

test("cells outside the element or covering too little of it are no grid", () => {
  assert.deepEqual(keys([cell("a", 507, 146, 318, 642), cell("b", 1200, 146, 318, 642)], grid), []);
  assert.deepEqual(keys([cell("a", 507, 146, 100, 100), cell("b", 700, 146, 100, 100)], grid), []);
});

test("bad input never makes a grid", () => {
  assert.deepEqual(keys([], grid), []);
  assert.deepEqual(keys(null, grid), []);
  assert.deepEqual(keys([cell("a", 507, 146, 318, 642), cell("b", 831, 146, 318, 642)], null), []);
});
