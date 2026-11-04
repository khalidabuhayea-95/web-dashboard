// The editor side of text effects: the stored field, and the layout bridge that must put every
// glyph exactly where Konva.Text's own pass puts it (a solid effect has to cover the same pixels
// as the plain text, or applying an effect would nudge the words).
//
//   node --import tsx --test src/lib/editor/textEffects.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "canvas";
// Side effect: Konva draws through node-canvas.
import "konva/canvas-backend";
import Konva from "konva";
import { SceneCanvas } from "konva/lib/Canvas";

import {
  konvaTextEffectLayout,
  normalizeEditorTextEffect,
  paintTextEffectOnNode,
  textEffectUnsupportedReason,
  type TextEffectCatalogItem,
} from "./textEffects";

// The renderer composes offscreen; node-canvas stands in for OffscreenCanvas.
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas ??= function OffscreenCanvas(
  width: number,
  height: number
) {
  return createCanvas(width, height);
};

test("the stored field keeps the slug and clean overrides only", () => {
  assert.equal(normalizeEditorTextEffect(null), null);
  assert.equal(normalizeEditorTextEffect({ effectId: "  " }), null);
  assert.deepEqual(normalizeEditorTextEffect({ effectId: "gold-leaf", extra: 1 }), { effectId: "gold-leaf" });
  assert.deepEqual(
    normalizeEditorTextEffect({ effectId: "thread", overrides: { intensity: 3, tintColor: "#00ff00", junk: true } }),
    { effectId: "thread", overrides: { intensity: 1, tintColor: "#00ff00" } }
  );
  assert.deepEqual(normalizeEditorTextEffect({ effectId: "x", overrides: { tintColor: "red;" } }), { effectId: "x" });
});

test("curved and mixed-layout text are reported, plain text is not", () => {
  assert.equal(textEffectUnsupportedReason({ textCurveEnabled: true, textCurveArcDegrees: 120 }), "curved");
  assert.equal(textEffectUnsupportedReason({ textCurveEnabled: true, textCurveArcDegrees: 0 }), null);
  assert.equal(textEffectUnsupportedReason({ spansAffectLayout: true }), "mixed-layout");
  assert.equal(textEffectUnsupportedReason({}), null);
});

function arabicNode(options: Partial<Konva.TextConfig> = {}) {
  return new Konva.Text({
    text: "محمد\nدعوة زفاف",
    width: 520,
    height: 220,
    fontSize: 64,
    fontFamily: "sans-serif",
    fontStyle: "bold",
    lineHeight: 1.2,
    align: "center",
    direction: "rtl",
    fill: "#000000",
    ...options,
  });
}

function alphaOf(draw: (context: Konva.Context) => void) {
  const scene = new SceneCanvas({ width: 520, height: 220, pixelRatio: 1 });
  const context = scene.getContext();
  draw(context);
  const raw = context._context as unknown as CanvasRenderingContext2D;
  const { data } = raw.getImageData(0, 0, 520, 220);
  const alpha = new Uint8Array(data.length / 4);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3];
  return alpha;
}

const solid = {
  id: "solid",
  titleEn: "Solid",
  titleAr: "لون",
  category: "",
  isPremium: false,
  previewUrl: null,
  textureUrl: null,
  textureVideoUrl: null,
  spec: { fill: { kind: "solid", color: "#000000" } },
} as TextEffectCatalogItem;

for (const [name, options] of [
  ["centred RTL, two lines", {}],
  ["right-aligned, vertically centred", { align: "right", verticalAlign: "middle" }],
  ["left-aligned LTR with padding", { text: "Wedding\nInvitation", direction: "ltr", align: "left", padding: 12 }],
] as const) {
  test(`a solid effect covers the same pixels as Konva's own text (${name})`, () => {
    const node = arabicNode(options as Partial<Konva.TextConfig>);
    const plain = alphaOf((context) => node._sceneFunc(context));
    const effect = alphaOf((context) => {
      assert.equal(paintTextEffectOnNode(context, node, solid, { effectId: "solid" }), true);
    });
    let inked = 0;
    let differing = 0;
    for (let i = 0; i < plain.length; i += 1) {
      if (plain[i] > 128 || effect[i] > 128) inked += 1;
      if (Math.abs(plain[i] - effect[i]) > 96) differing += 1;
    }
    assert.ok(inked > 2000, `expected ink, got ${inked}`);
    assert.ok(differing / inked < 0.01, `${differing} of ${inked} pixels differ`);
  });
}

test("the layout's bounds are the drawn lines, inside the box", () => {
  const layout = konvaTextEffectLayout(arabicNode());
  assert.ok(layout);
  assert.equal(layout.runs.length, 2);
  assert.equal(layout.direction, "rtl");
  assert.ok(layout.bounds.x > 0 && layout.bounds.x + layout.bounds.width < 520);
  assert.equal(Math.round(layout.bounds.height), Math.round(2 * 64 * 1.2));
  assert.equal(konvaTextEffectLayout(arabicNode({ text: "" })), null);
});
