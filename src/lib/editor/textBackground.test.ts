import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveTextBackgroundBox,
  textBackgroundFieldsFromPx,
  textBackgroundPaddingPx,
  textBackgroundRadiusPx,
} from "./textBackground";

test("the box uses the app's own formulas: radius angle×28, padding fontSize×ratio×0.5", () => {
  assert.equal(textBackgroundRadiusPx(0.5), 14);
  assert.equal(textBackgroundRadiusPx(2), 28, "angle clamps to 1");
  assert.equal(textBackgroundPaddingPx(0.4, 60), 12);
  const box = resolveTextBackgroundBox({
    width: 200, height: 50, fontSize: 40,
    textBackgroundEnabled: true, textBackgroundColor: "#112233", textBackgroundOpacity: 0.5,
    textBackgroundAngleSize: 0.5, textBackgroundPaddingX: 1, textBackgroundPaddingY: 0.5,
  });
  assert.deepEqual(box, { x: -20, y: -10, width: 240, height: 70, radius: 14, fill: "#112233", opacity: 0.5 });
});

test("nothing is drawn when the box is off, colourless or fully transparent", () => {
  const on = { width: 10, height: 10, fontSize: 10, textBackgroundEnabled: true, textBackgroundColor: "#000" };
  assert.equal(resolveTextBackgroundBox({ ...on, textBackgroundEnabled: false }), null);
  assert.equal(resolveTextBackgroundBox({ ...on, textBackgroundColor: "" }), null);
  assert.equal(resolveTextBackgroundBox({ ...on, textBackgroundOpacity: 0 }), null);
  assert.ok(resolveTextBackgroundBox(on));
});

test("the radius never exceeds half the box, so a short line still reads as a pill", () => {
  const box = resolveTextBackgroundBox({
    width: 100, height: 10, fontSize: 10,
    textBackgroundEnabled: true, textBackgroundColor: "#000", textBackgroundAngleSize: 1,
  });
  assert.equal(box?.radius, 5);
});

test("Canva's Background effect converts to the same numbers the app reads", () => {
  // Measured off a Canva design: cream box, 11.39px corners, spread 13.1 × 3.5 at 32.6px text.
  const fields = textBackgroundFieldsFromPx({ color: "#e8e4de", radiusPx: 11.39, padXPx: 13.1, padYPx: 3.5, fontSize: 32.6 });
  assert.equal(fields.textBackgroundAngleSize, 0.407);
  assert.equal(fields.textBackgroundPaddingX, 0.804);
  assert.equal(fields.textBackgroundPaddingY, 0.215);
  // …and back: the editor draws what Canva drew.
  assert.ok(Math.abs(textBackgroundRadiusPx(fields.textBackgroundAngleSize) - 11.39) < 0.02);
  assert.ok(Math.abs(textBackgroundPaddingPx(fields.textBackgroundPaddingX, 32.6) - 13.1) < 0.02);
});
