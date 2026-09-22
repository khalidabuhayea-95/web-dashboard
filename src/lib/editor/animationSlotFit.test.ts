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
  // The Entrance tab offers Rise and Succession now, so nothing is substituted: an imported Canva
  // entrance keeps the effect it was authored with, in the slot it belongs to.
  for (const category of CATEGORIES) {
    assert.equal(fitAnimationTypeToCategory("RISE", category), "RISE");
    assert.equal(fitAnimationTypeToCategory("SUCCESSION", category), "SUCCESSION");
  }
});

test("travel and impact effects arrive by the nearest entrance of the same feel", () => {
  assert.equal(fitAnimationTypeToCategory("PAN", "ENTRANCE"), "SLIDE");
  assert.equal(fitAnimationTypeToCategory("DRIFT", "ENTRANCE"), "SLIDE");
  assert.equal(fitAnimationTypeToCategory("TECTONIC", "ENTRANCE"), "SLIDE");
  assert.equal(fitAnimationTypeToCategory("STOMP", "ENTRANCE"), "POP");
  assert.equal(fitAnimationTypeToCategory("TUMBLE", "ENTRANCE"), "POP");
  assert.equal(fitAnimationTypeToCategory("BREATHE", "ENTRANCE"), "ZOOM");
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

  assert.equal(a.mediaAnimationType, "POP", "an entrance must come from the Entrance tab");
  assert.equal(b.mediaAnimationType, "RISE", "the Entrance tab offers Rise now, so it is kept");
  assert.equal(c.mediaAnimationType, "FADE", "an effect that already fits is untouched");
  assert.equal(d.animations.entrance.type, "SLIDE");
  assert.equal(d.animations.loop.type, "PAN");
  assert.equal(d.animations.entrance.durationMs, 800, "timing is not touched, only the effect");
  assert.equal(changed, 3);
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

  const popOut = { elements: [{ mediaAnimationType: "SCRAPBOOK", mediaAnimationMode: "IN_OUT", mediaAnimationOutDurationMs: 600 }] };
  fitImportedAnimationsToCategories(popOut);
  const popped = popOut.elements[0] as any;
  // Scrapbook enters as a pop, which is NOT an exit effect, so the exit leg is dropped.
  assert.equal(popped.mediaAnimationType, "POP");
  assert.equal(popped.mediaAnimationMode, "IN");
  assert.equal(popped.mediaAnimationOutDurationMs, undefined);
});
