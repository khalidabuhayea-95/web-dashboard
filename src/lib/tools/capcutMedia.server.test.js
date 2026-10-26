// CapCut media baked on import: photo crop and masks (rectangle, mirror), sticker GIF/WebP, effect overlays
// (video and image-sequence), video poster frames.
//
//   node --import tsx --test src/lib/tools/capcutMedia.server.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import sharp from "sharp";

import { runFfmpeg } from "../media/ffmpeg.server";
import {
  animatedGifInfo,
  capcutEffectOverlayWebp,
  capcutMaskMatte,
  capcutStickerWebp,
  cropCapcutImage,
  maskCapcutImage,
  videoPosterFrame,
} from "./capcutMedia.server.js";

// The paper card's mask in the real template: 82.4% × 97%, feather 0.159, corners 0.385.
const cardMask = {
  shape: "rectangle",
  width: 0.824227,
  height: 0.970426,
  centerX: 0,
  centerY: 0,
  rotation: 0,
  feather: 0.158618,
  roundCorner: 0.384869,
  invert: false,
};

async function solid(width, height) {
  return sharp({ create: { width, height, channels: 3, background: "#d8cfc0" } }).png().toBuffer();
}

async function alphaAt(png, x, y) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * 4 + 3];
}

// CapCut's own Rectangle mask shader: alpha = 1 − smoothstep(1 − 6f, 1 + 6f, r), r relative to
// each half-side of the box.
test("the matte follows CapCut's shader: a feather of 1 fades over six box sizes", () => {
  // The rings photo in the Arabic template: a 32.6% × 7.9% box, feather 1.
  const rings = { ...cardMask, width: 0.326479, height: 0.078893, feather: 1, roundCorner: 0 };
  const matte = capcutMaskMatte(rings, 720, 1280);
  const at = (x, y) => matte[y * 720 + x];
  // Centre r = 0: 1 − smoothstep(−5, 7, 0) = 0.624.
  assert.equal(at(360, 640), 159);
  // The photo's own side edge (r ≈ 3.06) still shows, faintly — as in CapCut's render.
  assert.ok(at(1, 640) > 55 && at(1, 640) < 75, `edge ${at(1, 640)}`);
  // A quarter of the height above the centre (r ≈ 6.3) is gone.
  assert.ok(at(360, 320) < 5, `above ${at(360, 320)}`);
});

test("without feather the matte is the box itself", () => {
  const box = { ...cardMask, width: 0.5, height: 0.5, feather: 0, roundCorner: 0 };
  const matte = capcutMaskMatte(box, 100, 100);
  assert.equal(matte[50 * 100 + 50], 255);
  assert.equal(matte[50 * 100 + 26], 255);
  assert.equal(matte[50 * 100 + 23], 0);
  // The inverse keeps the outside.
  const inverse = capcutMaskMatte({ ...box, invert: true }, 100, 100);
  assert.deepEqual([inverse[50 * 100 + 50], inverse[50 * 100 + 23]], [0, 255]);
});

test("baking keeps the middle opaque and fades the corners and edges", async () => {
  const out = await maskCapcutImage(await solid(560, 751), cardMask);
  assert.equal(await alphaAt(out, 280, 375), 255);
  // feather 0.159 → the edge band reaches ~95% of a half-side either way: soft, not gone.
  const corner = await alphaAt(out, 2, 2);
  const side = await alphaAt(out, 5, 375);
  assert.ok(corner < side && side < 200, `corner ${corner}, side ${side}`);
});

test("crop cuts the normalized rect from the real pixels", async () => {
  const out = await cropCapcutImage(await solid(500, 500), { x0: 0, y0: 0.443, x1: 0.485, y1: 1 });
  const { width, height } = await sharp(out).metadata();
  // Edges are rounded to pixels (221.5 → 222), so 500 − 222 = 278 rows.
  assert.deepEqual([width, height], [243, 278]);
});

test("an animated GIF reports its frames, loop length and a PNG poster", async () => {
  // Three 4×4 frames, 60 ms each, looping forever — like CapCut's sticker.
  const frames = await Promise.all(
    [10, 120, 240].map((value) =>
      sharp({ create: { width: 4, height: 4, channels: 4, background: { r: value, g: value, b: value, alpha: 1 } } }).png().toBuffer()
    )
  );
  const gif = await sharp(frames, { join: { animated: true } }).gif({ delay: [60, 60, 60], loop: 0 }).toBuffer();
  const info = await animatedGifInfo(gif);
  assert.equal(info.frameCount, 3);
  assert.equal(info.durationMs, 180);
  assert.equal(info.loop, true);
  const poster = await sharp(info.poster).metadata();
  assert.deepEqual([poster.format, poster.width, poster.height], ["png", 4, 4]);
});

// A zip like CapCut's sticker package (stored deflated, as the CDN serves it).
function zipOf(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = deflateRawSync(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

test("a CapCut sprite-sheet sticker becomes a lossless animated WebP with soft alpha kept", async () => {
  // 3 frames of 4×5 in a 12×5 sheet: red, green, then a half-transparent blue (the "glow").
  const cell = (r, g, b, alpha) => sharp({ create: { width: 4, height: 5, channels: 4, background: { r, g, b, alpha } } }).png().toBuffer();
  const sheet = await sharp({ create: { width: 12, height: 5, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: await cell(255, 0, 0, 1), left: 0, top: 0 },
      { input: await cell(0, 255, 0, 1), left: 4, top: 0 },
      { input: await cell(0, 0, 255, 0.5), left: 8, top: 0 },
    ])
    .png()
    .toBuffer();
  const frame = (index) => ({
    filename: `f_00${index}.png`,
    frame: { x: index * 4, y: 0, w: 4, h: 5 },
    sourceSize: { w: 4, h: 5 },
    spriteSourceSize: { x: 0, y: 0, w: 4, h: 5 },
    trimmed: false,
    rotated: false,
  });
  const zip = zipOf({
    "config.json": Buffer.from("{}"),
    // Listed out of order on purpose: frames play by file name.
    "ani_info.json": Buffer.from(JSON.stringify({ frames: [frame(2), frame(0), frame(1)], meta: { image: "SequenceMap.png" } })),
    "SequenceMap.png": sheet,
    "infoSticker.lua": Buffer.from("controller: setFps(16)"),
  });
  const sticker = await capcutStickerWebp(zip);
  assert.deepEqual([sticker.width, sticker.height, sticker.frameCount, sticker.durationMs], [4, 5, 3, 189]);
  const meta = await sharp(sticker.bytes, { animated: true }).metadata();
  assert.deepEqual([meta.format, meta.pages, meta.loop], ["webp", 3, 0]);
  assert.deepEqual(meta.delay, [63, 63, 63]);
  const poster = await sharp(sticker.poster).raw().toBuffer();
  assert.deepEqual([...poster.subarray(0, 4)], [255, 0, 0, 255]);
  // The third frame keeps its 50% alpha (a GIF could only keep it or drop it).
  const third = await sharp(sticker.bytes, { page: 2 }).ensureAlpha().raw().toBuffer();
  assert.ok(third[3] > 100 && third[3] < 155, `alpha ${third[3]}`);
});

test("a video's poster is the frame at its trim start", async () => {
  // One second: red for the first half, blue for the second.
  const dir = await mkdtemp(path.join(tmpdir(), "capcut-poster-test-"));
  try {
    const clip = path.join(dir, "clip.mp4");
    await runFfmpeg([
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "color=c=red:s=64x48:d=0.5:r=10",
      "-f", "lavfi", "-i", "color=c=blue:s=64x48:d=0.5:r=10",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]",
      "-pix_fmt", "yuv420p", clip,
    ]);
    const bytes = await readFile(clip);
    const pixel = async (seconds) => {
      const { data } = await sharp(await videoPosterFrame(bytes, seconds)).raw().toBuffer({ resolveWithObject: true });
      return [data[0], data[2]];
    };
    const [startRed, startBlue] = await pixel(0);
    assert.ok(startRed > 200 && startBlue < 60, `start ${startRed},${startBlue}`);
    const [laterRed, laterBlue] = await pixel(0.8);
    assert.ok(laterBlue > 200 && laterRed < 60, `0.8 s ${laterRed},${laterBlue}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an overlay effect's colour|alpha clip becomes a cropped, un-premultiplied animated WebP", async () => {
  // 1 s at 10 fps, 64×32: the left half is white premultiplied by 50% alpha (grey 128), the right
  // half is that alpha. The canvas is 1:2, so each 32² half is cut to its centre 16×32.
  const dir = await mkdtemp(path.join(tmpdir(), "capcut-overlay-test-"));
  try {
    const clip = path.join(dir, "fx.mp4");
    await runFfmpeg([
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "color=c=0x808080:s=64x32:d=1:r=10",
      // A dot moving along the alpha half's bottom row keeps every frame distinct (libwebp merges repeats).
      "-vf", "format=yuv444p,geq=lum='if(eq(Y,31)*eq(X,40+N),255,lum(X,Y))':cb=128:cr=128",
      "-pix_fmt", "yuv444p", "-c:v", "libx264", "-qp", "0", clip,
    ]);
    const zip = zipOf({ "AmazingFeature/resource/video/fx.mp4": await readFile(clip) });
    // Speed 2 → 50 ms a frame; the layer shows 100–400 ms of the effect's clock.
    const overlay = await capcutEffectOverlayWebp(zip, { aspect: 0.5, speed: 2, fromMs: 100, toMs: 400 });
    assert.deepEqual([overlay.width, overlay.height, overlay.frameCount, overlay.durationMs], [16, 32, 6, 300]);
    const meta = await sharp(overlay.bytes, { animated: true }).metadata();
    assert.deepEqual([meta.format, meta.pages], ["webp", 6]);
    const pixel = await sharp(overlay.poster).raw().toBuffer();
    assert.ok(pixel[0] > 245 && Math.abs(pixel[3] - 128) < 6, `rgba ${[...pixel.subarray(0, 4)]}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a mirror mask keeps a band of its height across the image (feather not ×6)", () => {
  const band = { shape: "mirror", width: 0.165637, height: 0.1, centerX: 0, centerY: 0, rotation: 0, feather: 0, roundCorner: 0, invert: false };
  const matte = capcutMaskMatte(band, 100, 200);
  const at = (x, y) => matte[y * 100 + x];
  // ±10% of the height around the middle: rows 90–109 kept, the full width.
  assert.deepEqual([at(2, 100), at(97, 95), at(50, 85), at(50, 115)], [255, 255, 0, 0]);
});

test("an image-sequence effect is cropped to the canvas, timed at 24 fps × speed, and screen-blended", async () => {
  // Four 40×20 frames of light on black and the shader line that says SCREEN.
  const frame = (value) => sharp({ create: { width: 40, height: 20, channels: 3, background: { r: value, g: value, b: 0 } } }).png().toBuffer();
  const files = { "AmazingFeature/xshader/CenterCrop.frag": Buffer.from("#define BLEND_MODE blendScreen\nvoid main(){}") };
  for (let index = 0; index < 4; index += 1) files[`AmazingFeature/image/a${index}.png`] = await frame(60 * (index + 1));
  // Out of order on purpose: frames play by their number.
  const zip = zipOf(Object.fromEntries(Object.entries(files).reverse()));
  const looped = await capcutEffectOverlayWebp(zip, { aspect: 0.5, speed: 0.5, loop: true, toMs: 60_000 });
  // 1:2 → the 40×20 frames are cut to their centre 10×20; 24 fps at half speed = 83 ms a frame.
  assert.deepEqual([looped.width, looped.height, looped.frameCount, looped.durationMs, looped.blendMode], [10, 20, 4, 333, "screen"]);
  const first = await sharp(looped.poster).raw().toBuffer();
  assert.deepEqual([...first.subarray(0, 4)], [60, 60, 0, 255]);
  // Not looping: cut to the window.
  const once = await capcutEffectOverlayWebp(zip, { aspect: 0.5, speed: 1, toMs: 100 });
  assert.deepEqual([once.frameCount, once.durationMs], [3, 100]);
});
