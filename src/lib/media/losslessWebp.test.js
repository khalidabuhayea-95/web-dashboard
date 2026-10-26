/**
 * Element PNGs are stored as lossless WebP: every visible pixel and the alpha survive exactly.
 *
 *   node --import tsx --test src/lib/media/losslessWebp.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { convertPngToLosslessWebp } from "@/lib/media/losslessWebp.server";

async function makePng(width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      pixels[i] = (x * 7) % 256;
      pixels[i + 1] = (y * 5) % 256;
      pixels[i + 2] = ((x + y) * 3) % 256;
      // A soft edge plus fully transparent corners, like a cut-out sticker.
      pixels[i + 3] = x < 8 || y < 8 ? 0 : Math.min(255, x * 4);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

const rgba = async (bytes) => (await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;

test("a PNG becomes a smaller WebP with identical visible pixels and alpha", async () => {
  const png = await makePng(160, 120);
  const result = await convertPngToLosslessWebp(png);
  assert.equal(result.converted, true);
  assert.equal(result.mimeType, "image/webp");
  assert.ok(result.bytes.length < png.length);
  const [a, b] = await Promise.all([rgba(png), rgba(result.bytes)]);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i += 4) {
    assert.equal(b[i + 3], a[i + 3], "alpha");
    if (a[i + 3] === 0) continue;
    assert.deepEqual([b[i], b[i + 1], b[i + 2]], [a[i], a[i + 1], a[i + 2]]);
  }
});

test("GIFs and JPEGs are left as they are", async () => {
  const gif = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#f00" } }).gif().toBuffer();
  const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#0f0" } }).jpeg().toBuffer();
  for (const bytes of [gif, jpeg]) {
    const result = await convertPngToLosslessWebp(bytes);
    assert.equal(result.converted, false);
    assert.equal(result.reason, "not-png");
    assert.equal(result.bytes, bytes);
  }
});

test("empty or unreadable input is not converted", async () => {
  assert.equal((await convertPngToLosslessWebp(Buffer.alloc(0))).converted, false);
  assert.equal((await convertPngToLosslessWebp(Buffer.from("not an image"))).converted, false);
});
