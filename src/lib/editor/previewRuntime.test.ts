import test from "node:test";
import assert from "node:assert/strict";

import type { EditorElement } from "@/store/editorStore";
import { getAnimationDefaults } from "./animationSpec";
import { applyAnimationEasing } from "./animationVisual";
import {
  PREVIEW_RENDER_FPS,
  resolveAnimatedElementPoseAtFrame,
  frameToSampleTimeMs,
  getDurationFrames,
  resolveAnimationStateAtFrame,
  resolveVideoSourceTimeAtFrame,
} from "./previewRuntime";

function createElement(overrides: Partial<EditorElement> = {}): EditorElement {
  return {
    id: "element-1",
    pageId: "page-1",
    type: "image",
    name: "Layer",
    x: 100,
    y: 120,
    width: 240,
    height: 180,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    visible: true,
    locked: false,
    fill: "#ffffff",
    stroke: "#000000",
    strokeWidth: 0,
    blendMode: "source-over",
    shadowColor: "rgba(0,0,0,0)",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    groupId: null,
    flipX: false,
    flipY: false,
    cornerRadius: 0,
    points: [],
    src: "",
    text: "",
    fontFamily: "Inter",
    fontSize: 32,
    fontWeight: "400",
    fontStyle: "normal",
    textDecoration: "",
    align: "left",
    lineHeight: 1.2,
    letterSpacing: 0,
    color: "#000000",
    ...overrides,
  };
}


test("frame 0 keeps animation progress at the true initial pose", () => {
  const element = createElement({
    mediaAnimationType: "RISE",
    mediaAnimationDurationMs: 1200,
    mediaAnimationMode: "IN",
  });

  const stateAtStart = resolveAnimationStateAtFrame(
    element,
    0,
    PREVIEW_RENDER_FPS,
    15_000
  );
  const stateAtFrameOne = resolveAnimationStateAtFrame(
    element,
    1,
    PREVIEW_RENDER_FPS,
    15_000
  );

  assert.ok(stateAtStart);
  assert.ok(stateAtFrameOne);
  assert.equal(stateAtStart.progress, 0);
  assert.ok(stateAtFrameOne.progress > stateAtStart.progress);

  // `progress` is the EASED value, on the easing the spec gives the type by default.
  const normalizedFrameOne = frameToSampleTimeMs(1, PREVIEW_RENDER_FPS) / 1200;
  const eased = applyAnimationEasing(normalizedFrameOne, getAnimationDefaults("RISE").easing);
  assert.ok(Math.abs(stateAtFrameOne.progress - eased) < 1e-6);
  assert.ok(Math.abs(stateAtFrameOne.cycleProgress - normalizedFrameOne) < 1e-6);
});

// Canva's Tumble, Scrapbook and Neon differ by the element's index on the page (parity and a size
// hash), so the renderer hands the runtime each layer's index; the app reads the same one.
test("the layer's index in its page reaches the runtime", () => {
  const element = createElement({
    width: 200,
    height: 100,
    animations: {
      entrance: { type: "TUMBLE", durationMs: 500, delayMs: 0, infinite: false },
      exit: null,
      loop: null,
    },
  } as Partial<EditorElement>);
  const bottom = resolveAnimatedElementPoseAtFrame(element, 0, PREVIEW_RENDER_FPS, 5000, {
    layerIndex: 0,
  });
  const above = resolveAnimatedElementPoseAtFrame(element, 0, PREVIEW_RENDER_FPS, 5000, {
    layerIndex: 1,
  });
  const unspecified = resolveAnimatedElementPoseAtFrame(element, 0, PREVIEW_RENDER_FPS, 5000);
  // An even index tumbles in from the left, an odd one from the right; omitted means 0.
  assert.ok(bottom.x < element.x, "the bottom layer starts off to the left");
  assert.ok(above.x > element.x, "the next layer starts off to the right");
  assert.equal(unspecified.x, bottom.x);
});

test("animation delay holds progress at zero until delay has elapsed", () => {
  const element = createElement({
    mediaAnimationType: "FADE",
    mediaAnimationDurationMs: 1000,
    mediaAnimationDelayMs: 500,
    mediaAnimationMode: "IN",
  });

  const beforeDelayFrame = Math.floor((450 / 1000) * PREVIEW_RENDER_FPS);
  const afterDelayFrame = Math.ceil((600 / 1000) * PREVIEW_RENDER_FPS);

  const beforeDelay = resolveAnimationStateAtFrame(
    element,
    beforeDelayFrame,
    PREVIEW_RENDER_FPS,
    15_000
  );
  const afterDelay = resolveAnimationStateAtFrame(
    element,
    afterDelayFrame,
    PREVIEW_RENDER_FPS,
    15_000
  );

  assert.ok(beforeDelay);
  assert.ok(afterDelay);
  assert.equal(beforeDelay.progress, 0);
  assert.ok(afterDelay.progress > 0);
});

test("duration frame count uses ceil so exported frame counts fully cover the timeline", () => {
  assert.equal(getDurationFrames(15_000, 60), 900);
  assert.equal(getDurationFrames(1_201, 60), 73);
  assert.equal(getDurationFrames(16, 60), 1);
});

test("video source time mapping starts at the true source start and loops deterministically", () => {
  const fps = PREVIEW_RENDER_FPS;
  const sourceStart = 2;
  const sourceEnd = 5;

  const firstFrame = resolveVideoSourceTimeAtFrame({
    frame: 0,
    fps,
    layerStartMs: 0,
    sourceStart,
    sourceEnd,
  });
  const oneSecond = resolveVideoSourceTimeAtFrame({
    frame: 60,
    fps,
    layerStartMs: 0,
    sourceStart,
    sourceEnd,
  });
  const wrapped = resolveVideoSourceTimeAtFrame({
    frame: 240,
    fps,
    layerStartMs: 0,
    sourceStart,
    sourceEnd,
  });

  assert.equal(firstFrame, sourceStart);
  assert.ok(Math.abs(oneSecond - 3) < 1e-6);
  assert.ok(Math.abs(wrapped - 3) < 1e-6);
});

/**
 * Konva turns a node about the point it is placed at, which is the layer's top-left corner, while
 * the app turns it about the centre. Spin therefore used to swing the layer around its own corner
 * in a wide arc instead of turning in place, and a zoom grew it towards the bottom-right.
 */
function centreOfPose(
  pose: { x: number; y: number; rotation: number; scaleX: number; scaleY: number },
  width: number,
  height: number
) {
  const radians = (pose.rotation * Math.PI) / 180;
  const halfWidth = (width * pose.scaleX) / 2;
  const halfHeight = (height * pose.scaleY) / 2;
  return {
    x: pose.x + Math.cos(radians) * halfWidth - Math.sin(radians) * halfHeight,
    y: pose.y + Math.sin(radians) * halfWidth + Math.cos(radians) * halfHeight,
  };
}

test("a spinning layer turns in place instead of orbiting its corner", () => {
  const element = createElement({
    width: 300,
    height: 200,
    mediaAnimationType: "ROTATE",
    mediaAnimationMode: "LOOP",
    mediaAnimationInfinite: true,
    mediaAnimationDurationMs: 1200,
  });

  const rest = { x: element.x, y: element.y, rotation: element.rotation, scaleX: 1, scaleY: 1 };
  const restCentre = centreOfPose(rest, element.width, element.height);

  let sawRotation = false;
  for (let frame = 0; frame <= 60; frame += 1) {
    const pose = resolveAnimatedElementPoseAtFrame(element, frame, PREVIEW_RENDER_FPS, 5000);
    if (Math.abs(pose.rotation - element.rotation) > 1) sawRotation = true;
    const centre = centreOfPose(pose, element.width, element.height);
    assert.ok(
      Math.abs(centre.x - restCentre.x) < 0.001 && Math.abs(centre.y - restCentre.y) < 0.001,
      `frame ${frame} moved the centre to ${centre.x},${centre.y} instead of ${restCentre.x},${restCentre.y}`
    );
  }
  assert.ok(sawRotation, "the layer never actually rotated, so the test proved nothing");
});

test("a scaling layer grows from its centre, not its corner", () => {
  const element = createElement({
    width: 300,
    height: 200,
    mediaAnimationType: "POP",
    mediaAnimationMode: "IN",
    mediaAnimationDurationMs: 1000,
  });

  const restCentre = centreOfPose(
    { x: element.x, y: element.y, rotation: element.rotation, scaleX: 1, scaleY: 1 },
    element.width,
    element.height
  );

  let sawScaleChange = false;
  for (let frame = 0; frame <= 30; frame += 1) {
    const pose = resolveAnimatedElementPoseAtFrame(element, frame, PREVIEW_RENDER_FPS, 5000);
    if (Math.abs(pose.scaleX - 1) > 0.01) sawScaleChange = true;
    const centre = centreOfPose(pose, element.width, element.height);
    assert.ok(
      Math.abs(centre.x - restCentre.x) < 0.001 && Math.abs(centre.y - restCentre.y) < 0.001,
      `frame ${frame} moved the centre while scaling`
    );
  }
  assert.ok(sawScaleChange, "the layer never actually scaled, so the test proved nothing");
});

// A Canva page animation puts a fade-in AND a fade-out on every layer, so frame 0 and the last
// frame are both fully transparent. The editing canvas and the thumbnail/poster taken from it draw
// the page AT REST instead, which is what Canva itself shows — see RenderPoseOptions.
test("a settled render shows the design, not the blank first frame of a fade-in", () => {
  const pageMs = 10_040;
  const element = createElement({
    opacity: 1,
    mediaAnimationType: "FADE",
    mediaAnimationMode: "IN_OUT",
    mediaAnimationDurationMs: 1000,
    mediaAnimationOutDurationMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: pageMs,
  } as Partial<EditorElement>);
  const lastFrame = getDurationFrames(pageMs, PREVIEW_RENDER_FPS);

  for (const frame of [0, lastFrame]) {
    assert.equal(
      resolveAnimatedElementPoseAtFrame(element, frame, PREVIEW_RENDER_FPS, pageMs).opacity,
      0,
      `frame ${frame} is transparent while the animation plays`
    );
    assert.equal(
      resolveAnimatedElementPoseAtFrame(element, frame, PREVIEW_RENDER_FPS, pageMs, {
        settled: true,
      }).opacity,
      1,
      `frame ${frame} settles to the authored opacity`
    );
  }

  // Settling must not become "ignore the layer's own values": only the animation is dropped.
  const dimmed = createElement({
    opacity: 0.4,
    mediaAnimationType: "FADE",
    mediaAnimationMode: "IN",
    mediaAnimationDurationMs: 1000,
  } as Partial<EditorElement>);
  const settled = resolveAnimatedElementPoseAtFrame(dimmed, 0, PREVIEW_RENDER_FPS, pageMs, {
    settled: true,
  });
  assert.equal(settled.opacity, 0.4);
  assert.equal(settled.x, dimmed.x);
  assert.equal(settled.y, dimmed.y);
  assert.equal(settled.scaleX, dimmed.scaleX);
  assert.equal(settled.blurRadius, 0);
  assert.equal(
    resolveAnimationStateAtFrame(dimmed, 0, PREVIEW_RENDER_FPS, pageMs, { settled: true }),
    null
  );
});

// A custom Canva motion path stores offsets that are CUMULATIVE from the authored position, so the
// settled pose is that authored position — where Canva's canvas draws the layer before it moves.
test("a settled render holds a motion path at its authored position", () => {
  const pageMs = 4000;
  const element = createElement({
    timelineStartMs: 0,
    timelineEndMs: pageMs,
    mediaMotionPath: [
      { t: 0, x: 0, y: 0 },
      { t: 2000, x: 300, y: -80 },
    ],
  } as Partial<EditorElement>);
  const midFrame = Math.round(PREVIEW_RENDER_FPS);

  const animated = resolveAnimatedElementPoseAtFrame(element, midFrame, PREVIEW_RENDER_FPS, pageMs);
  assert.notEqual(animated.x, element.x, "the path moves the layer while it plays");

  const settled = resolveAnimatedElementPoseAtFrame(element, midFrame, PREVIEW_RENDER_FPS, pageMs, {
    settled: true,
  });
  assert.equal(settled.x, element.x);
  assert.equal(settled.y, element.y);
});

// ── Round 2 (docs/canva-animation-parity.md §8.2/§8.4) ──────────────────────────────────────────

import {
  elementPlaysCanvaUnits,
  isCurvedTextElement,
  resolveAnimatedElementEffectsAtFrame,
} from "./previewRuntime";

// A frame index at [ms] on the render grid.
const frameAt = (ms: number) => Math.round((ms / 1000) * PREVIEW_RENDER_FPS);

test("a concurrent loop composes with the entrance in the rendered pose (§8.2)", () => {
  const element = createElement({
    timelineStartMs: 0,
    timelineEndMs: 4000,
    animations: {
      entrance: { type: "FADE", durationMs: 1000, delayMs: 0, infinite: false },
      exit: null,
      loop: {
        type: "ROTATE",
        durationMs: 2000,
        delayMs: 0,
        infinite: true,
        direction: "CLOCKWISE",
        params: { concurrent: 1 },
      },
    },
  } as unknown as Partial<EditorElement>);
  // 500 ms: the fade is half in AND the loop has already turned a quarter.
  const pose = resolveAnimatedElementPoseAtFrame(element, frameAt(500), PREVIEW_RENDER_FPS, 4000);
  assert.ok(Math.abs(pose.opacity - 0.75) < 1e-6, `opacity ${pose.opacity}`);
  assert.ok(Math.abs(pose.rotation - 90) < 1e-6, `rotation ${pose.rotation}`);
  // A loop that is not concurrent waits for the entrance, as before.
  const exclusive = createElement({
    ...element,
    animations: {
      ...(element as unknown as { animations: Record<string, unknown> }).animations,
      loop: { type: "ROTATE", durationMs: 2000, delayMs: 0, infinite: true, direction: "CLOCKWISE" },
    },
  } as unknown as Partial<EditorElement>);
  assert.equal(resolveAnimatedElementPoseAtFrame(exclusive, frameAt(500), PREVIEW_RENDER_FPS, 4000).rotation, 0);
});

test("a text layer played per unit leaves the whole-element fade to its units (§8.4)", () => {
  const animations = {
    entrance: { type: "FADE", durationMs: 1000, delayMs: 0, infinite: false, params: { unit: 2 } },
    exit: null,
    loop: null,
  };
  const text = createElement({ type: "text", text: "hello world", animations } as unknown as Partial<EditorElement>);
  const pose = resolveAnimatedElementPoseAtFrame(text, frameAt(250), PREVIEW_RENDER_FPS, 4000);
  assert.equal(pose.opacity, 1, "the units carry the fade, not the layer");
  const effects = resolveAnimatedElementEffectsAtFrame(text, frameAt(250), PREVIEW_RENDER_FPS, 4000);
  assert.equal(effects?.glyphMotion?.unit, 2);
  assert.ok(Math.abs((effects?.glyphMotion?.rawProgress ?? 0) - 0.25) < 1e-6);
  // A photo — or curved text — has no units: Canva's whole-element fallback plays instead.
  const image = createElement({ type: "image", animations } as unknown as Partial<EditorElement>);
  const imagePose = resolveAnimatedElementPoseAtFrame(image, frameAt(250), PREVIEW_RENDER_FPS, 4000);
  assert.ok(Math.abs(imagePose.opacity - 0.25 * (2 - 0.25)) < 1e-6, `image opacity ${imagePose.opacity}`);
  const curved = createElement({
    type: "text",
    text: "hello world",
    textCurveEnabled: true,
    textCurveAmount: 40,
    animations,
  } as unknown as Partial<EditorElement>);
  assert.equal(isCurvedTextElement(curved), true);
  assert.ok(resolveAnimatedElementPoseAtFrame(curved, frameAt(250), PREVIEW_RENDER_FPS, 4000).opacity < 1);
  assert.equal(elementPlaysCanvaUnits(curved, effects?.glyphMotion), false);
  assert.equal(elementPlaysCanvaUnits(text, effects?.glyphMotion), true);
  assert.equal(elementPlaysCanvaUnits(text, { type: "FADE", progress: 0.5, durationMs: 500 }), false);
});
