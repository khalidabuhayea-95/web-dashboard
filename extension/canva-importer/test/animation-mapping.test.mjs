// Canva → editor animation import (docs/canva-animation-parity.md §8.5), end to end from the raw
// Canva model: the extraction block shared by the three fiber walks, then Canva's scheduler as
// ported into background.js's mapping block. Both are evaluated straight out of the worker
// sources between their marker comments, so the test always exercises the code that ships.
//
// Every timing expectation below is written from Canva's own formulas (the comment next to it
// shows the arithmetic): Kwf / dsi / esi / Yrf / ksf / vrf for the default windows, Gwf for custom
// speeds, xrf / wrf (and luf's Wipe variant) for the builders' own fit, Kyf for page presets.
//
//   node --test extension/canva-importer/test/animation-mapping.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(here, "..");
const read = (file) => fs.readFileSync(path.join(extensionRoot, file), "utf8");

function sliceBetweenMarkers(source, name, file) {
  const markerStart = source.indexOf(`// ── ${name}:start`);
  const end = source.indexOf(`// ── ${name}:end`);
  assert.ok(markerStart >= 0 && end > markerStart, `${file}: ${name} markers missing`);
  // From the start of the marker's LINE, so the block's indentation is uniform and dedentable.
  const start = source.lastIndexOf("\n", markerStart) + 1;
  return source.slice(start, end);
}

function dedent(block) {
  const lines = block.split("\n");
  const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)[0].length);
  const common = Math.min(...indents);
  return lines.map((line) => line.slice(Math.min(common, line.match(/^\s*/)[0].length))).join("\n");
}

const EXTRACT_FILES = ["canva-fiber-main.js", "background.js", "canva-scraper.js"];
const extractBlocks = Object.fromEntries(
  EXTRACT_FILES.map((file) => [file, dedent(sliceBetweenMarkers(read(file), "canva-animation-extract", file))])
);

function loadExtraction(file = "canva-fiber-main.js") {
  const prelude = `
    const usToMs = (us) => (Number.isFinite(Number(us)) && Number(us) > 0 ? Math.round(Number(us) / 1000) : undefined);
    const decodeMotionPath = () => null;
  `;
  return vm.runInNewContext(
    `${prelude}\n${extractBlocks[file]}\n;({ extractAnimation, extractRepeating, readScheduleFacts, readAnimationEntry, collectCanvaElements, readPageAnimation, readPageSize, readPageDurationUs, listCanvaPages });`,
    {}
  );
}

function loadMapping() {
  const block = sliceBetweenMarkers(read("background.js"), "canva-animation-mapping", "background.js");
  return vm.runInNewContext(
    `${block}\n;({ CANVA_ANIMATION_PRESET_TO_TYPE, CANVA_PAGE_ANIMATION_PRESET_TO_TYPE, buildEditorAnimationFields, buildCanvaAnimationSlots, applyCanvaPageAnimations, scheduleCanvaPage, describeCanvaPageModel, canvaDefaultWindows, canvaRepeatingCycleMs, drainCanvaAnimationImportWarnings });`,
    {}
  );
}

const extractions = Object.fromEntries(EXTRACT_FILES.map((file) => [file, loadExtraction(file)]));
const extraction = extractions["canva-fiber-main.js"];
const mapping = loadMapping();
// Objects born inside the VM carry that realm's prototypes, which strict deepEqual rejects —
// round-trip through JSON so the comparisons look at the data alone (the model also crosses
// executeScript's serialization this way, so undefined keys vanish exactly as they do live).
const plain = (value) => JSON.parse(JSON.stringify(value));

/** A raw Canva element as the fiber walk sees it: UNTIMED unless startUs / durationUs are given. */
function element(id, animation, extra = {}) {
  return {
    id,
    type: "rect",
    left: 100,
    top: 100,
    width: 200,
    height: 100,
    ...(animation === undefined ? {} : { animation }),
    ...extra,
  };
}
const text = (id, animation, extra = {}) => element(id, animation, { type: "text", ...extra });

/** The page model one walk hands background.js: the element map (as the walks build it) + page facts. */
function pageModel(rawElements, { pageWidth = 1080, pageHeight = 1920, pageDurationMs = 5000, page = null, fill = null } = {}) {
  const model = {};
  let zOrder = 0;
  for (const { el, parentId } of extraction.collectCanvaElements(rawElements)) {
    if (!/^LB/.test(String(el.id || ""))) continue;
    model[el.id] = {
      zOrder: zOrder++,
      type: el.type,
      left: el.left,
      top: el.top,
      width: el.width,
      height: el.height,
      rotation: el.rotation || 0,
      ...extraction.readAnimationEntry(el, parentId),
      text: el.type === "text" ? { plaintext: "text" } : null,
    };
  }
  model.__pageWidth = pageWidth;
  model.__pageHeight = pageHeight;
  model.__pageDurationMs = pageDurationMs;
  if (page) {
    const pageAnimation = extraction.readPageAnimation(page);
    if (pageAnimation) model.__pageAnimation = pageAnimation;
  }
  if (fill) model.__pageFill = fill;
  return plain(model);
}

/**
 * Runs one page end to end: raw elements → model (walk) → Canva's scheduler → fabric fields.
 * Returns the fabric objects by id (every LB element gets an object, as the capture would).
 */
function importPage(rawElements, options = {}) {
  const model = pageModel(rawElements, options);
  const ids = Object.keys(model).filter((id) => !id.startsWith("__"));
  const objects = ids.map((id) => ({ importNodeId: id }));
  const layers = ids.map((id) => ({ id, kind: model[id].type === "text" ? "text" : "image", animation: model[id].animation }));
  if (options.backgroundObject) {
    objects.push({ importNodeId: "bg", ...options.backgroundObject });
    layers.push({ id: "bg", kind: "image", isFullPageBackground: true });
  }
  const result = mapping.applyCanvaPageAnimations(objects, layers, model, {
    hasNextPage: Boolean(options.hasNextPage),
    ...(options.overridePageMs ? { pageDurationMs: options.overridePageMs } : {}),
  });
  const out = Object.fromEntries(plain(objects).map((object) => [object.importNodeId, object]));
  Object.defineProperty(out, "__result", { value: plain(result), enumerable: false });
  return out;
}

const slot = (type, durationMs, extra = {}) => ({
  type,
  infinite: false,
  durationMs,
  delayMs: 0,
  direction: "DEFAULT",
  intensity: 1,
  ...extra,
});
const windowOf = (object) => [object.timelineStartMs, object.timelineEndMs];
const legs = (object) => ({
  entrance: object.animations.entrance && [object.animations.entrance.delayMs, object.animations.entrance.durationMs],
  exit: object.animations.exit && object.animations.exit.durationMs,
});
const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`);

// ── The three fiber walks ────────────────────────────────────────────────────────────────────

test("the extraction block is byte-identical (modulo indentation) in all three fiber walks", () => {
  for (const file of EXTRACT_FILES) {
    assert.equal(extractBlocks[file], extractBlocks["canva-fiber-main.js"], `${file} drifted from canva-fiber-main.js`);
  }
});

// ── Default windows (Kwf, dsi, esi, Yrf, ksf) ────────────────────────────────────────────────

test("1, 3, 6 and 12 animated elements on a 5 s page: the 200 ms stagger holds up to 6 elements and shrinks from 7", () => {
  const rise = (count) =>
    importPage(
      Array.from({ length: count }, (_, i) => element(`LB${i}`, { type: "sequenced", animation: 8 }, { top: 100 + 50 * i })),
      { hasNextPage: true }
    );
  // Kwf(5000): intro budget floor(1·1500) = 1500, outro budget floor(1·1000) = 1000, outro from
  // 5000 − 1000 = 4000. One element: no steps, tween 500 in [0, 500], out [4000, 4500].
  assert.deepEqual(legs(rise(1).LB0), { entrance: [0, 500], exit: 500 });
  assert.deepEqual(windowOf(rise(1).LB0), [0, 4500]);
  // 3: steps 2, step 200·min(1, 1000/400) = 200; esi min(1, 1500/(400 + 500)) = 1 → 200 / 500;
  // outro min(1, 1000/900) = 1 → 200 / 500: out at 4000, 4200, 4400.
  const three = rise(3);
  assert.deepEqual([0, 1, 2].map((i) => legs(three[`LB${i}`])), [0, 200, 400].map((d) => ({ entrance: [d, 500], exit: 500 })));
  assert.deepEqual([0, 1, 2].map((i) => windowOf(three[`LB${i}`])), [[0, 4500], [0, 4700], [0, 4900]]);
  // 6: steps 5, step 200·min(1, 1000/1000) = 200 (the span is exactly full); intro esi
  // min(1, 1500/1500) = 1; outro esi min(1, 1000/1500) = ⅔ → tween floor(333.3) = 333, step
  // floor(133.3) = 133: out at 4000 + 133i for 333 ms.
  const six = rise(6);
  assert.deepEqual([0, 5].map((i) => legs(six[`LB${i}`])), [
    { entrance: [0, 500], exit: 333 },
    { entrance: [1000, 500], exit: 333 },
  ]);
  assert.deepEqual([0, 5].map((i) => windowOf(six[`LB${i}`])), [[0, 4333], [0, 4000 + 665 + 333]]);
  // 12: steps 11, step 200·min(1, 1000/2200) = 90.909…; intro esi min(1, 1500/(90.909·11 + 500))
  // = 1 → step floor(90.909) = 90, tween 500; outro esi min(1, 1000/1500) = ⅔ → tween 333, step
  // floor(60.6) = 60.
  const twelve = rise(12);
  assert.deepEqual([0, 1, 11].map((i) => legs(twelve[`LB${i}`])), [
    { entrance: [0, 500], exit: 333 },
    { entrance: [90, 500], exit: 333 },
    { entrance: [990, 500], exit: 333 },
  ]);
  assert.deepEqual(windowOf(twelve.LB11), [0, 4000 + 660 + 333]);
});

test("a 2 s page scales the budgets (Kwf ⅔) and a 12 s page keeps them", () => {
  const two = importPage(
    [0, 1, 2].map((i) => element(`LB${i}`, { type: "sequenced", animation: 4, Xw: { qg: {}, Bf: {} } }, { top: 100 * (i + 1) })),
    { pageDurationMs: 2000 }
  );
  // Kwf(2000): factor 2000/3000 = ⅔ → intro budget floor(1000) = 1000, outro floor(666.7) = 666,
  // outro from 2000 − 666 = 1334. Intro: step 200, esi min(1, 1000/900) = 1 → 0 / 200 / 400 for
  // 500 ms. Outro: esi min(1, 666/900) = .74 → tween floor(370) = 370, step floor(148) = 148.
  assert.deepEqual([0, 1, 2].map((i) => legs(two[`LB${i}`])), [
    { entrance: [0, 500], exit: 370 },
    { entrance: [200, 500], exit: 370 },
    { entrance: [400, 500], exit: 370 },
  ]);
  assert.deepEqual([0, 1, 2].map((i) => windowOf(two[`LB${i}`])), [[0, 1704], [0, 1852], [0, 2000]]);
  const twelve = importPage([element("LB1", { type: "sequenced", animation: 4, Xw: { qg: {}, Bf: {} } })], { pageDurationMs: 12000 });
  // Kwf(12000): 1500 / 1000; the outro starts at 12000 − 1000 = 11000 and lasts 500.
  assert.deepEqual(legs(twelve.LB1), { entrance: [0, 500], exit: 500 });
  assert.deepEqual(windowOf(twelve.LB1), [0, 11500]);
});

test("a timed element (raw startUs / durationUs defined) takes ksf(its own length, 1), XH 0, and ends at its end", () => {
  const page = importPage([
    element("LB-a", { type: "sequenced", animation: 8 }, { top: 10 }),
    element("LB-timed", { type: "sequenced", animation: 8 }, { top: 20, startUs: 1_000_000, durationUs: 2_000_000 }),
    element("LB-b", { type: "sequenced", animation: 8 }, { top: 30 }),
  ]);
  // vwf: start 1e6, duration min(2e6, 5e6 − 1e6) → not to the page end, so the last-page rule
  // keeps its outro. A = min(2000, 5000 − 1000) = 2000; ksf(2000, 1): intro {0, 500}; outro from
  // 2000 − floor(⅔·1000) = 1334 for 500. Then Dwf: intro at startUs = 1000, outro ending at the
  // element's end: 1000 + 2000 − 500 = 2500. xrf leaves both (no stored durations).
  assert.deepEqual(windowOf(page["LB-timed"]), [1000, 3000]);
  assert.deepEqual(legs(page["LB-timed"]), { entrance: [0, 500], exit: 500 });
  // The untimed ones: N = 3 (the timed one counts), XH 0 and 2 — the timed element consumed
  // index 1 while using XH 0 itself. Single page, no config → no outro (last-page rule).
  assert.deepEqual(legs(page["LB-a"]), { entrance: [0, 500], exit: null });
  assert.deepEqual(legs(page["LB-b"]), { entrance: [400, 500], exit: null });
  assert.deepEqual(windowOf(page["LB-b"]), [0, 5000]);
  // startUs 0 is a real value: the element is timed (XH 0), not the first of the sequence.
  const zero = importPage([
    element("LB-first", { type: "sequenced", animation: 8 }, { top: 10 }),
    element("LB-zero", { type: "sequenced", animation: 8 }, { top: 20, startUs: 0 }),
  ]);
  assert.deepEqual(legs(zero["LB-zero"]), { entrance: [0, 500], exit: null });
  // …and undefined stays undefined through the walk (never coerced to 0).
  assert.equal("startUs" in extraction.readScheduleFacts(element("LB1")), false);
  assert.equal(extraction.readScheduleFacts(element("LB1", undefined, { startUs: 0 })).startUs, 0);
});

test("stored speeds: a speed preset keeps Canva's windows and xrf clips the leg to its room; other pairs are custom (Gwf)", () => {
  const rise = (qg, Bf) => importPage([element("LB1", { type: "sequenced", animation: 8, Xw: { qg, Bf, direction: 2 } })]).LB1;
  // slow (c = .1): 5 000 000 / 2 000 000 µs — one speed, so the default windows {0, 500} / {4000, 500}
  // stay; srf: min(5000, 4000 − 0) = 4000; trf: min(2000, 5000 − 4000) = 1000; wrf: factor
  // min(1, 5000/(4000 + 1000)) = 1, outro at min(4000, 5000 − 1000) = 4000 → in 4000, out 1000.
  const slow = rise({ durationUs: 5_000_000 }, { durationUs: 2_000_000 });
  assert.deepEqual(legs(slow), { entrance: [0, 4000], exit: 1000 });
  assert.deepEqual(windowOf(slow), [0, 5000]);
  assert.equal(slow.animations.entrance.direction, "UP");
  // medium (c = .5): 1 000 000 / 400 000 → in 1000, out 400 at 4000 (window to 4400).
  const medium = rise({ durationUs: 1_000_000 }, { durationUs: 400_000 });
  assert.deepEqual(legs(medium), { entrance: [0, 1000], exit: 400 });
  assert.deepEqual(windowOf(medium), [0, 4400]);
  // fast (c = 1.2): 416 666.67 / 166 666.67 → in 416.67 → 417, out 166.67 → 167, window to 4166.67 → 4167.
  const fast = rise({ durationUs: 5e5 / 1.2 }, { durationUs: 2e5 / 1.2 });
  assert.deepEqual(legs(fast), { entrance: [0, 417], exit: 167 });
  assert.deepEqual(windowOf(fast), [0, 4167]);
  // Not one speed (1.5 s in, .3 s out: speeds .333 / .667, mean .5, 500/.5 = 1 000 000 ≠ 1 500 000) →
  // Gwf: in 1500 from 1500·.5/N·XH, out 300 ending at the element end with 300·.5/N·XH shaved.
  const custom = importPage(
    [0, 1, 2].map((i) =>
      element(`LB${i}`, { type: "sequenced", animation: 8, Xw: { qg: { durationUs: 1_500_000 }, Bf: { durationUs: 300_000 } } }, { top: 100 * (i + 1) })
    )
  );
  // XH 1 of N 3: intro at 1500·.5/3·1 = 250 for 1500; outro at 5000 − 300 + 300·.5/3·1 = 4750 for
  // 300 − 50 = 250; xrf: srf min(1500, 4750 − 250) = 1500, trf min(300, 5000 − 4750) = 250 → as is.
  assert.deepEqual(legs(custom.LB1), { entrance: [250, 1500], exit: 250 });
  assert.deepEqual(windowOf(custom.LB1), [0, 5000]);
  // XH 2: intro at 500; outro at 4800 for 200.
  assert.deepEqual(legs(custom.LB2), { entrance: [500, 1500], exit: 200 });
  // NV 1 (custom mode) is custom even for a speed-preset pair.
  const mode = importPage([element("LB1", { type: "sequenced", animation: 8, Xw: { qg: { durationUs: 1e6 }, Bf: { durationUs: 4e5 }, NV: 1 } })]).LB1;
  // Gwf with N 1: in [0, 1000], out [5000 − 400, 400].
  assert.deepEqual(legs(mode), { entrance: [0, 1000], exit: 400 });
  assert.deepEqual(windowOf(mode), [0, 5000]);
});

test("legs: exit-only, entrance-only, both, and the last-page rule for a config that names no leg", () => {
  const rise = (Xw, options) => importPage([element("LB1", { type: "sequenced", animation: 8, ...(Xw ? { Xw } : {}) })], options).LB1;
  // Bf only → the intro tweens go; the outro plays [4000, 4500].
  assert.deepEqual(legs(rise({ Bf: {} })), { entrance: null, exit: 500 });
  assert.deepEqual(windowOf(rise({ Bf: {} })), [0, 4500]);
  // qg only → no outro, visible to the page end.
  assert.deepEqual(legs(rise({ qg: {} })), { entrance: [0, 500], exit: null });
  assert.deepEqual(windowOf(rise({ qg: {} })), [0, 5000]);
  // both named → both, even on the last page.
  assert.deepEqual(legs(rise({ qg: {}, Bf: {} })), { entrance: [0, 500], exit: 500 });
  // No config / a config without legs: both legs — EXCEPT on the last page, where an element that
  // runs to the page end loses its outro (Dwf: `f.yDb && z && Buf(d)`).
  assert.deepEqual(legs(rise(undefined)), { entrance: [0, 500], exit: null });
  assert.deepEqual(legs(rise({ direction: 3 })), { entrance: [0, 500], exit: null });
  assert.deepEqual(legs(rise(undefined, { hasNextPage: true })), { entrance: [0, 500], exit: 500 });
  // A reversed outro flips the exit (Erf: end Xk = f instead of −f).
  const reversed = rise({ qg: {}, Bf: { reverse: true } });
  assert.equal(reversed.animations.entrance.direction, "DEFAULT");
  assert.equal(reversed.animations.exit.direction, "DOWN");
});

test("Wipe: the 750 / 1500 ms cap binds only Canva's default window; stored durations run in full", () => {
  const wipe = (kind, Xw) => importPage([element("LB1", { type: "sequenced", animation: 26, Xw }, { type: kind })]).LB1;
  // Image, default: {0, 500} / {4000, 500}; luf X6a min(500, 750) = 500 → 500 / 500.
  assert.deepEqual(legs(wipe("rect", { qg: {}, Bf: {} })), { entrance: [0, 500], exit: 500 });
  // Text, default: Wipe animates units (ouf), so its intro takes the per-unit window
  // vrf(4000, 0, 1) = 4000 − 800·min(4000/3000, 1) = 3200, capped by luf at min(3200, 1500) = 1500.
  assert.deepEqual(legs(wipe("text", { qg: {}, Bf: {} })), { entrance: [0, 1500], exit: 500 });
  // Stored 2 s / 2 s: Wipe's speed base is 3200 ms, so 2e6 / 2e6 is no speed preset (speeds 1.6 and
  // .1) → Gwf: in [0, 2000], out [3000, 2000]; luf: srf min(2000, 3000) = 2000, trf min(2000,
  // 5000 − 3000) = 2000 → nothing capped.
  assert.deepEqual(legs(wipe("rect", { qg: { durationUs: 2e6 }, Bf: { durationUs: 2e6 } })), { entrance: [0, 2000], exit: 2000 });
  // Text, 3 s / 3 s: Gwf squeezes 6 s into the 5 s element → 2.5 s each; in 2500, out [2500, 2500].
  assert.deepEqual(legs(wipe("text", { qg: { durationUs: 3e6 }, Bf: { durationUs: 3e6 } })), { entrance: [0, 2500], exit: 2500 });
  // The speed preset "medium" (c = .5) stores 3200/.5 = 6.4 s in and 200/.5 = .4 s out — one speed,
  // so the default windows stay and srf clips the intro to its room: min(6400, 4000) = 4000.
  assert.deepEqual(legs(wipe("rect", { qg: { durationUs: 6.4e6 }, Bf: { durationUs: 4e5 } })), { entrance: [0, 4000], exit: 400 });
});

test("per-unit Fade on text: the mnb intro window, `unit`, and `fill` only where Canva stored a duration", () => {
  const fade = (Xw) => importPage([text("LB1", { type: "sequenced", animation: 4, Xw })]).LB1;
  // Word style (ID 2): intro window vrf(4000, 0, 1) = 3200; xrf keeps it (no overlap with 4000).
  const byWord = fade({ ID: 2, qg: {}, Bf: {} });
  assert.deepEqual(byWord.animations.entrance, slot("FADE", 3200, { params: { unit: 2 } }));
  assert.deepEqual(byWord.animations.exit, slot("FADE", 500, { params: { unit: 2 } }));
  assert.deepEqual(windowOf(byWord), [0, 4500]);
  assert.equal(byWord.canvaWritingStyle, 2);
  // Speed "medium" for a per-unit style: base 3200 → 6.4 s / .4 s is one speed; srf min(6400, 4000) =
  // 4000, trf min(400, 1000) = 400 — both stored, so both legs fill their windows.
  const medium = fade({ ID: 1, qg: { durationUs: 6.4e6 }, Bf: { durationUs: 4e5 } });
  assert.deepEqual(medium.animations.entrance, slot("FADE", 4000, { params: { unit: 1, fill: 1 } }));
  assert.deepEqual(medium.animations.exit, slot("FADE", 400, { params: { unit: 1, fill: 1 } }));
  // The whole element (ID 5, the default) and a non-text element never carry a unit.
  assert.equal(fade({ qg: {}, Bf: {} }).animations.entrance.params, undefined);
  const image = importPage([element("LB1", { type: "sequenced", animation: 4, Xw: { ID: 2, qg: {}, Bf: {} } })]).LB1;
  assert.equal(image.animations.entrance.params, undefined);
  assert.equal(image.animations.entrance.durationMs, 500);
});

test("Block: d = floor(min(330, page·.066, intro/2)) and k from the outro — 2d in, 2k out — with the stored bar colour", () => {
  const block = (options) => importPage([text("LB1", { type: "sequenced", animation: 17, Xw: { qg: {}, Bf: {}, color: "#ff0000" } })], options).LB1;
  // 5 s: min(330, 330, 500/2) → d = 250, k = 250 → 500 in, 500 out from 4000.
  const five = block();
  assert.deepEqual(five.animations.entrance, slot("BLOCK", 500, { params: { barColor: 0xffff0000 } }));
  assert.deepEqual(five.animations.exit, slot("BLOCK", 500, { params: { barColor: 0xffff0000 } }));
  assert.deepEqual(windowOf(five), [0, 4500]);
  // 2 s: min(330, 2000·.066 = 132, 250) → d = k = 132 → 264 in; out [1334, 1334 + 264].
  const two = block({ pageDurationMs: 2000 });
  assert.equal(two.animations.entrance.durationMs, 264);
  assert.equal(two.animations.exit.durationMs, 264);
  assert.deepEqual(windowOf(two), [0, 1598]);
  // Canva only offers Block on text; anything else keeps the plain fade on Canva's windows.
  const image = importPage([element("LB1", { type: "sequenced", animation: 17, Xw: { qg: {}, Bf: {} } })]).LB1;
  assert.deepEqual(image.animations, { entrance: slot("FADE", 500), exit: slot("FADE", 500), loop: null });
});

// ── Page presets (Kyf) ───────────────────────────────────────────────────────────────────────

test("page Rise: Kyf's default config has an outro only when a next page exists; wyf's 300 ms stagger", () => {
  const els = [element("LB1"), text("LB2", undefined, { top: 400 })];
  // wyf {step 300, tween 500, span 1500}, N 2: intro step 300·min(1, 1000/300) = 300, esi
  // min(1, 1500/800) = 1; outro esi min(1, 1000/800) = 1 → 300 / 500.
  const single = importPage(els, { page: { animation: 5 } });
  assert.deepEqual(legs(single.LB1), { entrance: [0, 500], exit: null });
  assert.deepEqual(legs(single.LB2), { entrance: [300, 500], exit: null });
  assert.equal(single.LB1.canvaPageAnimationPreset, 5);
  assert.equal(single.LB1.canvaAnimationPreset, undefined);
  const next = importPage(els, { page: { animation: 5 }, hasNextPage: true });
  assert.deepEqual(legs(next.LB1), { entrance: [0, 500], exit: 500 });
  assert.deepEqual(legs(next.LB2), { entrance: [300, 500], exit: 500 });
  assert.deepEqual([windowOf(next.LB1), windowOf(next.LB2)], [[0, 4500], [0, 4800]]);
  // A stored page config replaces the default: {} names no leg → the last-page rule applies.
  assert.equal(importPage(els, { page: { animation: 5, Xw: {} } }).LB1.animations.exit, null);
  assert.equal(importPage(els, { page: { animation: 5, Xw: {} }, hasNextPage: true }).LB1.animations.exit.durationMs, 500);
  // The page config's direction reaches every element.
  assert.equal(importPage(els, { page: { animation: 5, Xw: { qg: {}, direction: 3 } } }).LB2.animations.entrance.direction, "DOWN");
  // An element with its own animation keeps it; one cleared to {type:"none"} stays still.
  const mixed = importPage(
    [element("LB1"), element("LB-own", { type: "sequenced", animation: 4, Xw: { qg: {} } }, { top: 300 }), element("LB-none", { type: "none" }, { top: 500 })],
    { page: { animation: 5 } }
  );
  assert.equal(mixed["LB-own"].animations.entrance.type, "FADE");
  assert.equal(mixed["LB-own"].canvaAnimationPreset, 4);
  assert.equal(mixed["LB-none"].animations, undefined);
});

test("page Neon: no sort, and myf staggers the outro backwards", () => {
  const page = importPage([element("LB0", undefined, { top: 900 }), element("LB1", undefined, { top: 100 }), element("LB2", undefined, { top: 500 })], {
    page: { animation: 8 },
    hasNextPage: true,
  });
  // Paint order (no sort): XH 0, 1, 2. csi N 3: in at 200·XH for 500; out (myf) at
  // 4000 + 200·(3 − 1 − XH) for 500 → 4400, 4200, 4000.
  assert.deepEqual(["LB0", "LB1", "LB2"].map((id) => legs(page[id])), [
    { entrance: [0, 500], exit: 500 },
    { entrance: [200, 500], exit: 500 },
    { entrance: [400, 500], exit: 500 },
  ]);
  assert.deepEqual(["LB0", "LB1", "LB2"].map((id) => windowOf(page[id])), [[0, 4900], [0, 4700], [0, 4500]]);
  assert.deepEqual(["LB0", "LB1", "LB2"].map((id) => page[id].animations.entrance.params), [{ xh: 0 }, { xh: 1 }, { xh: 2 }]);
});

test("page Block animates text only (text in an un-animated group included); page Pop sorts by area with tyf", () => {
  const block = importPage(
    [
      element("LB-img"),
      text("LB-text", undefined, { top: 300 }),
      element("LB-group", undefined, { type: "group", top: 600, contents: [text("LB-child", undefined, { top: 0 })] }),
    ],
    { page: { animation: 1 }, hasNextPage: true }
  );
  assert.equal(block["LB-img"].animations, undefined);
  assert.equal(block["LB-group"].animations, undefined);
  // N = 2 texts (the grouped one joins via hyf's lVt); XH 0 and 1.
  assert.deepEqual(legs(block["LB-text"]), { entrance: [0, 500], exit: 500 });
  assert.deepEqual(legs(block["LB-child"]), { entrance: [200, 500], exit: 500 });
  const pop = importPage(
    [element("LB-small", undefined, { width: 100, height: 100 }), element("LB-big", undefined, { top: 900, width: 800, height: 800 })],
    { page: { animation: 11 }, hasNextPage: true }
  );
  // uyf: largest first. tyf {step 250, tween 750}, N 2: intro esi min(1, 1500/(250 + 750)) = 1 →
  // big [0, 750], small [250, 750]; outro esi min(1, 1000/1000) = 1 → 750 at 4000 / 4250.
  assert.deepEqual(legs(pop["LB-big"]), { entrance: [0, 750], exit: 750 });
  assert.deepEqual(legs(pop["LB-small"]), { entrance: [250, 750], exit: 750 });
  assert.deepEqual(windowOf(pop["LB-small"]), [0, 5000]);
});

test("page Stomp: the headline stomps on Fyf's windows; the others' shake is approximated with a warning", () => {
  mapping.drainCanvaAnimationImportWarnings();
  const els = [
    element("LB-img", undefined, { top: 50 }),
    text("LB-small", undefined, { top: 400, text: { stream: { attrs: { items: [{ s: { "font-size": 40 } }] } } } }),
    text("LB-big", undefined, { top: 800, text: { stream: { attrs: { items: [{ s: { "font-size": 90 } }] } } } }),
  ];
  const page = importPage(els, { page: { animation: 13 }, hasNextPage: true });
  // Fyf, headline present: scale min(5000/(250 + 450 + 900), 1) = 1 → stomp 250, shake 450, settle
  // 900; outro start floor(5000 − 900) = 4100; headline out at max(5000 − 250, 4100) = 4750.
  assert.deepEqual(legs(page["LB-big"]), { entrance: [0, 250], exit: 250 });
  assert.deepEqual(windowOf(page["LB-big"]), [0, 5000]);
  assert.equal(page["LB-big"].animations.entrance.type, "STOMP");
  // Everyone else: in at intro.delay + 250 for min(450, 500) — no stagger — and out at 4100 for
  // min(5000 − 450, 900 − 250·.4, 500) = 500.
  assert.deepEqual(legs(page["LB-img"]), { entrance: [250, 450], exit: 500 });
  assert.deepEqual(windowOf(page["LB-small"]), [0, 4600]);
  // Stomp's start scale is the page width over the element's (mtf): max(1080/200·1.5, 4) — in
  // doubles 5.4 · 1.5 = 8.100000000000001, exactly what Canva computes.
  assert.deepEqual(page["LB-big"].animations.entrance.params, { startScale: (1080 / 200) * 1.5 });
  assert.ok(mapping.drainCanvaAnimationImportWarnings().some((w) => /page Stomp/.test(w)));
});

test("page Scrapbook: distance-from-centre order and its own tables (zyf / Ayf)", () => {
  const page = importPage(
    [element("LB-far", undefined, { left: 0, top: 0 }), element("LB-centre", undefined, { left: 440, top: 910 }), element("LB-mid", undefined, { left: 300, top: 600 })],
    { page: { animation: 12 }, hasNextPage: true }
  );
  // Sorted by distance: centre, mid, far → XH 0, 1, 2. zyf (fixed 100 ms step, tween 1000): esi
  // min(1, 1500/(100·2 + 1000)) = 1 → in at 100·XH for 1000. Ayf (fixed 250, tween 1) over
  // min(3, 4) = 3: esi min(1, 1000/(250·2 + 1)) = 1 → out at 4000 + 250·(XH mod 3) for 1.
  assert.deepEqual(["LB-centre", "LB-mid", "LB-far"].map((id) => legs(page[id])), [
    { entrance: [0, 1000], exit: 1 },
    { entrance: [100, 1000], exit: 1 },
    { entrance: [200, 1000], exit: 1 },
  ]);
  assert.deepEqual(["LB-centre", "LB-mid", "LB-far"].map((id) => windowOf(page[id])), [[0, 4001], [0, 4251], [0, 4501]]);
});

test("a stale page id outside the page enum (31 — DAHOPR_iwyk's template leftover) animates nothing", () => {
  const page = importPage([element("LB1"), text("LB2", undefined, { top: 400 })], { page: { animation: 31 } });
  assert.equal(page.LB1.animations, undefined);
  assert.equal(page.LB2.animations, undefined);
  assert.equal(mapping.CANVA_ANIMATION_PRESET_TO_TYPE[31], "SUCCESSION");
  assert.equal(mapping.CANVA_PAGE_ANIMATION_PRESET_TO_TYPE[31], undefined);
  assert.deepEqual(plain(mapping.buildEditorAnimationFields({ canvaPreset: 31, fromPageAnimation: true }, { kind: "image" })), {});
});

// ── Builder params ───────────────────────────────────────────────────────────────────────────

test("Tumble / Stomp / Scrapbook params on a 1080×1920 and a 1080×1080 page", () => {
  const raw = (id, animation, extra) => element(id, { type: "sequenced", animation, Xw: { qg: {}, Bf: {} } }, { left: 100, top: 300, width: 200, height: 100, ...extra });
  for (const [pageHeight, reach] of [[1920, 1920], [1080, 1080]]) {
    // Tumble (juf), XH 0, Vd .5: k = lerp(−90, −270, .5) + |cos 0 · 200 · 100 · 300| mod 360 =
    // −180 + 6 000 000 mod 360 (= 240) = 60; direction auto + even XH → 5 → from the left (sign −1):
    // travel (cos 0 · D · −1, sin 0 · D · −1) with D = max(page w, h).
    const tumble = importPage([raw("LB1", 13)], { pageHeight }).LB1.animations;
    assert.deepEqual(tumble.entrance.params, { xh: 0, startRotation: 60, travelX: -reach, travelY: 0 });
    assert.deepEqual(tumble.exit.params, { xh: 0, startRotation: -60, travelX: reach, travelY: 0 });
    // Canva reads the element rotation (degrees) as RADIANS: rotation 30 → cos 30 = .15425…, sin 30 = −.98803….
    const turned = importPage([raw("LB1", 13, { rotation: 30 })], { pageHeight }).LB1.animations.entrance.params;
    close(turned.travelX, Math.cos(30) * reach * -1, "travelX");
    close(turned.travelY, Math.sin(30) * reach * -1, "travelY");
    // Stomp (mtf): max(page w / w · 1.5, 4) — 1080/200·1.5 (8.100000000000001 in doubles, as in
    // Canva); a 500 px element floors at 4. The page height plays no part.
    assert.deepEqual(importPage([raw("LB1", 11)], { pageHeight }).LB1.animations.entrance.params, { startScale: (1080 / 200) * 1.5 });
    assert.deepEqual(importPage([raw("LB1", 11, { width: 500 })], { pageHeight }).LB1.animations.entrance.params, { startScale: 4 });
  }
  // The reversed exit keeps the start offset (juf: end rotate k, Kk d, Xk e).
  const reversed = importPage([element("LB1", { type: "sequenced", animation: 13, Xw: { qg: {}, Bf: { reverse: true } } }, { top: 300 })]).LB1;
  assert.deepEqual(reversed.animations.exit.params, { xh: 0, startRotation: 60, travelX: -1920, travelY: 0 });
  // An odd XH flips the parity: second element (top 400), XH 1 → k = lerp(−270, −90, .5) + |cos 1 ·
  // 200 · 100 · 400| mod 360; auto + odd → 4 → from the right (sign +1).
  const pair = importPage([raw("LB1", 13), raw("LB2", 13, { top: 400 })]);
  close(pair.LB2.animations.entrance.params.startRotation, -180 + (Math.abs(Math.cos(1) * 200 * 100 * 400) % 360), "k");
  assert.equal(pair.LB2.animations.entrance.params.travelX, 1920);
  // Scrapbook (jtf) on the story page: centre (200, 350) against (540, 960) → rel (−.63, −.635),
  // distance .895 ≥ .5 → 2 poses; b = sign · ((1 − |rel|) · half + own half) = (−300, −400).
  const tall = importPage([raw("LB1", 9)]).LB1.animations.entrance.params;
  assert.equal(tall.poses, 2);
  close(tall.poseX, -300, "poseX");
  close(tall.poseY, -400, "poseY");
  // Near the centre of the square page, three poses: centre (540, 590) vs (540, 540) → rel (0, .0926).
  const square = importPage([raw("LB1", 9, { left: 440, top: 540 })], { pageHeight: 1080 }).LB1.animations.entrance.params;
  assert.equal(square.poses, 3);
  assert.equal(square.poseX, 0);
  close(square.poseY, (1 - 50 / 540) * 540 + 50, "poseY");
  // The same element on the tall page sits lower than centre → rel y = (590 − 960)/960 < 0.
  const low = importPage([raw("LB1", 9, { left: 440, top: 540 })]).LB1.animations.entrance.params;
  close(low.poseY, -((1 - 370 / 960) * 960 + 50), "poseY tall");
});

test("Neon: xh on the whole element, unit + seed per unit on text", () => {
  const neon = importPage([
    element("LB1", { type: "sequenced", animation: 5, Xw: { qg: {}, Bf: {} } }),
    text("LB2", { type: "sequenced", animation: 5, Xw: { qg: {}, Bf: {}, ID: 3 } }, { top: 400, left: 50, width: 300, height: 80 }),
  ]);
  assert.deepEqual(neon.LB1.animations.entrance.params, { xh: 0 });
  // seed = w · h · max(top, 1) · max(left, 1) = 300 · 80 · 400 · 50.
  assert.deepEqual(neon.LB2.animations.entrance.params, { unit: 3, seed: 300 * 80 * 400 * 50, xh: 1 });
  // A per-unit style takes the per-unit intro window: N 2 → vrf(4000, 200, 2) = 3800 − 800 = 3000.
  assert.equal(neon.LB2.animations.entrance.durationMs, 3000);
  assert.equal(neon.LB2.animations.entrance.delayMs, 200);
});

// ── Continuous presets (lsf, Csf, xtf) ───────────────────────────────────────────────────────

test("Breathe: FADE legs plus a concurrent scale / lift ramp — the page-long ramp, and the ≥ 10 s two-part ramp", () => {
  const breathe = (options) =>
    importPage([element("LB1", { type: "sequenced", animation: 2, Xw: { qg: {}, Bf: {} } }, { left: 100, top: 300 })], options).LB1;
  const short = breathe();
  // Fades on Canva's windows: in [0, 500], out [4000, 4500] → window [0, 4500].
  assert.deepEqual(short.animations.entrance, slot("FADE", 500));
  assert.deepEqual(short.animations.exit, slot("FADE", 500));
  assert.deepEqual(windowOf(short), [0, 4500]);
  // scale .5 → A = lerp(.95, .85, .5), B = lerp(1, 1.06, .5) = 1.03, over the whole page (5000 ms,
  // linear); lift 5 · g with g = (350 − 960)/960 → from 3.177 to −3.177.
  const loop = short.animations.loop;
  assert.equal(loop.type, "BREATHE");
  assert.equal(loop.infinite, true);
  const lift = 5 * ((350 - 960) / 960);
  assert.deepEqual(loop.params, {
    concurrent: 1,
    r1From: 0.95 + (0.85 - 0.95) * 0.5,
    r1To: 1 + (1.06 - 1) * 0.5,
    r1Start: 0,
    r1Dur: 5000,
    r1Ease: 1,
    y1From: -lift,
    y1To: lift,
  });
  // Legacy builds: a ping-pong over 2 × the window with intensity (B − A)/.13 = 1.
  assert.equal(loop.durationMs, 9000);
  assert.equal(loop.intensity, 1);
  // 12 s page: the outro window starts at 11000 → half (12000 − 11000)/2 = 500; first ramp
  // min(5000, 6000) − 500 = 4500 (A → B), then B → 1 over the next 4500, lift back to 0.
  const long = breathe({ pageDurationMs: 12000 }).animations.loop.params;
  assert.equal(long.r1Dur, 4500);
  assert.deepEqual([long.r2To, long.r2Start, long.r2Dur, long.r2Ease, long.y2To], [1, 4500, 4500, 1, 0]);
});

test("Drift: no fades on a normal page, a linear −m → +m ramp (short) or two eased halves (≥ 10 s); amplitude from O1.wN", () => {
  const drift = (options, extra = {}) =>
    importPage([element("LB1", { type: "sequenced", animation: 3, Xw: { direction: 4 } }, extra)], options).LB1;
  // m = min(1080, 1920)/4/1 · 1 · lerp(.5, 1.5, .5) = 270; direction 4 → vector −270 on x.
  const short = drift();
  assert.equal(short.animations.entrance, null);
  assert.equal(short.animations.exit, null);
  assert.deepEqual(windowOf(short), [0, 5000]);
  assert.deepEqual(short.animations.loop.params, { concurrent: 1, r1From: 270, r1To: -270, r1Start: 0, r1Dur: 5000, r1Ease: 1 });
  assert.equal(short.animations.loop.direction, "LEFT");
  // ≥ 10 s: half = the outro window's start / 2 = 11000 / 2 = 5500; −v → v/2 then → 0, easeInOutQuad.
  assert.deepEqual(drift({ pageDurationMs: 12000 }).animations.loop.params, {
    concurrent: 1,
    r1From: 270,
    r1To: -135,
    r1Start: 0,
    r1Dur: 5500,
    r1Ease: 4,
    r2To: 0,
    r2Start: 5500,
    r2Dur: 5500,
    r2Ease: 4,
  });
  // Timed (startUs 1 s, 2 s long): d = 2000/2 = 1000; ramps at 1000 and 1000 + 1000 in PAGE ms →
  // layer-local 0 and 1000; the window is the element's own [1000, 3000].
  const timed = drift({}, { startUs: 1e6, durationUs: 2e6 });
  assert.deepEqual(windowOf(timed), [1000, 3000]);
  assert.deepEqual(
    [timed.animations.loop.params.r1Start, timed.animations.loop.params.r1Dur, timed.animations.loop.params.r2Start],
    [0, 1000, 1000]
  );
  // N in the amplitude is the page's TOP-LEVEL element count (O1.wN), static elements included:
  // a static neighbour halves it (1080/4/2 = 135).
  const withNeighbour = importPage([element("LB1", { type: "sequenced", animation: 3 }), element("LB-static", undefined, { top: 900 })]);
  assert.equal(withNeighbour.LB1.animations.loop.params.r1From, -135);
});

test("Tectonic: linear FADE legs (fadeEase 1), side of the page, centred elements alternating page-wide", () => {
  const short = importPage([element("LB1", { type: "sequenced", animation: 12, Xw: { qg: {}, Bf: {} } })]).LB1;
  // d = 1080/6/1 · 1 · lerp(.7, 1.3, .5) = 180 (centre x 200 < 540 → as is). 2·lerp(7000, 3000, .5)
  // = 10000 > 5000 → one linear ramp −d → d/2 over the page.
  assert.deepEqual(short.animations.entrance, slot("FADE", 500, { params: { fadeEase: 1 } }));
  assert.deepEqual(short.animations.exit, slot("FADE", 500, { params: { fadeEase: 1 } }));
  assert.deepEqual(short.animations.loop.params, { concurrent: 1, r1From: -180, r1To: 90, r1Start: 0, r1Dur: 5000, r1Ease: 1 });
  // 12 s: 10000 > 12000 fails → half = (12000 − 11000)/2 = 500, first = min(5000, 6000) − 500.
  const long = importPage([element("LB1", { type: "sequenced", animation: 12, Xw: { qg: {}, Bf: {} } })], { pageDurationMs: 12000 }).LB1;
  assert.deepEqual(
    [long.animations.loop.params.r1Dur, long.animations.loop.params.r1Ease, long.animations.loop.params.r2Start, long.animations.loop.params.r2Dur],
    [4500, 4, 4500, 4500]
  );
  // Three centred elements (centre x 540): d = 1080/6/3 · (XH + 1) = 60, 120, 180 with the sign
  // alternating in schedule order: +, −, +.
  const centred = importPage(
    [0, 1, 2].map((i) => element(`LB${i}`, { type: "sequenced", animation: 12, Xw: { qg: {}, Bf: {} } }, { left: 440, top: 100 + 300 * i }))
  );
  assert.deepEqual([0, 1, 2].map((i) => centred[`LB${i}`].animations.loop.params.r1From), [-60, 120, -180]);
});

// ── Repeating effects (§4, concurrent) ───────────────────────────────────────────────────────

test("repeating rotate + flicker + wiggle stacked: rotate holds the loop, the rest stack; all on the page clock", () => {
  const ref = { rotate: { Vd: 0, direction: 2 }, R2a: { Vd: 0.5, Ezp: false }, N5a: { Vd: -0.5 } };
  const fields = importPage([element("LB1", undefined, { Sz: { ref } })]).LB1;
  // rotate t .5 → lerp(40000, 600, .5) = 20300, counter-clockwise; flicker t .75 → 2·lerp(600, 300,
  // .75) + 200 = 950; wiggle t .25 → lerp(600, 50, .25) = 462.5 × (floor(32.5) + 1) = 15262.5;
  // seed 200 · 100 · 100 · 100.
  assert.deepEqual(fields.animations, {
    entrance: null,
    exit: null,
    loop: slot("ROTATE", 20300, {
      infinite: true,
      direction: "COUNTERCLOCKWISE",
      params: {
        concurrent: 1,
        phaseMs: 0,
        stackPhaseMs: 0,
        stackFlicker: 950,
        stackFlickerT: 0.75,
        stackWiggle: 15262.5,
        stackWiggleT: 0.25,
        seed: 2e8,
      },
    }),
  });
  assert.deepEqual(fields.canvaRepeating, { rotate: { direction: 2, Vd: 0 }, flicker: { Vd: 0.5 }, wiggle: { Vd: -0.5 } });
  // A timed element's effects keep Canva's page clock: phase = the window start.
  const timed = importPage([element("LB1", undefined, { Sz: { ref: { N5a: { Vd: 0 } } }, startUs: 1_500_000, durationUs: 2e6 })]).LB1;
  assert.deepEqual(windowOf(timed), [1500, 3500]);
  assert.deepEqual(timed.animations.loop, slot("WIGGLE", 18200, { infinite: true, params: { concurrent: 1, phaseMs: 1500, seed: 2e8 } }));
  // A continuous preset keeps its ramp; the repeating effect stacks on it.
  const drift = importPage([element("LB1", { type: "sequenced", animation: 3 }, { Sz: { ref: { rotate: { Vd: 0, direction: 1 } } } })]).LB1;
  assert.equal(drift.animations.loop.type, "DRIFT");
  assert.equal(drift.animations.loop.params.stackRotate, 20300);
  assert.equal(drift.animations.loop.params.stackPhaseMs, 0);
  // A preset plus an effect: the preset keeps entrance / exit, the effect rides alongside.
  const pop = importPage([element("LB1", { type: "sequenced", animation: 7, Xw: { qg: {}, Bf: {} } }, { Sz: { ref: { BJa: { Vd: 0 } } } })]).LB1;
  assert.deepEqual(pop.animations.loop, slot("PULSE", 900, { infinite: true, params: { concurrent: 1, phaseMs: 0 } }));
  assert.equal(pop.animations.entrance.type, "POP");
  assert.equal(pop.mediaAnimationMode, "IN_OUT");
  assert.equal(mapping.canvaRepeatingCycleMs("pulse", 0), 900);
});

test("an independent element plays but does not consume a sequence index", () => {
  const page = importPage([
    element("LB-a", { type: "sequenced", animation: 4, Xw: { qg: {} } }, { top: 10 }),
    element("LB-ind", { type: "independent", animation: 4, Xw: { qg: {} } }, { top: 20 }),
    element("LB-b", { type: "sequenced", animation: 4, Xw: { qg: {} } }, { top: 30 }),
  ]);
  // N 3 → step 200. XH: a 0, ind 1 (no increment after it), b 1.
  assert.deepEqual(["LB-a", "LB-ind", "LB-b"].map((id) => page[id].animations.entrance.delayMs), [0, 200, 200]);
});

// ── Page background (page Breathe / Drift) ────────────────────────────────────────────────────

test("page Breathe / Drift: the photo background rides a concurrent ramp; Breathe's stagger starts a step late", () => {
  const fill = { image: { mediaId: "M1", box: { left: 0, top: 0, width: 1080, height: 1920 } } };
  const backgroundObject = { type: "Image", left: 0, top: 0, width: 1080, height: 1920, scaleX: 1, scaleY: 1 };
  const breathe = importPage([element("LB1"), element("LB2", undefined, { top: 500 })], {
    page: { animation: 2 },
    fill,
    backgroundObject,
    hasNextPage: true,
  });
  // PJx: with a background photo the intro stagger leads by one step: N 2 → steps 2, 200 → in at
  // 200 and 400.
  assert.deepEqual([breathe.LB1.animations.entrance.delayMs, breathe.LB2.animations.entrance.delayMs], [200, 400]);
  // iyf's ARi: scale 1 → lerp(1, 1.12, .5) = 1.06 over the page, easeOutQuad (id 3).
  assert.deepEqual(breathe.bg.animations.loop.params, { concurrent: 1, r1From: 1, r1To: 1.06, r1Start: 0, r1Dur: 5000, r1Ease: 3 });
  const drift = importPage([element("LB1")], { page: { animation: 9 }, fill, backgroundObject });
  // kyf's ARi: zoom max(1296/1080, 2304/1920) = 1.2 baked into the object about its centre; pan
  // −(1296 − 1080)/2 = −108 → +108 over min(10000, 5000), linear, on x (direction 5).
  assert.deepEqual(drift.bg.animations.loop.params, { concurrent: 1, r1From: -108, r1To: 108, r1Start: 0, r1Dur: 5000, r1Ease: 1 });
  assert.equal(drift.bg.animations.loop.direction, "RIGHT");
  close(drift.bg.scaleX, 1.2, "zoom");
  close(drift.bg.left, -108, "left");
  close(drift.bg.top, -192, "top");
});

// ── Group children ───────────────────────────────────────────────────────────────────────────

test("a group child with its own animation is scheduled right after its group; a page animation on a group plays on its children", () => {
  const own = importPage([
    element("LB-first", { type: "sequenced", animation: 4, Xw: { qg: {} } }, { top: 10 }),
    element("LB-group", undefined, {
      type: "group",
      top: 20,
      contents: [element("LB-kid", { type: "sequenced", animation: 4, Xw: { qg: {} } }, { top: 0 })],
    }),
    element("LB-last", { type: "sequenced", animation: 4, Xw: { qg: {} } }, { top: 30 }),
  ]);
  // N 3 (the kid counts). XH: first 0, group static (no index), kid 1, last 2.
  assert.deepEqual(["LB-first", "LB-kid", "LB-last"].map((id) => own[id].animations.entrance.delayMs), [0, 200, 400]);
  assert.equal(own["LB-group"].animations, undefined);
  // Page Rise on a group (not itself a layer here): its children inherit the group's slots.
  const model = pageModel(
    [element("LB-g", undefined, { type: "group", top: 20, contents: [element("LB-c1", undefined, { top: 0 }), text("LB-c2", undefined, { top: 40 })] })],
    { page: { animation: 5 } }
  );
  const objects = [{ importNodeId: "LB-c1" }, { importNodeId: "LB-c2" }];
  mapping.applyCanvaPageAnimations(objects, [{ id: "LB-c1", kind: "image" }, { id: "LB-c2", kind: "text" }], model, {});
  assert.deepEqual(plain(objects).map((object) => object.animations.entrance.type), ["RISE", "RISE"]);
  assert.equal(plain(objects)[0].canvaPageAnimationPreset, 5);
});

// ── The records Canva actually stores (read back live on 2026-09-22, spec §1) ─────────────────
const LIVE = JSON.parse(
  fs.readFileSync(path.join(extensionRoot, "test/fixtures/canva-live-records-2026-09-22.json"), "utf8")
);

test("live records: every panel tile maps to its type; a fresh click (no config) plays both legs only when a page follows", () => {
  const expected = {
    rise: "RISE",
    pan: "PAN",
    fade: "FADE",
    pop: "POP",
    wipe: "WIPE",
    blur: "BLUR",
    succession: "SUCCESSION",
    breathe: "BREATHE",
    baseline: "BASELINE",
    drift: "DRIFT",
    tectonic: "TECTONIC",
    tumble: "TUMBLE",
    neon: "NEON",
    scrapbook: "SCRAPBOOK",
    stomp: "STOMP",
    block: "BLOCK",
  };
  const continuous = new Set(["BREATHE", "DRIFT", "TECTONIC"]);
  for (const [name, type] of Object.entries(expected)) {
    const record = LIVE.presets[name];
    assert.ok(record, `fixture preset ${name}`);
    // The live element is an Arabic paragraph: text.
    const last = importPage([text("LB1", record.animation)]).LB1;
    const next = importPage([text("LB1", record.animation)], { hasNextPage: true }).LB1;
    const direction = record.animation.Xw && record.animation.Xw.direction === 4 ? "LEFT" : "DEFAULT";
    if (continuous.has(type)) {
      assert.equal(last.animations.loop.type, type, name);
      assert.equal(last.animations.loop.params.concurrent, 1, name);
      if (name === "drift") assert.equal(last.animations.loop.direction, "LEFT");
      continue;
    }
    assert.equal(last.animations.entrance.type, type, name);
    assert.equal(last.animations.entrance.direction, direction, name);
    // Canva's last-page rule: the fresh tile's outro is dropped on the final page…
    assert.equal(last.animations.exit, null, name);
    // …and kept when a page follows, reversed or not (none of these store `reverse`).
    assert.equal(next.animations.exit.type, type, name);
    assert.equal(next.animations.exit.direction, direction, name);
  }
  assert.deepEqual(
    Object.keys(LIVE.presets).filter((name) => LIVE.presets[name].animation.Xw?.direction === 4),
    ["pan", "wipe", "drift", "block"]
  );
});

test("live records: the Rise variants — both / slow / slow+reverse / exit only / custom speed", () => {
  const rise = (variant) => importPage([element("LB1", LIVE.riseVariants[variant])]).LB1;
  const up = (durationMs, extra) => slot("RISE", durationMs, { direction: "UP", ...extra });
  // "كلاهما" writes qg:{} and Bf:{} — present but empty = Canva's windows: [0, 500] / [4000, 4500].
  assert.deepEqual(rise("both").animations, { entrance: up(500), exit: up(500), loop: null });
  // بطيء (c = .1): 5 s in / 2 s out stored; one speed → srf min(5000, 4000) = 4000, trf min(2000, 1000).
  assert.deepEqual(rise("bothSlow").animations, { entrance: up(4000), exit: up(1000), loop: null });
  assert.deepEqual(rise("bothSlowReverse").animations, { entrance: up(4000), exit: slot("RISE", 1000, { direction: "DOWN" }), loop: null });
  assert.deepEqual(windowOf(rise("bothSlow")), [0, 5000]);
  // Exit only: no intro; the outro at [4000, 4500].
  assert.deepEqual(rise("exitOnly").animations, { entrance: null, exit: up(500), loop: null });
  // The design's own 1724137.93 µs intro with no outro stored: srf min(1724.14, 4000) → 1724; qg only.
  assert.deepEqual(rise("customSpeedFromDesign").animations, { entrance: up(1724), exit: null, loop: null });
});

test("live records: repeating toggles (flicker's boolean Ezp included) stack in Canva's order", () => {
  mapping.drainCanvaAnimationImportWarnings();
  const withRecord = (name) => importPage([element("LB1", undefined, { Sz: { ref: LIVE.repeating[name] } })]).LB1;
  assert.deepEqual(withRecord("rotateOn").animations.loop, slot("ROTATE", 20300, { infinite: true, direction: "CLOCKWISE", params: { concurrent: 1, phaseMs: 0 } }));
  const all = withRecord("wiggleOn");
  assert.deepEqual(Object.keys(all.canvaRepeating), ["rotate", "flicker", "pulse", "wiggle"]);
  assert.deepEqual(all.animations.loop.params, {
    concurrent: 1,
    phaseMs: 0,
    stackPhaseMs: 0,
    stackFlicker: 1100,
    stackFlickerT: 0.5,
    stackPulse: 900,
    stackWiggle: 18200,
    stackWiggleT: 0.5,
    seed: 2e8,
  });
  assert.equal(all.canvaAnimationWarnings, undefined);
  assert.equal(mapping.drainCanvaAnimationImportWarnings().length, 0);
});

test("a rotate at a non-default slider keeps intensity 1: Canva's qwf always turns exactly ±360° per cycle", () => {
  // Vd 0.6 → t = (0.6 + 1) / 2 = 0.8 → cycle = sqf(40000, 600, .8) = 40000 + (600 − 40000)·.8 = 8480 ms.
  // Both runtimes multiply ROTATE's turn by intensity, so anything but 1 would over-rotate (0.5 + .8 = 1.3
  // → 468° per cycle). Only the cycle carries the slider; flicker/pulse/wiggle keep 0.5 + t.
  const fields = importPage([element("LB1", undefined, { Sz: { ref: { rotate: { Vd: 0.6, direction: 2 } } } })]).LB1;
  assert.equal(fields.animations.loop.type, "ROTATE");
  assert.equal(fields.animations.loop.durationMs, 8480);
  assert.equal(fields.animations.loop.direction, "COUNTERCLOCKWISE");
  assert.equal(fields.animations.loop.intensity, 1);
  const flicker = importPage([element("LB1", undefined, { Sz: { ref: { R2a: { Vd: 0.6, Ezp: false } } } })]).LB1;
  assert.equal(flicker.animations.loop.type, "FLICKER");
  assert.equal(flicker.animations.loop.intensity, 1.3);
});

test('live records: a cleared element ({type: "none"}) is no animation, even with a leftover preset id or a page animation', () => {
  assert.equal(importPage([element("LB1", LIVE.cleared.animation)]).LB1.animations, undefined);
  assert.equal(extraction.extractAnimation(element("LB1", { type: "none", animation: 8, Xw: { qg: {}, Bf: {} } })), null);
  assert.equal(importPage([element("LB1", LIVE.cleared.animation)], { page: { animation: 5 } }).LB1.animations, undefined);
  // A repeating effect is its own record on the element and survives a cleared preset.
  const fields = importPage([element("LB1", { type: "none", animation: 8 }, { Sz: { ref: { rotate: { Vd: 0, direction: 1 } } } })]).LB1;
  assert.equal(fields.animations.entrance, null);
  assert.equal(fields.animations.loop.type, "ROTATE");
});

// ── Extraction details ───────────────────────────────────────────────────────────────────────

test("the config is found structurally under any prop name, keeps Canva's raw µs, and its tracks resolve by order", () => {
  const record = extraction.extractAnimation(
    element("LB1", { type: "sequenced", animation: 8, Qz: { aa: { durationUs: 1724137.9310344828 }, bb: { durationUs: 300_000, reverse: true }, direction: 5, Vd: 0.25, ID: 2, NV: 1 } })
  );
  assert.deepEqual(plain(record.config), {
    qg: { durationUs: 1724137.9310344828 },
    Bf: { durationUs: 300000, reverse: true },
    direction: 5,
    Vd: 0.25,
    ID: 2,
    NV: 1,
  });
  // A freshly clicked tile stores no config at all.
  assert.equal("config" in plain(extraction.extractAnimation(element("LB1", { type: "sequenced", animation: 8 }))), false);
  // A static element (no preset, no tracks, no repeating record) extracts to null.
  assert.equal(extraction.extractAnimation(element("LB1", { type: "sequenced" })), null);
  assert.equal(extraction.extractAnimation(element("LB1")), null);
  // The schedule facts tell "no animation field" (a page animation applies) from "cleared".
  assert.equal(extraction.readScheduleFacts(element("LB1")).animationState, "absent");
  assert.equal(extraction.readScheduleFacts(element("LB1", { type: "none" })).animationState, "none");
  assert.deepEqual(plain(extraction.readScheduleFacts(element("LB1", { type: "independent", animation: 3 }))), { animationState: "present", animationType: "independent" });
});

test("page animation reading: Xw by name, a strict structural fallback, and no config when the page stores none", () => {
  assert.deepEqual(plain(extraction.readPageAnimation({ animation: 5 })), { preset: 5 });
  const stored = plain(extraction.readPageAnimation({ animation: 5, Xw: { qg: {}, Bf: { durationUs: 4e5, reverse: true }, direction: 3 } }));
  assert.deepEqual(stored.config, { qg: {}, Bf: { durationUs: 400000, reverse: true }, direction: 3 });
  assert.equal(stored.hasOut, true);
  // A renamed config prop is still found — but a page fill record (colour + transparency) is not
  // mistaken for one.
  assert.deepEqual(plain(extraction.readPageAnimation({ animation: 9, Zz: { direction: 4, qg: {} } })).config, { qg: {}, direction: 4 });
  assert.equal("config" in plain(extraction.readPageAnimation({ animation: 9, fill: { color: "#fff", transparency: 0 } })), false);
  assert.equal(extraction.readPageAnimation({ animation: 0 }), null);
  assert.deepEqual(plain(extraction.listCanvaPages({ pages: new Map([["a", { id: "p1" }], ["b", { id: "p2" }]]) })), [{ id: "p1" }, { id: "p2" }]);
});

test("the three fiber walks extract identical entries for the same elements", () => {
  const battery = [
    element("A", { type: "sequenced", animation: 8 }),
    element("B", {
      type: "sequenced",
      animation: 6,
      Xw: { qg: { durationUs: 1_000_000 }, Bf: { durationUs: 400_000, reverse: true }, direction: 4, Vd: 0.25, ID: 2, NV: 1, color: "#123456" },
    }),
    element("C", { type: "independent", animation: 2, Xw: { qg: {}, Bf: {}, scale: -0.7 } }, { durationUs: 3_000_000 }),
    element("D", { type: "sequenced", animation: 7, Qz: { aa: {}, bb: { reverse: true } } }, { Sz: { ref: { BJa: { Vd: 0.5, direction: 1 }, N5a: { Vd: -1 } } } }),
    element("E", { type: "none", animation: 8, Xw: { qg: {} } }, { Sz: { ref: { rotate: { Vd: 0, direction: 2 } } } }),
    element("F", { type: "sequenced", animation: 28, Xw: { Acb: { t: [0, 500, 1000], x: [0, 10, 20], y: [0, 0, 5], durationUs: 1_000_000 } } }),
    element("G", undefined, { Sz: { ref: { R2a: { Vd: 0.3, Ezp: true }, Zq9: { Vd: 0.1 } } } }),
    element("H", { type: "sequenced", animation: 8, Xw: { direction: "down", Vd: 2 } }, { startUs: 1_500_000 }),
    element("I", undefined, { startUs: 0 }),
    element("LB-J", undefined, {
      type: "group",
      contents: [text("LB-K", { type: "sequenced", animation: 4, Xw: { ID: 1 } }, { text: { stream: { attrs: { items: [{ s: { "font-size": 52 } }] } } } })],
      wb: 150,
    }),
    element("M", undefined, { fill: { image: { media: { id: "M1" } } } }),
    ...Object.values(LIVE.presets).map((record, index) => element(`P${index}`, record.animation, { top: 100 + index * 10 })),
    ...Object.values(LIVE.riseVariants).map((animation, index) => element(`R${index}`, animation, { left: 300 + index })),
    ...Object.values(LIVE.repeating).map((ref, index) => element(`Q${index}`, undefined, { Sz: { ref } })),
    element("Z", LIVE.cleared.animation),
  ];
  const run = (api) =>
    plain(
      api
        .collectCanvaElements(battery)
        .map(({ el, parentId }) => ({ id: el.id, ...api.readAnimationEntry(el, parentId), repeating: api.extractRepeating(el) }))
    );
  const reference = run(extractions["canva-fiber-main.js"]);
  for (const file of EXTRACT_FILES) {
    assert.deepEqual(run(extractions[file]), reference, `${file} extracts differently`);
  }
  const byId = Object.fromEntries(reference.map((entry) => [entry.id, entry]));
  // The battery really exercises the walk: most elements carry a record, and the records differ.
  const records = reference.map((entry) => entry.animation).filter(Boolean);
  assert.ok(records.length >= 20, `only ${records.length} records`);
  assert.ok(new Set(records.map((record) => JSON.stringify(record))).size >= 12);
  assert.equal(byId.A.animationState, "present");
  assert.equal(byId.E.animationState, "none");
  assert.equal(byId.E.animation.canvaPreset, null);
  assert.deepEqual(byId.E.animation.repeating, { rotate: { direction: 2, Vd: 0 } });
  assert.equal(byId.H.animation.direction, 3);
  assert.equal(byId.H.animation.Vd, 1);
  assert.equal(byId.H.startUs, 1500000);
  assert.equal(byId.I.startUs, 0);
  assert.equal("durationUs" in byId.I, false);
  assert.equal(byId.C.durationUs, 3000000);
  assert.equal(byId["LB-K"].parentId, "LB-J");
  assert.equal(byId["LB-K"].maxFontSize, 52);
  assert.equal(byId["LB-J"].layoutWidth, 150);
  assert.equal(byId.M.hasMediaFill, true);
  assert.deepEqual(byId.G.animation.repeating, { flicker: { Vd: 0.3 }, unknownKeys: ["Zq9"] });
});

test("the one-record fallback (no page model in reach) schedules the record alone on its own page", () => {
  const fields = plain(
    mapping.buildEditorAnimationFields(
      { canvaPreset: 8, family: "sequenced", config: { qg: {}, Bf: {}, direction: 2 }, pageDurationMs: 5000 },
      { id: "LB1", kind: "image", x: 100, y: 100, width: 200, height: 100 }
    )
  );
  assert.deepEqual(fields.animations, {
    entrance: slot("RISE", 500, { direction: "UP" }),
    exit: slot("RISE", 500, { direction: "UP" }),
    loop: null,
  });
  assert.equal(fields.mediaAnimationMode, "IN_OUT");
  // A pure custom motion path gets no preset slots.
  const path = plain(mapping.buildEditorAnimationFields({ canvaPreset: 28, motionPath: [{ t: 0, x: 0, y: 0 }, { t: 500, x: 40, y: 0 }] }, { kind: "image" }));
  assert.deepEqual(path.mediaMotionPath, [{ t: 0, x: 0, y: 0 }, { t: 500, x: 40, y: 0 }]);
  assert.equal(path.animations, undefined);
});

test("a captured background video's length re-times the page (the model states none for a video page)", () => {
  const page = importPage([element("LB1", { type: "sequenced", animation: 4, Xw: { qg: {}, Bf: {} } })], { pageDurationMs: 0, overridePageMs: 12000 });
  // 12 s: out from 11000 for 500.
  assert.deepEqual(windowOf(page.LB1), [0, 11500]);
});
