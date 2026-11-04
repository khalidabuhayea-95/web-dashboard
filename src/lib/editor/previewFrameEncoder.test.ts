/**
 * The frame-by-frame preview recorder (a background tab) ships VP8 in an IVF file to the server's
 * ffmpeg. Its layout was checked byte for byte against ffmpeg's own IVF muxer on 2026-11-01; these
 * pin the fields ffmpeg reads timing from.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildIvfFile } from "@/lib/editor/previewFrameEncoder";

async function bytesOf(blob: Blob) {
  return new DataView(await blob.arrayBuffer());
}

test("the IVF header carries the codec, size, 1/fps timebase and frame count", async () => {
  const view = await bytesOf(
    buildIvfFile(
      [
        { data: new Uint8Array([1, 2, 3]), pts: 0 },
        { data: new Uint8Array([4, 5]), pts: 1 },
      ],
      { width: 720, height: 1280, fps: 30 }
    )
  );
  const tag = (offset: number) =>
    String.fromCharCode(...[0, 1, 2, 3].map((index) => view.getUint8(offset + index)));
  assert.equal(tag(0), "DKIF");
  assert.equal(view.getUint16(4, true), 0);
  assert.equal(view.getUint16(6, true), 32);
  assert.equal(tag(8), "VP80");
  assert.equal(view.getUint16(12, true), 720);
  assert.equal(view.getUint16(14, true), 1280);
  assert.equal(view.getUint32(16, true), 30, "timebase denominator");
  assert.equal(view.getUint32(20, true), 1, "timebase numerator");
  assert.equal(view.getUint32(24, true), 2, "frame count");
  assert.equal(view.byteLength, 32 + (12 + 3) + (12 + 2));
});

test("each frame is its size, a 64-bit timestamp in frames, then its bytes", async () => {
  const view = await bytesOf(
    buildIvfFile(
      [
        { data: new Uint8Array([9, 8, 7]), pts: 0 },
        { data: new Uint8Array([6]), pts: 41 },
      ],
      { width: 64, height: 48, fps: 30 }
    )
  );
  assert.equal(view.getUint32(32, true), 3);
  assert.equal(view.getUint32(36, true), 0);
  assert.equal(view.getUint32(40, true), 0);
  assert.deepEqual([view.getUint8(44), view.getUint8(45), view.getUint8(46)], [9, 8, 7]);
  assert.equal(view.getUint32(47, true), 1);
  assert.equal(view.getUint32(51, true), 41);
  assert.equal(view.getUint32(55, true), 0);
  assert.equal(view.getUint8(59), 6);
});
