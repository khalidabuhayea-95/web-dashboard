/**
 * Turning a frame back into a plain layer keeps the media exactly where the frame showed it.
 *
 *   node --import tsx --test src/lib/editor/frames.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  frameStrokeWidthForMediaBorder,
  mediaBorderWidthForFrameStroke,
  resolveFrameMediaAsLayerBox,
} from "@/lib/editor/frames";

const close = (actual: number, expected: number, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≉ ${expected}`);

test("a cover-fitted photo: the frame box, cropped to what it showed", () => {
  // 1200x800 photo cover-fitted into a 300x300 frame: scale 0.375 → 450x300, centred → x -75.
  const box = resolveFrameMediaAsLayerBox(300, 300, 1200, 800, { fit: "cover", scale: 1, offsetX: 0, offsetY: 0 });
  assert.ok(box);
  assert.deepEqual([box.localX, box.localY, box.width, box.height], [0, 0, 300, 300]);
  close(box.crop.x, 200);
  close(box.crop.y, 0);
  close(box.crop.width, 800);
  close(box.crop.height, 800);
});

test("a contain-fitted photo: the layer is the photo's own rect, uncropped", () => {
  const box = resolveFrameMediaAsLayerBox(300, 300, 1200, 800, { fit: "contain", scale: 1, offsetX: 0, offsetY: 0 });
  assert.ok(box);
  assert.deepEqual([box.localX, box.localY, box.width, box.height], [0, 50, 300, 200]);
  assert.deepEqual(box.crop, { x: 0, y: 0, width: 1200, height: 800 });
});

test("a layer converted to a frame with its crop converts back to the same crop", () => {
  // convertMediaElementToFrame on a 400x200 layer showing crop (100, 50, 800, 400) of a 1000x600
  // source: scale 0.5, offsets -100*0.5-(400-500)/2 = 0 and -50*0.5-(200-300)/2 = 25.
  const box = resolveFrameMediaAsLayerBox(400, 200, 1000, 600, { fit: "manual", scale: 0.5, offsetX: 0, offsetY: 25 });
  assert.ok(box);
  assert.deepEqual([box.localX, box.localY, box.width, box.height], [0, 0, 400, 200]);
  close(box.crop.x, 100);
  close(box.crop.y, 50);
  close(box.crop.width, 800);
  close(box.crop.height, 400);
});

test("media panned wholly outside the frame has nothing to show", () => {
  assert.equal(resolveFrameMediaAsLayerBox(300, 300, 600, 600, { fit: "manual", scale: 1, offsetX: 1000, offsetY: 0 }), null);
});

test("a media border converts to the frame stroke that shows the same ring", () => {
  // The travel post's round photo: 12 px white border on a layer scaled 0.61. The frame shows only
  // the inner half of a stroke that scales with the layer, so it needs 2 × 12 / 0.61.
  close(frameStrokeWidthForMediaBorder(12, 0.6108, 0.6100), 24 / 0.6104, 1e-3);
  assert.equal(frameStrokeWidthForMediaBorder(12, 1, 1), 24);
  // Flips are scale signs, not sizes; a missing scale is 1; no border stays no border.
  assert.equal(frameStrokeWidthForMediaBorder(10, -1, 1), 20);
  assert.equal(frameStrokeWidthForMediaBorder(10, undefined, undefined), 20);
  assert.equal(frameStrokeWidthForMediaBorder(0, 0.5, 0.5), 0);
  assert.equal(frameStrokeWidthForMediaBorder(undefined, 0.5, 0.5), 0);
});

test("frame stroke → media border is the exact inverse", () => {
  const frameStroke = frameStrokeWidthForMediaBorder(12, 0.6108, 0.61);
  close(mediaBorderWidthForFrameStroke(frameStroke, 0.6108, 0.61), 12);
  assert.equal(mediaBorderWidthForFrameStroke(24, 1, 1), 12);
  assert.equal(mediaBorderWidthForFrameStroke(0, 1, 1), 0);
});
