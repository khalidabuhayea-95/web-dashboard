/**
 * Every effect the picker offers must actually be VISIBLE on the layer it is offered for.
 *
 * This is the regression that hid for months: the reveal mattes, the typewriter reveal, the
 * per-glyph motion and BLOCK's bar were resolved correctly by the animation runtime and then only
 * ever painted inside CanvasEditor's `element.type === "text"` branch. Eighteen of the effects
 * therefore did nothing at all on a photo, a video or a shape — the picker offered them, the tile
 * highlighted, the duration applied, and the canvas never changed a pixel.
 *
 * The test encodes what the canvas can paint per layer kind (canPaint below). Keep it in step
 * with CanvasEditor: if a channel is dropped from the renderer, a row here fails and names the
 * effect instead of the failure being invisible.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import type { EditorElement } from "@/store/editorStore";
import { ANIMATION_CATALOG, type AnimationCategory } from "./animationSpec";
import { makeAnimationSpec } from "./animationSlots";
import {
  PREVIEW_RENDER_FPS,
  resolveAnimatedElementEffectsAtFrame,
  resolveAnimatedElementPoseAtFrame,
} from "./previewRuntime";

const PAGE_MS = 6000;
const POSE_KEYS = ["x", "y", "rotation", "scaleX", "scaleY", "opacity", "blurRadius"] as const;

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
  } as EditorElement;
}

/**
 * What CanvasEditor can actually draw for a layer of this kind.
 *
 * A reveal matte is geometry, so every kind gets one. Per-glyph motion has no glyphs outside a
 * text layer, so elsewhere the layer moves as a single unit — still visible. The typewriter reveal
 * and BLOCK's painted bar are the only genuinely text-shaped channels, and both of those effects
 * also carry something else (alpha, a matte), so nothing relies on them alone.
 */
function canPaint(
  kind: string,
  effects: {
    revealMask?: unknown;
    textReveal?: unknown;
    glyphMotion?: unknown;
    overlayBar?: unknown;
  } | null
): boolean {
  if (!effects) return false;
  if (effects.revealMask || effects.glyphMotion) return true;
  return kind === "text" && Boolean(effects.textReveal || effects.overlayBar);
}

function isVisible(element: EditorElement, slot: AnimationCategory, type: string): boolean {
  const spec = makeAnimationSpec({ type }, slot);
  const key = slot.toLowerCase() as "entrance" | "exit" | "loop";
  const subject = {
    ...element,
    animations: { entrance: null, exit: null, loop: null, [key]: spec },
  } as EditorElement;

  const frames = Math.round((PAGE_MS / 1000) * PREVIEW_RENDER_FPS);
  const first = resolveAnimatedElementPoseAtFrame(subject, 0, PREVIEW_RENDER_FPS, PAGE_MS);
  for (let frame = 0; frame <= frames; frame += 1) {
    const pose = resolveAnimatedElementPoseAtFrame(subject, frame, PREVIEW_RENDER_FPS, PAGE_MS);
    for (const poseKey of POSE_KEYS) {
      const tolerance = poseKey === "opacity" ? 0.003 : 0.05;
      if (Math.abs(pose[poseKey] - first[poseKey]) > tolerance) return true;
    }
    const effects = resolveAnimatedElementEffectsAtFrame(subject, frame, PREVIEW_RENDER_FPS, PAGE_MS);
    if (canPaint(element.type, effects)) return true;
  }
  return false;
}

const KINDS = ["text", "image", "video", "rect"] as const;

for (const kind of KINDS) {
  const element = createElement({
    type: kind,
    text: kind === "text" ? "مرحبا بالعالم" : "",
  });

  for (const slot of ["ENTRANCE", "EXIT", "LOOP"] as AnimationCategory[]) {
    test(`every ${slot.toLowerCase()} effect is visible on a ${kind} layer`, () => {
      const invisible = ANIMATION_CATALOG[slot]
        .filter((type) => type !== "NONE")
        .filter((type) => !isVisible(element, slot, type));
      assert.deepEqual(
        invisible,
        [],
        `these ${slot.toLowerCase()} effects draw nothing on a ${kind} layer: ${invisible.join(", ")}`
      );
    });
  }
}

/**
 * The checks above prove the RUNTIME hands the canvas something paintable for every effect. They
 * cannot prove the canvas paints it, because React-Konva does not render here — and that gap is
 * exactly where the bug lived. This reads the renderer's source for the two structural facts that
 * make the rest true: effects are resolved for every layer kind (before the `element.type`
 * dispatch, not inside the text branch), and the selected layer is not excluded outright.
 */
test("CanvasEditor resolves effects for every layer kind, not just text", async () => {
  const source = await readFile(
    new URL("../../components/editor/CanvasEditor.tsx", import.meta.url),
    "utf8"
  );
  // Measured from inside the element loop, so the import at the top of the file does not count.
  const loopAt = source.indexOf("elements.map((element, layerIndex) => {");
  const resolvedAt = source.indexOf("resolveAnimatedElementEffectsAtFrame(", loopAt);
  const firstTypeBranch = source.indexOf('element.type === "frame"', loopAt);
  assert.ok(loopAt > 0 && resolvedAt > 0 && firstTypeBranch > 0, "CanvasEditor no longer looks the way this test expects");
  assert.ok(
    resolvedAt < firstTypeBranch,
    "animation effects must be resolved BEFORE the element.type dispatch — resolving them inside the text branch is what made Wipe, Circular and Radial do nothing on photos and videos"
  );
  assert.ok(
    !/const textFx = isSelected\s*\n?\s*\?\s*null/.test(source),
    "the selected layer must keep animating while the timeline plays — suppressing its effects outright is what made picking an effect and pressing play show nothing"
  );
});

/**
 * The preview recorder plays the timeline and repaints the Konva layer on a capture cadence. The
 * poses, the reveal mattes and the typewriter reveals are all produced by a REACT render, so a
 * repaint alone captures whatever the scene looked like when recording began. It did exactly that:
 * previews came out as the opening frame held for their whole length, with only the <video> layers
 * moving, because those decode in their own elements. Two facts keep it honest, and both are read
 * from the source because a recording cannot run in this test process.
 */
test("the preview recorder advances the scene it captures", async () => {
  const source = await readFile(
    new URL("../../components/editor/CanvasEditor.tsx", import.meta.url),
    "utf8"
  );
  const loopAt = source.indexOf("let lastCaptureAtMs = startedAt;");
  assert.ok(loopAt > 0, "the preview recording loop no longer looks the way this test expects");
  const loop = source.slice(loopAt, loopAt + 4000);

  assert.ok(
    /useEditorStore\.getState\(\)\.timelinePlayheadMs/.test(loop),
    "the recorder must read the LIVE playhead: the refs it used to read are advanced only by the playback driver, which is switched off while a preview records"
  );
  // Matched on the repaint STATEMENT, not on the words "layer.draw()", which also appear in the
  // comment that explains why this ordering matters.
  const repaintAt = loop.indexOf("stage.getLayers().forEach");
  const renderAt = loop.indexOf("flushSync(");
  assert.ok(renderAt > 0 && repaintAt > 0, "the capture step no longer looks the way this test expects");
  assert.ok(
    renderAt < repaintAt,
    "the recorder must render the scene at the captured frame BEFORE repainting the layer, or every frame is the scene as it stood when recording began"
  );
});

test("a reveal matte reaches layer kinds that have no text", () => {
  // WIPE is the clearest case: it has no transform and no alpha at all, so before the matte was
  // painted for non-text layers it was a complete no-op on a photo.
  const photo = createElement({ type: "image" });
  assert.equal(isVisible(photo, "ENTRANCE", "WIPE"), true);
  assert.equal(isVisible(photo, "EXIT", "WIPE"), true);
});
