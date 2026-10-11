// A clip outline well inside its element's box is a photo WINDOW: the frame becomes that window,
// placed on the page by turning its offset with the layer. The block is evaluated straight out of
// canva-scraper.js between its marker comments, so the test exercises the code that ships.
//
// DAHR4NoHFpw's polaroids (straight) and DAHR4MPh4ls's (tilted -10.6° / 16.8°): the photo's
// wrapper (431x501 layout px, scaled 1.5824 to fill the 682x792 layer) is clipped to a 385x370
// opening at (19.5, 23.2); the photo sits at (-65, 23.2) 555x370 inside that wrapper.
//
//   node --test extension/canva-importer/test/clip-window.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-clip-window:start");
const end = source.indexOf("// ── canva-clip-window:end");
assert.ok(start >= 0 && end > start, "canva-clip-window markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.geometry = clipWindowGeometry;\nthis.place = placeClipWindow;`, context);
const geometry = (input) => {
  const value = context.geometry(input);
  return value === null ? null : JSON.parse(JSON.stringify(value));
};
const place = (input) => JSON.parse(JSON.stringify(context.place(input)));
const close = (actual, expected, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≉ ${expected}`);

const polaroid = {
  bounds: { x: 19.53, y: 23.23, width: 385.54, height: 370.12 },
  boxWidth: 431,
  boxHeight: 501,
  clippedLocal: { x: 0, y: 0, width: 682, height: 792.8 },
  layerWidth: 682,
  layerHeight: 792,
  mediaLocal: { x: -65.04, y: 23.23, width: 555, height: 370 },
};

test("the polaroid's opening: fractions of the layer, and the photo slice that shows", () => {
  const value = geometry(polaroid);
  assert.ok(value);
  close(value.x, (19.53 * 682) / 431 / 682);
  close(value.y, (23.23 * 792.8) / 501 / 792);
  close(value.width, (385.54 * 682) / 431 / 682);
  close(value.height, (370.12 * 792.8) / 501 / 792);
  // The photo overflows the opening on both sides: the slice is x 84.57..470.11 of 555, full height.
  close(value.crop.x, (19.53 + 65.04) / 555);
  close(value.crop.width, 385.54 / 555);
  close(value.crop.y, 0);
  close(value.crop.height, 1);
});

test("a photo smaller than the opening crops to its own extent", () => {
  const value = geometry({ ...polaroid, mediaLocal: { x: 100, y: 100, width: 200, height: 150 } });
  assert.deepEqual(value.crop, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(geometry({ ...polaroid, mediaLocal: null }).crop, null);
});

test("an outline that fills the box (an arch, a torn edge) is no window", () => {
  assert.equal(geometry({ ...polaroid, bounds: { x: 0, y: 0, width: 431, height: 501 } }), null);
  // A hair inside the box is still the box.
  assert.equal(geometry({ ...polaroid, bounds: { x: 3, y: 2, width: 425, height: 496 } }), null);
});

test("missing or empty inputs never make a window", () => {
  assert.equal(geometry({ ...polaroid, bounds: null }), null);
  assert.equal(geometry({ ...polaroid, bounds: { x: 10, y: 10, width: 0, height: 50 } }), null);
  assert.equal(geometry({ ...polaroid, clippedLocal: null }), null);
  assert.equal(geometry({ ...polaroid, layerWidth: 0 }), null);
});

test("a straight layer: the window is just its share of the frame", () => {
  const value = place({ frameWidth: 280, frameHeight: 320, centerX: 140, centerY: 160, angle: 0, opening: { x: 0.0453, y: 0.0464, width: 0.8945, height: 0.7388 } });
  close(value.width, 280 * 0.8945);
  close(value.height, 320 * 0.7388);
  close(value.centerX, (0.0453 + 0.8945 / 2) * 280);
  close(value.centerY, (0.0464 + 0.7388 / 2) * 320);
});

test("a tilted layer: the window's offset turns with it", () => {
  // The opening sits 8.1% of the height ABOVE the layer centre (and dead centre horizontally);
  // at 90° that offset points along +x on the page... and at -10.6° it drifts left and up.
  const opening = { x: 0.05, y: 0.05, width: 0.9, height: 0.7 };
  const quarter = place({ frameWidth: 100, frameHeight: 200, centerX: 500, centerY: 500, angle: 90, opening });
  close(quarter.centerX, 500 + 0.1 * 200);
  close(quarter.centerY, 500);
  const tilted = place({ frameWidth: 100, frameHeight: 200, centerX: 500, centerY: 500, angle: -10.594, opening });
  const dy = -0.1 * 200;
  const rad = (-10.594 * Math.PI) / 180;
  close(tilted.centerX, 500 - dy * Math.sin(rad));
  close(tilted.centerY, 500 + dy * Math.cos(rad));
  assert.ok(tilted.centerX < 500 && tilted.centerY < 500);
});
