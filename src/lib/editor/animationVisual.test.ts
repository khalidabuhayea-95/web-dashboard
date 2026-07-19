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
  applyAnimationEasing,
  pingPongProgress,
  resolveAnimationVector,
  resolveAnimationVisualState,
  rotationSpin,
  type AnimationSpecInput,
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
  // PULSE overshoots (y2 = 1.178); BOUNCE undershoots (y1 = -0.25). Must stay finite.
  assert.ok(Number.isFinite(cubicBezierEase(0.5, 0.6, 0, 0.48, 1.178)));
  assert.ok(Number.isFinite(cubicBezierEase(0.5, 0.167, -0.25, 0.833, 0.967)));
});

test("FADE's authored opacity curve plays", () => {
  const curves = getAuthoredCurves("FADE");
  assert.ok(curves);
  assert.equal(curves.fps, 25);
  assert.equal(curves.durationFrames, 35);
  const opacity = curves.channels.opacity;
  assert.ok(opacity);
  // Authored 5→0, 25→1: hidden before frame 5, fully shown from 25 on.
  assert.equal(valueAtFrame(opacity, 0), 0);
  assert.equal(valueAtFrame(opacity, 25), 1);
  assert.equal(valueAtFrame(opacity, 35), 1);
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

test("RISE settles to its resting pose at progress 1", () => {
  const state = resolveAnimationVisualState(spec("RISE"), 1, W, H);
  closeTo(state.translationY, 0);
  closeTo(state.alphaMultiplier, 1);
});

test("RISE offsets by max(16, height*0.22) at progress 0", () => {
  const state = resolveAnimationVisualState(spec("RISE", { infinite: false }), 0, W, H);
  closeTo(state.translationY, Math.max(16, H * 0.22));
  closeTo(state.alphaMultiplier, 0.12);
});

test("amplitudes honour their min-px floor on tiny layers", () => {
  const state = resolveAnimationVisualState(spec("RISE", { infinite: false }), 0, 10, 10);
  closeTo(state.translationY, 16);
});

test("PAN follows the direction vector", () => {
  const right = resolveAnimationVisualState(spec("PAN", { direction: "RIGHT" }), 0, W, H);
  const left = resolveAnimationVisualState(spec("PAN", { direction: "LEFT" }), 0, W, H);
  closeTo(right.translationX, Math.max(22, W * 0.28));
  closeTo(left.translationX, -Math.max(22, W * 0.28));
});

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

test("intensity scales the amplitude", () => {
  const normal = resolveAnimationVisualState(spec("RISE", { intensity: 1 }), 0, W, H);
  const double = resolveAnimationVisualState(spec("RISE", { intensity: 2 }), 0, W, H);
  closeTo(double.translationY, normal.translationY * 2);
});

test("POP carries the authored -180° rotation the old web port lacked", () => {
  const start = resolveAnimationVisualState(spec("POP"), 5 / 35, W, H);
  const end = resolveAnimationVisualState(spec("POP"), 20 / 35, W, H);
  closeTo(start.scaleMultiplier, 0);
  closeTo(start.rotationDeltaDegrees, -180);
  closeTo(end.scaleMultiplier, 1);
  closeTo(end.rotationDeltaDegrees, 0);
});

test("the GRADIENT reveal twins differ only by feather", () => {
  const wipe = resolveAnimationVisualState(spec("WIPE"), 0.5, W, H);
  const gradient = resolveAnimationVisualState(spec("GRADIENT_WIPE"), 0.5, W, H);
  assert.equal(wipe.revealMask?.kind, "WIPE");
  assert.equal(gradient.revealMask?.kind, "WIPE");
  assert.equal((wipe.revealMask as { featherFraction: number }).featherFraction, 0);
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
  const a = resolveAnimationVisualState(spec("FADE", { easing: "LINEAR" }), 0.5, W, H);
  const b = resolveAnimationVisualState(spec("FADE", { easing: "EASE_IN" }), 0.5, W, H);
  closeTo(a.alphaMultiplier, b.alphaMultiplier);

  const c = resolveAnimationVisualState(spec("RISE", { easing: "LINEAR" }), 0.5, W, H);
  const d = resolveAnimationVisualState(spec("RISE", { easing: "EASE_IN" }), 0.5, W, H);
  notCloseTo(c.translationY, d.translationY);
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

  const exiting = at(9_500);
  assert.equal(exiting.animation?.type, "FADE");
  assert.equal(exiting.isExiting, true);
  // The exit runs the curve in reverse: halfway through → progress 0.5, heading to 0.
  closeTo(exiting.progress, 0.5);
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
