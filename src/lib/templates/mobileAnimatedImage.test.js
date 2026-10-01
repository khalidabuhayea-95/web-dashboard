/**
 * A Canva animated sticker (a looping GIF) reaches the app as an IMAGE layer whose `imageUri` is
 * the settled poster still, with the GIF itself under `animatedImage` — so a client that cannot
 * play GIFs renders exactly what it rendered before, and one that can loops the sticker in place.
 *
 *   node --import tsx --test src/lib/templates/mobileAnimatedImage.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import { toMobileTemplateDetailSlim } from "@/lib/templates/mobileProject";

const layersOf = (objects) =>
  toMobileTemplateDetailSlim(
    { id: "tpl", name: "bloom", canvasWidth: 1080, canvasHeight: 1080, data: { version: "7.0.0", objects } },
    {}
  ).project.layers;

const sticker = (overrides = {}) => ({
  type: "image",
  left: 120,
  top: 160,
  width: 497,
  height: 598,
  scaleX: 1.26,
  scaleY: 1.26,
  src: "https://cdn.example.com/bloom.gif",
  posterSrc: "https://cdn.example.com/bloom-poster.png",
  sourceWidth: 497,
  sourceHeight: 598,
  layerType: "image",
  importKind: "image",
  rasterPalette: ["#e39aa5", "#8fb3a0"],
  animatedImage: { kind: "gif", frameCount: 10, durationMs: 2500, loop: true },
  ...overrides,
});

test("an animated sticker ships the poster as imageUri and the GIF under animatedImage", () => {
  const [layer] = layersOf([sticker()]);
  assert.equal(layer.type, "IMAGE");
  assert.equal(layer.imageUri, "https://cdn.example.com/bloom-poster.png");
  assert.deepEqual(layer.animatedImage, {
    kind: "gif",
    uri: "https://cdn.example.com/bloom.gif",
    durationMs: 2500,
    frameCount: 10,
    loop: true,
  });
  // Never recolorable: a palette remap would bake the loop into one still frame.
  assert.equal(layer.colorEditMode, "none");
  assert.deepEqual(layer.rasterPalette, []);
  assert.equal(layer.rasterOriginalUri ?? null, null);
});

test("without a poster the GIF itself stays the imageUri (a GIF-capable client still animates it)", () => {
  const [layer] = layersOf([sticker({ posterSrc: "" })]);
  assert.equal(layer.imageUri, "https://cdn.example.com/bloom.gif");
  assert.equal(layer.animatedImage.uri, "https://cdn.example.com/bloom.gif");
});

test("a still image carries no animatedImage and keeps its palette", () => {
  const [layer] = layersOf([sticker({ animatedImage: undefined, src: "https://cdn.example.com/still.png" })]);
  assert.equal(layer.animatedImage, undefined);
  assert.equal(layer.imageUri, "https://cdn.example.com/still.png");
  assert.equal(layer.colorEditMode, "raster");
});
