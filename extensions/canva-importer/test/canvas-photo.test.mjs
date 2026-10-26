// A photo Canva paints into a <canvas> is captured from the canvas's pixels — unless they read back
// blank (a WebGL buffer already presented) or throw (tainted), when the screenshot crop stands in.
// DAHYjTZd758's full-page jewel frame was a 900×1600 canvas at import time and came in as a blank
// white shape. The block is evaluated straight out of canva-scraper.js between its marker comments.
//
//   node --test extensions/canva-importer/test/canvas-photo.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-canvas-photo:start");
const end = source.indexOf("// ── canva-canvas-photo:end");
assert.ok(start >= 0 && end > start, "canva-canvas-photo markers missing");

function load(probePixels, { throws = false, dataUrl = "data:image/png;base64,AAAA" } = {}) {
  const document = {
    createElement: () => ({
      getContext: () => ({
        drawImage: () => {
          if (throws) throw new Error("SecurityError");
        },
        getImageData: () => ({ data: probePixels }),
      }),
    }),
  };
  const context = vm.createContext({ document });
  vm.runInContext(`${source.slice(start, end)}\nthis.read = readCanvasPhotoDataUrl; this.blank = isBlankPixelData;`, context);
  return { read: () => context.read({ toDataURL: () => dataUrl }), blank: context.blank };
}

test("a canvas with visible pixels is captured", () => {
  const pixels = new Uint8ClampedArray(16 * 16 * 4);
  pixels[3] = 255;
  assert.equal(load(pixels).read(), "data:image/png;base64,AAAA");
});

test("a canvas that reads back fully transparent, or throws, gives nothing", () => {
  assert.equal(load(new Uint8ClampedArray(16 * 16 * 4)).read(), "");
  const pixels = new Uint8ClampedArray(16 * 16 * 4).fill(255);
  assert.equal(load(pixels, { throws: true }).read(), "");
  assert.equal(load(pixels, { dataUrl: "data:," }).read(), "");
});
