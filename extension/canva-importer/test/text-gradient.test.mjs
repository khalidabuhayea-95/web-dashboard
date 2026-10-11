// Canva gradient text → the box-relative TextFill the editor and the app paint
// (src/lib/editor/textFill.ts). The conversion block is evaluated straight out of canva-scraper.js
// between its marker comments, so the test exercises the code that ships.
//
// Canva paints a gradient text colour as an SVG image clipped to the glyphs; the scraper used to read
// that image as the layer's BACKGROUND, so every gradient text imported as a gradient slab with a
// flat-colour copy of the words on top (Ramadan tips post DAHPQOCtDPM).
//
//   node --test extension/canva-importer/test/text-gradient.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-text-gradient:start");
const end = source.indexOf("// ── canva-text-gradient:end");
assert.ok(start >= 0 && end > start, "canva-text-gradient markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.canvaTextGradientToFill = canvaTextGradientToFill;`, context);
// Results are built in the vm's realm; copy them into this one so deepEqual compares values.
const toFill = (...args) => {
  const fill = context.canvaTextGradientToFill(...args);
  return fill === null ? null : JSON.parse(JSON.stringify(fill));
};

const close = (actual, expected, epsilon = 1e-3) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≉ ${expected}`);

// "أذكار الصباح والمساء", exactly as Canva served it: the paragraph is padded 69.333 px all round
// (and pulled back by the same negative margin), the image sits at background-position
// 21.6172px -7px, and the gradient runs across the letters' ink (x 21.6 → 171.4 of a 171.3 box).
const listItemSvg =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='-47.716 -76.333 288.455 228.666' width='288.455' height='228.666'>" +
  "<defs><linearGradient id='g' gradientUnits='userSpaceOnUse' x1='21.617' y1='38' x2='171.406' y2='38'>" +
  "<stop stop-color='#214132' stop-opacity='1' offset='0'/><stop stop-color='#0f1c15' stop-opacity='1' offset='1'/>" +
  "</linearGradient></defs><rect x='-47.716' y='-76.333' width='288.455' height='228.666' fill='url(#g)'/></svg>";
const listItemLayout = {
  width: 310 - 2 * 69.333,
  height: 215 - 2 * 69.333,
  bgX: 21.6172,
  bgY: -7,
  originOffsetX: 69.333,
  originOffsetY: 69.333,
  imageWidth: null,
  imageHeight: null,
};

test("Canva's list-item gradient lands on the box where Canva drew it", () => {
  const fill = toFill(listItemSvg, listItemLayout);
  assert.equal(fill.type, "gradient");
  assert.equal(fill.gradientKind, "linear");
  assert.equal(fill.angle, 0);
  assert.equal(fill.stops.length, 2);
  // Starts on the first letter's edge (21.6 of 171.3), ends at the box edge with Canva's colour there.
  close(fill.stops[0].position, 21.6174 / 171.334);
  assert.equal(fill.stops[0].color, "#214132");
  assert.equal(fill.stops[1].position, 1);
  assert.equal(fill.stops[1].color, "#0f1c15");
  assert.equal("opacity" in fill.stops[0], false);
});

test("a ramp wider than the box is clipped to the colours Canva shows at the box edges", () => {
  const svg =
    "<svg viewBox='0 0 100 50' width='100' height='50'><linearGradient id='g' gradientUnits='userSpaceOnUse' x1='-100' y1='0' x2='200' y2='0'>" +
    "<stop offset='0%' stop-color='#000000'/><stop offset='100%' stop-color='#ffffff' stop-opacity='0.5'/></linearGradient>" +
    "<rect x='0' y='0' width='100' height='50' fill='url(#g)'/></svg>";
  const fill = toFill(svg, { width: 100, height: 50, bgX: 0, bgY: 0, originOffsetX: 0, originOffsetY: 0 });
  // The box covers 1/3 → 2/3 of the ramp: #555555 at 0 and #aaaaaa at 1, alpha 0.833 → 0.667.
  assert.deepEqual(
    fill.stops.map((stop) => [stop.position, stop.color, stop.opacity ?? 1]),
    [
      [0, "#555555", 0.833],
      [1, "#aaaaaa", 0.667],
    ]
  );
});

test("vertical and rotated ramps keep their direction; objectBoundingBox defaults apply", () => {
  const vertical =
    "<svg viewBox='0 0 200 100' width='200' height='100'><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'>" +
    "<stop offset='0' style='stop-color:#ff0000'/><stop offset='1' style='stop-color:#0000ff'/></linearGradient>" +
    "<rect width='200' height='100' fill='url(#g)'/></svg>";
  const down = toFill(vertical, { width: 200, height: 100, bgX: 0, bgY: 0, originOffsetX: 0, originOffsetY: 0 });
  assert.equal(down.angle, 90);
  assert.deepEqual(down.stops.map((stop) => [stop.position, stop.color]), [[0, "#ff0000"], [1, "#0000ff"]]);

  const rotated =
    "<svg viewBox='0 0 100 100' width='100' height='100'><linearGradient id='g' gradientTransform='rotate(45 0.5 0.5)'>" +
    "<stop offset='0' stop-color='#ff0000'/><stop offset='1' stop-color='#0000ff'/></linearGradient>" +
    "<rect width='100' height='100' fill='url(#g)'/></svg>";
  const diagonal = toFill(rotated, { width: 100, height: 100, bgX: 0, bgY: 0, originOffsetX: 0, originOffsetY: 0 });
  assert.equal(diagonal.angle, 45);
});

test("a radial ramp scales its stops onto the box's half diagonal", () => {
  const svg =
    "<svg viewBox='0 0 300 400' width='300' height='400'><radialGradient id='g' gradientUnits='userSpaceOnUse' cx='150' cy='200' r='125'>" +
    "<stop offset='0' stop-color='#ffffff'/><stop offset='1' stop-color='#000000'/></radialGradient>" +
    "<rect width='300' height='400' fill='url(#g)'/></svg>";
  const fill = toFill(svg, { width: 300, height: 400, bgX: 0, bgY: 0, originOffsetX: 0, originOffsetY: 0 });
  assert.equal(fill.gradientKind, "radial");
  // Canva's radius 125 against the renderers' 250 (half of the 500 px diagonal).
  assert.deepEqual(fill.stops.map((stop) => stop.position), [0, 0.5]);
});

test("anything it cannot express comes back null, so the text keeps its flat colour", () => {
  assert.equal(toFill("<svg viewBox='0 0 10 10'><image href='photo.jpg'/></svg>", listItemLayout), null);
  assert.equal(toFill(listItemSvg, { ...listItemLayout, width: 0 }), null);
  const oneStop = listItemSvg.replace(/<stop stop-color='#0f1c15'[^>]*>/, "");
  assert.equal(toFill(oneStop, listItemLayout), null);
  const skewed = listItemSvg.replace("<linearGradient id='g'", "<linearGradient id='g' gradientTransform='skewX(20)'");
  assert.equal(toFill(skewed, listItemLayout), null);
});
