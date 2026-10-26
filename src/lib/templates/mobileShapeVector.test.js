/**
 * Simple template shapes (rect/circle/line/arrow/star) reach the app as SVG vectors, so a 1 px ring
 * on an A6 page isn't a box-sized PNG upscaled 3× on a phone.
 *
 *   node --import tsx --test src/lib/templates/mobileShapeVector.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import { toMobileTemplateDetailSlim } from "@/lib/templates/mobileProject";

const assetResolver = ({ scope, elementId, index, field }) =>
  `http://host/api/mobile/templates/tpl/assets?scope=${scope}&elementId=${elementId}&index=${index}&field=${field}`;

const layersOf = (objects, options = {}) =>
  toMobileTemplateDetailSlim(
    { id: "tpl", name: "a6", canvasWidth: 397, canvasHeight: 559, data: { version: "7.0.0", objects } },
    options
  ).project.layers;

const ring = {
  id: "ring",
  type: "circle",
  left: 133,
  top: 70,
  width: 132,
  height: 35,
  originX: "left",
  originY: "top",
  fill: "transparent",
  stroke: "#caba9c",
  strokeWidth: 1,
};

test("a template circle ships as a vector asset", () => {
  const [layer] = layersOf([ring], { assetResolver });
  assert.equal(layer.type, "IMAGE");
  assert.equal(layer.assetKind, "vector");
  assert.equal(layer.colorEditMode, "none");
  assert.match(layer.imageUri, /field=shape-vector&v=[0-9a-z]+$/);
  assert.equal(layer.frameWidth, 132);
  assert.equal(layer.frameHeight, 35);
});

test("a shape whose paint SVG can't express stays a PNG", () => {
  const [layer] = layersOf([{ ...ring, stroke: undefined, strokeWidth: 0, fill: { type: "linear" } }], { assetResolver });
  assert.match(layer.imageUri, /field=shape-raster$/);
  assert.equal(layer.assetKind, undefined);
});

test("with no asset server the inline PNG is kept", () => {
  const [layer] = layersOf([ring]);
  assert.match(layer.imageUri, /^data:image\/png;base64,/);
  assert.equal(layer.assetKind, undefined);
});
