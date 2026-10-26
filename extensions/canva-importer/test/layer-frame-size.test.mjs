// A layer's frame size in design px: the un-rotated style box when it agrees with the measured
// bounding box, else the box itself (swapped back for quarter turns). The block is evaluated
// straight out of canva-scraper.js between its marker comments, so the test exercises the code
// that ships.
//
// On DAHFE4GgR2Q (A4 landscape, imported at its 81% fit zoom) every unrotated layer came in at
// 81% of its size around its own centre: the styled box was still in SCREEN px, landed inside
// the 0.8–1.25 "matches" window against the design-px raw box, and won. The caller now converts
// it to design px before this helper sees it; these are the numbers it then compares.
//
//   node --test extensions/canva-importer/test/layer-frame-size.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-layer-frame-size:start");
const end = source.indexOf("// ── canva-layer-frame-size:end");
assert.ok(start >= 0 && end > start, "canva-layer-frame-size markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.size = resolveLayerFrameSize;`, context);
const size = (input) => JSON.parse(JSON.stringify(context.size(input)));

test("the cream blob keeps its 975x724 frame at an 81% zoom", () => {
  // Style 975.41x723.84 in design px (after the caller's conversion) vs the measured 976x724 box.
  assert.deepEqual(
    size({ rawWidth: 976, rawHeight: 724, styledWidth: 975.41, styledHeight: 723.84, isQuarterTurned: false }),
    { width: 975.41, height: 723.84 }
  );
  // What the old screen-px styled box would have produced is NOT what a design-px one gives.
  assert.notDeepEqual(
    size({ rawWidth: 976, rawHeight: 724, styledWidth: 975.41, styledHeight: 723.84, isQuarterTurned: false }),
    { width: 789, height: 585.5 }
  );
});

test("without its angle, a turned layer whose footprint disagrees with its frame keeps the footprint", () => {
  // The 6.2° medal ribbon: style 153.6x509.6, footprint 208x523 — the ratios miss the window.
  assert.deepEqual(
    size({ rawWidth: 208, rawHeight: 523, styledWidth: 153.6, styledHeight: 509.6, isQuarterTurned: false }),
    { width: 208, height: 523 }
  );
});

test("with its angle, a turned layer's own box is compared as the footprint it makes", () => {
  // That ribbon's footprint IS its 153.6x509.6 frame turned 6.2° (207.7x523.2) — and Canva's
  // model box for it (DAHFE4GgR2Q, LBKvfnBLBL3H70pB) is 153.6x509.58, not the 208 px footprint.
  assert.deepEqual(
    size({ rawWidth: 208, rawHeight: 523, styledWidth: 153.6, styledHeight: 509.6, isQuarterTurned: false, angle: 6.2 }),
    { width: 153.6, height: 509.6 }
  );
  // DAHNZVrSYZM's "عروسـ": a 297.56x120.46 text turned -8.29°; its screen footprint 311.83x162.13.
  assert.deepEqual(
    size({ rawWidth: 311.83, rawHeight: 162.13, styledWidth: 297.56, styledHeight: 120.46, isQuarterTurned: false, angle: -8.29 }),
    { width: 297.56, height: 120.46 }
  );
});

test("with its angle, a style box that does not make the footprint still loses to it", () => {
  // A style box in the wrong units (60% of the frame) turned 8.3° is far off the footprint.
  assert.deepEqual(
    size({ rawWidth: 311.83, rawHeight: 162.13, styledWidth: 178.5, styledHeight: 72.3, isQuarterTurned: false, angle: -8.29 }),
    { width: 311.83, height: 162.13 }
  );
});

test("with its angle, a quarter turn compares its swapped frame like before", () => {
  // The -90° floral strip: turned -90°, the 1920x458 frame makes exactly the 458x1920 footprint.
  assert.deepEqual(
    size({ rawWidth: 458, rawHeight: 1920, styledWidth: 1920, styledHeight: 458, isQuarterTurned: true, angle: -90 }),
    { width: 1920, height: 458 }
  );
  assert.deepEqual(
    size({ rawWidth: 458, rawHeight: 1920, styledWidth: 0, styledHeight: 0, isQuarterTurned: true, angle: -90 }),
    { width: 1920, height: 458 }
  );
  // An unturned layer reads exactly as without the angle.
  assert.deepEqual(
    size({ rawWidth: 976, rawHeight: 724, styledWidth: 975.41, styledHeight: 723.84, isQuarterTurned: false, angle: 0 }),
    { width: 975.41, height: 723.84 }
  );
});

test("a quarter turn compares against the swapped box and swaps it back when unmatched", () => {
  // The -90° floral strip (round 3): a 1920x458 frame whose footprint measures 458x1920.
  assert.deepEqual(
    size({ rawWidth: 458, rawHeight: 1920, styledWidth: 1920, styledHeight: 458, isQuarterTurned: true }),
    { width: 1920, height: 458 }
  );
  assert.deepEqual(
    size({ rawWidth: 458, rawHeight: 1920, styledWidth: 0, styledHeight: 0, isQuarterTurned: true }),
    { width: 1920, height: 458 }
  );
});

test("no style box means the measured box, never below one pixel", () => {
  assert.deepEqual(size({ rawWidth: 120, rawHeight: 40, styledWidth: 0, styledHeight: 0, isQuarterTurned: false }), { width: 120, height: 40 });
  assert.deepEqual(size({ rawWidth: 0, rawHeight: NaN, styledWidth: 0, styledHeight: 0, isQuarterTurned: false }), { width: 1, height: 1 });
});
