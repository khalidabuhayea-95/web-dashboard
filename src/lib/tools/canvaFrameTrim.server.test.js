import test from "node:test";
import assert from "node:assert/strict";

import {
  computeFrameTrimGeometry,
  isImportedCanvaFrameCandidate,
  measureVisibleAlphaBounds,
} from "./canvaFrameTrim.server.js";

test("measureVisibleAlphaBounds finds the tight alpha box", () => {
  const width = 4;
  const height = 3;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const setAlpha = (x, y, alpha) => {
    pixels[(y * width + x) * 4 + 3] = alpha;
  };

  setAlpha(1, 0, 255);
  setAlpha(2, 2, 255);

  assert.deepEqual(measureVisibleAlphaBounds(pixels, width, height), {
    minX: 1,
    minY: 0,
    maxX: 2,
    maxY: 2,
  });
});

test("computeFrameTrimGeometry shrinks the frame and keeps visible content in place", () => {
  const geometry = computeFrameTrimGeometry(
    {
      left: 100,
      top: 50,
      width: 400,
      height: 200,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
    },
    {
      minX: 40,
      minY: 20,
      maxX: 319,
      maxY: 179,
    },
    400,
    200
  );

  assert.ok(geometry);
  assert.equal(Math.round(geometry.left), 140);
  assert.equal(Math.round(geometry.top), 70);
  assert.equal(Math.round(geometry.width), 280);
  assert.equal(Math.round(geometry.height), 160);
  assert.equal(geometry.trimmedWidth, 280);
  assert.equal(geometry.trimmedHeight, 160);
});

test("isImportedCanvaFrameCandidate only matches image-backed frame layers", () => {
  assert.equal(
    isImportedCanvaFrameCandidate({
      layerType: "frame",
      frameContent: { kind: "image", src: "https://example.com/frame.png" },
    }),
    true
  );

  assert.equal(
    isImportedCanvaFrameCandidate({
      layerType: "frame",
      frameContent: { kind: "video", src: "https://example.com/frame.mp4" },
    }),
    false
  );
});
