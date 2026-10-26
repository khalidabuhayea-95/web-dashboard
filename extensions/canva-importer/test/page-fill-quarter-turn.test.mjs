// A page-fill photo laid sideways (box rotation ±90) → the slice of the un-turned photo the
// page shows, and which way to turn it. The block is evaluated straight out of canva-scraper.js
// between its marker comments, so the test exercises the code that ships.
//
// The floral certificate DAHFEzrP4PM fills its landscape page with a 1848x2400 portrait photo
// turned -90°; the importer dropped the turn and took a centre slice of the upright photo, so the
// frame came in sideways with the flowers cut off.
//
//   node --test extensions/canva-importer/test/page-fill-quarter-turn.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-page-fill-quarter-turn:start");
const end = source.indexOf("// ── canva-page-fill-quarter-turn:end");
assert.ok(start >= 0 && end > start, "canva-page-fill-quarter-turn markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.crop = quarterTurnedPageFillCrop;`, context);
const crop = (...args) => {
  const value = context.crop(...args);
  return value === null ? null : JSON.parse(JSON.stringify(value));
};

const close = (actual, expected, epsilon = 1e-3) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≉ ${expected}`);

// Exactly as Canva's model held it: the box turns about its centre, so on the 1123x794 page its
// footprint is (-11, -54) 1153x894 and the whole page is inside it.
const certificateBox = { left: 119.2, top: -183.75, width: 893.64, height: 1153.35, rotation: -90 };

test("the certificate's sideways photo: the page's slice, turned counter-clockwise", () => {
  const value = crop(certificateBox, 1123, 794);
  assert.equal(value.quarterTurns, -1);
  // Visible part of the footprint: x 11/1153, y 54/894, w 1123/1153, h 794/894 — then, for a
  // counter-clockwise turn, x′ = 1 − y − h, y′ = x, sides swapped.
  close(value.region.x, 1 - 54 / 893.64 - 794 / 893.64);
  close(value.region.y, 11.0 / 1153.35, 2e-3);
  close(value.region.width, 794 / 893.64);
  close(value.region.height, 1123 / 1153.35);
  // In the 1848x2400 photo that is a 1642x2337 portrait slice — the page's shape once turned.
  const sliceWidth = value.region.width * 1848;
  const sliceHeight = value.region.height * 2400;
  close(sliceHeight / sliceWidth, 1123 / 794, 0.02);
});

test("a clockwise turn maps the other way round", () => {
  const value = crop({ ...certificateBox, rotation: 90 }, 1123, 794);
  assert.equal(value.quarterTurns, 1);
  close(value.region.x, 54 / 893.64);
  close(value.region.y, 1 - 11.0 / 1153.35 - 1123 / 1153.35, 2e-3);
  close(value.region.width, 794 / 893.64);
  close(value.region.height, 1123 / 1153.35);
});

test("a footprint smaller than the page keeps the whole photo and 270° counts as -90°", () => {
  // A 400x800 photo turned -90 at the page's centre: footprint 800x400, fully inside.
  const value = crop({ left: 361.5, top: -3, width: 400, height: 800, rotation: 270 }, 1123, 794);
  assert.equal(value.quarterTurns, -1);
  assert.deepEqual(value.region, { x: 0, y: 0, width: 1, height: 1 });
});

test("anything that is not a quarter turn is left to the other paths", () => {
  assert.equal(crop({ ...certificateBox, rotation: 0 }, 1123, 794), null);
  assert.equal(crop({ ...certificateBox, rotation: 180 }, 1123, 794), null);
  assert.equal(crop({ ...certificateBox, rotation: -74.8 }, 1123, 794), null);
  assert.equal(crop(null, 1123, 794), null);
  assert.equal(crop(certificateBox, 0, 794), null);
  // A footprint entirely off the page shows nothing.
  assert.equal(crop({ ...certificateBox, left: 5000 }, 1123, 794), null);
});
