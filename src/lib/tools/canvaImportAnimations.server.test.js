// Server-side passthrough of the Canva importer's three-slot `animations` object
// (docs/canva-animation-parity.md §6): the extension emits explicit slots next to the legacy
// mediaAnimation* mirror, createImportedTemplate runs fitImportedAnimationsToCategories over the
// fabric data, the editor/store resolve slots with resolveElementAnimations, and the mobile API
// serialises them through toMobileProject. Explicit slots must win over the legacy mirror at every
// step, and the imported numbers (durations, stagger, amplitude-on-intensity) must come out intact.
//
//   node --import tsx --test src/lib/tools/canvaImportAnimations.server.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { fitImportedAnimationsToCategories } from "@/lib/editor/animationSlotFit";
import { resolveElementAnimations, hasExplicitAnimationSlots } from "@/lib/editor/animationSlots";
import { toMobileProject } from "@/lib/templates/mobileProject";
import { resolveImportedTemplateData } from "@/lib/tools/canvaImportTemplate";

/** A fabric object exactly as background.js's annotateImportMetadata emits it for a Canva Drift
 *  element (continuous preset → loop DRIFT + FADE legs) that ALSO carries a repeating rotate. */
function importedDriftObject() {
  return {
    type: "Image",
    version: "7.0.0",
    originX: "left",
    originY: "top",
    left: 100,
    top: 200,
    width: 300,
    height: 150,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    opacity: 1,
    src: "https://cdn.example.com/photo.png",
    layerType: "image",
    importNodeId: "LB1",
    canvaAnimationPreset: 3,
    canvaRepeating: { rotate: { direction: 2, Vd: 0 } },
    animations: {
      entrance: { type: "FADE", infinite: false, durationMs: 500, delayMs: 400, direction: "DEFAULT", intensity: 1 },
      exit: { type: "FADE", infinite: false, durationMs: 500, delayMs: 0, direction: "DEFAULT", intensity: 1 },
      loop: { type: "ROTATE", infinite: true, durationMs: 20300, delayMs: 0, direction: "COUNTERCLOCKWISE", intensity: 1 },
    },
    // Legacy mirror for pre-slot builds: deliberately DIFFERENT from the slots (loop only) so a
    // consumer that still reads it first would be caught.
    mediaAnimationType: "DRIFT",
    mediaAnimationMode: "LOOP",
    mediaAnimationInfinite: true,
    mediaAnimationDurationMs: 10000,
    mediaAnimationIntensity: 2.25,
  };
}

function importedTumbleTextObject() {
  return {
    type: "textbox",
    version: "7.0.0",
    left: 40,
    top: 40,
    width: 400,
    height: 80,
    text: "مرحبا",
    fontSize: 48,
    fontFamily: "Cairo",
    layerType: "text",
    canvaAnimationPreset: 3,
    animations: {
      entrance: { type: "FADE", infinite: false, durationMs: 500, delayMs: 200, direction: "DEFAULT", intensity: 1 },
      exit: { type: "FADE", infinite: false, durationMs: 500, delayMs: 0, direction: "DEFAULT", intensity: 1 },
      loop: { type: "DRIFT", infinite: true, durationMs: 10000, delayMs: 0, direction: "LEFT", intensity: 2.25 },
    },
    mediaAnimationType: "DRIFT",
    mediaAnimationMode: "LOOP",
    mediaAnimationInfinite: true,
    mediaAnimationDurationMs: 10000,
  };
}

test("createImportedTemplate's category fit keeps the imported slot numbers and only touches types", () => {
  const data = { version: "7.0.0", objects: [importedDriftObject(), importedTumbleTextObject()] };
  fitImportedAnimationsToCategories(data);
  const [drift, text] = data.objects;
  // FADE / ROTATE / DRIFT are offered by their tabs already, so nothing is rewritten.
  assert.deepEqual(drift.animations.entrance, {
    type: "FADE",
    infinite: false,
    durationMs: 500,
    delayMs: 400,
    direction: "DEFAULT",
    intensity: 1,
  });
  assert.equal(drift.animations.loop.type, "ROTATE");
  assert.equal(drift.animations.loop.durationMs, 20300);
  assert.equal(drift.animations.loop.direction, "COUNTERCLOCKWISE");
  assert.equal(text.animations.loop.type, "DRIFT");
  assert.equal(text.animations.loop.intensity, 2.25);
  assert.equal(text.animations.loop.direction, "LEFT");
  // The raw Canva facts ride along untouched.
  assert.equal(drift.canvaAnimationPreset, 3);
  assert.deepEqual(drift.canvaRepeating, { rotate: { direction: 2, Vd: 0 } });
});

test("explicit slots win over the legacy mirror when the editor resolves an imported element", () => {
  const object = importedDriftObject();
  assert.equal(hasExplicitAnimationSlots(object.animations), true);
  const slots = resolveElementAnimations(object);
  assert.equal(slots.entrance?.type, "FADE");
  assert.equal(slots.entrance?.delayMs, 400);
  assert.equal(slots.exit?.type, "FADE");
  assert.equal(slots.loop?.type, "ROTATE");
  assert.equal(slots.loop?.infinite, true);
  assert.equal(slots.loop?.durationMs, 20300);
  // The legacy mirror alone (an older extension build) still migrates.
  const { animations: _dropped, ...legacyOnly } = object;
  const migrated = resolveElementAnimations(legacyOnly);
  assert.equal(migrated.entrance, null);
  assert.equal(migrated.loop?.type, "DRIFT");
});

test("the mobile API serialises the three slots from the explicit object, amplitude intensity intact", () => {
  const project = toMobileProject({
    id: "tpl-1",
    name: "Canva import",
    canvasWidth: 1080,
    canvasHeight: 1920,
    data: { version: "7.0.0", objects: [importedDriftObject(), importedTumbleTextObject()] },
  });
  const [drift, text] = project.layers;
  assert.equal(drift.animations.entrance.type, "FADE");
  assert.equal(drift.animations.entrance.delayMs, 400);
  assert.equal(drift.animations.exit.type, "FADE");
  assert.equal(drift.animations.loop.type, "ROTATE");
  assert.equal(drift.animations.loop.infinite, true);
  assert.equal(drift.animations.loop.durationMs, 20300);
  assert.equal(drift.animations.loop.direction, "COUNTERCLOCKWISE");
  // 270 px / 120 = 2.25 must survive the serializer's clamp (it used to stop at 2).
  assert.equal(text.animations.loop.type, "DRIFT");
  assert.equal(text.animations.loop.intensity, 2.25);
  assert.equal(text.animations.loop.direction, "LEFT");
  // The legacy single `animation` is still emitted for older app builds (its `infinite` flag
  // follows the web's own legacy preset table, which is not this importer's concern).
  assert.equal(drift.animation.type, "DRIFT");
});

// ── The whole server path, database-free (adversarial pass 2026-09-23) ─────────────────────────
// A synthetic extension payload, shaped exactly like background.js's requestBody (fabricData +
// editorData + the importMetadata the route builds), through the function createImportedTemplate
// stores from, then through the editor's resolver and the mobile serializer.

/** Canva "Pop" text with a wiggle stacked on it: preset → entrance/exit, repeating → loop. */
function importedPopWiggleTextObject() {
  return {
    type: "textbox",
    version: "7.0.0",
    left: 40,
    top: 40,
    width: 400,
    height: 80,
    text: "أهلاً",
    fontSize: 48,
    fontFamily: "Cairo",
    layerType: "text",
    importNodeId: "pop-wiggle",
    canvaAnimationPreset: 7,
    canvaRepeating: { wiggle: { Vd: 0 } },
    animations: {
      entrance: { type: "POP", infinite: false, durationMs: 500, delayMs: 200, direction: "DEFAULT", intensity: 1 },
      exit: { type: "POP", infinite: false, durationMs: 500, delayMs: 0, direction: "DEFAULT", intensity: 1 },
      loop: { type: "WIGGLE", infinite: true, durationMs: 18200, delayMs: 0, direction: "DEFAULT", intensity: 1 },
    },
    mediaAnimationType: "POP",
    mediaAnimationMode: "IN_OUT",
    mediaAnimationDurationMs: 500,
    mediaAnimationOutDurationMs: 500,
    mediaAnimationDelayMs: 200,
  };
}

/** Canva "Breathe" (continuous): loop BREATHE for 2 × the window + FADE legs. */
function importedBreatheImageObject() {
  return {
    type: "Image",
    version: "7.0.0",
    left: 0,
    top: 300,
    width: 600,
    height: 400,
    src: "https://cdn.example.com/hero.png",
    layerType: "image",
    importNodeId: "breathe",
    canvaAnimationPreset: 2,
    animations: {
      entrance: { type: "FADE", infinite: false, durationMs: 500, delayMs: 0, direction: "DEFAULT", intensity: 1 },
      exit: { type: "FADE", infinite: false, durationMs: 500, delayMs: 0, direction: "DEFAULT", intensity: 1 },
      loop: { type: "BREATHE", infinite: true, durationMs: 10000, delayMs: 0, direction: "DEFAULT", intensity: 1 },
    },
    mediaAnimationType: "BREATHE",
    mediaAnimationMode: "LOOP",
    mediaAnimationInfinite: true,
    mediaAnimationDurationMs: 10000,
  };
}

/** The new Canva enter/exit family (spec §7) — offered by both tabs, so nothing gets swapped. */
function importedNeonTextObject() {
  return {
    type: "textbox",
    version: "7.0.0",
    left: 40,
    top: 900,
    width: 400,
    height: 80,
    text: "نيون",
    fontSize: 40,
    fontFamily: "Cairo",
    layerType: "text",
    importNodeId: "neon",
    canvaAnimationPreset: 5,
    canvaWritingStyle: 5,
    animations: {
      entrance: { type: "NEON", infinite: false, durationMs: 500, delayMs: 400, direction: "DEFAULT", intensity: 1.25 },
      exit: { type: "NEON", infinite: false, durationMs: 500, delayMs: 0, direction: "DEFAULT", intensity: 1.25 },
      loop: null,
    },
    mediaAnimationType: "NEON",
    mediaAnimationMode: "IN_OUT",
    mediaAnimationDurationMs: 500,
    mediaAnimationOutDurationMs: 500,
    mediaAnimationDelayMs: 400,
    mediaAnimationIntensity: 1.25,
  };
}

/** An older extension build: the legacy mirror only, no `animations` object at all. */
function legacyOnlyTumbleObject() {
  return {
    type: "Image",
    version: "7.0.0",
    left: 500,
    top: 1200,
    width: 300,
    height: 300,
    src: "https://cdn.example.com/badge.png",
    layerType: "image",
    importNodeId: "legacy-tumble",
    mediaAnimationType: "TUMBLE",
    mediaAnimationMode: "IN_OUT",
    mediaAnimationDurationMs: 500,
    mediaAnimationOutDurationMs: 500,
  };
}

/** A slot holding a type its tab does not offer (a pre-§7 build's Drift entrance). */
function staleSlotObject() {
  return {
    type: "Image",
    version: "7.0.0",
    left: 700,
    top: 100,
    width: 200,
    height: 200,
    src: "https://cdn.example.com/sticker.png",
    layerType: "image",
    importNodeId: "stale-slot",
    animations: {
      entrance: { type: "DRIFT", infinite: false, durationMs: 1234, delayMs: 600, direction: "LEFT", intensity: 2 },
      exit: { type: "FADE", infinite: false, durationMs: 321, delayMs: 0, direction: "DEFAULT", intensity: 1 },
      loop: null,
    },
    mediaAnimationType: "DRIFT",
    mediaAnimationMode: "IN",
    mediaAnimationDurationMs: 1234,
  };
}

function extensionPayload() {
  const page = { id: "canva-page-1", name: "Canva Page 1", width: 1080, height: 1920, sourceWidth: 1080, sourceHeight: 1920, durationMs: 5000 };
  return {
    fabricData: {
      version: "7.0.0",
      backgroundColor: "#ffffff",
      objects: [
        importedPopWiggleTextObject(),
        importedBreatheImageObject(),
        importedNeonTextObject(),
        legacyOnlyTumbleObject(),
        staleSlotObject(),
      ],
    },
    editorData: {
      importVersion: 2,
      source: "canva-extension",
      page,
      layerTree: [],
      usedFonts: ["Cairo"],
      customFonts: [],
      warnings: [],
    },
    importMetadata: {
      source: "canva-extension",
      importVersion: 2,
      page,
      layerTree: [],
      layerStats: { total: 5 },
      usedFonts: ["Cairo"],
      warnings: [],
      assetManifest: [],
    },
  };
}

function resolvedById(payload) {
  const resolved = resolveImportedTemplateData({
    ...payload,
    imageDataUrl: "",
    canvasWidth: 1080,
    canvasHeight: 1920,
    sourceWidth: 1080,
    sourceHeight: 1920,
  });
  return { ...resolved, byId: Object.fromEntries(resolved.data.objects.map((object) => [object.importNodeId, object])) };
}

test("resolveImportedTemplateData keeps every imported slot through extraction, metadata attach and the tab fit", () => {
  const payload = extensionPayload();
  const { data, hasFabricData, refittedAnimations, byId } = resolvedById(payload);
  assert.equal(hasFabricData, true);
  assert.equal(data.meta.import.source, "canva-extension");
  assert.equal(data.backgroundColor, "#ffffff");
  // Only the stale object needed a fit — its Drift entrance slot AND its legacy IN mirror, one
  // count each; every Canva-family slot is offered by its tab.
  assert.equal(refittedAnimations, 2);
  assert.deepEqual(byId["pop-wiggle"].animations, importedPopWiggleTextObject().animations);
  assert.deepEqual(byId.breathe.animations, importedBreatheImageObject().animations);
  assert.deepEqual(byId.neon.animations, importedNeonTextObject().animations);
  assert.equal(byId["stale-slot"].animations.entrance.type, "SLIDE");
  assert.equal(byId["stale-slot"].animations.entrance.durationMs, 1234);
  assert.equal(byId["stale-slot"].animations.entrance.delayMs, 600);
  assert.equal(byId["stale-slot"].animations.entrance.direction, "LEFT");
  assert.deepEqual(byId["stale-slot"].animations.exit, staleSlotObject().animations.exit);
  // The legacy mirror is fitted on its own and never grows an `animations` object here.
  assert.equal(byId["legacy-tumble"].animations, undefined);
  assert.equal(byId["legacy-tumble"].mediaAnimationType, "TUMBLE");
  assert.equal(byId["legacy-tumble"].mediaAnimationMode, "IN_OUT");
  assert.equal(byId["stale-slot"].mediaAnimationType, "SLIDE");
  // The raw Canva facts ride along untouched.
  assert.equal(byId["pop-wiggle"].canvaAnimationPreset, 7);
  assert.deepEqual(byId["pop-wiggle"].canvaRepeating, { wiggle: { Vd: 0 } });
  assert.equal(byId.neon.canvaWritingStyle, 5);
  // Nothing else on the payload objects was dropped.
  assert.equal(byId["pop-wiggle"].text, "أهلاً");
  assert.equal(byId.breathe.src, "https://cdn.example.com/hero.png");
  // The one-image fallback still builds when there are no objects, and nothing at all with neither.
  const snapshot = resolveImportedTemplateData({
    fabricData: { version: "7.0.0", objects: [] },
    editorData: null,
    importMetadata: null,
    imageDataUrl: "data:image/png;base64,AAAA",
    canvasWidth: 1080,
    canvasHeight: 1920,
    sourceWidth: 1080,
    sourceHeight: 1920,
  });
  assert.equal(snapshot.hasFabricData, false);
  assert.equal(snapshot.data.objects.length, 1);
  assert.equal(snapshot.data.objects[0].src, "data:image/png;base64,AAAA");
  assert.deepEqual(
    resolveImportedTemplateData({ fabricData: null, editorData: null, importMetadata: null, imageDataUrl: "", canvasWidth: 1080, canvasHeight: 1920 }),
    { data: null, hasFabricData: false, refittedAnimations: 0 }
  );
});

test("after the server fit, explicit slots win over the legacy mirror in the editor resolver", () => {
  const { byId } = resolvedById(extensionPayload());
  const pop = resolveElementAnimations(byId["pop-wiggle"]);
  assert.equal(pop.entrance?.type, "POP");
  assert.equal(pop.entrance?.delayMs, 200);
  assert.equal(pop.exit?.type, "POP");
  assert.equal(pop.loop?.type, "WIGGLE");
  assert.equal(pop.loop?.infinite, true);
  assert.equal(pop.loop?.durationMs, 18200);
  const breathe = resolveElementAnimations(byId.breathe);
  assert.equal(breathe.loop?.type, "BREATHE");
  assert.equal(breathe.loop?.infinite, true);
  assert.equal(breathe.loop?.durationMs, 10000);
  assert.equal(breathe.entrance?.type, "FADE");
  const neon = resolveElementAnimations(byId.neon);
  assert.equal(neon.entrance?.type, "NEON");
  assert.equal(neon.entrance?.intensity, 1.25);
  assert.equal(neon.exit?.type, "NEON");
  assert.equal(neon.loop, null);
  // The legacy-only object migrates its IN_OUT mirror into entrance + exit.
  const tumble = resolveElementAnimations(byId["legacy-tumble"]);
  assert.equal(tumble.entrance?.type, "TUMBLE");
  assert.equal(tumble.exit?.type, "TUMBLE");
  assert.equal(tumble.loop, null);
});

test("the mobile API emits the imported slots — new types, loop infinite:true — next to the legacy single animation", () => {
  const { data } = resolvedById(extensionPayload());
  const project = toMobileProject({
    id: "tpl-canva",
    name: "Canva import",
    canvasWidth: 1080,
    canvasHeight: 1920,
    data,
  });
  const layers = Object.fromEntries(
    project.layers.map((layer, index) => [data.objects[index].importNodeId, layer])
  );
  assert.deepEqual(layers["pop-wiggle"].animations, {
    entrance: { type: "POP", infinite: false, durationMs: 500, delayMs: 200, direction: "DEFAULT", easing: "LINEAR", intensity: 1 },
    exit: { type: "POP", infinite: false, durationMs: 500, delayMs: 0, direction: "DEFAULT", easing: "LINEAR", intensity: 1 },
    loop: { type: "WIGGLE", infinite: true, durationMs: 18200, delayMs: 0, direction: "DEFAULT", easing: "LINEAR", intensity: 1 },
  });
  assert.deepEqual(layers.breathe.animations.loop, {
    type: "BREATHE",
    infinite: true,
    durationMs: 10000,
    delayMs: 0,
    direction: "DEFAULT",
    easing: "LINEAR",
    intensity: 1,
  });
  assert.equal(layers.breathe.animations.entrance.type, "FADE");
  assert.equal(layers.breathe.animations.exit.type, "FADE");
  assert.equal(layers.neon.animations.entrance.type, "NEON");
  assert.equal(layers.neon.animations.entrance.delayMs, 400);
  assert.equal(layers.neon.animations.entrance.intensity, 1.25);
  assert.equal(layers.neon.animations.exit.type, "NEON");
  assert.equal(layers.neon.animations.loop, undefined);
  assert.equal(layers["legacy-tumble"].animations.entrance.type, "TUMBLE");
  assert.equal(layers["legacy-tumble"].animations.exit.type, "TUMBLE");
  assert.equal(layers["stale-slot"].animations.entrance.type, "SLIDE");
  // The legacy single `animation` for pre-slot builds still names the Canva family (all in its
  // 20-type vocabulary) and only loops for a loop.
  assert.equal(layers["pop-wiggle"].animation.type, "POP");
  assert.equal(layers["pop-wiggle"].animation.infinite, false);
  assert.equal(layers.breathe.animation.type, "BREATHE");
  assert.equal(layers.breathe.animation.infinite, true);
  assert.equal(layers.neon.animation.type, "NEON");
  assert.equal(layers["legacy-tumble"].animation.type, "TUMBLE");
  // A repeating-only element (no preset) reaches the legacy object as its loop type.
  const wiggleOnly = toMobileProject({
    id: "tpl-w",
    name: "w",
    canvasWidth: 1080,
    canvasHeight: 1920,
    data: {
      version: "7.0.0",
      objects: [
        {
          ...importedBreatheImageObject(),
          animations: {
            entrance: null,
            exit: null,
            loop: { type: "ROTATE", infinite: true, durationMs: 20300, delayMs: 0, direction: "COUNTERCLOCKWISE", intensity: 1 },
          },
          mediaAnimationType: "ROTATE",
          mediaAnimationMode: "LOOP",
          mediaAnimationInfinite: true,
          mediaAnimationDurationMs: 20300,
          mediaAnimationDirection: "COUNTERCLOCKWISE",
        },
      ],
    },
  }).layers[0];
  assert.deepEqual(wiggleOnly.animations, {
    loop: { type: "ROTATE", infinite: true, durationMs: 20300, delayMs: 0, direction: "COUNTERCLOCKWISE", easing: "LINEAR", intensity: 1 },
  });
  assert.equal(wiggleOnly.animation.type, "ROTATE");
  assert.equal(wiggleOnly.animation.direction, "COUNTERCLOCKWISE");
  assert.equal(wiggleOnly.animation.infinite, true);
});

// ── Round 2 (docs/canva-animation-parity.md §8.5): Canva's scheduler output ────────────────────
// The extension now writes Canva's exact windows (timelineStartMs / timelineEndMs), entrance
// delays and exits that end at the window end, and `params` (§8.1) the runtimes read. The server
// fits TYPES only, so every window and every param must reach the editor and the app unchanged.

/** A Tumble title shaped as applyCanvaPageAnimations writes it (XH 1 on a 1080×1920 page; the
 *  numbers are illustrative — this test is about the server carrying them, not computing them). */
function exactTumbleTextObject() {
  return {
    type: "textbox",
    version: "7.0.0",
    left: 100,
    top: 400,
    width: 200,
    height: 100,
    text: "دوران",
    fontSize: 48,
    fontFamily: "Cairo",
    layerType: "text",
    importNodeId: "LB-tumble",
    canvaAnimationPreset: 13,
    timelineStartMs: 0,
    timelineEndMs: 4700,
    animations: {
      entrance: {
        type: "TUMBLE",
        infinite: false,
        durationMs: 500,
        delayMs: 200,
        direction: "DEFAULT",
        intensity: 1,
        params: { xh: 1, startRotation: -95.25, travelX: 1920, travelY: 0 },
      },
      exit: {
        type: "TUMBLE",
        infinite: false,
        durationMs: 500,
        delayMs: 0,
        direction: "DEFAULT",
        intensity: 1,
        params: { xh: 1, startRotation: 95.25, travelX: -1920, travelY: 0 },
      },
      loop: null,
    },
    mediaAnimationType: "TUMBLE",
    mediaAnimationMode: "IN_OUT",
    mediaAnimationDurationMs: 500,
    mediaAnimationOutDurationMs: 500,
    mediaAnimationDelayMs: 200,
  };
}

/** A Drift photo: a CONCURRENT loop carrying Canva's ramp, with a repeating rotate stacked on it. */
function exactDriftImageObject() {
  return {
    type: "Image",
    version: "7.0.0",
    left: 0,
    top: 300,
    width: 600,
    height: 400,
    src: "https://cdn.example.com/drift.png",
    layerType: "image",
    importNodeId: "LB-drift",
    canvaAnimationPreset: 3,
    canvaRepeating: { rotate: { direction: 1, Vd: 0 } },
    timelineStartMs: 0,
    timelineEndMs: 5000,
    animations: {
      entrance: null,
      exit: null,
      loop: {
        type: "DRIFT",
        infinite: true,
        durationMs: 10000,
        delayMs: 0,
        direction: "LEFT",
        intensity: 2.25,
        params: {
          concurrent: 1,
          r1From: 270,
          r1To: -270,
          r1Start: 0,
          r1Dur: 5000,
          r1Ease: 1,
          stackPhaseMs: 0,
          stackRotate: 20300,
        },
      },
    },
    mediaAnimationType: "DRIFT",
    mediaAnimationMode: "LOOP",
    mediaAnimationInfinite: true,
    mediaAnimationDurationMs: 10000,
    mediaAnimationDirection: "LEFT",
    mediaAnimationIntensity: 2.25,
  };
}

/** A per-word Fade and a Block with its stored bar colour (ARGB as a plain number). */
function exactTextEffectsObjects() {
  const base = {
    type: "textbox",
    version: "7.0.0",
    left: 40,
    top: 1200,
    width: 800,
    height: 120,
    text: "كلمة كلمة",
    fontSize: 40,
    fontFamily: "Cairo",
    layerType: "text",
  };
  return [
    {
      ...base,
      importNodeId: "LB-words",
      canvaAnimationPreset: 4,
      canvaWritingStyle: 2,
      timelineStartMs: 0,
      timelineEndMs: 4400,
      animations: {
        entrance: { type: "FADE", infinite: false, durationMs: 4000, delayMs: 0, direction: "DEFAULT", intensity: 1, params: { unit: 2, fill: 1 } },
        exit: { type: "FADE", infinite: false, durationMs: 400, delayMs: 0, direction: "DEFAULT", intensity: 1, params: { unit: 2, fill: 1 } },
        loop: null,
      },
      mediaAnimationType: "FADE",
      mediaAnimationMode: "IN_OUT",
      mediaAnimationDurationMs: 4000,
      mediaAnimationOutDurationMs: 400,
    },
    {
      ...base,
      top: 1500,
      importNodeId: "LB-block",
      canvaAnimationPreset: 17,
      timelineStartMs: 0,
      timelineEndMs: 4500,
      animations: {
        entrance: { type: "BLOCK", infinite: false, durationMs: 500, delayMs: 0, direction: "DEFAULT", intensity: 1, params: { barColor: 0xffff0000 } },
        exit: { type: "BLOCK", infinite: false, durationMs: 500, delayMs: 0, direction: "DEFAULT", intensity: 1, params: { barColor: 0xffff0000 } },
        loop: null,
      },
      mediaAnimationType: "BLOCK",
      mediaAnimationMode: "IN_OUT",
      mediaAnimationDurationMs: 500,
      mediaAnimationOutDurationMs: 500,
    },
  ];
}

test("§8.5: Canva's windows and params ride through the server fit, the editor resolver and the mobile API unchanged", () => {
  const objects = [exactTumbleTextObject(), exactDriftImageObject(), ...exactTextEffectsObjects()];
  const payload = extensionPayload();
  payload.fabricData.objects = objects.map((object) => structuredClone(object));
  const { data, byId, refittedAnimations } = resolvedById(payload);
  // Every type is offered by its tab: nothing refitted, every slot (params included) intact.
  assert.equal(refittedAnimations, 0);
  for (const object of objects) {
    const stored = byId[object.importNodeId];
    assert.deepEqual(stored.animations, object.animations, object.importNodeId);
    assert.equal(stored.timelineStartMs, object.timelineStartMs, object.importNodeId);
    assert.equal(stored.timelineEndMs, object.timelineEndMs, object.importNodeId);
  }
  // The editor's resolver keeps the params with the slot (a picker-made spec never has any).
  const tumble = resolveElementAnimations(byId["LB-tumble"]);
  assert.deepEqual(tumble.entrance?.params, { xh: 1, startRotation: -95.25, travelX: 1920, travelY: 0 });
  assert.deepEqual(tumble.exit?.params, { xh: 1, startRotation: 95.25, travelX: -1920, travelY: 0 });
  assert.equal(resolveElementAnimations(byId["LB-drift"]).loop?.params?.concurrent, 1);
  assert.equal(resolveElementAnimations(byId["LB-block"]).entrance?.params?.barColor, 0xffff0000);
  // The mobile API emits the same numbers next to each layer's window.
  const project = toMobileProject({ id: "tpl-exact", name: "Canva exact", canvasWidth: 1080, canvasHeight: 1920, data });
  const layers = Object.fromEntries(project.layers.map((layer, index) => [data.objects[index].importNodeId, layer]));
  assert.deepEqual(layers["LB-tumble"].animations.entrance.params, { xh: 1, startRotation: -95.25, travelX: 1920, travelY: 0 });
  assert.equal(layers["LB-tumble"].animations.entrance.delayMs, 200);
  assert.equal(layers["LB-tumble"].timelineEndMs, 4700);
  assert.deepEqual(layers["LB-drift"].animations.loop.params, exactDriftImageObject().animations.loop.params);
  assert.equal(layers["LB-drift"].animations.loop.infinite, true);
  assert.deepEqual(layers["LB-words"].animations.entrance.params, { unit: 2, fill: 1 });
  assert.equal(layers["LB-words"].timelineEndMs, 4400);
  assert.equal(layers["LB-block"].animations.exit.params.barColor, 0xffff0000);
});
