import test from "node:test";
import assert from "node:assert/strict";

import type { EditorElement } from "@/store/editorStore";
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

function softOut(progress: number) {
  return 1 - Math.pow(1 - progress, 4);
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

  const normalizedFrameOne = frameToSampleTimeMs(1, PREVIEW_RENDER_FPS) / 1200;
  assert.ok(Math.abs(stateAtFrameOne.progress - softOut(normalizedFrameOne)) < 1e-6);
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
