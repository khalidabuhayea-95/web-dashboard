// Canva's animation player draws its own copy of every element (same LB id) in which the page zoom
// sits INSIDE the element and the element's own transform is the current animation frame. The
// block is evaluated straight out of canva-scraper.js between its marker comments, so the test
// exercises the code that ships.
//
// DAHNZYYmqNA at 26.77% zoom, imported mid-playback: "بكل الحب والود ندعوكم لحضور" is 45.33 px in
// the design but came in at 12.14 (45.33 × 0.2677), and every Breathe layer came in 6% too big.
//
//   node --test extensions/canva-importer/test/player-copy.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-player-copy:start");
const end = source.indexOf("// ── canva-player-copy:end");
assert.ok(start >= 0 && end > start, "canva-player-copy markers missing");
const context = vm.createContext({});
vm.runInContext(
  `${source.slice(start, end)}\nthis.units = layerUnitsToDesign; this.rest = playerCopyRestBox;`,
  context
);
const units = (...args) => context.units(...args);
const rest = (input) => JSON.parse(JSON.stringify(context.rest(input)));

const ZOOM = 0.267708;
const DESIGN_SCALE = 1920 / (1920 * ZOOM);

test("an editing copy keeps its numbers exactly: the zoom sits above the layer", () => {
  assert.equal(units(ZOOM, DESIGN_SCALE), 1);
  // Float noise and rounding of the page rect stay snapped to 1.
  assert.equal(units(0.2677, 1920 / 514), 1);
  assert.equal(units(1, 1), 1);
});

test("a player copy's own px are screen px: one of them is 1 / zoom design px", () => {
  const value = units(1, DESIGN_SCALE);
  assert.ok(Math.abs(value - 1 / ZOOM) < 1e-9);
  // The 12.14 px the text came in at, through the player's zoom wrapper, back to Canva's 45.33.
  const cssFont = 45.3333;
  assert.ok(Math.abs(cssFont * ZOOM * value - cssFont) < 1e-6);
});

test("the resting box is the model's frame, not the Breathe frame the DOM showed", () => {
  const model = { left: 237.55206298828125, top: 354.7872103254558, width: 604.8958740234375, height: 53.93334, rotation: 0 };
  const box = rest({
    model,
    modelById: { LB93t7VxhpzyQzqP: model },
    // What the import measured at that frame: 642×57 around a centre nudged 3 px up.
    captured: { x: 219.12, y: 350.13, width: 642, height: 57 },
    frameScaleX: 1.061,
    frameScaleY: 1.061,
  });
  assert.deepEqual(box, { x: model.left, y: model.top, width: model.width, height: model.height, fromModel: true });
});

test("a grouped element is taken to page space through its group", () => {
  const group = { left: 100, top: 50, width: 400, height: 300, rotation: 0 };
  const child = { left: 10, top: 20, width: 30, height: 40, rotation: 0, parentId: "LBgroup" };
  const box = rest({ model: child, modelById: { LBgroup: group, LBchild: child }, captured: null });
  assert.deepEqual(box, { x: 110, y: 70, width: 30, height: 40, fromModel: true });
});

test("without a usable model the frame's own scale is taken out around the centre", () => {
  // The Breathe frame at 0.9: a 605×54 text shows as 544.5×48.6 around the same centre.
  const box = rest({
    model: null,
    modelById: {},
    captured: { x: 267.8, y: 357.5, width: 544.5, height: 48.6 },
    frameScaleX: 0.9,
    frameScaleY: 0.9,
  });
  assert.ok(Math.abs(box.width - 605) < 1e-6);
  assert.ok(Math.abs(box.height - 54) < 1e-6);
  assert.ok(Math.abs(box.x + box.width / 2 - (267.8 + 544.5 / 2)) < 1e-6);
  assert.ok(Math.abs(box.y + box.height / 2 - (357.5 + 48.6 / 2)) < 1e-6);
  assert.equal(box.fromModel, false);
  // A group turned on the page cannot be unwound from the model alone — the captured box stays.
  const turned = { left: 0, top: 0, width: 10, height: 10, rotation: 30 };
  const child = { left: 1, top: 1, width: 2, height: 2, parentId: "LBturned" };
  const fallback = rest({
    model: child,
    modelById: { LBturned: turned },
    captured: { x: 5, y: 5, width: 4, height: 4 },
    frameScaleX: 1,
    frameScaleY: 1,
  });
  assert.equal(fallback.fromModel, false);
  assert.deepEqual([fallback.x, fallback.y, fallback.width, fallback.height], [5, 5, 4, 4]);
});

test("a layer inside a SCALED group: one of its px is the group's scale in design px", () => {
  // DAHNlFf3ad4's monogram group is 304.7 px wide on the page, its contents laid out 1225.6 px wide
  // inside: the letters' parent space is zoom × 0.2486 on screen, so a 1471 px font is 366 design px.
  const groupScale = 304.7367 / 1225.6453;
  const groupUnits = units(ZOOM * groupScale, DESIGN_SCALE);
  assert.ok(Math.abs(groupUnits - groupScale) < 1e-6, `${groupUnits}`);
  assert.ok(Math.abs(1471.35 * groupUnits - 365.8) < 0.5);
  // An unscaled group's children keep their numbers bit-for-bit.
  assert.equal(units(ZOOM * 1.005, DESIGN_SCALE), 1);
});
