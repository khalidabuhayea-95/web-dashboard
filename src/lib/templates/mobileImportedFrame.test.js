/**
 * A Canva photo in a shaped frame (arch, dome…) reaches the app as a FRAME layer.
 *
 * The importer stores it as a fabric IMAGE object that carries a `frameShape` polygon (points in
 * 0..100 of the box, from the extension's detectClipPathFrameMask) with the photo in its own `src`.
 * Without the frameShape the same object is a plain rectangle IMAGE, which is how every shaped
 * photo arrived before 2026-09-29.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveFrameContent, toMobileTemplateDetailSlim } from "@/lib/templates/mobileProject";

const ARCH = [100, 50, 100, 100, 0, 100, 0, 50, 10, 20, 50, 0, 90, 20];

const importedPhoto = (overrides = {}) => ({
  type: "image",
  left: 241,
  top: 397,
  width: 450,
  height: 800,
  scaleX: 1.4,
  scaleY: 1.4,
  src: "https://cdn.example.com/kuwait-towers.png",
  sourceWidth: 450,
  sourceHeight: 800,
  layerType: "image",
  importKind: "image",
  ...overrides,
});

const layersOf = (objects) =>
  toMobileTemplateDetailSlim(
    { id: "tpl", name: "frame", canvasWidth: 1080, canvasHeight: 1920, data: { version: "7.0.0", objects } },
    { assetResolver: ({ field, index }) => `https://assets.example/${index}/${field}` }
  ).project.layers;

test("an imported photo with a clip-path polygon ships as a FRAME with that polygon", () => {
  const [layer] = layersOf([importedPhoto({ frameShape: { presetId: "canva-clip-path", kind: "polygon", points: ARCH } })]);
  assert.equal(layer.type, "FRAME");
  assert.equal(layer.shape.kind, "polygon");
  assert.deepEqual(
    layer.shape.points.map(({ x, y }) => [x, y]),
    [[100, 50], [100, 100], [0, 100], [0, 50], [10, 20], [50, 0], [90, 20]]
  );
  assert.equal(layer.content.type, "IMAGE");
  assert.equal(layer.content.imageUri, "https://assets.example/0/frameContent.preview");
});

test("the frame's photo is the object's own src, so a re-uploaded src never goes stale", () => {
  const content = resolveFrameContent(importedPhoto({ frameShape: { kind: "polygon", points: ARCH } }));
  assert.equal(content.src, "https://cdn.example.com/kuwait-towers.png");
  assert.equal(content.sourceWidth, 450);
  assert.equal(content.sourceHeight, 800);
});

test("the same photo without a frameShape stays a plain IMAGE", () => {
  const [layer] = layersOf([importedPhoto()]);
  assert.equal(layer.type, "IMAGE");
  assert.equal(resolveFrameContent(importedPhoto()), null);
});
