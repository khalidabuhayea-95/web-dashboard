/**
 * The canvas clamp must carry the layers with it. A 1587×2245 Canva poster is clamped to a
 * 1357×1920 canvas; before scaleFabricDataToCanvas existed the stored objects kept their page
 * pixels, so the name box (top 2086) sat below a 1920-px page and the title (left 355, width 877)
 * sat off centre. Run: node --import tsx --test src/lib/tools/canvaImportScale.server.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeCanvasInput,
  resolveImportCanvasScale,
  scaleEditorDataLayerTree,
  scaleFabricDataToCanvas,
  scaleFabricObjectToCanvas,
} from "@/lib/tools/canvaImportTemplate";

const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

const posterDimensions = () =>
  normalizeCanvasInput({ width: 1587, height: 2245, sourceWidth: 1587, sourceHeight: 2245, maxDimension: 1920 });

test("a page that fits the clamp yields no scale, so the payload passes through untouched", () => {
  const dims = normalizeCanvasInput({ width: 1080, height: 1920, sourceWidth: 1080, sourceHeight: 1920 });
  assert.equal(resolveImportCanvasScale(dims), null);
  const fabricData = { version: "7.0.0", objects: [{ type: "image", left: 10, top: 20, scaleX: 2 }] };
  assert.equal(scaleFabricDataToCanvas(fabricData, null), fabricData);
  assert.equal(scaleEditorDataLayerTree({ layerTree: [] }, null).layerTree.length, 0);
  assert.equal(resolveImportCanvasScale({ canvasWidth: 0, canvasHeight: 10, sourceWidth: 10, sourceHeight: 10 }), null);
});

test("a clamped poster scales positions, sizes and pixel fields by the clamp factor", () => {
  const dims = posterDimensions();
  assert.deepEqual([dims.canvasWidth, dims.canvasHeight], [1357, 1920]);
  const scale = resolveImportCanvasScale(dims);
  const factor = 1920 / 2245;
  close(scale.sy, factor);
  close(scale.sx, 1357 / 1587);
  close(scale.uniform, Math.min(scale.sx, scale.sy));

  const fabricData = {
    version: "7.0.0",
    backgroundColor: "#af6135",
    objects: [
      {
        type: "textbox",
        left: 354.96,
        top: 158.85,
        width: 877,
        height: 452,
        scaleX: 1,
        scaleY: -1,
        fontSize: 197.97,
        charSpacing: 10,
        lineHeight: 1.0858,
        textBackgroundRadius: 12,
        shadowBlur: 8,
        shadowOffsetX: 4,
        shadowOffsetY: 6,
      },
      {
        type: "image",
        left: -247.25,
        top: 746.82,
        width: 1600,
        height: 1266,
        scaleX: 1.300625,
        scaleY: 1.326224,
        cropX: 12,
        cropWidth: 900,
        sourceWidth: 1600,
        sourceHeight: 1266,
        mediaCornerRadius: 0.25,
        mediaBlur: 10,
        cornerRadius: 40,
        animations: {
          entrance: { type: "TUMBLE", durationMs: 500, params: { xh: 3, startRotation: -120, travelX: 800, travelY: -300 } },
          loop: { type: "BREATHE", params: { concurrent: 1, y1From: 0, y1To: -20, y2To: 10, seed: 0.42 } },
          exit: null,
        },
      },
      { type: "rect", left: 483.99, top: 2086.15, width: 619, height: 215, scaleX: 1, scaleY: 1, rx: 47, ry: 47, strokeWidth: 3 },
      { type: "circle", left: 100, top: 100, radius: 50, scaleX: 1, scaleY: 1 },
      { type: "path", left: 5, top: 5, width: 100, height: 40, scaleX: 2, scaleY: 3, path: [["M", 0, 0]] },
      { type: "line", left: 0, top: 0, x1: 0, y1: 0, x2: 952, y2: 0, strokeWidth: 13 },
    ],
  };
  const scaled = scaleFabricDataToCanvas(fabricData, scale);
  assert.notEqual(scaled, fabricData);
  assert.equal(scaled.backgroundColor, "#af6135");
  assert.equal(fabricData.objects[0].fontSize, 197.97, "input objects are not mutated");

  const [text, image, rect, circle, path, line] = scaled.objects;
  close(text.left, 354.96 * scale.sx);
  close(text.top, 158.85 * scale.sy);
  close(text.width, 877 * scale.sx);
  close(text.height, 452 * scale.sy);
  close(text.fontSize, 197.97 * scale.uniform);
  assert.equal(text.scaleX, 1, "text scales stay sign-only");
  assert.equal(text.scaleY, -1, "text scales stay sign-only");
  assert.equal(text.charSpacing, 10, "charSpacing is em-relative");
  assert.equal(text.lineHeight, 1.0858, "lineHeight is a ratio");
  close(text.textBackgroundRadius, 12 * scale.uniform);
  close(text.shadowBlur, 8 * scale.uniform);
  close(text.shadowOffsetX, 4 * scale.uniform);
  close(text.shadowOffsetY, 6 * scale.uniform);

  close(image.left, -247.25 * scale.sx);
  close(image.scaleX, 1.300625 * scale.sx);
  close(image.scaleY, 1.326224 * scale.sy);
  assert.equal(image.width, 1600, "intrinsic size is the source bitmap");
  assert.equal(image.cropX, 12, "crop rects are source pixels");
  assert.equal(image.cropWidth, 900);
  assert.equal(image.sourceWidth, 1600);
  assert.equal(image.mediaCornerRadius, 0.25, "corner ratio is not a pixel value");
  close(image.mediaBlur, 10 * scale.uniform);
  close(image.cornerRadius, 40 * scale.uniform);
  close(image.animations.entrance.params.travelX, 800 * scale.sx);
  close(image.animations.entrance.params.travelY, -300 * scale.sy);
  assert.equal(image.animations.entrance.params.startRotation, -120, "degrees pass through");
  assert.equal(image.animations.entrance.params.xh, 3);
  assert.equal(image.animations.entrance.durationMs, 500, "time passes through");
  close(image.animations.loop.params.y1To, -20 * scale.sy);
  close(image.animations.loop.params.y2To, 10 * scale.sy);
  assert.equal(image.animations.loop.params.seed, 0.42, "the Canva hash seed is not a pixel value");
  assert.equal(image.animations.loop.params.concurrent, 1);
  assert.equal(image.animations.exit, null);

  close(rect.top, 2086.15 * scale.sy);
  // In Canva the name box overhangs the page bottom (2086 + 215 > 2245); the clamped copy must
  // overhang by the same proportion instead of sitting wholly below a 1920-px page.
  assert.ok(rect.top < 1920, "the name box top lands inside the clamped page");
  close((rect.top + rect.height) / 1920, (2086.15 + 215) / 2245, 1e-6);
  close(rect.width, 619 * scale.sx);
  close(rect.height, 215 * scale.sy);
  close(rect.rx, 47 * scale.uniform);
  close(rect.ry, 47 * scale.uniform);
  close(rect.strokeWidth, 3 * scale.uniform);
  assert.equal(rect.scaleX, 1);

  close(circle.radius, 50 * scale.uniform);
  assert.equal(circle.scaleX, 1);

  close(path.scaleX, 2 * scale.sx);
  close(path.scaleY, 3 * scale.sy);
  assert.equal(path.width, 100, "path geometry stays intrinsic");
  assert.deepEqual(path.path, [["M", 0, 0]]);

  close(line.x2, 952 * scale.sx);
  close(line.strokeWidth, 13 * scale.uniform);
});

test("an object without scale fields gets explicit scales, and unknown fields pass through", () => {
  const scale = resolveImportCanvasScale(posterDimensions());
  const scaled = scaleFabricObjectToCanvas({ type: "video", left: 1, top: 2, custom: "keep", opacity: 0.5 }, scale);
  close(scaled.scaleX, scale.sx);
  close(scaled.scaleY, scale.sy);
  assert.equal(scaled.custom, "keep");
  assert.equal(scaled.opacity, 0.5);
});

test("layer-tree bounds follow the objects into the clamped canvas", () => {
  const scale = resolveImportCanvasScale(posterDimensions());
  const editorData = {
    page: { width: 1587, height: 2245 },
    layerTree: [
      { id: "LB1", bounds: { x: 317.69, y: 651.77, width: 952, height: 13 } },
      { id: "LB2", name: "no bounds" },
      null,
    ],
  };
  const scaled = scaleEditorDataLayerTree(editorData, scale);
  close(scaled.layerTree[0].bounds.x, 317.69 * scale.sx);
  close(scaled.layerTree[0].bounds.y, 651.77 * scale.sy);
  close(scaled.layerTree[0].bounds.width, 952 * scale.sx);
  close(scaled.layerTree[0].bounds.height, 13 * scale.sy);
  assert.deepEqual(scaled.layerTree[1], { id: "LB2", name: "no bounds" });
  assert.equal(scaled.layerTree[2], null);
  assert.equal(scaled.page.width, 1587, "the metadata page keeps reporting the source size; the route records both");
  assert.equal(editorData.layerTree[0].bounds.x, 317.69, "input is not mutated");
});
