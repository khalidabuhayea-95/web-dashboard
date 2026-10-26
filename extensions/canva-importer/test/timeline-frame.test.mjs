// A video page's elements are only mounted while the playhead is inside their timeline window, so
// the import captures the moment that shows the most of them, seeking Canva's ruler there. Both
// blocks are evaluated straight out of the shipped files between their marker comments.
//
// DAHNZc5myOk (12.4 s): the arch and petals at 0 s, flowers from 1–1.6 s, the invitation at 3.9 s,
// the names at 4.6 s, the last line at 5.9 s — captured at 0:00 the import kept 5 of 35 elements.
//
//   node --test extensions/canva-importer/test/timeline-frame.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const evaluate = (file, marker, exportsLine) => {
  const source = fs.readFileSync(path.join(here, "..", file), "utf8");
  const start = source.indexOf(`// ── ${marker}:start`);
  const end = source.indexOf(`// ── ${marker}:end`);
  assert.ok(start >= 0 && end > start, `${marker} markers missing`);
  const context = vm.createContext({});
  vm.runInContext(`${source.slice(start, end)}\n${exportsLine}`, context);
  return context;
};
const frameBlock = evaluate(
  "background.js",
  "canva-timeline-frame",
  "this.choose = chooseTimelineCaptureSeconds; this.frames = chooseTimelineCaptureFrames;"
);
const mergeBlock = evaluate("background.js", "canva-timeline-merge", "this.merge = mergeTimelineFrameCapture;");
const seekBlock = evaluate(
  "canva-fiber-main.js",
  "canva-timeline-seek",
  "this.label = timelineLabelSeconds; this.scale = timelineRulerScale; this.iso = isoDurationSeconds;"
);
const choose = (elements) => JSON.parse(JSON.stringify(frameBlock.choose(elements)));

const END = 12401347;
const at = (startSeconds) => ({ startUs: Math.round(startSeconds * 1e6), durationUs: END - Math.round(startSeconds * 1e6) });

test("a second after the last entrance, every element is on screen", () => {
  const elements = {
    LBlinen: at(0),
    LBarch: at(0),
    LBpetals: at(0),
    LBflowersA: at(1.166666),
    LBflowersB: at(1.008333),
    LBinvite: at(3.9),
    LBnames: at(4.6),
    LBlast: at(5.9),
    // Grouped children follow their group and do not vote.
    LBname1: { ...at(0), parentId: "LBnames" },
    __pageDurationMs: 12401,
  };
  const frame = choose(elements);
  assert.equal(frame.ids.length, 8);
  assert.equal(frame.total, 8);
  assert.ok(Math.abs(frame.seconds - 6.9) < 1e-9);
});

test("windows that never overlap: the busiest moment, earliest first", () => {
  const frame = choose({
    LBa: { startUs: 0, durationUs: 3e6 },
    LBb: { startUs: 0, durationUs: 3e6 },
    LBc: { startUs: 3e6, durationUs: 3e6 },
  });
  assert.deepEqual(frame.ids, ["LBa", "LBb"]);
  assert.ok(Math.abs(frame.seconds - 1) < 1e-9);
});

test("a short window is never overshot", () => {
  const frame = choose({ LBa: { startUs: 2e6, durationUs: 1e5 }, LBb: { startUs: 2e6, durationUs: 5e6 } });
  assert.ok(frame.seconds > 2 && frame.seconds < 2.1);
});

test("a design without timing is left alone", () => {
  assert.equal(frameBlock.choose({ LBa: { type: "rect" }, LBb: { type: "text" } }), null);
  assert.equal(frameBlock.choose({ LBa: at(0) }), null);
  assert.equal(frameBlock.choose(null), null);
});

test("ruler labels in Arabic and English", () => {
  assert.equal(seekBlock.label("0ث"), 0);
  assert.equal(seekBlock.label("10ث"), 10);
  assert.equal(seekBlock.label("20s"), 20);
  assert.equal(seekBlock.label("1:00"), 60);
  assert.equal(seekBlock.label("١٠ث"), 10);
  assert.equal(seekBlock.label("2.5s"), 2.5);
  assert.equal(seekBlock.label("27%"), null);
  assert.equal(seekBlock.label("Page 2"), null);
  assert.equal(seekBlock.label(""), null);
});

test("the ruler's px per second from its labels", () => {
  const scale = JSON.parse(
    JSON.stringify(
      seekBlock.scale([
        { seconds: 10, x: 256 },
        { seconds: 0, x: 16 },
        { seconds: 60, x: 1456 },
      ])
    )
  );
  assert.equal(scale.pxPerSecond, 24);
  assert.equal(scale.originX, 16);
  assert.equal(seekBlock.scale([{ seconds: 0, x: 16 }]), null);
  assert.equal(seekBlock.scale([{ seconds: 5, x: 16 }, { seconds: 5, x: 40 }]), null);
});

test("the playhead time Canva writes on <time datetime>", () => {
  assert.equal(seekBlock.iso("P0S"), 0);
  assert.equal(seekBlock.iso("P7S"), 7);
  assert.equal(seekBlock.iso("P12.4S"), 12.4);
  assert.equal(seekBlock.iso("PT1M5S"), 65);
  assert.equal(seekBlock.iso("P"), null);
  assert.equal(seekBlock.iso("12"), null);
});

// DAHNZVrSYZM (11 s) plays scenes: doors 0–2.54 s, a first card 3.23–6 s, the final card 6.1–11 s.
// Its busiest moment shows the final card only — the doors were lost (their pictures are their own).
const window = (startS, durationS) => ({ startUs: Math.round(startS * 1e6), durationUs: Math.round(durationS * 1e6) });
const scenes = {
  __pageDurationMs: 11000,
  LBdoorL: window(0, 2.541667),
  LBdoorR: window(0, 2.541667),
  LBring: window(1.041666, 1.500001),
  LBcard1a: window(3.229167, 2.770833),
  LBcard1b: window(3.229167, 2.770833),
  LBcard1c: window(3.229167, 2.770833),
  LBcard2a: window(6.125, 4.875),
  LBcard2b: window(6.125, 4.875),
  LBcard2c: window(6.125, 4.875),
  LBcard2d: window(6.125, 4.875),
  LBlogo: window(6, 5),
};
const frames = (elements) => JSON.parse(JSON.stringify(frameBlock.frames(elements)));

test("a page of scenes is captured at one moment per scene, busiest first", () => {
  const picked = frames(scenes);
  assert.equal(picked.length, 3);
  assert.deepEqual(picked[0].ids.sort(), ["LBcard2a", "LBcard2b", "LBcard2c", "LBcard2d", "LBlogo"]);
  // The other two scenes tie (three elements each); the earlier one comes first.
  assert.deepEqual(picked[1].ids.sort(), ["LBdoorL", "LBdoorR", "LBring"]);
  assert.deepEqual(picked[2].ids.sort(), ["LBcard1a", "LBcard1b", "LBcard1c"]);
  // The doors' moment is after the ring enters and before the doors leave.
  assert.ok(picked[1].seconds > 1.041666 && picked[1].seconds < 2.541667);
  const seen = new Set(picked.flatMap((frame) => frame.ids));
  assert.equal(seen.size, Object.keys(scenes).length - 1);
});

test("an element with a start and no duration runs to the page's end", () => {
  const picked = frames({ __pageDurationMs: 15000, LBa: { startUs: 0, durationUs: 15e6 }, LBlate: { startUs: 2333333 } });
  assert.equal(picked.length, 1);
  assert.deepEqual(picked[0].ids.sort(), ["LBa", "LBlate"]);
  assert.ok(picked[0].seconds > 2.333);
});

test("every element on screen at once: one frame", () => {
  const all = { __pageDurationMs: 12000, LBa: window(0, 12), LBb: window(1, 11), LBc: window(5.9, 6.1) };
  assert.equal(frames(all).length, 1);
});

const merge = (input) => JSON.parse(JSON.stringify(mergeBlock.merge(input)));
const z = { LBdoorL: 0, LBdoorR: 1, LBcard2a: 2, LBcard2b: 3 };

test("a moment's DOM capture replaces the main capture's model rebuild, in Canva's paint order", () => {
  const out = merge({
    objects: [
      { importNodeId: "layer-1" },
      { importNodeId: "LBcard2a" },
      { importNodeId: "LBdoorR", rebuilt: true },
      { importNodeId: "LBcard2b" },
    ],
    layers: [{ id: "LBcard2a" }, { id: "LBcard2b" }, { id: "LBdoorR", fromModel: true }],
    extraObjects: [
      { importNodeId: "layer-1" },
      { importNodeId: "LBdoorL" },
      { importNodeId: "LBdoorR" },
      { importNodeId: "LBdoorR__frame" },
      { importNodeId: "LBcard2a", rebuilt: true },
    ],
    extraLayers: [{ id: "LBdoorL" }, { id: "LBdoorR" }, { id: "LBdoorR__frame" }, { id: "LBcard2a", fromModel: true }],
    zOrderOf: (id) => (id in z ? z[id] : NaN),
  });
  assert.deepEqual(out.taken.sort(), ["LBdoorL", "LBdoorR"]);
  assert.deepEqual(
    out.objects.map((object) => `${object.importNodeId}${object.rebuilt ? "*" : ""}`),
    ["layer-1", "LBdoorL", "LBdoorR", "LBdoorR__frame", "LBcard2a", "LBcard2b"]
  );
  assert.deepEqual(out.layers.map((layer) => layer.id), ["LBcard2a", "LBcard2b", "LBdoorL", "LBdoorR", "LBdoorR__frame"]);
});

test("nothing new at that moment: the main capture stays as it was", () => {
  const objects = [{ importNodeId: "LBcard2a" }];
  const out = merge({
    objects,
    layers: [{ id: "LBcard2a" }],
    extraObjects: [{ importNodeId: "LBcard2a" }],
    extraLayers: [{ id: "LBcard2a" }],
    zOrderOf: () => NaN,
  });
  assert.deepEqual(out.taken, []);
  assert.deepEqual(out.objects, objects);
});
