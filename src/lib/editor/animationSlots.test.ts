import test from "node:test";
import assert from "node:assert/strict";

import {
  hasExplicitAnimationSlots,
  isEmptyAnimationSlots,
  normalizeAnimationSlots,
  resolveElementAnimations,
} from "./animationSlots";
import { isElementVisibleAtPlayhead } from "./animationTimeline";

// The legacy fields a Canva import writes: one effect plus a mode that means "entrance AND exit".
const LEGACY = {
  mediaAnimationType: "FADE",
  mediaAnimationMode: "IN_OUT",
  mediaAnimationDurationMs: 1000,
  mediaAnimationOutDurationMs: 1000,
};

test("a layer that has never seen the slot editor still migrates its legacy animation", () => {
  const slots = resolveElementAnimations({ ...LEGACY });
  assert.equal(slots.entrance?.type, "FADE");
  assert.equal(slots.exit?.type, "FADE");
  assert.equal(slots.loop, null);

  // `{}` says nothing about the slots, so it is not a decision either.
  const emptyObject = resolveElementAnimations({ ...LEGACY, animations: {} });
  assert.equal(emptyObject.entrance?.type, "FADE");
  assert.equal(emptyObject.exit?.type, "FADE");
});

// The Entrance/Exit tabs used to trade one animation back and forth forever: clearing the last
// slot wrote all-null, which read as "not migrated yet", so mediaAnimationType came straight back.
test("clearing every slot removes the animation instead of resurrecting the legacy one", () => {
  const cleared = resolveElementAnimations({
    ...LEGACY,
    animations: { entrance: null, exit: null, loop: null },
  });
  assert.equal(cleared.entrance, null, "entrance stays cleared");
  assert.equal(cleared.exit, null, "exit stays cleared");
  assert.equal(cleared.loop, null, "loop stays cleared");
  assert.ok(isEmptyAnimationSlots(cleared), "the layer has no animation at all");
});

test("a partially filled slots object is taken at its word, legacy fields ignored", () => {
  // Exit only — the entrance must NOT be filled in from mediaAnimationMode: "IN_OUT".
  const exitOnly = resolveElementAnimations({
    ...LEGACY,
    animations: {
      entrance: null,
      loop: null,
      exit: { type: "FADE", durationMs: 1000, delayMs: 0, infinite: false },
    },
  });
  assert.equal(exitOnly.entrance, null);
  assert.equal(exitOnly.exit?.type, "FADE");
});

// What the Canva importer stores on an object now that it emits three slots: the explicit
// `animations` PLUS a legacy single-slot mirror of its entrance for pre-slot readers. The editor's
// template→element mapping (SidePanel `common`) used to copy only the mirror, so a RISE entrance
// + ROTATE loop opened as RISE alone. This pins the step that mapping performs and what the
// resolver then returns for the element it builds.
test("an imported object's explicit slots survive the template→element mapping", () => {
  const imported = {
    animations: {
      entrance: { type: "RISE", durationMs: 500, delayMs: 200, direction: "UP", intensity: 1 },
      exit: null,
      loop: {
        type: "ROTATE",
        durationMs: 20300,
        delayMs: 0,
        infinite: true,
        direction: "CLOCKWISE",
        intensity: 1,
      },
    },
    mediaAnimationType: "RISE",
    mediaAnimationMode: "IN",
    mediaAnimationDurationMs: 500,
    mediaAnimationDelayMs: 200,
  };

  // The old mapping's output — the legacy mirror by itself — cannot carry the loop.
  const { animations: _dropped, ...legacyOnly } = imported;
  const collapsed = resolveElementAnimations(legacyOnly);
  assert.equal(collapsed.entrance?.type, "RISE");
  assert.equal(collapsed.loop, null, "the legacy mirror only ever held the entrance");

  // The mapping's step: an object that names its slots is normalized and carried onto the element.
  assert.equal(hasExplicitAnimationSlots(imported.animations), true);
  const element = { ...legacyOnly, animations: normalizeAnimationSlots(imported.animations) };
  const slots = resolveElementAnimations(element);
  assert.equal(slots.entrance?.type, "RISE");
  assert.equal(slots.entrance?.delayMs, 200, "the importer's stagger delay is kept");
  assert.equal(slots.entrance?.infinite, false, "an entrance is one-shot");
  assert.equal(slots.exit, null, "a null slot stays empty — never filled from mediaAnimationMode");
  assert.equal(slots.loop?.type, "ROTATE");
  assert.equal(slots.loop?.infinite, true, "the loop stays infinite");
  assert.equal(slots.loop?.durationMs, 20300);
  assert.deepEqual(slots, element.animations, "explicit slots are returned as stored, not re-derived");
});

test("hasExplicitAnimationSlots separates a decision from a missing value", () => {
  assert.equal(hasExplicitAnimationSlots(undefined), false);
  assert.equal(hasExplicitAnimationSlots(null), false);
  assert.equal(hasExplicitAnimationSlots({}), false);
  assert.equal(hasExplicitAnimationSlots({ entrance: null, exit: null, loop: null }), true);
  assert.equal(hasExplicitAnimationSlots({ loop: null }), true);
});

// Playback parks the playhead exactly on the page duration when it finishes. Every layer's window
// ends there too, so the half-open visibility test used to hide all of them at once and the canvas
// went blank white the instant a preview ended.
test("a layer that runs to the end of the page survives the playhead parked there", () => {
  const PAGE_MS = 10040;
  const fullLength = { timelineStartMs: 0, timelineEndMs: PAGE_MS };
  assert.equal(isElementVisibleAtPlayhead(fullLength, PAGE_MS, PAGE_MS), true, "visible at the end");
  assert.equal(isElementVisibleAtPlayhead(fullLength, PAGE_MS - 1, PAGE_MS), true);
  assert.equal(isElementVisibleAtPlayhead(fullLength, 0, PAGE_MS), true);

  // An INTERIOR boundary is unchanged: a clip that ends at 3s is gone at 3s.
  const earlyClip = { timelineStartMs: 0, timelineEndMs: 3000 };
  assert.equal(isElementVisibleAtPlayhead(earlyClip, 2999, PAGE_MS), true);
  assert.equal(isElementVisibleAtPlayhead(earlyClip, 3000, PAGE_MS), false, "gone at its own end");
  assert.equal(isElementVisibleAtPlayhead(earlyClip, PAGE_MS, PAGE_MS), false, "still gone at the end");

  // A layer that starts later is still hidden before its window opens, and a hidden layer stays hidden.
  assert.equal(isElementVisibleAtPlayhead({ timelineStartMs: 4000, timelineEndMs: PAGE_MS }, 3999, PAGE_MS), false);
  assert.equal(isElementVisibleAtPlayhead({ visible: false, timelineStartMs: 0, timelineEndMs: PAGE_MS }, PAGE_MS, PAGE_MS), false);
});

// ── Round 2 (docs/canva-animation-parity.md §8.1/§8.2): params and concurrent loops ──────────────

import {
  editAnimationSlotSpec,
  makeAnimationSpec,
  normalizeAnimationParams,
  resolveTimelinePlaybackState,
} from "./animationSlots";
import {
  composeVisualStates,
  identityVisualState,
  resolveConcurrentLoopVisualState,
  resolvePlaybackVisualState,
  resolveStackedEffectsVisualState,
} from "./animationVisual";
import { toMobileProject } from "@/lib/templates/mobileProject";

function near(actual: number, expected: number, what = "") {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${what} expected ${expected}, got ${actual}`);
}

test("params keep every finite number and are omitted when none is left (§8.1)", () => {
  const spec = makeAnimationSpec({
    type: "TUMBLE",
    params: { startRotation: -170, travelX: -1920, bogus: Number.NaN, label: "x" as unknown as number, inf: Infinity },
  });
  assert.deepEqual(spec.params, { startRotation: -170, travelX: -1920 });
  assert.equal("params" in makeAnimationSpec({ type: "TUMBLE", params: {} }), false);
  assert.equal("params" in makeAnimationSpec({ type: "TUMBLE" }), false);
  assert.equal(normalizeAnimationParams([1, 2]), undefined);
  assert.deepEqual(normalizeAnimationParams({ unknownKey: 3 }), { unknownKey: 3 }, "unknown keys round-trip");
});

test("params round-trip through the stored slots and the editor's resolver", () => {
  const stored = {
    entrance: { type: "FADE", durationMs: 500, params: { unit: 2, fill: 1 } },
    exit: null,
    loop: { type: "BREATHE", durationMs: 8000, infinite: true, params: { concurrent: 1, r1From: 0.9, r1To: 1.03, r1Dur: 8000 } },
  };
  const slots = resolveElementAnimations({ animations: stored });
  assert.deepEqual(slots.entrance?.params, { unit: 2, fill: 1 });
  assert.deepEqual(slots.loop?.params, { concurrent: 1, r1From: 0.9, r1To: 1.03, r1Dur: 8000 });
  // Normalizing twice (load → save → load) changes nothing.
  assert.deepEqual(normalizeAnimationSlots(JSON.parse(JSON.stringify(slots))), slots);
});

test("picking a NEW effect starts without params; editing the current one keeps them", () => {
  const current = makeAnimationSpec({ type: "TUMBLE", params: { startRotation: -170 } }, "ENTRANCE");
  const slower = editAnimationSlotSpec(current, { durationMs: 900 }, "ENTRANCE");
  assert.equal(slower.durationMs, 900);
  assert.deepEqual(slower.params, { startRotation: -170 });
  const turned = editAnimationSlotSpec(current, { type: "TUMBLE", direction: "LEFT" }, "ENTRANCE");
  assert.deepEqual(turned.params, { startRotation: -170 });
  const swapped = editAnimationSlotSpec(current, { type: "FADE" }, "ENTRANCE");
  assert.equal(swapped.type, "FADE");
  assert.equal("params" in swapped, false);
  assert.equal(swapped.durationMs, 500, "the new type's own defaults");
  assert.equal(editAnimationSlotSpec(null, { type: "RISE" }, "ENTRANCE").type, "RISE");
});

test("the mobile API emits a slot's finite params and the legacy intensity up to 4", () => {
  const project = toMobileProject({
    id: "tpl-params",
    name: "params",
    canvasWidth: 1080,
    canvasHeight: 1920,
    data: {
      version: "7.0.0",
      objects: [
        {
          type: "textbox",
          left: 10,
          top: 10,
          width: 300,
          height: 80,
          text: "hello",
          fontSize: 40,
          mediaAnimationType: "DRIFT",
          mediaAnimationMode: "LOOP",
          mediaAnimationInfinite: true,
          mediaAnimationIntensity: 3.25,
          animations: {
            entrance: { type: "FADE", durationMs: 500, params: { unit: 1, fill: 0 } },
            exit: { type: "FADE", durationMs: 500 },
            loop: { type: "ROTATE", infinite: true, durationMs: 20300, params: { concurrent: 1, phaseMs: 400, stackWiggle: 18200 } },
          },
        },
      ],
    },
  });
  const layer = project.layers[0] as {
    animations: Record<string, { params?: Record<string, number> } | undefined>;
    animation: { intensity: number };
  };
  assert.deepEqual(layer.animations.entrance?.params, { unit: 1, fill: 0 });
  assert.equal(layer.animations.exit && "params" in layer.animations.exit, false);
  assert.deepEqual(layer.animations.loop?.params, { concurrent: 1, phaseMs: 400, stackWiggle: 18200 });
  assert.equal(layer.animation.intensity, 3.25, "the legacy single animation clamps at 4, not 2");
});

// A concurrent loop is not a slot in the exit → entrance → loop race: the entrance/exit resolve as
// if there were no loop, and the loop rides along the whole visible window on its own clock.
const concurrentSlots = {
  entrance: makeAnimationSpec({ type: "FADE", durationMs: 500 }, "ENTRANCE"),
  exit: makeAnimationSpec({ type: "FADE", durationMs: 500 }, "EXIT"),
  loop: makeAnimationSpec(
    { type: "ROTATE", durationMs: 1000, params: { concurrent: 1, phaseMs: 250 } },
    "LOOP"
  ),
};

test("the timeline attaches a concurrent loop to every visible state (§8.2)", () => {
  const at = (ms: number) => resolveTimelinePlaybackState(false, 1000, 5000, concurrentSlots, ms, 6000);
  const entering = at(1250);
  assert.equal(entering.animation?.type, "FADE");
  assert.equal(entering.isExiting, false);
  near(entering.progress, 0.5);
  assert.equal(entering.concurrentLoop?.type, "ROTATE");
  assert.equal(entering.windowMs, 250);
  const holding = at(3000);
  assert.equal(holding.animation?.type, "FADE", "past the entrance the entrance's end holds");
  assert.equal(holding.progress, 1);
  assert.equal(holding.windowMs, 2000);
  const leaving = at(4750);
  assert.equal(leaving.isExiting, true);
  near(leaving.progress, 0.5);
  assert.equal(leaving.concurrentLoop?.type, "ROTATE");
  const hidden = at(500);
  assert.equal(hidden.isVisible, false);
  assert.equal(hidden.concurrentLoop, undefined);
  // A concurrent loop alone still plays.
  const alone = resolveTimelinePlaybackState(false, 0, 4000, { entrance: null, exit: null, loop: concurrentSlots.loop }, 100, 4000);
  assert.equal(alone.animation, null);
  assert.equal(alone.concurrentLoop?.type, "ROTATE");
  // Without `concurrent` the loop is an ordinary slot, exactly as before.
  const plain = resolveTimelinePlaybackState(
    false,
    0,
    4000,
    { ...concurrentSlots, loop: makeAnimationSpec({ type: "ROTATE", durationMs: 1000 }, "LOOP") },
    2000,
    4000
  );
  assert.equal(plain.animation?.type, "ROTATE");
  assert.equal(plain.concurrentLoop, undefined);
});

test("the playback visual composes the slot with the concurrent loop on the loop's clock", () => {
  const visual = (ms: number) =>
    resolvePlaybackVisualState(resolveTimelinePlaybackState(false, 0, 4000, concurrentSlots, ms, 4000), 200, 100);
  // 250 ms: the fade is half in (easeOutQuad), the loop clock is 250 + phaseMs 250 = 500 ms.
  near(visual(250).alphaMultiplier, 0.75, "fade");
  near(visual(250).rotationDeltaDegrees, 180, "rotate");
  near(visual(2000).alphaMultiplier, 1);
  near(visual(2000).rotationDeltaDegrees, 90);
  // 3750 ms: half-way out; the loop clock wrapped to 0.
  near(visual(3750).alphaMultiplier, 0.75);
  near(visual(3750).rotationDeltaDegrees, 0);
});

test("a ramped concurrent BREATHE/DRIFT/TECTONIC follows its ms ramp (§8.2)", () => {
  const breathe = makeAnimationSpec(
    {
      type: "BREATHE",
      durationMs: 8000,
      params: { concurrent: 1, r1From: 0.9, r1To: 1.03, r1Start: 0, r1Dur: 4000, r1Ease: 1, r2To: 1, r2Start: 4000, r2Dur: 4000, r2Ease: 4, y1From: -5, y1To: 5, y2To: 0 },
    },
    "LOOP"
  );
  const mid = resolveConcurrentLoopVisualState(breathe, 2000, 200, 100);
  near(mid.scaleMultiplier, 0.965);
  near(mid.translationY, 0);
  const second = resolveConcurrentLoopVisualState(breathe, 5000, 200, 100);
  const e = 2 * 0.25 * 0.25;
  near(second.scaleMultiplier, 1.03 + (1 - 1.03) * e);
  near(second.translationY, 5 + (0 - 5) * e);
  near(resolveConcurrentLoopVisualState(breathe, 9000, 200, 100).scaleMultiplier, 1);
  // Drift moves on its axis: y for UP/DOWN, x otherwise; Tectonic always on x.
  const drift = (direction: "UP" | "DOWN" | "LEFT" | "RIGHT") =>
    resolveConcurrentLoopVisualState(
      makeAnimationSpec({ type: "DRIFT", direction, params: { concurrent: 1, r1From: -40, r1To: 40, r1Dur: 1000 } }, "LOOP"),
      500,
      200,
      100
    );
  near(drift("UP").translationY, 0);
  near(drift("UP").translationX, 0);
  near(resolveConcurrentLoopVisualState(
    makeAnimationSpec({ type: "DRIFT", direction: "DOWN", params: { concurrent: 1, r1From: -40, r1To: 40, r1Dur: 1000 } }, "LOOP"),
    750, 200, 100
  ).translationY, 20);
  near(resolveConcurrentLoopVisualState(
    makeAnimationSpec({ type: "TECTONIC", params: { concurrent: 1, r1From: -30, r1To: 15, r1Dur: 1000 } }, "LOOP"),
    1000, 200, 100
  ).translationX, 15);
  // Without a ramp the loop formula plays at (τ mod durationMs) / durationMs — as a loop.
  const pulse = makeAnimationSpec({ type: "PULSE", durationMs: 900, infinite: false, params: { concurrent: 1 } }, "LOOP");
  near(resolveConcurrentLoopVisualState(pulse, 900 * 3 + 150, 200, 100).scaleMultiplier, 1.15);
});

test("stacked repeating effects compose on their own clock (§8.2)", () => {
  const loop = makeAnimationSpec(
    {
      type: "BREATHE",
      params: { concurrent: 1, stackRotate: -1000, stackPulse: 900, stackFlicker: 1100, stackFlickerT: 0.5 },
    },
    "LOOP"
  );
  const stacked = resolveStackedEffectsVisualState(loop, 450, 200, 100);
  near(stacked.rotationDeltaDegrees, -162, "a negative stackRotate turns counter-clockwise");
  near(stacked.alphaMultiplier, 0.35, "flicker at the bottom of its dip");
  // Pulse half-way through its 900 ms cycle: 1.15 → 0.85 on easeOutQuad, half done.
  near(stacked.scaleMultiplier, 1.15 - 0.3 * 0.75);
  // A stacked wiggle walks by the loop's seed.
  const wiggle = resolveStackedEffectsVisualState(
    makeAnimationSpec({ type: "BREATHE", params: { concurrent: 1, stackWiggle: 18200, stackWiggleT: 0.5, seed: 4321.5 } }, "LOOP"),
    162.5,
    200,
    100
  );
  const r = (s: number) => Math.abs(Math.cos(s) * 4321.5) % 1;
  near(wiggle.translationX, (-20 + 40 * r(2)) * 1.15 * 0.5);
  // Composition: alpha and scales multiply, the rest adds, structure comes from the primary.
  const primary = { ...identityVisualState(), alphaMultiplier: 0.5, translationX: 10, revealMask: { kind: "WIPE" as const, progress: 0.3, featherFraction: 0 } };
  const other = { ...identityVisualState(), alphaMultiplier: 0.5, translationX: 5, scaleMultiplier: 2, blurRadiusPx: 3, revealMask: { kind: "WIPE" as const, progress: 0.9, featherFraction: 0 } };
  const composed = composeVisualStates(primary, other);
  near(composed.alphaMultiplier, 0.25);
  near(composed.translationX, 15);
  near(composed.scaleMultiplier, 2);
  near(composed.blurRadiusPx, 3);
  assert.equal(composed.revealMask, primary.revealMask);
});

test("a writing style under a concurrent loop records what the layer keeps (the app's rest*)", () => {
  const slots = {
    entrance: makeAnimationSpec({ type: "FADE", durationMs: 1000, params: { unit: 1 } }, "ENTRANCE"),
    exit: null,
    loop: makeAnimationSpec(
      { type: "BREATHE", durationMs: 8000, params: { concurrent: 1, r1From: 0.9, r1To: 1.03, r1Dur: 8000, stackFlicker: 1100 } },
      "LOOP"
    ),
  };
  const state = resolvePlaybackVisualState(resolveTimelinePlaybackState(false, 0, 8000, slots, 400, 8000), 200, 100);
  assert.equal(state.glyphMotion?.unit, 1);
  near(state.glyphMotion?.restScale ?? 0, 0.9 + 0.13 * 0.05);
  near(state.glyphMotion?.restAlpha ?? 0, 1 - (1 - 0.35) * (400 / 450));
  near(state.glyphMotion?.restBlurPx ?? -1, 0);
});
