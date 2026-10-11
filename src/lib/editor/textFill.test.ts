/**
 * Gradient text fill: the editor paints the ramp exactly where the mobile app does (same box
 * geometry), and the mobile payload is the app's own `Background.Gradient` shape.
 *
 *   node --import tsx --test src/lib/editor/textFill.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeTextFill,
  resolveLinearGradientEndpoints,
  resolveRadialGradientRadius,
  textFillKonvaProps,
  textFillToMobilePayload,
} from "@/lib/editor/textFill";

// The Ramadan tips post (DAHPQOCtDPM): Canva's dark-green ramp across a list item's ink.
const canvaGreen = {
  type: "gradient",
  gradientKind: "linear",
  angle: 0,
  stops: [
    { color: "#214132", position: 0.12617 },
    { color: "#0F1C15", position: 1 },
  ],
};

const close = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≉ ${expected}`);

test("normalizes a gradient fill and rejects anything unusable", () => {
  const fill = normalizeTextFill({ ...canvaGreen, angle: -90, stops: [canvaGreen.stops[1], canvaGreen.stops[0]] });
  assert.deepEqual(fill, {
    type: "gradient",
    gradientKind: "linear",
    angle: 270,
    stops: [
      { color: "#214132", position: 0.12617 },
      { color: "#0f1c15", position: 1 },
    ],
  });
  assert.equal(normalizeTextFill(undefined), undefined);
  assert.equal(normalizeTextFill({ type: "image", imageUri: "x" }), undefined);
  assert.equal(normalizeTextFill({ ...canvaGreen, stops: [canvaGreen.stops[0]] }), undefined);
  assert.equal(normalizeTextFill({ ...canvaGreen, stops: [{ color: "red", position: 0 }, { color: "#fff", position: 1 }] }), undefined);
  const translucent = normalizeTextFill({
    ...canvaGreen,
    stops: [{ color: "#abc", position: -1, opacity: 0.5 }, { color: "#000000", position: 2, opacity: 1 }],
  });
  assert.deepEqual(translucent?.stops, [
    { color: "#aabbcc", position: 0, opacity: 0.5 },
    { color: "#000000", position: 1 },
  ]);
});

test("linear endpoints match the app: centre ± the half projection along the angle", () => {
  assert.deepEqual(resolveLinearGradientEndpoints(200, 100, 0), { startX: 0, startY: 50, endX: 200, endY: 50 });
  const down = resolveLinearGradientEndpoints(200, 100, 90);
  close(down.startX, 100);
  close(down.startY, 0);
  close(down.endY, 100);
  // 45° on a 200×100 box reaches the far corners' projection: half = (100 + 50)·√½.
  const diagonal = resolveLinearGradientEndpoints(200, 100, 45);
  const half = (100 + 50) * Math.SQRT1_2;
  close(diagonal.endX, 100 + half * Math.SQRT1_2);
  close(diagonal.endY, 50 + half * Math.SQRT1_2);
  close(resolveRadialGradientRadius(300, 400), 250);
});

test("Konva props paint the ramp over the box, shifted into child coordinates on request", () => {
  const props = textFillKonvaProps(canvaGreen, 171, 76);
  assert.equal(props.fillPriority, "linear-gradient");
  assert.deepEqual(props.fillLinearGradientStartPoint, { x: 0, y: 38 });
  assert.deepEqual(props.fillLinearGradientEndPoint, { x: 171, y: 38 });
  assert.deepEqual(props.fillLinearGradientColorStops, [0.12617, "#214132", 1, "#0f1c15"]);
  const word = textFillKonvaProps(canvaGreen, 171, 76, 40, 0);
  assert.deepEqual(word.fillLinearGradientStartPoint, { x: -40, y: 38 });
  const radial = textFillKonvaProps({ ...canvaGreen, gradientKind: "radial", stops: [
    { color: "#ffffff", position: 0, opacity: 0.25 },
    { color: "#000000", position: 1 },
  ] }, 300, 400);
  assert.equal(radial.fillPriority, "radial-gradient");
  assert.equal(radial.fillRadialGradientEndRadius, 250);
  assert.deepEqual(radial.fillRadialGradientColorStops, [0, "rgba(255, 255, 255, 0.25)", 1, "#000000"]);
  assert.deepEqual(textFillKonvaProps(undefined, 10, 10), {});
});

test("mobile payload is the app's Background.Gradient shape, alpha as #AARRGGBB", () => {
  assert.deepEqual(textFillToMobilePayload(canvaGreen), {
    type: "gradient",
    gradientKind: "linear",
    angle: 0,
    startColorHex: "#214132",
    endColorHex: "#0F1C15",
    stops: [
      { colorHex: "#214132", position: 0.12617 },
      { colorHex: "#0F1C15", position: 1 },
    ],
  });
  const translucent = textFillToMobilePayload({
    ...canvaGreen,
    stops: [{ color: "#ff0000", position: 0, opacity: 0.5 }, { color: "#0000ff", position: 1 }],
  });
  assert.equal(translucent?.startColorHex, "#80FF0000");
  assert.equal(textFillToMobilePayload({ type: "solid" }), null);
});
