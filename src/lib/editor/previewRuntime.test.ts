import test from "node:test";
import assert from "node:assert/strict";

import type { EditorElement } from "@/store/editorStore";
import {
  PREVIEW_RENDER_FPS,
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
