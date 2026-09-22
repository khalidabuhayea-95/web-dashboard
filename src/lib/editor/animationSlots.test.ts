import test from "node:test";
import assert from "node:assert/strict";

import {
  hasExplicitAnimationSlots,
  isEmptyAnimationSlots,
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
