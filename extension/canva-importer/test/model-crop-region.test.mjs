// Canva's media draw rect (the model crop) → the slice of the photo the frame shows, and when that
// exact crop wins over measuring the DOM. The block is evaluated straight out of canva-scraper.js
// between its marker comments, so the test exercises the code that ships.
//
// The coffee cup on DAHPQG4ffsM is a cropped photo turned -74.8°. Cropped photos count as
// "masked", and masked layers were always cut from DOM measurements — axis-aligned screen boxes,
// meaningless for a turned layer — so the cup came in as a 715x1114 portrait slice squeezed into
// its square frame.
//
//   node --test extension/canva-importer/test/model-crop-region.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-model-crop-region:start");
const end = source.indexOf("// ── canva-model-crop-region:end");
assert.ok(start >= 0 && end > start, "canva-model-crop-region markers missing");
const context = vm.createContext({});
vm.runInContext(
  `${source.slice(start, end)}\nthis.region = modelCropRegionForFrame;\nthis.applies = modelCropAppliesToLayer;`,
  context
);
// Results are built in the vm's realm; copy them into this one so deepEqual compares values.
const region = (...args) => {
  const value = context.region(...args);
  return value === null ? null : JSON.parse(JSON.stringify(value));
};

const close = (actual, expected, epsilon = 1e-4) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≉ ${expected}`);

// Exactly as Canva's model held it: the 514.476×522.45 frame shows its 1200×1600 PNG drawn at
// (-79.567, -235.697) and 691.625×923.285 frame px.
const cupFrame = { width: 514.476, height: 522.45 };
const cupCrop = { top: -235.697, left: -79.567, width: 691.625, height: 923.285, rotation: 0 };

test("the turned coffee cup keeps a square slice of its photo", () => {
  const slice = region(cupCrop, cupFrame.width, cupFrame.height);
  close(slice.x, 79.567 / 691.625);
  close(slice.y, 235.697 / 923.285);
  close(slice.width, 514.476 / 691.625);
  close(slice.height, 522.45 / 923.285);
  // In the PNG's pixels the slice has the frame's own shape, so it scales uniformly into it — to
  // Canva's own rounding (its draw rect is 0.12% off the PNG's 3:4). The DOM-measured slice was
  // 715×1114, 35% off.
  const pixels = { width: slice.width * 1200, height: slice.height * 1600 };
  close(pixels.width / pixels.height, cupFrame.width / cupFrame.height, 5e-3);
});

test("a masked layer takes the model crop unless the page clips it or its fill is mirrored", () => {
  const masked = { usesVisibleGeometry: true, pageClipped: false, fillFlipX: false, fillFlipY: false };
  assert.equal(context.applies(masked), true);
  assert.equal(context.applies({ ...masked, pageClipped: true }), false);
  assert.equal(context.applies({ ...masked, fillFlipX: true }), false);
  assert.equal(context.applies({ ...masked, fillFlipY: true }), false);
  // Layers laid out on their full frame always could.
  assert.equal(context.applies({ ...masked, usesVisibleGeometry: false, pageClipped: true, fillFlipX: true }), true);
});

test("media that fills its frame, a turned fill or no frame size means no model crop", () => {
  assert.equal(region({ top: 0, left: 0, width: 300, height: 200, rotation: 0 }, 300, 200), null);
  assert.equal(region({ ...cupCrop, rotation: 90 }, cupFrame.width, cupFrame.height), null);
  assert.equal(region(cupCrop, 0, cupFrame.height), null);
  assert.equal(region(null, cupFrame.width, cupFrame.height), null);
});
