// Canva's Photo Flow moves each PHOTO INSIDE its frame (the frame never moves): photos fade in one
// after another on the page's photo timing, zoomed 1 + k and panned k along an axis picked from the
// frame's shape or quarter of the page. Read from Canva's bundle (eQf / fQf / YQf / XQf). The blocks
// are evaluated straight out of background.js between their marker comments.
//
// DAHNZYC32A0 (15 s, 30 photos, Photo Flow page) used to play element Drift: whole flowers sliding
// up to 270 px each way for 7 s.
//
//   node --test extensions/canva-importer/test/photo-flow.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "background.js"), "utf8");
const slice = (name) => {
  const start = source.indexOf(`// ── ${name}:start`);
  const end = source.indexOf(`// ── ${name}:end`);
  assert.ok(start >= 0 && end > start, `${name} markers missing`);
  return source.slice(source.lastIndexOf("\n", start) + 1, end);
};
const mapping = vm.runInNewContext(
  `${slice("canva-animation-mapping")}\n;({ scheduleCanvaPage, canvaPhotoPageTiming, canvaPhotoFlowMotion, applyCanvaPageAnimations });`,
  {}
);
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≠ ${expected}`);

test("the photo timing of a 15 s page with 30 photos", () => {
  const timing = plain(mapping.canvaPhotoPageTiming({ pageMs: 15000, photoCount: 30, otherCount: 4 }));
  // span 8000 − 750 = 7250; slot 241.67, step .66 of it, then the slot widened by the span's leftover / N.
  const slot0 = 7250 / 30;
  const step = slot0 * 0.66;
  const slot = slot0 + (7250 - (29 * step + slot0)) / 30;
  near(timing.stepMs, step);
  near(timing.flowMs, slot);
  near(timing.fadeMs, slot);
  // The outro leg: 750 ms at the page end, staggered over max(photos, others).
  assert.equal(timing.outro.delay, 14250);
});

test("one photo flows over the whole span, the fade capped at 1.3 s", () => {
  const timing = plain(mapping.canvaPhotoPageTiming({ pageMs: 15000, photoCount: 1, otherCount: 0 }));
  near(timing.flowMs, 7250);
  near(timing.fadeMs, 1300);
  near(timing.stepMs, 7250 * 0.66);
});

test("a short page scales the outro span and the fade cap", () => {
  const timing = plain(mapping.canvaPhotoPageTiming({ pageMs: 1025, photoCount: 1, otherCount: 0 }));
  // factor = 1025 / 2050 = .5 → outro span 375, fade cap 650.
  near(timing.flowMs, 1025 - 375);
  near(timing.fadeMs, 650);
});

test("the pan axis and direction, from the frame and its quarter of the page", () => {
  const page = { pageWidth: 1080, pageHeight: 1920 };
  const motion = (box) => plain(mapping.canvaPhotoFlowMotion({ box, ...page }));
  // Top-left quarter → right; bottom-left → up; top-right → down; bottom-right → left.
  const topLeft = motion({ left: 100, top: 100, width: 300, height: 300 });
  assert.equal(topLeft.horizontal, true);
  assert.ok(topLeft.from < 0 && topLeft.to > 0);
  const bottomLeft = motion({ left: 100, top: 1500, width: 300, height: 300 });
  assert.equal(bottomLeft.horizontal, false);
  assert.ok(bottomLeft.from > 0 && bottomLeft.to < 0);
  const topRight = motion({ left: 700, top: 100, width: 300, height: 300 });
  assert.equal(topRight.horizontal, false);
  assert.ok(topRight.from < 0 && topRight.to > 0);
  const bottomRight = motion({ left: 700, top: 1500, width: 300, height: 300 });
  assert.equal(bottomRight.horizontal, true);
  assert.ok(bottomRight.from > 0 && bottomRight.to < 0);
  // A tall frame pans up, a wide one right, wherever they are.
  const tall = motion({ left: 700, top: 100, width: 100, height: 300 });
  assert.equal(tall.horizontal, false);
  assert.ok(tall.to < 0);
  const wide = motion({ left: 700, top: 1500, width: 600, height: 300 });
  assert.equal(wide.horizontal, true);
  assert.ok(wide.to > 0);
  // Intensity .5: zoom 1.06 and a 6% pan of the axis size, centred.
  near(bottomLeft.scale, 1.06);
  near(bottomLeft.to - bottomLeft.from, -0.06 * 300);
  near(plain(mapping.canvaPhotoFlowMotion({ box: { left: 100, top: 1500, width: 300, height: 300 }, ...page, intensity: 1 })).scale, 1.1);
});

const photo = (id, left, top, width, height, extra = {}) => ({
  id,
  type: "rect",
  zOrder: 0,
  left,
  top,
  width,
  height,
  rotation: 0,
  animationState: "absent",
  animation: null,
  repeating: null,
  hasMediaFill: true,
  children: [],
  ...extra,
});

test("a Photo Flow page: photos fade in one by one, zoomed and panned in place, never travelling", () => {
  const page = {
    durationMs: 15000,
    width: 1080,
    height: 1920,
    hasNextPage: false,
    animation: { preset: 17, config: null },
    background: null,
    elements: [
      photo("LBa", 100, 1500, 300, 300),
      photo("LBb", 700, 1500, 300, 300),
      photo("LBc", 100, 100, 300, 300),
      photo("LBtimed", 400, 200, 300, 300, { startUs: 2333333 }),
      {
        id: "LBtext",
        type: "text",
        zOrder: 0,
        left: 200,
        top: 800,
        width: 600,
        height: 60,
        rotation: 0,
        animationState: "absent",
        animation: null,
        repeating: null,
        text: { maxFontSize: 40 },
        hasMediaFill: false,
        children: [],
      },
    ],
  };
  const scheduled = plain(mapping.scheduleCanvaPage(page));
  const timing = plain(mapping.canvaPhotoPageTiming({ pageMs: 15000, photoCount: 4, otherCount: 1 }));
  const untimed = ["LBa", "LBb", "LBc"].map((id) => scheduled.elements[id]);
  for (const entry of untimed) {
    assert.equal(entry.type, "BREATHE");
    assert.ok(entry.ramp && entry.ramp.ramps.length === 1);
    near(entry.ramp.ramps[0].from, 1.06);
    near(entry.ramp.ramps[0].to, 1.06);
    near(entry.ramp.ramps[0].duration, timing.flowMs);
    assert.equal(entry.ramp.ramps[0].ease, 4);
    near(entry.entrance.durationMs, Math.round(timing.fadeMs), 1);
    // The last page: a leg running to the end gets no outro.
    assert.equal(entry.exit, null);
  }
  // Each untimed photo starts one step after the previous, in the page's order.
  const delays = untimed.map((entry) => entry.entrance.startMs).sort((a, b) => a - b);
  near(delays[0], 0);
  near(delays[1], timing.stepMs);
  near(delays[2], 2 * timing.stepMs);
  // A vertical pan rides on the lift, a sideways one on the slide — never both.
  assert.ok(scheduled.elements.LBa.ramp.lift && scheduled.elements.LBa.ramp.lift.to < 0);
  assert.equal(scheduled.elements.LBa.ramp.slide, null);
  // Bottom-right pans left, top-left right; 6% of 300 px, centred.
  assert.equal(scheduled.elements.LBb.ramp.lift, null);
  near(scheduled.elements.LBb.ramp.slide.from, 9);
  near(scheduled.elements.LBb.ramp.slide.to, -9);
  near(scheduled.elements.LBc.ramp.slide.from, -9);
  near(scheduled.elements.LBc.ramp.slide.to, 9);
  // A timed photo plays on its own window and takes no step.
  near(scheduled.elements.LBtimed.entrance.startMs, 2333.333, 0.01);
  near(scheduled.elements.LBtimed.ramp.ramps[0].delay, 2333.333, 0.01);
  // The text keeps its Fade.
  assert.equal(scheduled.elements.LBtext.type, "FADE");
});

test("a turned photo pans along its own axes, split over the page's x and y", () => {
  const page = {
    durationMs: 15000,
    width: 1080,
    height: 1920,
    hasNextPage: false,
    animation: { preset: 17, config: null },
    background: null,
    // Top-left quarter → a rightward pan in the frame; turned 90° it runs DOWN the page.
    elements: [photo("LBturned", 100, 100, 300, 300, { rotation: 90 }), photo("LBtilt", 100, 100, 300, 300, { rotation: 30 })],
  };
  const scheduled = plain(mapping.scheduleCanvaPage(page));
  const turned = scheduled.elements.LBturned.ramp;
  assert.equal(turned.slide, null);
  near(turned.lift.from, -9, 1e-3);
  near(turned.lift.to, 9, 1e-3);
  const tilt = scheduled.elements.LBtilt.ramp;
  near(tilt.slide.to, 9 * Math.cos(Math.PI / 6), 1e-3);
  near(tilt.lift.to, 9 * Math.sin(Math.PI / 6), 1e-3);
  near(tilt.slide.from, -tilt.slide.to, 1e-3);
});

test("the emitted loop carries the slide as x1 params on the ramp's timing", () => {
  const objects = [{ importNodeId: "LBb", type: "image" }, { importNodeId: "LBa", type: "image" }];
  const model = {
    __pageAnimation: { preset: 17 },
    __pageDurationMs: 15000,
    __pageWidth: 1080,
    __pageHeight: 1920,
    LBa: { type: "rect", left: 100, top: 1500, width: 300, height: 300, zOrder: 0, hasMediaFill: true },
    LBb: { type: "rect", left: 700, top: 1500, width: 300, height: 300, zOrder: 1, hasMediaFill: true },
  };
  mapping.applyCanvaPageAnimations(objects, [], model, { pageDurationMs: 15000 });
  const sideways = plain(objects[0].animations.loop.params);
  near(sideways.x1From, 9);
  near(sideways.x1To, -9);
  assert.equal(sideways.y1From, undefined);
  near(sideways.r1From, 1.06);
  const vertical = plain(objects[1].animations.loop.params);
  near(vertical.y1From, 9);
  near(vertical.y1To, -9);
  assert.equal(vertical.x1From, undefined);
});
