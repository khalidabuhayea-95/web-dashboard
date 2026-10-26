/**
 * A Canva custom motion path reaches the app as the layer's `motionPath` — the same
 * `[{ t, x, y }]` the web editor plays (lib/editor/previewRuntime.ts resolveMotionPathOffset).
 * DAHNZVrSYZM's doors cover the design for 2.5 s in the app until they slide apart along theirs.
 *
 *   node --import tsx --test src/lib/templates/mobileMotionPath.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import { toMobileTemplateDetailSlim } from "@/lib/templates/mobileProject";

const layersOf = (objects) =>
  toMobileTemplateDetailSlim(
    { id: "tpl", name: "doors", canvasWidth: 1080, canvasHeight: 1920, data: { version: "7.0.0", objects } },
    {}
  ).project.layers;

const door = (overrides = {}) => ({
  type: "image",
  src: "https://cdn.example.com/door.png",
  left: 540,
  top: 0,
  width: 540,
  height: 1920,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  originX: "left",
  originY: "top",
  layerType: "image",
  timelineStartMs: 0,
  timelineEndMs: 2542,
  ...overrides,
});

test("a layer's motion path is sent as-is: ms from its window start, project-px page offsets", () => {
  const path = [
    { t: 0, x: 0, y: 0 },
    { t: 52, x: 24, y: 0 },
    { t: 1178, x: 542, y: 6 },
  ];
  const [layer] = layersOf([door({ mediaMotionPath: path })]);
  assert.deepEqual(layer.motionPath, path);
  assert.equal(layer.timelineStartMs, 0);
});

test("a mirrored door keeps its path in page axes (the mirror does not flip the offsets)", () => {
  const path = [
    { t: 0, x: 0, y: 0 },
    { t: 1962, x: -664, y: -16 },
  ];
  const [layer] = layersOf([door({ scaleX: -1, mediaMotionPath: path })]);
  assert.equal(layer.transform.flipX, true);
  assert.deepEqual(layer.motionPath, path);
});

test("points are sorted by time, junk dropped, values rounded to 0.01", () => {
  const [layer] = layersOf([
    door({
      mediaMotionPath: [
        { t: 900.004, x: 10.126, y: -3.3333 },
        { t: "x", x: 1, y: 1 },
        null,
        { t: 0, x: 0, y: 0 },
        { t: -5, x: 0, y: Number.NaN },
      ],
    }),
  ]);
  assert.deepEqual(layer.motionPath, [
    { t: 0, x: 0, y: 0 },
    { t: 900, x: 10.13, y: -3.33 },
  ]);
});

test("no path, or fewer than two usable points, sends no field at all", () => {
  const [plain, single, junk] = layersOf([
    door(),
    door({ mediaMotionPath: [{ t: 0, x: 0, y: 0 }] }),
    door({ mediaMotionPath: [{ t: 0, x: 0, y: 0 }, { t: 10, x: "a", y: 0 }] }),
  ]);
  assert.equal("motionPath" in plain, false);
  assert.equal("motionPath" in single, false);
  assert.equal("motionPath" in junk, false);
});

test("text and shape layers carry their path too", () => {
  const path = [
    { t: 0, x: 0, y: 0 },
    { t: 400, x: 0, y: -120 },
  ];
  const [text] = layersOf([
    {
      type: "textbox",
      text: "عروسه",
      left: 100,
      top: 300,
      width: 400,
      height: 120,
      fontSize: 80,
      fontFamily: "Arial",
      originX: "left",
      originY: "top",
      mediaMotionPath: path,
    },
  ]);
  assert.deepEqual(text.motionPath, path);
});

// ── curved text: the app's curveConfig, including the Size slider ───────────────────────────────
test("a curved text sends its arc and its Size (ringSpread)", () => {
  const [ring, plain] = layersOf([
    {
      type: "textbox",
      text: "مبارك عليكم",
      left: 100,
      top: 300,
      width: 400,
      height: 120,
      fontSize: 60,
      fontFamily: "Arial",
      originX: "left",
      originY: "top",
      textCurveEnabled: true,
      textCurveArcDegrees: 360,
      textCurveRingSpread: 0.4,
    },
    {
      type: "textbox",
      text: "Hello",
      left: 100,
      top: 600,
      width: 300,
      height: 80,
      fontSize: 50,
      fontFamily: "Arial",
      originX: "left",
      originY: "top",
      textCurveEnabled: true,
      textCurveArcDegrees: -90,
    },
  ]);
  assert.equal(ring.curveConfig.enabled, true);
  assert.equal(ring.curveConfig.arcDegrees, 360);
  assert.equal(ring.curveConfig.ringSpread, 0.4);
  assert.equal(plain.curveConfig.arcDegrees, -90);
  assert.equal("ringSpread" in plain.curveConfig, false);
});
