// A clip outline that only traces the clipped element's own rectangle is no mask. The block is
// evaluated straight out of canva-scraper.js between its marker comments, so the test exercises
// the code that ships.
//
// DAHR9xcvsOU's 11%-opacity clock tower sits in a wrapper (256x1107 layout px) clipped to
// M0,0L256,0L256,1107.09L0,1107.09Z; read as a mask it forced the isolation snapshot.
//
//   node --test extension/canva-importer/test/whole-box-clip.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-whole-box-clip:start");
const end = source.indexOf("// ── canva-whole-box-clip:end");
assert.ok(start >= 0 && end > start, "canva-whole-box-clip markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.whole = isWholeBoxRectPath;`, context);
const whole = (...args) => context.whole(...args);

test("the clock tower's clip is its own box", () => {
  assert.equal(whole("M0,0L256,0L256,1107.0917934572099L0,1107.0917934572099Z", 256, 1107), true);
});

test("other spellings of the same rectangle", () => {
  assert.equal(whole("M 0 0 H 100 V 50 H 0 Z", 100, 50), true);
  assert.equal(whole("m0 0 l100 0 l0 50 l-100 0 z", 100, 50), true);
  assert.equal(whole("M100,0L100,50L0,50L0,0Z", 100, 50), true);
  // objectBoundingBox units.
  assert.equal(whole("M0,0L1,0L1,1L0,1Z", 1, 1), true);
});

test("a crop smaller than the box is a real mask", () => {
  assert.equal(whole("M0,0L80,0L80,50L0,50Z", 100, 50), false);
  assert.equal(whole("M10,10L90,10L90,40L10,40Z", 100, 50), false);
});

test("curves, windows and shapes are masks", () => {
  // The polaroid card: outline plus an inner window.
  assert.equal(whole("M0,0L431,0L431,501L0,501ZM20,23L405,23L405,393L20,393Z", 431, 501), false);
  // An arch.
  assert.equal(whole("M0,565C0,253 242,0 540,0C838,0 1080,253 1080,565L1080,1130L0,1130Z", 1080, 1130), false);
  // A triangle.
  assert.equal(whole("M0,0L100,0L0,50Z", 100, 50), false);
});

test("garbage never passes", () => {
  assert.equal(whole("", 100, 50), false);
  assert.equal(whole("M0,0L100,0L100,50L0,50Z", 0, 50), false);
  assert.equal(whole("L0,0L100,0", 100, 50), false);
  assert.equal(whole("M0,0 A10,10 0 0 1 100,0 L100,50 L0,50Z", 100, 50), false);
});
