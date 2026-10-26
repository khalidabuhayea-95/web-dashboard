// A Canva motion path is a RECORDED drag (`dts` ms between samples, `Hjd`/`Ijd` x/y deltas) that
// Canva PLAYS over `durationUs`, spreading that time over the samples by `easing`: 1 as recorded,
// 2 at constant speed, 5 constant speed easing in and out (its player: jUf / kUf / oUf, read from
// the bundle 2026-10-14). The decoder is evaluated straight out of canva-fiber-main.js between its
// marker comments; the other two copies must match it.
//
// DAHNZVrSYZM's doors: dragged away in 0.33 s / 0.54 s, played over 1.96 s / 1.18 s (easing 2);
// the recorded ms used to be the play time, and the right door's positive x deltas were even taken
// for the time array (it then "slid down" by the recorded ms).
//
//   node --test extensions/canva-importer/test/motion-path.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, "..", file), "utf8");
const source = read("canva-fiber-main.js");
const start = source.indexOf("// ── canva-motion-path:start");
const end = source.indexOf("// ── canva-motion-path:end");
assert.ok(start >= 0 && end > start, "canva-motion-path markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.decode = decodeMotionPath;`, context);
const decode = (track, windowMs) => JSON.parse(JSON.stringify(context.decode(track, windowMs)));

test("the three decoder copies are identical (modulo indentation)", () => {
  const body = (text) => {
    const from = text.indexOf("const decodeMotionPath = (track, windowMs) => {");
    assert.ok(from >= 0, "decoder missing");
    const indent = text.slice(text.lastIndexOf("\n", from) + 1, from);
    const to = text.indexOf(`\n${indent}};\n`, from);
    assert.ok(to > from, "decoder end missing");
    return text
      .slice(from, to)
      .split("\n")
      .map((line) => line.trim())
      .join("\n");
  };
  const main = body(source);
  assert.equal(body(read("background.js")), main, "background.js decoder drifted");
  assert.equal(body(read("canva-scraper.js")), main, "canva-scraper.js decoder drifted");
});

test("easing 2 spreads the play time by distance, from the element's resting place", () => {
  // Three samples: 100 px right in 10 ms, 300 px right in 10 ms, played over 1000 ms.
  const path = decode({ dts: [10, 10], Hjd: [100, 300], Ijd: [0, 0], easing: 2, durationUs: 1e6 });
  assert.deepEqual(path, [
    { t: 0, x: 0, y: 0 },
    { t: 250, x: 100, y: 0 },
    { t: 1000, x: 400, y: 0 },
  ]);
});

test("easing 1 keeps the recorded proportions, stretched to the play time", () => {
  const path = decode({ dts: [30, 10], Hjd: [100, 300], Ijd: [0, 0], easing: 1, durationUs: 2e6 });
  assert.deepEqual(path.map((p) => p.t), [0, 1500, 2000]);
});

test("the play time is capped by the element's window", () => {
  const path = decode({ dts: [10, 10], Hjd: [100, 100], Ijd: [0, 0], easing: 2, durationUs: 3e6 }, 2541);
  assert.equal(path[path.length - 1].t, 2541);
});

test("positive x deltas are never mistaken for the time array", () => {
  // The right door: every x delta positive, no y motion — on the old sign heuristic the x deltas
  // (sum closest to the duration) became the time axis and the recorded ms the y travel.
  const path = decode({ dts: [8, 11, 31], Hjd: [12, 12, 11], Ijd: [0, 0, 0], easing: 2, durationUs: 1178000 });
  assert.deepEqual(path.map((p) => [p.x, p.y]), [[0, 0], [12, 0], [24, 0], [35, 0]]);
  assert.equal(path[path.length - 1].t, 1178);
});

test("the older deploy's names still decode", () => {
  const path = decode({ Rkd: [20, 20], eGd: [0, 0], gGd: [-50, -50], easing: 1, durationUs: 1e6 });
  assert.deepEqual(path, [
    { t: 0, x: 0, y: 0 },
    { t: 500, x: 0, y: -50 },
    { t: 1000, x: 0, y: -100 },
  ]);
});

test("easing 5 moves slowest at the ends", () => {
  const deltas = Array.from({ length: 20 }, () => 100);
  const path = decode({ dts: deltas.map(() => 10), Hjd: deltas, Ijd: deltas.map(() => 0), easing: 5, durationUs: 2e6 });
  const first = path[1].t - path[0].t;
  const middle = path[10].t - path[9].t;
  const last = path[path.length - 1].t - path[path.length - 2].t;
  assert.ok(first > middle && last > middle, `${first} ${middle} ${last}`);
  assert.equal(path[path.length - 1].t, 2000);
});

test("a path that goes nowhere, or has one sample, is no path", () => {
  assert.equal(context.decode({ dts: [10, 10], Hjd: [0, 1], Ijd: [0, 0], easing: 2, durationUs: 1e6 }), null);
  assert.equal(context.decode({ dts: [10], Hjd: [100], Ijd: [0], easing: 2, durationUs: 1e6 }), null);
  assert.equal(context.decode(null), null);
});

test("the 2026-10-19 deploy's names (Dkd / Ekd) decode as x / y", () => {
  const path = decode({ Dkd: [100, 100], Ekd: [0, 10], dts: [10, 10], easing: 2 });
  assert.equal(path[path.length - 1].x, 200);
  assert.equal(path[path.length - 1].y, 10);
});
