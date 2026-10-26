// A captured clip must carry a picture. Canva serves a clip's picture and sound as separate files
// under one video id, and the capture once kept the sound one: DAHNlFf3ad4's arch "video" was a
// 4.8 KB file with a single `soun` track, so the frame stayed empty on the web (videoWidth 0).
// The block is evaluated straight out of background.js between its marker comments.
//
//   node --test extensions/canva-importer/test/mp4-tracks.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "background.js"), "utf8");
const start = source.indexOf("// ── canva-mp4-tracks:start");
const end = source.indexOf("// ── canva-mp4-tracks:end");
assert.ok(start >= 0 && end > start, "canva-mp4-tracks markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.kinds = readMp4TrackKinds;`, context);

// The moov box of a whole file (top-level walk, as readMp4MoovBox does on a blob).
function moovOf(file) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(here, "fixtures", file)));
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const size = ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "moov") return bytes.subarray(offset, offset + size);
    offset += size;
  }
  return null;
}
const kinds = (file) => Array.from(context.kinds(moovOf(file)));

test("the sound-only rendition Canva handed the capture has no picture track", () => {
  assert.deepEqual(kinds("canva-sound-only-rendition.mp4"), ["soun"]);
});

test("a real clip declares its picture track", () => {
  const found = kinds("tiny-video-with-sound.mp4");
  assert.ok(found.includes("vide"), found.join(","));
  assert.ok(found.includes("soun"), found.join(","));
});

test("garbage never throws", () => {
  assert.deepEqual(Array.from(context.kinds(new Uint8Array([0, 0, 0, 3, 1, 2, 3]))), []);
  assert.deepEqual(Array.from(context.kinds(new Uint8Array(0))), []);
});
