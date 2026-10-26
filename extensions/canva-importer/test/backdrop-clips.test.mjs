// A Canva video page's backdrop is a clip list, one per scene, and the clip restarts with each
// scene: one video object per clip, windowed to its scene, and a page as long as the scenes.
// Evaluated straight out of background.js between its marker comments.
//
// DAHNlJ_f8mI: six scenes (7417 + 5500 + 8583 + 10667 + 5830 + 6864 ms) over one 15 s clip.
//
//   node --test extensions/canva-importer/test/backdrop-clips.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "background.js"), "utf8");
const start = source.indexOf("// ── canva-backdrop-clips:start");
const end = source.indexOf("// ── canva-backdrop-clips:end");
assert.ok(start >= 0 && end > start, "canva-backdrop-clips markers missing");
const context = vm.createContext({});
vm.runInContext(
  `${source.slice(start, end)}\nthis.windows = canvaBackdropClipWindows; this.length = canvaVideoPageLengthMs;`,
  context
);

const video = { videoId: "VAE-9-_6QnQ" };
const scenes = [7417, 5500, 8583, 10667, 5830, 6864].map((durationMs) => ({ durationMs, video }));

test("six scenes on one clip: six windows back to back, the page their total", () => {
  const { windows, totalMs } = JSON.parse(JSON.stringify(context.windows(scenes)));
  assert.equal(totalMs, 44861);
  assert.deepEqual(
    windows.map((w) => [w.startMs, w.endMs]),
    [
      [0, 7417],
      [7417, 12917],
      [12917, 21500],
      [21500, 32167],
      [32167, 37997],
      [37997, 44861],
    ]
  );
  assert.ok(windows.every((w) => w.videoId === "VAE-9-_6QnQ"));
});

test("a colour-only scene has no window but keeps its time", () => {
  const { windows, totalMs } = JSON.parse(JSON.stringify(context.windows([{ durationMs: 3000, color: "#fff" }, { durationMs: 4000, video }])));
  assert.equal(totalMs, 7000);
  assert.deepEqual(windows.map((w) => [w.startMs, w.endMs]), [[3000, 7000]]);
  assert.equal(JSON.parse(JSON.stringify(context.windows(null))).windows.length, 0);
});

test("the page runs for the longest of clip, model page and scene total", () => {
  assert.equal(context.length(15000, 0, 44861), 44861);
  assert.equal(context.length(15000, 5000, 0), 15000);
  assert.equal(context.length(0, 5000, 0), 5000);
  assert.equal(context.length(0, 0, 0), 0);
  assert.equal(context.length("junk", null, undefined), 0);
});
