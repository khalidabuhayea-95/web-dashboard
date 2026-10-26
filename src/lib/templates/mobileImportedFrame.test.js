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

test("a video-filled element (video object + frameShape) is a FRAME whose content is the clip, poster first", () => {
  const video = importedPhoto({
    type: "video",
    layerType: "video",
    importKind: "video",
    src: "https://cdn.example.com/kaaba.mp4",
    thumbnailUri: "https://cdn.example.com/kaaba-poster.png",
    videoStart: 0,
    videoEnd: 5,
    videoDuration: 5,
    frameShape: { presetId: "canva-clip-path", kind: "polygon", points: ARCH },
  });
  const content = resolveFrameContent(video);
  assert.equal(content.kind, "video");
  assert.equal(content.src, "https://cdn.example.com/kaaba.mp4");
  assert.equal(content.posterSrc, "https://cdn.example.com/kaaba-poster.png");
  assert.equal(content.videoDuration, 5);
  const [layer] = layersOf([video]);
  assert.equal(layer.type, "FRAME");
  assert.equal(layer.shape.kind, "polygon");
  // The clip itself plays in the frame (a poster-only preview exported as an empty frame).
  assert.equal(layer.content.type, "VIDEO");
  assert.equal(layer.content.previewOnly, false);
  assert.match(layer.content.videoUri, /kaaba\.mp4$/);
  assert.match(layer.content.thumbnailUri, /kaaba-poster\.png$/);
});

test("a framed video is cover-fitted in the app's own scale (source x scale), not stretched or zoomed", () => {
  // DAHNlFf3ad4's chandelier: a 1920x1080 clip in a 520x733 arch.
  const video = importedPhoto({
    type: "video",
    layerType: "video",
    src: "https://cdn.example.com/chandelier.mp4",
    width: 520,
    height: 733,
    scaleX: 1,
    scaleY: 1,
    sourceWidth: 1920,
    sourceHeight: 1080,
    videoDuration: 8.456,
    videoEnd: 8.456,
    frameShape: { presetId: "canva-clip-path", kind: "polygon", points: ARCH },
  });
  const [layer] = layersOf([video]);
  assert.equal(layer.content.type, "VIDEO");
  assert.equal("thumbnailUri" in layer.content, false, "the .mp4 is no thumbnail");
  assert.equal(layer.contentTransform.fit, "manual");
  assert.ok(Math.abs(layer.contentTransform.scale - 733 / 1080) < 1e-4, String(layer.contentTransform.scale));
  // A web frame that contains its clip keeps the whole clip inside.
  const [contained] = layersOf([{ ...video, frameContentTransform: { fit: "contain", scale: 1 } }]);
  assert.ok(Math.abs(contained.contentTransform.scale - 520 / 1920) < 1e-4);
  // A manual transform is passed through untouched.
  const [manual] = layersOf([{ ...video, frameContentTransform: { fit: "manual", scale: 0.5, offsetX: 10 } }]);
  assert.deepEqual(manual.contentTransform, { fit: "manual", scale: 0.5, offsetX: 10, offsetY: 0 });
});
