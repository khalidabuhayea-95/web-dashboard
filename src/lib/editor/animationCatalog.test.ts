/**
 * Per-animation coverage: one test per type in the spec, so a failure names the effect.
 *
 * Each type is exercised across its whole cycle and checked for the invariants every effect must
 * hold regardless of its maths, plus type-specific assertions for the families with a known
 * signature (reveals, glyphs, resting poses).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  ANIMATION_CATALOG,
  ANIMATION_TYPES,
  getAnimationTypeSpec,
  type AnimationCategory,
} from "./animationSpec";
import { makeAnimationSpec } from "./animationSlots";
import { resolveAnimationVisualState, type AnimationVisualState } from "./animationVisual";

const W = 240;
const H = 160;
const SAMPLES = [0, 0.1, 0.25, 0.33, 0.5, 0.66, 0.75, 0.9, 1];

/** Types whose entire job is to sit still. */
const STILL = new Set(["NONE", "STATIC"]);

/** Reveal families: these drive a mask channel rather than a transform. */
const MASK_TYPES = new Set([
  "WIPE",
  "GRADIENT_WIPE",
  "RADIAL",
  "RADIAL_GRADIENT",
  "CIRCUAL",
  "CIRCUAL_GRADIENT",
  "DIAGONAL",
  "DIAGONAL_GRADIENT",
]);

/** Text families: these drive per-glyph reveal, with an alpha/mask fallback. */
const TEXT_TYPES = new Set([
  "TYPEWRITER_CHARS",
  "TYPEWRITER_WORDS",
  "TYPEWRITER_CURSOR",
  "ONE_WORD",
  "CH_POSITION_FADE",
  "CH_SCALE_FADE",
  "CH_WIGGLE_Y",
]);

function sample(type: string, progress: number, over: Record<string, unknown> = {}) {
  return resolveAnimationVisualState(makeAnimationSpec({ type, ...over }), progress, W, H);
}

function fingerprint(state: AnimationVisualState): string {
  return [
    state.scaleMultiplier,
    state.scaleXMultiplier,
    state.scaleYMultiplier,
    state.rotationDeltaDegrees,
    state.translationX,
    state.translationY,
    state.alphaMultiplier,
    state.revealMask ? JSON.stringify(state.revealMask) : "-",
    state.glyphMotion ? state.glyphMotion.progress : "-",
    state.textReveal ? state.textReveal.progress : "-",
  ]
    .map((v) => (typeof v === "number" ? v.toFixed(5) : String(v)))
    .join("|");
}

for (const entry of ANIMATION_TYPES) {
  const type = entry.type;

  test(`${type}: resolves to finite, in-range values across its cycle`, () => {
    for (const p of SAMPLES) {
      const s = sample(type, p);
      for (const [key, value] of Object.entries(s)) {
        if (typeof value !== "number") continue;
        assert.ok(Number.isFinite(value), `${type} @${p}: ${key} is ${value}`);
      }
      assert.ok(
        s.alphaMultiplier >= 0 && s.alphaMultiplier <= 1,
        `${type} @${p}: alpha ${s.alphaMultiplier} out of 0..1`
      );
      // Scale may reach exactly 0 — POP and ZOOM are authored to grow from nothing — but a
      // NEGATIVE scale would mirror the layer, which no effect intends.
      assert.ok(s.scaleMultiplier >= 0, `${type} @${p}: scaleMultiplier ${s.scaleMultiplier} < 0`);
      assert.ok(s.scaleXMultiplier >= 0, `${type} @${p}: scaleX ${s.scaleXMultiplier} < 0`);
      assert.ok(s.scaleYMultiplier >= 0, `${type} @${p}: scaleY ${s.scaleYMultiplier} < 0`);
      // Amplitudes must stay in a sane band — a runaway translate would fling the layer offscreen.
      assert.ok(Math.abs(s.translationX) <= W * 8, `${type} @${p}: translationX ${s.translationX}`);
      assert.ok(Math.abs(s.translationY) <= H * 8, `${type} @${p}: translationY ${s.translationY}`);
      assert.ok(
        Math.abs(s.rotationDeltaDegrees) <= 720,
        `${type} @${p}: rotation ${s.rotationDeltaDegrees}`
      );
    }
  });

  test(`${type}: ${STILL.has(type) ? "stays still" : "actually animates"}`, () => {
    const prints = new Set(SAMPLES.map((p) => fingerprint(sample(type, p))));
    if (STILL.has(type)) {
      assert.equal(prints.size, 1, `${type} should not change across its cycle`);
    } else {
      assert.ok(prints.size > 1, `${type} produced an identical state at every progress`);
    }
  });

  test(`${type}: is deterministic`, () => {
    for (const p of SAMPLES) {
      assert.equal(fingerprint(sample(type, p)), fingerprint(sample(type, p)), `${type} @${p}`);
    }
  });

  test(`${type}: clamps progress outside 0..1`, () => {
    assert.equal(fingerprint(sample(type, -1)), fingerprint(sample(type, 0)), `${type} below 0`);
    assert.equal(fingerprint(sample(type, 2)), fingerprint(sample(type, 1)), `${type} above 1`);
  });

  test(`${type}: intensity scales its amplitude (or is deliberately intensity-free)`, () => {
    const single = sample(type, 0.3, { intensity: 1 });
    const triple = sample(type, 0.3, { intensity: 3 });
    const moved =
      Math.abs(single.translationX) + Math.abs(single.translationY) + Math.abs(single.rotationDeltaDegrees);
    if (moved > 1e-6) {
      const tripled =
        Math.abs(triple.translationX) + Math.abs(triple.translationY) + Math.abs(triple.rotationDeltaDegrees);
      // Authored-curve effects bake amplitude into keyframes and ignore intensity by design.
      const authored = Boolean(entry.authoredCurves);
      if (authored) {
        assert.ok(Math.abs(tripled - moved) < 1e-6, `${type}: authored curves must ignore intensity`);
      } else {
        assert.ok(tripled > moved, `${type}: intensity 3 did not increase amplitude`);
      }
    }
  });

  if (MASK_TYPES.has(type)) {
    test(`${type}: drives a reveal mask that advances with progress`, () => {
      const early = sample(type, 0.2).revealMask;
      const late = sample(type, 0.9).revealMask;
      assert.ok(early, `${type} has no revealMask at 0.2`);
      assert.ok(late, `${type} has no revealMask at 0.9`);
      assert.ok(late.progress >= early.progress, `${type} mask progress went backwards`);
      for (const p of SAMPLES) {
        const mask = sample(type, p).revealMask;
        assert.ok(mask, `${type} @${p} lost its mask`);
        assert.ok(mask.progress >= 0 && mask.progress <= 1, `${type} @${p} mask out of 0..1`);
      }
    });
  }

  if (TEXT_TYPES.has(type)) {
    test(`${type}: exposes a glyph/text channel`, () => {
      const s = sample(type, 0.5);
      assert.ok(s.textReveal || s.glyphMotion, `${type} exposes neither textReveal nor glyphMotion`);
    });

    // CH_WIGGLE_Y is the ONE glyph effect with no layer-level fallback: its formula sets
    // glyphMotion and nothing else — no alpha ramp, no mask. So on any surface without real
    // glyph positions (our canvas today, and media layers on mobile) it renders STATIC. That is
    // the app's own behaviour, not a porting gap; phase 2's glyph path is what turns it on.
    const hasFallback = type !== "CH_WIGGLE_Y";
    test(`${type}: ${hasFallback ? "falls back for glyph-less surfaces" : "is glyph-only with no fallback (renders static without a glyph path)"}`, () => {
      const s = sample(type, 0.5);
      const fallback = s.revealMask !== null || s.alphaMultiplier < 1;
      assert.equal(fallback, hasFallback, `${type} fallback expectation`);
    });
  }

  // A one-shot entrance must resolve to its resting pose at progress 1, or the layer would sit
  // permanently offset once the entrance finishes.
  if (entry.tabs.includes("ENTRANCE") && !TEXT_TYPES.has(type) && !MASK_TYPES.has(type)) {
    test(`${type}: settles to its resting pose at progress 1`, () => {
      const s = sample(type, 1);
      assert.ok(Math.abs(s.translationX) < 0.5, `${type}: translationX ${s.translationX} at rest`);
      assert.ok(Math.abs(s.translationY) < 0.5, `${type}: translationY ${s.translationY} at rest`);
      assert.ok(
        Math.abs(s.rotationDeltaDegrees) < 0.5,
        `${type}: rotation ${s.rotationDeltaDegrees} at rest`
      );
      assert.ok(Math.abs(s.scaleMultiplier - 1) < 0.02, `${type}: scale ${s.scaleMultiplier} at rest`);
      assert.ok(s.alphaMultiplier > 0.98, `${type}: alpha ${s.alphaMultiplier} at rest`);
    });
  }

  test(`${type}: is fully hidden when an exit finishes`, () => {
    const gone = resolveAnimationVisualState(makeAnimationSpec({ type }), 0, W, H, true);
    // Two legitimate ways to be gone, exactly as the mobile source does it: faded out, OR a matte
    // closed over the layer. The reveal family (WIPE/RADIAL/CIRCUAL/…) deliberately keeps alpha=1
    // and closes its mask instead — fading AND closing isn't the authored behaviour.
    const maskClosed = gone.revealMask != null && (gone.revealMask as { progress: number }).progress <= 0.01;
    assert.ok(
      gone.alphaMultiplier <= 0.01 || maskClosed,
      `${type}: exit left the layer visible (alpha=${gone.alphaMultiplier}, mask=${JSON.stringify(gone.revealMask)})`
    );
  });
}

test("every offered tile resolves and the catalog order is stable", () => {
  for (const [category, types] of Object.entries(ANIMATION_CATALOG)) {
    assert.ok(types.length > 0, `${category} catalog is empty`);
    types.forEach((type, index) => {
      const entry = getAnimationTypeSpec(type);
      assert.ok(entry, `${category}[${index}] = ${type} has no spec`);
      assert.ok(
        entry.tabs.includes(category as AnimationCategory),
        `${type} is listed in ${category} but its tabs are ${entry.tabs.join(",")}`
      );
    });
    // NONE must be the first tile in every tab that offers it.
    if (types.includes("NONE")) assert.equal(types[0], "NONE", `${category} must lead with NONE`);
  }
});

test("the catalog covers every type that declares a tab", () => {
  const catalogued = new Set([
    ...ANIMATION_CATALOG.ENTRANCE,
    ...ANIMATION_CATALOG.EXIT,
    ...ANIMATION_CATALOG.LOOP,
  ]);
  for (const entry of ANIMATION_TYPES) {
    if (entry.tabs.length === 0) {
      assert.ok(!catalogued.has(entry.type), `${entry.type} is enum-only but appears in a catalog`);
    } else {
      assert.ok(catalogued.has(entry.type), `${entry.type} declares tabs but is in no catalog`);
    }
  }
});
