import test from "node:test";
import assert from "node:assert/strict";

import { cubicBezierEase, valueAtFrame } from "./animationCurves";
import {
  ANIMATION_CATALOG,
  ANIMATION_TYPES,
  getAnimationDefaults,
  getAnimationLabel,
  getAnimationTypeSpec,
  getAuthoredCurves,
  normalizeSpecAnimationType,
  normalizeSpecDirection,
  normalizeSpecEasing,
  type AnimationCategory,
} from "./animationSpec";
import { makeAnimationSpec, resolveTimelinePlaybackState } from "./animationSlots";
import {
  MAX_ANIMATION_INTENSITY,
  MIN_ANIMATION_INTENSITY,
  applyAnimationEasing,
  pingPongProgress,
  resolveAnimationVector,
  resolveAnimationVisualState,
  rotationSpin,
  type AnimationSpecInput,
  type RevealMaskSpec,
} from "./animationVisual";

/** |actual - expected| < 10^-precision / 2 — the tolerance convention used across these tests. */
function closeTo(actual: number, expected: number, precision = 6, message?: string) {
  const tolerance = Math.pow(10, -precision) / 2;
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    message ?? `expected ${actual} to be close to ${expected} (precision ${precision})`
  );
}

function notCloseTo(actual: number, expected: number, precision = 3) {
  const tolerance = Math.pow(10, -precision) / 2;
  assert.ok(
    Math.abs(actual - expected) >= tolerance,
    `expected ${actual} NOT to be close to ${expected} (precision ${precision})`
  );
}

const spec = (type: string, over: Record<string, unknown> = {}) =>
  makeAnimationSpec({ type, ...over });

const W = 200;
const H = 100;

/** The exit slot hands the runtime `1 − u` (animationSlots.resolveTimelinePlaybackState). */
const exiting = (type: string, u: number, over: Record<string, unknown> = {}, layerIndex = 0) =>
  resolveAnimationVisualState(spec(type, over), 1 - u, W, H, true, layerIndex);
const entering = (type: string, p: number, over: Record<string, unknown> = {}, layerIndex = 0) =>
  resolveAnimationVisualState(spec(type, over), p, W, H, false, layerIndex);

/** Canva's easings (docs/canva-animation-parity.md §1), restated here so a test reads as the spec. */
const easeInQuad = (u: number) => u * u;
const easeOutQuad = (u: number) => u * (2 - u);
const easeInCubic = (u: number) => u * u * u;
const easeOutCubic = (u: number) => Math.pow(u - 1, 3) + 1;
const easeInQuart = (u: number) => u * u * u * u;
const easeOutExpo = (u: number) => 1 - Math.pow(2, -10 * u);
const easeInSine = (u: number) => 1 - Math.cos((u * Math.PI) / 2);

const wipe = (state: { revealMask: RevealMaskSpec | null }) => {
  assert.ok(state.revealMask, "expected a reveal mask");
  assert.equal(state.revealMask.kind, "WIPE");
  return state.revealMask as {
    kind: "WIPE";
    progress: number;
    featherFraction: number;
    edge?: string;
    anchored?: boolean;
  };
};

// ── spec data integrity ───────────────────────────────────────────────────────

test("every type has exactly one of authoredCurves or formula", () => {
  for (const entry of ANIMATION_TYPES) {
    const hasCurves = Boolean(entry.authoredCurves);
    const hasFormula = Boolean(entry.formula);
    assert.ok(hasCurves !== hasFormula, `${entry.type} must have exactly one`);
  }
});

test("every catalog entry resolves to a type offered in that tab", () => {
  for (const [category, types] of Object.entries(ANIMATION_CATALOG)) {
    for (const type of types) {
      const entry = getAnimationTypeSpec(type);
      assert.ok(entry, `${type} missing from types`);
      assert.ok(entry.tabs.includes(category as AnimationCategory), `${type} not in ${category}`);
    }
  }
});

test("the Canva family plays formulas, not authored curves", () => {
  // Fade, Pop and Wipe used to be Andalusi's keyframes; Flicker and Pulse too. They are Canva's
  // own tween formulas now (docs/canva-animation-parity.md §2 and §4).
  for (const type of ["FADE", "POP", "WIPE", "FLICKER", "PULSE"]) {
    assert.equal(getAuthoredCurves(type), null, `${type} must not carry authored curves`);
    assert.ok(getAnimationTypeSpec(type)?.formula, `${type} must carry a formula`);
  }
});

test("the tabs offer Canva's family where Canva offers it (spec §7)", () => {
  const entrance = ANIMATION_CATALOG.ENTRANCE;
  const exit = ANIMATION_CATALOG.EXIT;
  // Appended in the spec's order.
  assert.deepEqual(entrance.slice(-7), ["PAN", "BLUR", "BASELINE", "TUMBLE", "NEON", "SCRAPBOOK", "STOMP"]);
  assert.deepEqual(exit.slice(-4), ["POP", "BASELINE", "NEON", "SCRAPBOOK"]);
  for (const type of ["BREATHE", "DRIFT", "TECTONIC", "ROTATE", "FLICKER", "PULSE", "WIGGLE"]) {
    assert.ok(ANIMATION_CATALOG.LOOP.includes(type), `${type} is a loop`);
  }
  // The continuous three have no enter/exit choice in Canva.
  assert.ok(!entrance.includes("BREATHE") && !exit.includes("BREATHE"));
  assert.ok(!entrance.includes("DRIFT"));
  assert.ok(!entrance.includes("TECTONIC"));
});

test("the Canva family carries Canva's labels and timings (spec §1)", () => {
  assert.equal(getAnimationLabel("RISE", "ar"), "ارتقاء");
  assert.equal(getAnimationLabel("PAN", "ar"), "تأرجح");
  assert.equal(getAnimationLabel("WIPE", "ar"), "المسح");
  assert.equal(getAnimationLabel("BLUR", "en"), "Blur");
  assert.equal(getAnimationLabel("STOMP", "ar"), "سقوط هوائي");
  assert.equal(getAnimationLabel("ROTATE", "en"), "Rotate");
  assert.equal(getAnimationLabel("TUMBLE", "ar"), "دوران");
  assert.equal(getAnimationLabel("PULSE", "ar"), "تقليص العنصر وتمديده");
  for (const type of ["RISE", "PAN", "FADE", "POP", "WIPE", "BLUR", "SUCCESSION", "BASELINE", "TUMBLE", "NEON", "SCRAPBOOK", "STOMP"]) {
    const d = getAnimationDefaults(type);
    assert.equal(d.durationMs, 500, `${type} intro is Canva's 500 ms`);
    assert.equal(d.easing, "LINEAR", `${type} easing is computed inline, so the spec's is LINEAR`);
  }
  assert.equal(getAnimationDefaults("RISE").direction, "UP");
  assert.equal(getAnimationDefaults("PAN").direction, "RIGHT");
  assert.equal(getAnimationDefaults("WIPE").direction, "RIGHT");
  assert.equal(getAnimationDefaults("BASELINE").direction, "UP");
  assert.equal(getAnimationDefaults("TUMBLE").direction, "DEFAULT");
  for (const type of ["BREATHE", "DRIFT", "TECTONIC"]) {
    assert.equal(getAnimationDefaults(type).durationMs, 10000, `${type} spans a whole window`);
  }
  assert.equal(getAnimationDefaults("DRIFT").direction, "RIGHT");
  assert.equal(getAnimationDefaults("ROTATE").durationMs, 20300);
  assert.equal(getAnimationDefaults("ROTATE").direction, "CLOCKWISE");
  assert.equal(getAnimationDefaults("FLICKER").durationMs, 1100);
  assert.equal(getAnimationDefaults("PULSE").durationMs, 900);
  assert.equal(getAnimationDefaults("WIGGLE").durationMs, 18200);
});

test("DISSOLVE is labelled differently on entry vs exit", () => {
  assert.equal(getAnimationLabel("DISSOLVE", "en", "ENTRANCE"), "Descend");
  assert.equal(getAnimationLabel("DISSOLVE", "en", "EXIT"), "Dissolve");
  assert.equal(getAnimationLabel("DISSOLVE", "ar", "EXIT"), "اندثار");
  // A type without an exit-specific label keeps its normal one.
  assert.equal(getAnimationLabel("FADE", "en", "EXIT"), "Fade");
});

test("unknown enum values fall back to NONE / DEFAULT", () => {
  assert.equal(normalizeSpecAnimationType("NOT_A_TYPE"), "NONE");
  assert.equal(normalizeSpecAnimationType("rise"), "RISE");
  assert.equal(normalizeSpecDirection("sideways"), "DEFAULT");
  assert.equal(normalizeSpecEasing(undefined), "DEFAULT");
  // The web's old CENTER direction is not a spec value — it must not survive.
  assert.equal(normalizeSpecDirection("CENTER"), "DEFAULT");
});

// ── runtime helpers ───────────────────────────────────────────────────────────

test("pingPongProgress is a raised cosine, not a triangle", () => {
  closeTo(pingPongProgress(0), 0);
  closeTo(pingPongProgress(0.5), 1);
  closeTo(pingPongProgress(1), 0);
  closeTo(pingPongProgress(0.25), 0.5);
  // A triangle wave would give 0.25 here; the raised cosine gives 0.1464.
  closeTo(pingPongProgress(0.125), 0.14644661);
  notCloseTo(pingPongProgress(0.125), 0.25);
});

test("applyAnimationEasing matches applyLayerAnimationEasing for every easing", () => {
  closeTo(applyAnimationEasing(0.5, "LINEAR"), 0.5);
  closeTo(applyAnimationEasing(0.5, "DEFAULT"), 0.5);
  // EASE_IN was missing from the web enum entirely and silently fell back to linear.
  closeTo(applyAnimationEasing(0.5, "EASE_IN"), 0.25);
  closeTo(applyAnimationEasing(0.5, "EASE_OUT"), 0.875);
  closeTo(applyAnimationEasing(0.5, "SOFT_OUT"), 0.9375);
  closeTo(applyAnimationEasing(0.5, "EASE_IN_OUT"), 0.5);
  closeTo(applyAnimationEasing(0.5, "SOFT_IN_OUT"), 0.5);
  closeTo(applyAnimationEasing(0.25, "SOFT_IN_OUT"), 0.14644661);
});

test("the direction vector and the rotation spin are separate", () => {
  assert.deepEqual(resolveAnimationVector("LEFT"), { x: -1, y: 0 });
  assert.deepEqual(resolveAnimationVector("UP"), { x: 0, y: -1 });
  assert.deepEqual(resolveAnimationVector("CLOCKWISE"), { x: 0, y: 0 });
  assert.equal(rotationSpin("LEFT"), -1);
  assert.equal(rotationSpin("COUNTERCLOCKWISE"), -1);
  // The old web helper fused vector+spin and returned -1 for UP; mobile returns +1.
  assert.equal(rotationSpin("UP"), 1);
  assert.equal(rotationSpin("DEFAULT"), 1);
});

test("a DEFAULT direction resolves to the type's own default, as the app does", () => {
  // A zero vector would leave Drift motionless; the app resolves DEFAULT to the preset's direction.
  const drift = entering("DRIFT", 0, { direction: "DEFAULT" });
  closeTo(drift.translationX, -120);
  closeTo(drift.translationY, 0);
  const rise = entering("RISE", 0, { direction: "DEFAULT" });
  closeTo(rise.translationY, 80);
});

test("intensity is clamped to the shared 0.1..4.0 band", () => {
  assert.equal(MIN_ANIMATION_INTENSITY, 0.1);
  assert.equal(MAX_ANIMATION_INTENSITY, 4);
  // Drift's amplitude is 120 px per unit of intensity, so the band shows directly on it.
  closeTo(entering("DRIFT", 0, { intensity: 10 }).translationX, -120 * 4);
  closeTo(entering("DRIFT", 0, { intensity: 0 }).translationX, -120 * 0.1);
  // 4 is inside the band — the old 2.4 ceiling would have cut a Drift's imported amplitude.
  closeTo(entering("DRIFT", 0, { intensity: 4 }).translationX, -480);
});

// ── keyframe player ───────────────────────────────────────────────────────────

test("keyframes clamp outside the authored range instead of extrapolating", () => {
  const kf = [
    { frame: 5, value: 0, easing: null, hold: false },
    { frame: 25, value: 1, easing: null, hold: false },
  ];
  assert.equal(valueAtFrame(kf, 0), 0);
  assert.equal(valueAtFrame(kf, 5), 0);
  closeTo(valueAtFrame(kf, 15), 0.5);
  assert.equal(valueAtFrame(kf, 25), 1);
  assert.equal(valueAtFrame(kf, 999), 1);
});

test("hold makes a keyframe segment a step", () => {
  const kf = [
    { frame: 0, value: 0, easing: null, hold: true },
    { frame: 10, value: 1, easing: null, hold: false },
  ];
  assert.equal(valueAtFrame(kf, 5), 0);
  assert.equal(valueAtFrame(kf, 9.9), 0);
  assert.equal(valueAtFrame(kf, 10), 1);
});

test("cubic-bezier solves, including control points outside 0..1", () => {
  closeTo(cubicBezierEase(0, 0.4, 0, 0.6, 1), 0);
  closeTo(cubicBezierEase(1, 0.4, 0, 0.6, 1), 1);
  // A linear bezier is the identity.
  closeTo(cubicBezierEase(0.35, 0.3333, 0.3333, 0.6667, 0.6667), 0.35, 2);
  // WOBBLE overshoots and BOUNCE undershoots (y1 = -0.25). Must stay finite.
  assert.ok(Number.isFinite(cubicBezierEase(0.5, 0.6, 0, 0.48, 1.178)));
  assert.ok(Number.isFinite(cubicBezierEase(0.5, 0.167, -0.25, 0.833, 0.967)));
});

// ── visual state ──────────────────────────────────────────────────────────────

test("NONE and STATIC resolve to identity", () => {
  for (const type of ["NONE", "STATIC"]) {
    const state = resolveAnimationVisualState(spec(type), 0.5, W, H);
    assert.equal(state.alphaMultiplier, 1);
    assert.equal(state.scaleMultiplier, 1);
    assert.equal(state.translationX, 0);
    assert.equal(state.translationY, 0);
  }
});

/**
 * FADE is Canva's تلاشي (spec §2): opacity alone, easeOutQuad on the way in and easeInQuad on the
 * way out. Nothing else moves.
 */
test("FADE is opacity alone on Canva's quadratic eases", () => {
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    const state = entering("FADE", p);
    closeTo(state.alphaMultiplier, easeOutQuad(p));
    closeTo(state.translationX, 0);
    closeTo(state.translationY, 0);
    closeTo(state.scaleMultiplier, 1);
    closeTo(state.blurRadiusPx, 0);
    assert.equal(state.revealMask, null);
  }
  for (const u of [0, 0.25, 0.5, 0.75, 1]) {
    closeTo(exiting("FADE", u).alphaMultiplier, 1 - easeInQuad(u));
  }
});

/**
 * The frames below were measured off an MP4 Canva exported of their own تلاشي (1080x1920, 30fps,
 * "متوسط", 15 frames). Canva's code says easeOutQuad; the recording lags it by well under a frame,
 * so this is only a sanity check that the formula is the same curve, not a fit.
 */
test("FADE stays within a frame of Canva's own recorded fade", () => {
  const canva = [
    0, 0.1, 0.206, 0.311, 0.415, 0.51, 0.601, 0.675,
    0.747, 0.814, 0.877, 0.922, 0.959, 0.981, 0.996, 0.999,
  ];
  let worst = 0;
  for (let frame = 0; frame < canva.length; frame += 1) {
    const state = entering("FADE", frame / (canva.length - 1));
    worst = Math.max(worst, Math.abs(state.alphaMultiplier - canva[frame]));
  }
  assert.ok(worst <= 0.05, `worst gap against Canva's frames is ${worst.toFixed(3)}`);
});

test("RISE settles to its resting pose at progress 1", () => {
  const state = resolveAnimationVisualState(spec("RISE"), 1, W, H);
  closeTo(state.translationY, 0);
  closeTo(state.alphaMultiplier, 1);
});

/**
 * A one-shot RISE is Canva's ارتقاء (spec §2): 80px of travel and opacity 0 -> 1, both on a
 * quadratic ease-out, the same 80px whatever the layer's size. An INFINITE rise keeps the older
 * height-proportional bob.
 */
test("a one-shot RISE starts 80px low and fully transparent", () => {
  const state = entering("RISE", 0);
  closeTo(state.translationY, 80);
  closeTo(state.alphaMultiplier, 0);
});

test("a one-shot RISE travels the same distance whatever the layer's size", () => {
  const tiny = resolveAnimationVisualState(spec("RISE", { infinite: false }), 0, 10, 10);
  const huge = resolveAnimationVisualState(spec("RISE", { infinite: false }), 0, 900, 700);
  closeTo(tiny.translationY, 80);
  closeTo(huge.translationY, 80);
});

test("a one-shot RISE follows Canva's quadratic ease-out: p = 0.5 → alpha 0.75, 20px low", () => {
  const half = entering("RISE", 0.5);
  closeTo(half.alphaMultiplier, 0.75);
  closeTo(half.translationY, 20);
  for (const p of [0.25, 0.5, 0.75]) {
    const state = entering("RISE", p);
    closeTo(state.alphaMultiplier, easeOutQuad(p));
    closeTo(state.translationY, (1 - easeOutQuad(p)) * 80);
  }
});

test("a one-shot RISE exits by continuing upward on an ease-in, not by reversing", () => {
  // u = 0.5 → e = 0.25: still three-quarters opaque and 20px ABOVE home (a reversed entrance would
  // put it 20px below and, with the generic exit fade, at alpha 0.375).
  const half = exiting("RISE", 0.5);
  closeTo(half.alphaMultiplier, 0.75);
  closeTo(half.translationY, -20);
  const gone = exiting("RISE", 1);
  closeTo(gone.alphaMultiplier, 0);
  closeTo(gone.translationY, -80);
  // A reversed exit arrives as the opposite direction and heads back down.
  closeTo(exiting("RISE", 1, { direction: "DOWN" }).translationY, 80);
});

test("an infinite RISE keeps its height-proportional bob", () => {
  const state = resolveAnimationVisualState(spec("RISE", { infinite: true }), 0, W, H);
  closeTo(state.translationY, Math.max(16, H * 0.22));
  closeTo(state.alphaMultiplier, 0.12);
});

/** PAN is Rise on the horizontal axis: dir RIGHT starts 80px to the LEFT and moves right. */
test("a one-shot PAN is Rise sideways: it starts 80px against its direction", () => {
  closeTo(entering("PAN", 0, { direction: "RIGHT" }).translationX, -80);
  closeTo(entering("PAN", 0, { direction: "LEFT" }).translationX, 80);
  closeTo(entering("PAN", 0).translationY, 0);
  closeTo(entering("PAN", 0.5).translationX, -20);
  closeTo(entering("PAN", 0.5).alphaMultiplier, 0.75);
  // And keeps going the same way on the way out.
  closeTo(exiting("PAN", 1, { direction: "RIGHT" }).translationX, 80);
});

test("an infinite PAN keeps the older width-proportional slide", () => {
  const state = resolveAnimationVisualState(spec("PAN", { infinite: true }), 0, W, H);
  closeTo(state.translationX, Math.max(22, W * 0.28));
  closeTo(state.alphaMultiplier, 0.16);
});

/** SHIFT and SKATE are Rise and Pan mirrored (direction DOWN / LEFT), so they ride the same tween. */
test("a one-shot SHIFT or SKATE is Rise or Pan mirrored", () => {
  closeTo(entering("SHIFT", 0).translationY, -80, 6, "starts above, settles down");
  closeTo(entering("SHIFT", 0).alphaMultiplier, 0);
  closeTo(entering("SHIFT", 0.5).translationY, -20);
  closeTo(entering("SHIFT", 1).translationY, 0);
  closeTo(entering("SKATE", 0).translationX, 80, 6, "starts right, glides left");
  closeTo(entering("SKATE", 0.5).translationX, 20);
  closeTo(exiting("SKATE", 0.5).translationX, -20, 6, "keeps gliding left on the way out");
  closeTo(exiting("SKATE", 0.5).alphaMultiplier, 0.75);
  closeTo(exiting("SHIFT", 1).translationY, 80);
  closeTo(exiting("SHIFT", 1).alphaMultiplier, 0);
});

test("the Rise family is a flat 80px: it ignores intensity and resolves a spin to its own axis", () => {
  closeTo(entering("RISE", 0, { intensity: 3 }).translationY, 80);
  closeTo(entering("PAN", 0, { intensity: 0.5 }).translationX, -80);
  // A non-axis direction (a spin, or DEFAULT) is the type's own preset axis, as the app resolves it.
  closeTo(entering("RISE", 0, { direction: "CLOCKWISE" }).translationY, 80);
  closeTo(entering("SKATE", 0, { direction: "COUNTERCLOCKWISE" }).translationX, 80);
  closeTo(entering("RISE", 0, { direction: "DOWN" }).translationY, -80);
});

test("amplitudes honour their min-px floor on tiny layers", () => {
  // The loop slide — a one-shot SKATE is Canva's Pan mirrored, a flat 80 px whatever the size.
  const state = resolveAnimationVisualState(spec("SKATE", { infinite: true }), 0, 10, 10);
  closeTo(state.translationX, -22);
  closeTo(resolveAnimationVisualState(spec("SKATE", { infinite: false }), 0, 10, 10).translationX, 80);
});

/** POP is Canva's انبثاق (spec §2): an elastic scale, no opacity change, no rotation. */
test("POP overshoots past 1 on the way in and shrinks to nothing on the way out", () => {
  closeTo(entering("POP", 0).scaleMultiplier, 0);
  closeTo(entering("POP", 1).scaleMultiplier, 1);
  // elasticOut(1) peaks near u ≈ 0.175 at ~1.27.
  const peak = entering("POP", 0.175).scaleMultiplier;
  assert.ok(peak > 1.2 && peak < 1.3, `expected the overshoot near 1.27, got ${peak}`);
  let maxScale = 0;
  for (let i = 0; i <= 100; i += 1) {
    const state = entering("POP", i / 100);
    maxScale = Math.max(maxScale, state.scaleMultiplier);
    closeTo(state.alphaMultiplier, 1);
    closeTo(state.rotationDeltaDegrees, 0);
  }
  assert.ok(maxScale > 1.2, "POP must overshoot");
  // Exit: scale 1 → 0 on elasticIn, opacity untouched — the layer leaves by vanishing in size.
  closeTo(exiting("POP", 0).scaleMultiplier, 1);
  closeTo(exiting("POP", 1).scaleMultiplier, 0);
  closeTo(exiting("POP", 1).alphaMultiplier, 1);
});

/**
 * WIPE is Canva's المسح (spec §2): a pure clip reveal. The band grows from the edge the motion
 * starts at (dir RIGHT → from the LEFT edge) on easeOutCubic, and on the way out keeps sweeping
 * the same way on easeInCubic, so the part revealed first disappears first.
 */
test("WIPE reveals a band from the edge the motion starts at and never moves the content", () => {
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    const state = entering("WIPE", p, { direction: "RIGHT" });
    const mask = wipe(state);
    assert.equal(mask.edge, "LEFT");
    closeTo(mask.progress, easeOutCubic(p));
    closeTo(mask.featherFraction, 0);
    closeTo(state.translationX, 0);
    closeTo(state.scaleXMultiplier, 1);
    closeTo(state.alphaMultiplier, 1);
  }
  assert.equal(wipe(entering("WIPE", 0.5, { direction: "LEFT" })).edge, "RIGHT");
  assert.equal(wipe(entering("WIPE", 0.5, { direction: "UP" })).edge, "BOTTOM");
  assert.equal(wipe(entering("WIPE", 0.5, { direction: "DOWN" })).edge, "TOP");
  // DEFAULT is the type's default, RIGHT.
  assert.equal(wipe(entering("WIPE", 0.5, { direction: "DEFAULT" })).edge, "LEFT");
});

/**
 * §8.3 item 1: Canva caps only its DEFAULT Wipe window (750 ms, text 1500), which the importer now
 * computes; an explicit duration runs in full. So the runtime has no cap at all.
 */
test("WIPE plays its band over the whole slot, however long (no runtime cap)", () => {
  const long = (p: number) => wipe(entering("WIPE", p, { durationMs: 1500 })).progress;
  closeTo(long(0.25), easeOutCubic(0.25), 6, "375ms into a 1500ms band");
  closeTo(long(0.5), easeOutCubic(0.5));
  closeTo(long(0.75), easeOutCubic(0.75));
  closeTo(long(1), 1);
  closeTo(wipe(entering("WIPE", 0.5, { durationMs: 500 })).progress, easeOutCubic(0.5));
  closeTo(wipe(exiting("WIPE", 0.5, { durationMs: 1500 })).progress, 1 - easeInCubic(0.5));
});

test("WIPE, BASELINE and BLOCK masks are anchored; the legacy reveals are not (§8.3 item 2)", () => {
  assert.equal(wipe(entering("WIPE", 0.5)).anchored, true);
  assert.equal(wipe(exiting("WIPE", 0.5)).anchored, true);
  assert.equal(wipe(entering("BASELINE", 0.5)).anchored, true);
  assert.equal(wipe(exiting("BASELINE", 0.3)).anchored, true);
  assert.equal(wipe(entering("BLOCK", 0.7)).anchored, true);
  assert.equal(wipe(exiting("BLOCK", 0.2)).anchored, true);
  // The typewriter family and the per-glyph fallbacks keep mirroring for right-to-left text.
  for (const type of ["TYPEWRITER_CHARS", "ONE_WORD", "ASCEND", "GRADIENT_WIPE"]) {
    const mask = entering(type, 0.5).revealMask as { anchored?: boolean } | null;
    assert.ok(mask, `${type} has a mask`);
    assert.ok(!mask.anchored, `${type} must not be anchored`);
  }
});

test("WIPE exits by sweeping on: the band is anchored to the far edge and shrinks", () => {
  const half = wipe(exiting("WIPE", 0.5, { direction: "RIGHT" }));
  assert.equal(half.edge, "RIGHT");
  closeTo(half.progress, 1 - easeInCubic(0.5));
  assert.equal(wipe(exiting("WIPE", 0.5, { direction: "UP" })).edge, "TOP");
  const gone = exiting("WIPE", 1, { direction: "RIGHT" });
  closeTo(wipe(gone).progress, 0);
  closeTo(gone.alphaMultiplier, 0, 6, "opacity drops to 0 only at the very end");
  closeTo(exiting("WIPE", 0.99, { direction: "RIGHT" }).alphaMultiplier, 1);
});

/** BLUR is Canva's تمويه (spec §2): a 32px haze resolving while the opacity rises. */
test("BLUR resolves out of a 32px haze on quadratic eases", () => {
  const start = entering("BLUR", 0);
  closeTo(start.alphaMultiplier, 0);
  closeTo(start.blurRadiusPx, 32);
  const half = entering("BLUR", 0.5);
  closeTo(half.alphaMultiplier, 0.75);
  closeTo(half.blurRadiusPx, 8);
  closeTo(half.scaleXMultiplier, 1);
  const done = entering("BLUR", 1);
  closeTo(done.alphaMultiplier, 1);
  closeTo(done.blurRadiusPx, 0);
  const leaving = exiting("BLUR", 0.5);
  closeTo(leaving.alphaMultiplier, 0.75);
  closeTo(leaving.blurRadiusPx, 8);
  closeTo(exiting("BLUR", 1).blurRadiusPx, 32);
});

/**
 * A one-shot SUCCESSION is Canva's التتابع (spec §2): Blur with a 24px haze plus a scale from
 * s0 = 0.9 − 0.3·Vd, where Vd is Canva's slider (our intensity − 0.5, so 0.75 at the default).
 */
test("a one-shot SUCCESSION starts blurred, transparent and at 75% scale", () => {
  const state = entering("SUCCESSION", 0);
  closeTo(state.alphaMultiplier, 0);
  closeTo(state.blurRadiusPx, 24);
  closeTo(state.scaleMultiplier, 0.75);
  closeTo(state.translationX, 0);
  closeTo(state.translationY, 0);
});

test("a one-shot SUCCESSION resolves on easeOutQuad and settles sharp, opaque and at scale 1", () => {
  for (const p of [0.25, 0.5, 0.75]) {
    const e = easeOutQuad(p);
    const state = entering("SUCCESSION", p);
    closeTo(state.alphaMultiplier, e);
    closeTo(state.blurRadiusPx, 24 * (1 - e));
    closeTo(state.scaleMultiplier, 0.75 + 0.25 * e);
  }
  const done = entering("SUCCESSION", 1);
  closeTo(done.alphaMultiplier, 1);
  closeTo(done.blurRadiusPx, 0);
  closeTo(done.scaleMultiplier, 1);
});

test("SUCCESSION's slider sets its start scale and its blur is the same at any layer size", () => {
  closeTo(entering("SUCCESSION", 0, { intensity: 1.5 }).scaleMultiplier, 0.6);
  closeTo(entering("SUCCESSION", 0, { intensity: 0.5 }).scaleMultiplier, 0.9);
  const tiny = resolveAnimationVisualState(spec("SUCCESSION"), 0, 10, 10);
  const huge = resolveAnimationVisualState(spec("SUCCESSION"), 0, 900, 700);
  closeTo(tiny.blurRadiusPx, 24);
  closeTo(huge.blurRadiusPx, 24);
});

test("a one-shot SUCCESSION exits by blurring and shrinking back on easeInQuad", () => {
  const half = exiting("SUCCESSION", 0.5);
  closeTo(half.alphaMultiplier, 0.75);
  closeTo(half.blurRadiusPx, 6);
  closeTo(half.scaleMultiplier, 1 - 0.25 * 0.25);
  closeTo(exiting("SUCCESSION", 1).alphaMultiplier, 0);
});

test("an infinite SUCCESSION keeps the older scale-and-fade pulse", () => {
  const state = resolveAnimationVisualState(spec("SUCCESSION", { infinite: true }), 0, W, H);
  closeTo(state.scaleMultiplier, 0.82);
  closeTo(state.alphaMultiplier, 0.06);
  closeTo(state.blurRadiusPx, 0);
});

/**
 * BASELINE is Canva's rise-from-the-baseline (spec §2): the content slides its own height into
 * its box while the box clips it. Our matte travels with the layer, so the band is expressed in
 * CONTENT space: the part inside the home box is the band behind the LEADING edge on the way in.
 */
test("BASELINE slides the content its own size into a band clipped at the leading edge", () => {
  const start = entering("BASELINE", 0, { direction: "UP" });
  closeTo(start.translationY, H, 6, "starts a full height below");
  closeTo(start.alphaMultiplier, 1, 6, "opaque from t = 0 — the clip does the hiding");
  closeTo(wipe(start).progress, 0);
  assert.equal(wipe(start).edge, "TOP");

  const half = entering("BASELINE", 0.5, { direction: "UP" });
  const e = easeOutExpo(0.5);
  closeTo(half.translationY, H * (1 - e));
  closeTo(wipe(half).progress, e);
  closeTo(half.translationX, 0);

  // The intro's last frame is held for the rest of the layer's window, so it must land EXACTLY
  // home with the whole content inside the box (easeOutExpo is pinned at u = 1; the bare formula
  // would leave 1/1024 of the height outside the band forever).
  const end = entering("BASELINE", 1, { direction: "UP" });
  closeTo(end.translationY, 0, 12, "p = 1 is exactly home");
  closeTo(wipe(end).progress, 1, 12, "p = 1 is fully revealed");

  // Sideways it is the width that travels, and the band hangs off the side it heads for.
  const right = entering("BASELINE", 0, { direction: "RIGHT" });
  closeTo(right.translationX, -W);
  assert.equal(wipe(right).edge, "RIGHT");
  assert.equal(wipe(entering("BASELINE", 0.5, { direction: "DOWN" })).edge, "BOTTOM");
});

test("BASELINE exits over the first 60% of the outro, out through the trailing edge", () => {
  const early = exiting("BASELINE", 0.3, { direction: "UP" });
  const e = easeInSine(0.5);
  closeTo(early.translationY, -H * e);
  closeTo(wipe(early).progress, 1 - e);
  assert.equal(wipe(early).edge, "BOTTOM");
  closeTo(early.alphaMultiplier, 1);
  // From 60% on it is fully out of its box and held invisible.
  for (const u of [0.6, 0.8, 1]) {
    const gone = exiting("BASELINE", u, { direction: "UP" });
    closeTo(gone.translationY, -H);
    closeTo(wipe(gone).progress, 0);
    closeTo(gone.alphaMultiplier, 0);
  }
});

test("an infinite BASELINE keeps the older bounce", () => {
  const state = resolveAnimationVisualState(spec("BASELINE", { infinite: true }), 0.25, W, H);
  closeTo(state.translationY, -Math.max(10, H * 0.1));
  assert.equal(state.revealMask, null);
});

/**
 * TUMBLE is Canva's دوران (spec §2): the layer spins in from a page away. Its start angle is
 * −180° (at the default slider) plus a per-element hash |cos(idx)·w·h| mod 360, and the side it
 * comes from alternates with the element index unless the direction says otherwise.
 */
test("TUMBLE spins in from a page away, from a side and angle set by the layer index", () => {
  const hash = (idx: number) => Math.abs(Math.cos(idx) * W * H) % 360;
  const bottom = entering("TUMBLE", 0, {}, 0);
  closeTo(bottom.translationX, -1920, 6, "an even index comes from the left");
  closeTo(bottom.rotationDeltaDegrees, -180 + hash(0));
  closeTo(bottom.alphaMultiplier, 0);
  const above = entering("TUMBLE", 0, {}, 1);
  closeTo(above.translationX, 1920, 6, "an odd index comes from the right");
  closeTo(above.rotationDeltaDegrees, -180 + hash(1));
  // An explicit direction picks the side regardless of the index.
  closeTo(entering("TUMBLE", 0, { direction: "LEFT" }, 0).translationX, 1920);
  closeTo(entering("TUMBLE", 0, { direction: "RIGHT" }, 1).translationX, -1920);
  // Canva's slider moves the start angle: Vd 1 → −270° (even) / −90° (odd) plus the hash.
  closeTo(entering("TUMBLE", 0, { intensity: 1.5 }, 0).rotationDeltaDegrees, -270 + hash(0));
  closeTo(entering("TUMBLE", 0, { intensity: 1.5 }, 1).rotationDeltaDegrees, -90 + hash(1));

  const half = entering("TUMBLE", 0.5, {}, 0);
  const e = easeOutCubic(0.5);
  closeTo(half.translationX, -1920 * (1 - e));
  closeTo(half.rotationDeltaDegrees, (-180 + hash(0)) * (1 - e));
  closeTo(half.alphaMultiplier, e);
  const done = entering("TUMBLE", 1, {}, 0);
  closeTo(done.translationX, 0);
  closeTo(done.rotationDeltaDegrees, 0);
  closeTo(done.alphaMultiplier, 1);
});

test("TUMBLE exits by spinning on out the far side", () => {
  const hash0 = Math.abs(Math.cos(0) * W * H) % 360;
  const gone = exiting("TUMBLE", 1, {}, 0);
  closeTo(gone.translationX, 1920, 6, "came from the left, leaves to the right");
  closeTo(gone.rotationDeltaDegrees, -(-180 + hash0));
  closeTo(gone.alphaMultiplier, 0);
  closeTo(exiting("TUMBLE", 0, {}, 0).alphaMultiplier, 1);
});

/** STOMP is Canva's سقوط هوائي (spec §2): it slams down from max(4, 1620/w) times its size. */
test("STOMP slams down from several times its size, fading in over the first 40%", () => {
  const s0 = Math.max(4, 1620 / W);
  const start = entering("STOMP", 0);
  closeTo(start.scaleMultiplier, s0);
  closeTo(start.alphaMultiplier, 0);
  const fifth = entering("STOMP", 0.2);
  closeTo(fifth.alphaMultiplier, easeInQuart(0.5));
  closeTo(fifth.scaleMultiplier, s0 + (1 - s0) * easeInQuart(0.2));
  closeTo(entering("STOMP", 0.4).alphaMultiplier, 1);
  const done = entering("STOMP", 1);
  closeTo(done.scaleMultiplier, 1);
  closeTo(done.alphaMultiplier, 1);
  closeTo(done.rotationDeltaDegrees, 0);
  // A tiny layer starts even larger, a huge one bottoms out at 4×.
  closeTo(resolveAnimationVisualState(spec("STOMP"), 0, 100, 100).scaleMultiplier, 16.2);
  closeTo(resolveAnimationVisualState(spec("STOMP"), 0, 1000, 100).scaleMultiplier, 4);
  // Exit: a plain fade, no scale change.
  const leaving = exiting("STOMP", 0.5);
  closeTo(leaving.alphaMultiplier, 1 - easeOutQuad(0.5));
  closeTo(leaving.scaleMultiplier, 1);
  closeTo(exiting("STOMP", 1).alphaMultiplier, 0);
});

/**
 * SCRAPBOOK is Canva's stamped poses (spec §2): opaque from t = 0, three poses held at equal
 * intervals with no tweening, then rest. The tilt's sign alternates with the element index.
 */
test("SCRAPBOOK stamps three held poses and then rests", () => {
  const expectPose = (p: number, x: number, y: number, rotation: number, layerIndex = 0) => {
    const state = entering("SCRAPBOOK", p, {}, layerIndex);
    closeTo(state.translationX, x, 6, `x at ${p}`);
    closeTo(state.translationY, y, 6, `y at ${p}`);
    closeTo(state.rotationDeltaDegrees, rotation, 6, `rotation at ${p}`);
    closeTo(state.alphaMultiplier, 1, 6, `alpha at ${p}`);
  };
  expectPose(0, 50, 0, 5);
  expectPose(0.2, 50, 0, 5);
  expectPose(1 / 3, 0, 50, -4.5);
  expectPose(0.5, 0, 50, -4.5);
  expectPose(2 / 3, 50, 0, 3.5);
  expectPose(0.9, 50, 0, 3.5);
  expectPose(1, 0, 0, 0);
  // An odd layer index flips the tilt only.
  expectPose(0.2, 50, 0, -5, 1);
  expectPose(0.5, 0, 50, 4.5, 1);
  // The pose does not tween: the same numbers whatever the intensity or the layer's size.
  closeTo(entering("SCRAPBOOK", 0.2, { intensity: 3 }).translationX, 50);
  closeTo(resolveAnimationVisualState(spec("SCRAPBOOK"), 0.2, 900, 700).translationX, 50);
});

test("SCRAPBOOK exits by vanishing at the start of the outro", () => {
  closeTo(exiting("SCRAPBOOK", 0).alphaMultiplier, 1, 6, "the first frame still shows the start value");
  closeTo(exiting("SCRAPBOOK", 0.01).alphaMultiplier, 0);
  closeTo(exiting("SCRAPBOOK", 1).alphaMultiplier, 0);
  closeTo(exiting("SCRAPBOOK", 0.5).translationX, 0);
});

/**
 * NEON is Canva's sign flickering on (spec §2): LINEAR opacity tweens evaluated under the
 * tween-list hold rule. At the default slider the intro is 18 units of c with two flashes; the
 * even-parity sequence is ramp [0,3c], on to 4c, fade [4c,5c], off to 6c, on [6c,8c], off
 * [8c,13c], ramp [13c,16c], on.
 */
test("NEON's intro follows Canva's flash sequence (even layer index)", () => {
  const at = (units: number) => entering("NEON", units / 18, {}, 0).alphaMultiplier;
  closeTo(at(0), 0);
  closeTo(at(1.5), 0.5, 6, "ramping 0→1 over [0,3c]");
  closeTo(at(3.5), 1, 6, "on until 4c");
  closeTo(at(4.5), 0.5, 6, "fading 1→0 over [4c,5c]");
  closeTo(at(5.5), 0, 6, "off until 6c");
  closeTo(at(7), 1, 6, "on [6c,8c]");
  closeTo(at(10), 0, 6, "off [8c,13c]");
  closeTo(at(14.5), 0.5, 6, "ramping 0→1 over [13c,16c]");
  closeTo(at(17), 1, 6, "on");
  closeTo(at(18), 1, 6, "settled lit");
  // Nothing but opacity moves.
  const mid = entering("NEON", 0.5, {}, 0);
  closeTo(mid.scaleMultiplier, 1);
  closeTo(mid.translationX, 0);
});

test("NEON's intro on an odd layer index dims to 0.75 and holds off longer", () => {
  const at = (units: number) => entering("NEON", units / 18, {}, 1).alphaMultiplier;
  closeTo(at(1.5), 0.5, 6, "ramp [0,3c]");
  closeTo(at(3.5), 1, 6, "on until 4c");
  closeTo(at(5), 0, 6, "off (hard) [4c,6c]");
  closeTo(at(7), 0.75, 6, "0.75 [6c,8c]");
  closeTo(at(11), 0, 6, "off [8c,14c]");
  closeTo(at(16), 0.5, 6, "ramp [14c,18c]");
  closeTo(at(18), 1);
});

test("NEON's outro flickers off in units of d = outro / 6", () => {
  const even = (u: number) => exiting("NEON", u, {}, 0).alphaMultiplier;
  closeTo(even(0.1), 1, 6, "on until 1.1d");
  closeTo(even(0.3), 0, 6, "off [1.1d, 3d)");
  closeTo(even(0.6), 0.5, 6, "0.5 [3d, 5d)");
  closeTo(even(0.9), 0, 6, "off from 5d");
  closeTo(even(1), 0);
  const odd = (u: number) => exiting("NEON", u, {}, 1).alphaMultiplier;
  closeTo(odd(0.1), 1, 6, "on until d");
  closeTo(odd(1 / 3), 0.75, 6, "1→0.5 over [d, 3d]");
  closeTo(odd(0.6), 0.5, 6, "0.5 until 4d");
  closeTo(odd(0.68), 0.1, 6, "0.5→0 over [4d, 4.1d]");
  closeTo(odd(0.9), 0);
  closeTo(odd(1), 0);
});

test("NEON fits its schedule to the slot when the slider's list overruns it", () => {
  // Vd 0 (intensity 0.5): one flash over 10 units — but the list ends at 12c (even) / 14c (odd),
  // so the whole list is fitted to the intro and the layer is lit at p = 1, as the app does.
  const even = (units: number) => entering("NEON", units / 12, { intensity: 0.5 }, 0).alphaMultiplier;
  closeTo(even(1.5), 0.5, 6, "ramp [0,3c]");
  closeTo(even(3.5), 1, 6, "on until 4c");
  closeTo(even(4.5), 0.5, 6, "fading [4c,5c]");
  closeTo(even(7), 0, 6, "off until 9c");
  closeTo(even(10), 1 / 3, 6, "ramping [9c,12c]");
  closeTo(even(12), 1);
  const odd = (units: number) => entering("NEON", units / 14, { intensity: 0.5 }, 1).alphaMultiplier;
  closeTo(odd(4.5), 0, 6, "the 0→0 tween: off (hard)");
  closeTo(odd(12), 0.5, 6, "ramping [10c,14c]");
  closeTo(odd(14), 1);
  // The outro is fitted the same way: 5d (even) / 4.1d (odd) when lerp(4, 8, Vd) is shorter.
  const outEven = (u: number) => exiting("NEON", u, { intensity: 0.5 }, 0).alphaMultiplier;
  closeTo(outEven(0.2), 1, 6, "on until 1.1d of 5d");
  closeTo(outEven(0.5), 0, 6, "off [1.1d,3d)");
  closeTo(outEven(0.7), 0.5, 6, "0.5 [3d,5d)");
  closeTo(outEven(1), 0);
  const outOdd = (u: number) => exiting("NEON", u, { intensity: 0.5 }, 1).alphaMultiplier;
  closeTo(outOdd(0.5), 1 - 0.5 * ((0.5 * 4.1 - 1) / 2), 6, "1→0.5 over [d,3d] of 4.1d");
  closeTo(outOdd(1), 0);
});

test("an infinite NEON keeps the older glow", () => {
  // pingPong(0.25) = 0.5 → scale 1 + 0.5 · 0.05.
  const state = resolveAnimationVisualState(spec("NEON", { infinite: true }), 0.25, W, H);
  closeTo(state.scaleMultiplier, 1.025);
  assert.ok(state.alphaMultiplier >= 0.72 && state.alphaMultiplier <= 1);
});

/**
 * The continuous three (spec §3): LINEAR ramps. One-shot plays A → B over the cycle; a loop
 * ping-pongs A → B → A as a triangle so it cycles seamlessly. spec.easing is ignored.
 */
test("BREATHE ramps its scale 0.90 → 1.03 and ping-pongs when looping", () => {
  closeTo(entering("BREATHE", 0).scaleMultiplier, 0.9);
  closeTo(entering("BREATHE", 0.5).scaleMultiplier, 0.965);
  closeTo(entering("BREATHE", 1).scaleMultiplier, 1.03);
  closeTo(entering("BREATHE", 0.5).alphaMultiplier, 1, 6, "the fades live in the FADE slots");
  const loop = (cp: number) =>
    resolveAnimationVisualState(spec("BREATHE", { infinite: true }), cp, W, H).scaleMultiplier;
  closeTo(loop(0), 0.9);
  closeTo(loop(0.25), 0.965);
  closeTo(loop(0.5), 1.03);
  closeTo(loop(0.75), 0.965);
  closeTo(loop(1), 0.9);
  // The slider widens the range: B − A = 0.13 · intensity.
  closeTo(entering("BREATHE", 0, { intensity: 2 }).scaleMultiplier, 0.8);
  closeTo(entering("BREATHE", 1, { intensity: 2 }).scaleMultiplier, 1.06);
  // LINEAR whatever the spec says.
  closeTo(entering("BREATHE", 0.5, { easing: "EASE_IN" }).scaleMultiplier, 0.965);
});

test("DRIFT ramps −vec → +vec at 120px per intensity along its direction", () => {
  closeTo(entering("DRIFT", 0, { direction: "RIGHT" }).translationX, -120);
  closeTo(entering("DRIFT", 0.5, { direction: "RIGHT" }).translationX, 0);
  closeTo(entering("DRIFT", 1, { direction: "RIGHT" }).translationX, 120, 6, "ends at +vec, not at home");
  closeTo(entering("DRIFT", 0, { direction: "UP" }).translationY, 120);
  closeTo(entering("DRIFT", 1, { direction: "UP" }).translationY, -120);
  closeTo(entering("DRIFT", 0, { direction: "LEFT", intensity: 2 }).translationX, 240);
  closeTo(entering("DRIFT", 0.5).alphaMultiplier, 1);
  const loop = (cp: number) =>
    resolveAnimationVisualState(spec("DRIFT", { infinite: true, direction: "RIGHT" }), cp, W, H)
      .translationX;
  closeTo(loop(0), -120);
  closeTo(loop(0.5), 120);
  closeTo(loop(1), -120);
});

test("TECTONIC ramps −d → +d/2 on the horizontal axis", () => {
  closeTo(entering("TECTONIC", 0).translationX, -120);
  closeTo(entering("TECTONIC", 1).translationX, 60);
  closeTo(entering("TECTONIC", 0.5).translationX, -30);
  closeTo(entering("TECTONIC", 0.5).translationY, 0);
  closeTo(entering("TECTONIC", 0.5).scaleXMultiplier, 1);
  closeTo(entering("TECTONIC", 0, { direction: "LEFT" }).translationX, 120);
  closeTo(entering("TECTONIC", 0, { intensity: 2 }).translationX, -240);
  const loop = (cp: number) =>
    resolveAnimationVisualState(spec("TECTONIC", { infinite: true }), cp, W, H).translationX;
  closeTo(loop(0.5), 60);
  closeTo(loop(1), -120);
});

/** The repeating effects (spec §4) are shaped by the cycle alone. */
test("ROTATE spins a full turn and honours the spin direction", () => {
  const cw = resolveAnimationVisualState(spec("ROTATE", { direction: "CLOCKWISE" }), 1, W, H);
  const ccw = resolveAnimationVisualState(
    spec("ROTATE", { direction: "COUNTERCLOCKWISE" }),
    1,
    W,
    H
  );
  closeTo(cw.rotationDeltaDegrees, 360);
  closeTo(ccw.rotationDeltaDegrees, -360);
});

test("FLICKER dims 1 → b over a, holds b for 200ms, and returns over a", () => {
  // The default 1100ms cycle is a = 450, b = 0.35.
  const at = (ms: number) =>
    resolveAnimationVisualState(spec("FLICKER", { infinite: true }), ms / 1100, W, H).alphaMultiplier;
  closeTo(at(0), 1);
  closeTo(at(225), 0.675);
  closeTo(at(450), 0.35);
  closeTo(at(550), 0.35, 6, "held");
  closeTo(at(650), 0.35, 6, "still held at 200ms");
  closeTo(at(875), 0.675);
  closeTo(at(1100), 1);
  // §8.3 item 5: `a` comes from the cycle, `b` from the slider (intensity = 0.5 + t). A 1400ms
  // cycle is a = 600 at the same dim level; t = 1 dims to 0.1, t = 0 only to 0.6.
  const flicker = (over: Record<string, unknown>, ms: number, cycle: number) =>
    resolveAnimationVisualState(spec("FLICKER", { durationMs: cycle, ...over }), ms / cycle, W, H)
      .alphaMultiplier;
  closeTo(flicker({}, 600, 1400), 0.35);
  closeTo(flicker({}, 300, 1400), 0.675);
  closeTo(flicker({ intensity: 1.5 }, 450, 1100), 0.1);
  closeTo(flicker({ intensity: 0.5 }, 450, 1100), 0.6);
  closeTo(flicker({ intensity: 0.2 }, 450, 1100), 0.6, 6, "the slider clamps at t = 0");
  // A cycle of 200ms or less has no ramps: dim, then restore at 200ms.
  closeTo(flicker({}, 100, 200), 0.35);
  closeTo(flicker({}, 200, 200), 1);
});

test("PULSE swells to 1.15, sinks to 0.85 and recovers in fixed sixths of the cycle", () => {
  const at = (cp: number) =>
    resolveAnimationVisualState(spec("PULSE", { infinite: true }), cp, W, H).scaleMultiplier;
  closeTo(at(0), 1);
  closeTo(at(1 / 12), 1.075);
  closeTo(at(1 / 6), 1.15);
  closeTo(at(0.5), 1.15 - 0.3 * easeOutQuad(0.5));
  closeTo(at(5 / 6), 0.85);
  closeTo(at(11 / 12), 0.925);
  closeTo(at(1), 1);
});

test("WIGGLE is a deterministic random walk that returns to rest at the cycle end", () => {
  const at = (cp: number) => resolveAnimationVisualState(spec("WIGGLE", { infinite: true }), cp, W, H);
  const rest = at(0);
  closeTo(rest.translationX, 0);
  closeTo(rest.translationY, 0);
  closeTo(rest.rotationDeltaDegrees, 0);
  const end = at(1);
  closeTo(end.translationX, 0);
  closeTo(end.translationY, 0);
  closeTo(end.rotationDeltaDegrees, 0);
  let moved = false;
  for (let i = 1; i < 200; i += 1) {
    const state = at(i / 200);
    // Canva's statistics at the default slider: ±23px, −11.5..17.25°.
    assert.ok(Math.abs(state.translationX) <= 23.0001, `tx ${state.translationX}`);
    assert.ok(Math.abs(state.translationY) <= 23.0001, `ty ${state.translationY}`);
    assert.ok(
      state.rotationDeltaDegrees >= -11.5001 && state.rotationDeltaDegrees <= 17.2501,
      `rotation ${state.rotationDeltaDegrees}`
    );
    if (Math.abs(state.translationX) > 1) moved = true;
  }
  assert.ok(moved, "the walk never moved");
  assert.deepEqual(at(0.37), at(0.37));
  // The step rule (Canva's `rwf`): 56 units per cycle at the default slider, the tilt tween runs
  // half a step behind the offset's and exists only for the first n − 1 = 54 steps, so the last
  // step HOLDS the 54th tilt, and the closing unit returns every channel to rest from there.
  const hash = (seed: number) => Math.abs(Math.cos(seed) * W * H) % 1;
  const rot = (i: number) => (i < 0 || i >= 54 ? 0 : (-10 + 25 * hash(i + 1)) * 1.15);
  const tx = (i: number) => (i < 0 || i >= 55 ? 0 : (-20 + 40 * hash(i + 2)) * 1.15);
  const inOut = (u: number) => (u < 0.5 ? 2 * u * u : (4 - 2 * u) * u - 1);
  const atUnits = (x: number) => at(x / 56);
  closeTo(atUnits(3.25).translationX, tx(2) + (tx(3) - tx(2)) * inOut(0.25));
  closeTo(atUnits(3.25).rotationDeltaDegrees, rot(1) + (rot(2) - rot(1)) * inOut(0.75));
  closeTo(atUnits(3.75).rotationDeltaDegrees, rot(2) + (rot(3) - rot(2)) * inOut(0.25));
  closeTo(atUnits(0.25).rotationDeltaDegrees, 0, 6, "no tilt before the first tilt tween");
  closeTo(atUnits(54.9).rotationDeltaDegrees, rot(53), 6, "the last step holds the 54th tilt");
  closeTo(atUnits(54.9).translationX, tx(53) + (tx(54) - tx(53)) * inOut(0.9));
  closeTo(atUnits(55.5).translationX, tx(54) * (1 - inOut(0.5)));
  closeTo(atUnits(55.5).rotationDeltaDegrees, rot(53) * (1 - inOut(0.5)));
});

test("WIGGLE reads Canva's slider from intensity and walks by the importer's seed (§8.3 item 7)", () => {
  // t = intensity − 0.5: n = floor(lerp(10, 100, t)) steps, amplitude lerp(.5, 1.8, t).
  const at = (over: Record<string, unknown>, cp: number) =>
    resolveAnimationVisualState(spec("WIGGLE", { infinite: true, ...over }), cp, W, H);
  const hash = (s: number) => Math.abs(Math.cos(s) * W * H) % 1;
  const inOut = (u: number) => (u < 0.5 ? 2 * u * u : (4 - 2 * u) * u - 1);
  // t = 0: 10 steps of 1/11 of the cycle, amplitude 0.5.
  const slow = at({ intensity: 0.5 }, 1.5 / 11);
  closeTo(slow.translationX, (-20 + 40 * hash(2)) * 0.5 + ((-20 + 40 * hash(3)) - (-20 + 40 * hash(2))) * 0.5 * inOut(0.5));
  // t = 1: 100 steps, amplitude 1.8.
  const fast = at({ intensity: 1.5 }, 0.5 / 101);
  closeTo(fast.translationX, (-20 + 40 * hash(2)) * 1.8 * inOut(0.5));
  // A seed replaces the size hash: r(s) = |cos(s) · seed| mod 1.
  const seed = 123456.789;
  const r = (s: number) => Math.abs(Math.cos(s) * seed) % 1;
  const seeded = resolveAnimationVisualState(
    makeAnimationSpec({ type: "WIGGLE", infinite: true, params: { seed } }, "LOOP"),
    0.5 / 56,
    W,
    H
  );
  closeTo(seeded.translationX, (-20 + 40 * r(2)) * 1.15 * inOut(0.5));
  closeTo(seeded.translationY, (-20 + 40 * r(3)) * 1.15 * inOut(0.5));
});

test("intensity scales the amplitude of the formula effects that carry one", () => {
  // The loop bob; a one-shot RISE is Canva's flat 80 px and ignores the slider.
  const normal = resolveAnimationVisualState(spec("RISE", { infinite: true, intensity: 1 }), 0, W, H);
  const double = resolveAnimationVisualState(spec("RISE", { infinite: true, intensity: 2 }), 0, W, H);
  closeTo(double.translationY, normal.translationY * 2);
  closeTo(resolveAnimationVisualState(spec("RISE", { intensity: 2 }), 0, W, H).translationY, 80);
});

test("the GRADIENT reveal twins differ only by feather", () => {
  const plain = resolveAnimationVisualState(spec("WIPE"), 0.5, W, H);
  const gradient = resolveAnimationVisualState(spec("GRADIENT_WIPE"), 0.5, W, H);
  assert.equal(plain.revealMask?.kind, "WIPE");
  assert.equal(gradient.revealMask?.kind, "WIPE");
  assert.equal((plain.revealMask as { featherFraction: number }).featherFraction, 0);
  closeTo((gradient.revealMask as { featherFraction: number }).featherFraction, 0.35);

  const circle = resolveAnimationVisualState(spec("CIRCUAL"), 0.5, W, H);
  const circleGradient = resolveAnimationVisualState(spec("CIRCUAL_GRADIENT"), 0.5, W, H);
  assert.equal(circle.revealMask?.kind, "CIRCLE");
  assert.equal((circle.revealMask as { featherFraction: number }).featherFraction, 0);
  closeTo((circleGradient.revealMask as { featherFraction: number }).featherFraction, 0.4);
});

test("authored translations scale by the layer size, not the 700px comp", () => {
  // SLIDE authors translateY = 1.4971429 at frame 5 (a fraction of the comp).
  const small = resolveAnimationVisualState(spec("SLIDE"), 5 / 35, W, 100);
  const large = resolveAnimationVisualState(spec("SLIDE"), 5 / 35, W, 400);
  closeTo(large.translationY, small.translationY * 4);
  assert.ok(Math.abs(small.translationY) > 0);
});

test("spec.easing is ignored on the authored path and honoured on the formula path", () => {
  const a = resolveAnimationVisualState(spec("SLIDE", { easing: "LINEAR" }), 0.3, W, H);
  const b = resolveAnimationVisualState(spec("SLIDE", { easing: "EASE_IN" }), 0.3, W, H);
  closeTo(a.translationY, b.translationY);

  const c = resolveAnimationVisualState(spec("DROP", { easing: "LINEAR" }), 0.5, W, H);
  const d = resolveAnimationVisualState(spec("DROP", { easing: "EASE_IN" }), 0.5, W, H);
  notCloseTo(c.translationY, d.translationY);
});

test("the Canva family carries Canva's own curves and ignores spec.easing when one-shot", () => {
  // Canva's eases are none of ours, so they are computed from the raw progress instead of read
  // from the spec. The editor exposes no easing control, so the setting is unreachable anyway.
  for (const type of ["RISE", "SHIFT", "PAN", "SKATE", "FADE", "POP", "WIPE", "BLUR", "SUCCESSION", "BASELINE", "TUMBLE", "NEON", "SCRAPBOOK", "STOMP"]) {
    const linear = resolveAnimationVisualState(spec(type, { easing: "LINEAR" }), 0.5, W, H);
    const easeIn = resolveAnimationVisualState(spec(type, { easing: "EASE_IN" }), 0.5, W, H);
    assert.deepEqual(linear, easeIn, type);
  }
});

test("the glyph families emit the documented fallback", () => {
  for (const type of ["TYPEWRITER_CHARS", "TYPEWRITER_WORDS", "TYPEWRITER_CURSOR"]) {
    const state = resolveAnimationVisualState(spec(type), 0.5, W, H);
    assert.ok(state.textReveal, `${type} textReveal`);
    assert.equal(state.revealMask?.kind, "WIPE");
    // The alpha fallback is what surfaces without glyph access render.
    assert.ok(state.alphaMultiplier > 0 && state.alphaMultiplier < 1);
  }
  for (const type of ["CH_POSITION_FADE", "CH_SCALE_FADE", "CH_WIGGLE_Y"]) {
    assert.ok(resolveAnimationVisualState(spec(type), 0.5, W, H).glyphMotion, `${type} glyphMotion`);
  }
});

test("an exit fades the layer to nothing as it reverses", () => {
  const mid = resolveAnimationVisualState(spec("FADE"), 0.5, W, H, true);
  const gone = resolveAnimationVisualState(spec("FADE"), 0, W, H, true);
  closeTo(gone.alphaMultiplier, 0);
  assert.ok(mid.alphaMultiplier > 0);
  // An effect outside the Canva family still gets the generic fade on top of its reversed motion.
  const drop = resolveAnimationVisualState(spec("DROP", { easing: "LINEAR" }), 0.5, W, H, true);
  closeTo(drop.alphaMultiplier, Math.min(1, 0.5 * 2) * 0.5);
});

test("the Canva family's exit is its own outro, never the entrance reversed and faded", () => {
  // The generic exit multiplies alpha by cycleProgress; Canva's outros never do.
  closeTo(exiting("FADE", 0.5).alphaMultiplier, 0.75);
  closeTo(exiting("BLUR", 0.5).alphaMultiplier, 0.75);
  closeTo(exiting("POP", 0.5).alphaMultiplier, 1);
  closeTo(exiting("SCRAPBOOK", 0.5).alphaMultiplier, 0);
  closeTo(exiting("STOMP", 0.5).alphaMultiplier, 1 - easeOutQuad(0.5));
  closeTo(exiting("SKATE", 0.5).alphaMultiplier, 0.75, 6, "the mirrors ride the same outro");
});

test("the layer index defaults to 0 and is sanitised", () => {
  const explicit = resolveAnimationVisualState(spec("SCRAPBOOK"), 0.2, W, H, false, 0);
  const implicit = resolveAnimationVisualState(spec("SCRAPBOOK"), 0.2, W, H);
  assert.deepEqual(implicit, explicit);
  const odd = resolveAnimationVisualState(spec("SCRAPBOOK"), 0.2, W, H, false, 3);
  closeTo(odd.rotationDeltaDegrees, -5);
  const fractional = resolveAnimationVisualState(spec("SCRAPBOOK"), 0.2, W, H, false, 3.7);
  assert.deepEqual(fractional, odd);
  const negative = resolveAnimationVisualState(spec("SCRAPBOOK"), 0.2, W, H, false, -2);
  assert.deepEqual(negative, explicit);
});

test("every offered type resolves to finite values across its cycle", () => {
  const offered = ANIMATION_TYPES.filter((entry) => entry.tabs.length > 0);
  // Derived, not a magic number: "offered" must be exactly the distinct types across the three
  // catalogs, so this can't go stale the next time an effect is added to a tab.
  const catalogUnion = new Set([
    ...ANIMATION_CATALOG.ENTRANCE,
    ...ANIMATION_CATALOG.EXIT,
    ...ANIMATION_CATALOG.LOOP,
  ]);
  assert.equal(offered.length, catalogUnion.size);
  for (const entry of offered) {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const state = resolveAnimationVisualState(spec(entry.type), p, W, H);
      assert.ok(Number.isFinite(state.alphaMultiplier), `${entry.type} alpha`);
      assert.ok(Number.isFinite(state.scaleMultiplier), `${entry.type} scale`);
      assert.ok(Number.isFinite(state.scaleXMultiplier), `${entry.type} scaleX`);
      assert.ok(Number.isFinite(state.scaleYMultiplier), `${entry.type} scaleY`);
      assert.ok(Number.isFinite(state.translationX), `${entry.type} tx`);
      assert.ok(Number.isFinite(state.translationY), `${entry.type} ty`);
      assert.ok(Number.isFinite(state.rotationDeltaDegrees), `${entry.type} rotation`);
    }
  }
});

// ── three-slot playback ───────────────────────────────────────────────────────

type SlotInput = Partial<
  Record<"entrance" | "exit" | "loop", Partial<AnimationSpecInput> & { type: string }>
>;

const anims = (over: SlotInput) => ({
  entrance: over.entrance ? makeAnimationSpec(over.entrance, "ENTRANCE") : null,
  exit: over.exit ? makeAnimationSpec(over.exit, "EXIT") : null,
  loop: over.loop ? makeAnimationSpec(over.loop, "LOOP") : null,
});

test("slots play entrance, then loop, then exit", () => {
  const a = anims({
    entrance: { type: "FADE", durationMs: 1000, delayMs: 0 },
    loop: { type: "BREATHE", durationMs: 1000 },
    exit: { type: "FADE", durationMs: 1000 },
  });
  const at = (ms: number) => resolveTimelinePlaybackState(false, 0, 10_000, a, ms, 10_000);

  assert.equal(at(500).animation?.type, "FADE");
  assert.equal(at(500).isExiting, false);
  closeTo(at(500).progress, 0.5);

  assert.equal(at(5_000).animation?.type, "BREATHE");

  const exitingState = at(9_500);
  assert.equal(exitingState.animation?.type, "FADE");
  assert.equal(exitingState.isExiting, true);
  // The exit runs the curve in reverse: halfway through → progress 0.5, heading to 0.
  closeTo(exitingState.progress, 0.5);
  // exitStart is 9000, so the last ms of the window is 999/1000 through the exit.
  closeTo(at(9_999).progress, 0.001);
  closeTo(at(10_000).progress, 0);
});

test("the entrance takes the duration budget before the exit", () => {
  const a = anims({
    entrance: { type: "FADE", durationMs: 800 },
    exit: { type: "FADE", durationMs: 5000 },
  });
  // The layer is only 1000ms; the entrance takes 800, squeezing the exit into the last 200.
  assert.equal(resolveTimelinePlaybackState(false, 0, 1000, a, 850, 1000).isExiting, true);
  assert.equal(resolveTimelinePlaybackState(false, 0, 1000, a, 400, 1000).isExiting, false);
});

test("with no loop, the entrance's final frame is held", () => {
  const a = anims({ entrance: { type: "FADE", durationMs: 500 } });
  const state = resolveTimelinePlaybackState(false, 0, 10_000, a, 5_000, 10_000);
  assert.equal(state.animation?.type, "FADE");
  assert.equal(state.progress, 1);
  assert.equal(state.isExiting, false);
});

test("the entrance delay is honoured", () => {
  const a = anims({ entrance: { type: "FADE", durationMs: 1000, delayMs: 500 } });
  // Still inside the delay → no progress yet.
  assert.equal(resolveTimelinePlaybackState(false, 0, 10_000, a, 200, 10_000).progress, 0);
  closeTo(resolveTimelinePlaybackState(false, 0, 10_000, a, 1_000, 10_000).progress, 0.5);
});

test("the loop is offset by the entrance duration and its own delay", () => {
  const a = anims({
    entrance: { type: "FADE", durationMs: 1000 },
    loop: { type: "BREATHE", durationMs: 1000, delayMs: 200 },
  });
  // localMs 1200 → delayed = 1200 - 1000 - 200 = 0 → the loop starts here.
  closeTo(resolveTimelinePlaybackState(false, 0, 10_000, a, 1_200, 10_000).progress, 0);
  closeTo(resolveTimelinePlaybackState(false, 0, 10_000, a, 1_700, 10_000).progress, 0.5);
});

test("a layer is invisible outside its timeline window", () => {
  const a = anims({ loop: { type: "BREATHE", durationMs: 1000 } });
  assert.equal(resolveTimelinePlaybackState(false, 2_000, 5_000, a, 1_000, 10_000).isVisible, false);
  assert.equal(resolveTimelinePlaybackState(false, 2_000, 5_000, a, 3_000, 10_000).isVisible, true);
  assert.equal(resolveTimelinePlaybackState(true, 0, 10_000, a, 3_000, 10_000).isVisible, false);
});

test("a layer whose window ends on the timeline's final frame still shows", () => {
  const a = anims({ loop: { type: "BREATHE", durationMs: 1000 } });
  assert.equal(resolveTimelinePlaybackState(false, 0, 10_000, a, 10_000, 10_000).isVisible, true);
});

test("NONE is treated as an empty slot", () => {
  const a = anims({ entrance: { type: "NONE" }, loop: { type: "BREATHE", durationMs: 1000 } });
  assert.equal(resolveTimelinePlaybackState(false, 0, 10_000, a, 100, 10_000).animation?.type, "BREATHE");
});

test("a slot is only infinite when the type supports it", () => {
  assert.equal(makeAnimationSpec({ type: "BREATHE" }, "LOOP").infinite, true);
  assert.equal(makeAnimationSpec({ type: "FADE" }, "ENTRANCE").infinite, false);
  // ZOOM_FADE has supportsInfinite:false — it must not loop even in the loop slot.
  assert.equal(getAnimationDefaults("ZOOM_FADE").supportsInfinite, false);
  assert.equal(makeAnimationSpec({ type: "ZOOM_FADE", infinite: true }, "LOOP").infinite, false);
});

// ── Round 2 (docs/canva-animation-parity.md §8): params, Block, writing styles, concurrency ────────

const withParams = (type: string, params: Record<string, number>, over: Record<string, unknown> = {}) =>
  makeAnimationSpec({ type, ...over, params });
const easeOutQuart = (u: number) => 1 - Math.pow(1 - u, 4);

test("BLOCK sweeps a full-box bar across in 2d and switches the text on halfway (§8.3 item 3)", () => {
  const bar = (p: number, over: Record<string, unknown> = {}) => entering("BLOCK", p, over).overlayBar;
  const s = (x: number) => (x < 0.5 ? -1 + easeInQuart(2 * x) : easeOutQuart(2 * x - 1));
  for (const p of [0, 0.25, 0.49, 0.5, 0.75, 0.99]) {
    const state = entering("BLOCK", p);
    assert.deepEqual(state.overlayBar, {
      leftFraction: s(p),
      topFraction: 0,
      widthFraction: 1,
      heightFraction: 1,
    });
    const mask = wipe(state);
    assert.equal(mask.progress, p >= 0.5 ? 1 : 0, `text ${p >= 0.5 ? "on" : "off"} at ${p}`);
    assert.equal(mask.anchored, true);
    closeTo(state.alphaMultiplier, 1);
  }
  assert.equal(bar(1), null, "the bar has left the box at the end");
  // The axis follows the direction the bar moves; DEFAULT is Canva's RIGHT.
  closeTo(bar(0.25, { direction: "LEFT" })!.leftFraction, -s(0.25));
  closeTo(bar(0.25, { direction: "DOWN" })!.topFraction, s(0.25));
  closeTo(bar(0.25, { direction: "DOWN" })!.leftFraction, 0);
  closeTo(bar(0.25, { direction: "UP" })!.topFraction, -s(0.25));
  closeTo(bar(0.25, { direction: "DEFAULT" })!.leftFraction, s(0.25));
  // Canva's default window: 500 ms, whatever the old 1200 ms default was.
  assert.equal(getAnimationDefaults("BLOCK").durationMs, 500);
});

test("BLOCK exits the same way round: text off behind the bar at u = .5, no exit fade", () => {
  const s = (x: number) => (x < 0.5 ? -1 + easeInQuart(2 * x) : easeOutQuart(2 * x - 1));
  const early = exiting("BLOCK", 0.25);
  assert.equal(wipe(early).progress, 1);
  closeTo(early.overlayBar!.leftFraction, s(0.25));
  closeTo(early.alphaMultiplier, 1, 6, "no generic exit fade");
  const late = exiting("BLOCK", 0.75);
  assert.equal(wipe(late).progress, 0);
  closeTo(late.overlayBar!.leftFraction, s(0.75));
  closeTo(late.alphaMultiplier, 1);
  const gone = exiting("BLOCK", 1);
  assert.equal(gone.overlayBar, null);
  assert.equal(wipe(gone).progress, 0);
  // A loop replays the entrance every cycle; an imported colour rides on the bar.
  const loop = resolveAnimationVisualState(spec("BLOCK", { infinite: true }), 0.25, W, H);
  closeTo(loop.overlayBar!.leftFraction, s(0.25));
  const colored = resolveAnimationVisualState(withParams("BLOCK", { barColor: 0xff336699 }), 0.3, W, H);
  assert.equal(colored.overlayBar!.colorArgb, 0xff336699);
  assert.equal(entering("BLOCK", 0.3).overlayBar!.colorArgb, undefined);
  // A signed 32-bit ARGB (as some writers store it) reads back as the same unsigned colour.
  const signed = resolveAnimationVisualState(withParams("BLOCK", { barColor: 0xff336699 - 0x100000000 }), 0.3, W, H);
  assert.equal(signed.overlayBar!.colorArgb, 0xff336699);
});

test("TUMBLE plays the importer's own start pose, in and out (§8.3 item 8)", () => {
  const params = { startRotation: -200, travelX: -1500, travelY: 300 };
  const e = easeOutCubic(0.5);
  const half = resolveAnimationVisualState(withParams("TUMBLE", params), 0.5, W, H);
  closeTo(half.alphaMultiplier, e);
  closeTo(half.rotationDeltaDegrees, -200 * (1 - e));
  closeTo(half.translationX, -1500 * (1 - e));
  closeTo(half.translationY, 300 * (1 - e));
  const done = resolveAnimationVisualState(withParams("TUMBLE", params), 1, W, H);
  closeTo(done.rotationDeltaDegrees, 0);
  closeTo(done.translationX, 0);
  // On the way out the params ARE the end pose, animated from 0 on easeInCubic.
  const out = resolveAnimationVisualState(withParams("TUMBLE", params), 0.5, W, H, true);
  const u = easeInCubic(0.5);
  closeTo(out.alphaMultiplier, 1 - u);
  closeTo(out.rotationDeltaDegrees, -200 * u);
  closeTo(out.translationY, 300 * u);
  // Without a pose, `xh` stands in for the layer index: parity AND hash.
  const byXh = resolveAnimationVisualState(withParams("TUMBLE", { xh: 1 }), 0, W, H, false, 0);
  const byIndex = entering("TUMBLE", 0, {}, 1);
  closeTo(byXh.translationX, byIndex.translationX);
  closeTo(byXh.rotationDeltaDegrees, byIndex.rotationDeltaDegrees);
});

test("STOMP starts from the importer's s0 when it has one (§8.3 item 9)", () => {
  closeTo(resolveAnimationVisualState(withParams("STOMP", { startScale: 7.5 }), 0, W, H).scaleMultiplier, 7.5);
  const quarter = resolveAnimationVisualState(withParams("STOMP", { startScale: 7.5 }), 0.25, W, H);
  closeTo(quarter.scaleMultiplier, 7.5 + (1 - 7.5) * easeInQuart(0.25));
  closeTo(entering("STOMP", 0).scaleMultiplier, Math.max(4, 1620 / W));
});

test("SCRAPBOOK stamps Canva's g poses around b, each from floor(h·c) − 1 ms (§8.3 item 10)", () => {
  const params = { poses: 2, poseX: 40, poseY: -20 };
  const at = (p: number, over: Record<string, number> = {}, layerIndex = 0) =>
    resolveAnimationVisualState(withParams("SCRAPBOOK", { ...params, ...over }), p, W, H, false, layerIndex);
  // D = 500, g = 2: h = 250; pose 1 from 249 ms, rest from 499 ms.
  const first = at(0.2);
  closeTo(first.translationX, 40 + 50);
  closeTo(first.translationY, -20);
  closeTo(first.rotationDeltaDegrees, 5);
  const second = at(0.6);
  closeTo(second.translationX, 20);
  closeTo(second.translationY, -10 + 50);
  closeTo(second.rotationDeltaDegrees, -4.5);
  closeTo(at(248 / 500).translationX, 90, 6, "pose 0 until 249 ms");
  closeTo(at(249 / 500).translationX, 20, 6, "pose 1 from 249 ms");
  closeTo(at(499 / 500).translationX, 0, 6, "rest from 499 ms");
  // The tilt's sign follows xh's parity, over the layer index.
  closeTo(at(0.2, { xh: 1 }, 0).rotationDeltaDegrees, -5);
  closeTo(at(0.2, { xh: 2 }, 1).rotationDeltaDegrees, 5);
  // The default g = 3 over 500 ms: h = 166, pose 1 from 165 ms.
  closeTo(entering("SCRAPBOOK", 164 / 500).translationX, 50);
  closeTo(entering("SCRAPBOOK", 165 / 500).translationY, 50);
});

test("NEON takes its parity from xh over the layer index (§8.3 item 11)", () => {
  for (const p of [0.2, 0.3, 0.45]) {
    closeTo(
      resolveAnimationVisualState(withParams("NEON", { xh: 1 }), p, W, H, false, 0).alphaMultiplier,
      entering("NEON", p, {}, 1).alphaMultiplier
    );
  }
});

test("FADE with fadeEase = 1 fades LINEARLY both ways (§8.3 item 12)", () => {
  closeTo(resolveAnimationVisualState(withParams("FADE", { fadeEase: 1 }), 0.3, W, H).alphaMultiplier, 0.3);
  closeTo(resolveAnimationVisualState(withParams("FADE", { fadeEase: 1 }), 0.7, W, H, true).alphaMultiplier, 0.7);
  closeTo(entering("FADE", 0.3).alphaMultiplier, easeOutQuad(0.3));
});

test("a writing style keeps the whole-element state and hands the units to glyphMotion (§8.4)", () => {
  const params = { unit: 1, fill: 1, seed: 5 };
  const inState = resolveAnimationVisualState(withParams("FADE", params), 0.4, W, H);
  closeTo(inState.alphaMultiplier, easeOutQuad(0.4), 6, "Canva's own fallback for glyph-less surfaces");
  assert.deepEqual(inState.glyphMotion, {
    type: "FADE",
    progress: 0.4,
    durationMs: 500,
    unit: 1,
    fill: true,
    rawProgress: 0.4,
    isExiting: false,
    intensity: 1,
    seed: 5,
  });
  // On the way out the raw progress is u, the exit's own clock.
  const outState = resolveAnimationVisualState(withParams("BLUR", { unit: 3 }), 0.7, W, H, true);
  closeTo(outState.glyphMotion!.rawProgress!, 0.3);
  assert.equal(outState.glyphMotion!.isExiting, true);
  assert.equal(outState.glyphMotion!.fill, false);
  assert.equal(outState.glyphMotion!.unit, 3);
  for (const type of ["SUCCESSION", "NEON"]) {
    assert.ok(resolveAnimationVisualState(withParams(type, { unit: 2 }), 0.5, W, H).glyphMotion);
  }
  // No style, an unknown one, a loop, or a type without styles: no units.
  assert.equal(entering("FADE", 0.4).glyphMotion, null);
  assert.equal(resolveAnimationVisualState(withParams("FADE", { unit: 5 }), 0.4, W, H).glyphMotion, null);
  assert.equal(resolveAnimationVisualState(withParams("RISE", { unit: 1 }), 0.4, W, H).glyphMotion, null);
  assert.equal(
    resolveAnimationVisualState(withParams("FADE", { unit: 1 }, { infinite: true }), 0.4, W, H).glyphMotion,
    null
  );
});
