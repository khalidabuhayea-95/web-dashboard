/**
 * An imported animation must always be an effect its own tab offers.
 *
 * Canva's Rise mapped onto our RISE, which was a Loop and Exit effect and never an entrance, so the
 * Entrance slot ended up holding something the tab does not list. The editor could not show it as
 * selected and the app was handed an entrance it does not offer either. (Rise and Succession are
 * entrances in their own right now; the effects below still need fitting.)
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ANIMATION_CATALOG, type AnimationCategory } from "./animationSpec";
import {
  categoryForLegacyMode,
  fitAnimationTypeToCategory,
  fitImportedAnimationsToCategories,
} from "./animationSlotFit";

const CATEGORIES: AnimationCategory[] = ["ENTRANCE", "EXIT", "LOOP"];

test("every effect in the catalogue fits every tab, whichever it started in", () => {
  const everyType = [
    ...new Set([...ANIMATION_CATALOG.ENTRANCE, ...ANIMATION_CATALOG.EXIT, ...ANIMATION_CATALOG.LOOP]),
  ];
  for (const category of CATEGORIES) {
    for (const type of everyType) {
      const fitted = fitAnimationTypeToCategory(type, category);
      assert.ok(
        ANIMATION_CATALOG[category].includes(fitted),
        `${type} in ${category} became ${fitted}, which that tab does not offer`
      );
    }
  }
});

test("a tab's own effects are left exactly as they are", () => {
  for (const category of CATEGORIES) {
    for (const type of ANIMATION_CATALOG[category]) {
      assert.equal(fitAnimationTypeToCategory(type, category), type);
    }
  }
});

test("the Canva effects we ported keep their own effect in every tab", () => {
  // Canva's enter/exit family is offered wherever Canva offers it (docs/canva-animation-parity.md
  // §7), so nothing is substituted: an imported Canva animation keeps the effect it was authored
  // with, in the slot it belongs to.
  for (const category of CATEGORIES) {
    for (const type of [
      "RISE",
      "PAN",
      "SUCCESSION",
      "BLUR",
      "BASELINE",
      "TUMBLE",
      "NEON",
      "SCRAPBOOK",
      "STOMP",
    ]) {
      assert.equal(fitAnimationTypeToCategory(type, category), type, `${type} in ${category}`);
    }
  }
  // Fade, Pop and Wipe enter and exit as themselves; only a loop of them is substituted.
  for (const type of ["FADE", "POP", "WIPE"]) {
    assert.equal(fitAnimationTypeToCategory(type, "ENTRANCE"), type);
    assert.equal(fitAnimationTypeToCategory(type, "EXIT"), type);
  }
  assert.equal(fitAnimationTypeToCategory("POP", "EXIT"), "POP", "Pop is an exit now, not a Zoom");
});

test("the continuous and loop-only effects arrive by the nearest entrance of the same feel", () => {
  assert.equal(fitAnimationTypeToCategory("DRIFT", "ENTRANCE"), "SLIDE");
  assert.equal(fitAnimationTypeToCategory("TECTONIC", "ENTRANCE"), "SLIDE");
  assert.equal(fitAnimationTypeToCategory("SHIFT", "ENTRANCE"), "SLIDE");
  assert.equal(fitAnimationTypeToCategory("PULSE", "ENTRANCE"), "POP");
  assert.equal(fitAnimationTypeToCategory("BREATHE", "ENTRANCE"), "ZOOM");
  assert.equal(fitAnimationTypeToCategory("FLICKER", "ENTRANCE"), "DISSOLVE");
  assert.equal(fitAnimationTypeToCategory("BREATHE", "EXIT"), "ZOOM");
  assert.equal(fitAnimationTypeToCategory("FLICKER", "EXIT"), "DISSOLVE");
});

test("NONE stays NONE and an unknown effect lands on the tab's fallback", () => {
  for (const category of CATEGORIES) {
    assert.equal(fitAnimationTypeToCategory("NONE", category), "NONE");
    assert.equal(fitAnimationTypeToCategory("", category), "NONE");
  }
  assert.equal(fitAnimationTypeToCategory("NOT_A_REAL_EFFECT", "ENTRANCE"), "FADE");
  assert.equal(fitAnimationTypeToCategory("NOT_A_REAL_EFFECT", "LOOP"), "PULSE");
});

test("the legacy mode decides which tab an imported layer is fitted against", () => {
  assert.equal(categoryForLegacyMode("IN"), "ENTRANCE");
  assert.equal(categoryForLegacyMode("IN_OUT"), "ENTRANCE");
  assert.equal(categoryForLegacyMode("OUT"), "EXIT");
  assert.equal(categoryForLegacyMode("LOOP"), "LOOP");
  assert.equal(categoryForLegacyMode(undefined), "ENTRANCE");
  // An infinite spec is a loop whatever the mode says.
  assert.equal(categoryForLegacyMode("IN", true), "LOOP");
});

test("an imported design has each of its animations refitted in place", () => {
  const design = {
    pages: [
      {
        elements: [
          { id: "a", mediaAnimationType: "TUMBLE", mediaAnimationMode: "IN" },
          { id: "b", mediaAnimationType: "RISE", mediaAnimationMode: "IN" },
          { id: "c", mediaAnimationType: "FADE", mediaAnimationMode: "IN" },
          {
            id: "d",
            animations: {
              entrance: { type: "DRIFT", durationMs: 800 },
              exit: null,
              loop: { type: "SLIDE", durationMs: 900 },
            },
          },
        ],
      },
    ],
  };

  const changed = fitImportedAnimationsToCategories(design);
  const [a, b, c, d] = design.pages[0].elements as any[];

  assert.equal(a.mediaAnimationType, "TUMBLE", "the Entrance tab offers Tumble now, so it is kept");
  assert.equal(b.mediaAnimationType, "RISE", "the Entrance tab offers Rise now, so it is kept");
  assert.equal(c.mediaAnimationType, "FADE", "an effect that already fits is untouched");
  assert.equal(d.animations.entrance.type, "SLIDE", "Drift is never an entrance");
  assert.equal(d.animations.loop.type, "PAN");
  assert.equal(d.animations.entrance.durationMs, 800, "timing is not touched, only the effect");
  assert.equal(changed, 2);
});

test("an in-and-out import keeps only the entrance when the fit is not an exit effect", () => {
  const design = {
    elements: [
      {
        id: "a",
        mediaAnimationType: "BREATHE",
        mediaAnimationMode: "IN_OUT",
        mediaAnimationOutDurationMs: 600,
      },
    ],
  };

  fitImportedAnimationsToCategories(design);
  const layer = design.elements[0] as any;

  // Breathe enters as a zoom, and Zoom IS an exit effect, so both legs survive.
  assert.equal(layer.mediaAnimationType, "ZOOM");
  assert.equal(layer.mediaAnimationMode, "IN_OUT");
  assert.equal(layer.mediaAnimationOutDurationMs, 600);

  const typed = { elements: [{ mediaAnimationType: "TYPEWRITER_CHARS", mediaAnimationMode: "IN_OUT", mediaAnimationOutDurationMs: 600 }] };
  fitImportedAnimationsToCategories(typed);
  const typewriter = typed.elements[0] as any;
  // A typewriter only ever enters — it is NOT an exit effect, so the exit leg is dropped.
  assert.equal(typewriter.mediaAnimationType, "TYPEWRITER_CHARS");
  assert.equal(typewriter.mediaAnimationMode, "IN");
  assert.equal(typewriter.mediaAnimationOutDurationMs, undefined);

  // Scrapbook enters AND exits as itself now (Canva offers it both ways), so both legs survive.
  const stamped = { elements: [{ mediaAnimationType: "SCRAPBOOK", mediaAnimationMode: "IN_OUT", mediaAnimationOutDurationMs: 600 }] };
  assert.equal(fitImportedAnimationsToCategories(stamped), 0);
  const scrapbook = stamped.elements[0] as any;
  assert.equal(scrapbook.mediaAnimationType, "SCRAPBOOK");
  assert.equal(scrapbook.mediaAnimationMode, "IN_OUT");
  assert.equal(scrapbook.mediaAnimationOutDurationMs, 600);
});

// §8.1: `params` are Canva's exact numbers for the spec's OWN type — Tumble's start pose, a
// writing style, a concurrent loop's ramp. A kept type keeps them; a substituted one drops them,
// since the look-alike would misread (or ignore) every one of them.
test("a refitted slot keeps its params when its type is kept and drops them when it is swapped", () => {
  const design = {
    elements: [
      {
        id: "a",
        animations: {
          entrance: { type: "TUMBLE", durationMs: 500, params: { startRotation: -170, travelX: -1920 } },
          exit: { type: "FADE", durationMs: 500, params: { unit: 2, fill: 1 } },
          loop: { type: "BREATHE", durationMs: 8000, params: { concurrent: 1, r1From: 0.9, r1To: 1.03 } },
        },
      },
      {
        id: "b",
        animations: {
          entrance: { type: "DRIFT", durationMs: 800, params: { fadeEase: 1 } },
          exit: null,
          loop: { type: "FADE", durationMs: 900, params: { concurrent: 1 } },
        },
      },
    ],
  };

  const changed = fitImportedAnimationsToCategories(design);
  const [a, b] = design.elements as any[];
  assert.deepEqual(a.animations.entrance.params, { startRotation: -170, travelX: -1920 });
  assert.deepEqual(a.animations.exit.params, { unit: 2, fill: 1 });
  assert.deepEqual(a.animations.loop.params, { concurrent: 1, r1From: 0.9, r1To: 1.03 });
  assert.equal(b.animations.entrance.type, "SLIDE");
  assert.equal("params" in b.animations.entrance, false, "a swapped entrance loses its params");
  assert.equal(b.animations.loop.type, "PULSE");
  assert.equal("params" in b.animations.loop, false, "a swapped loop is no longer concurrent");
  assert.equal(changed, 2);
});
