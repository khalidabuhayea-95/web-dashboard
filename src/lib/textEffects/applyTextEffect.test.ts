// The shared text-effect renderer and the texture contract. Pixel tests draw real Arabic
// through node-canvas (Pango shapes it), so they check what the browser path does: the
// material lands inside the glyphs and nowhere else.
//
//   node --import tsx --test src/lib/textEffects/applyTextEffect.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas, DOMMatrix as NodeDOMMatrix } from "canvas";

import {
  applyTextEffect,
  coverRect,
  effectPadding,
  gradientEndpoints,
  layoutSimpleText,
  type EffectCanvas,
} from "./applyTextEffect";
import {
  normalizeTextEffectBlendMode,
  normalizeTextEffectCategory,
  normalizeTextEffectSpec,
  serializeTextEffect,
  storableTextEffectSpec,
} from "./spec";

(globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix ??= NodeDOMMatrix;

const factory = (width: number, height: number) => createCanvas(width, height) as unknown as EffectCanvas;

test("cover rect fills the text box and keeps the texture's aspect", () => {
  const rect = coverRect(1000, 500, { x: 10, y: 20, width: 300, height: 300 });
  assert.equal(rect.height, 300);
  assert.equal(rect.width, 600);
  assert.equal(rect.x, 10 - 150);
  assert.equal(rect.y, 20);
  const zoomed = coverRect(100, 100, { x: 0, y: 0, width: 200, height: 100 }, 2);
  assert.deepEqual(zoomed, { x: -100, y: -150, width: 400, height: 400 });
});

test("gradient endpoints span the box along the angle", () => {
  const round = (ends: Record<string, number>) =>
    Object.fromEntries(Object.entries(ends).map(([key, value]) => [key, Math.round(value * 1e6) / 1e6 + 0]));
  assert.deepEqual(round(gradientEndpoints(90, { x: 0, y: 0, width: 200, height: 100 })), { x0: 100, y0: 0, x1: 100, y1: 100 });
  const horizontal = gradientEndpoints(0, { x: 0, y: 0, width: 200, height: 100 });
  assert.equal(horizontal.x0, 0);
  assert.equal(horizontal.x1, 200);
});

test("padding grows with stroke and shadow, in font-size units", () => {
  const plain = effectPadding({}, 100);
  const stroked = effectPadding({ stroke: { width: 0.1 } }, 100);
  const shadowed = effectPadding({ shadow: { enabled: true, blur: 0.2, offsetY: 0.1 } }, 100);
  assert.ok(stroked > plain);
  assert.ok(shadowed >= 50);
});

test("texture fills normalize with defaults, aliases and clamps; old specs gain the fields", () => {
  const spec = normalizeTextEffectSpec({
    fill: { kind: "texture", texture: { blendMode: "multiplyBlendMode", opacity: 3, renderMode: "bw", scale: 99 } },
  });
  assert.equal(spec.fill.kind, "texture");
  assert.deepEqual(spec.fill.texture, { blendMode: "multiply", opacity: 1, renderMode: "bw", tint: "#d4af37", scale: 6 });
  assert.equal(normalizeTextEffectBlendMode("normal"), "source-over");
  assert.equal(normalizeTextEffectBlendMode("screen"), "screen");
  assert.equal(normalizeTextEffectBlendMode("weird"), "source-over");
  const old = normalizeTextEffectSpec({ fill: { kind: "gradient", stops: [[0, "#000"], [1, "#fff"]] } });
  assert.equal(old.fill.kind, "gradient");
  assert.equal(old.bevel.enabled, false);
  assert.equal(old.fill.texture.blendMode, "source-over");
});

test("the row's texture URLs ride in the client spec, never in the stored one", () => {
  const stored = storableTextEffectSpec({ fill: { kind: "texture", texture: { url: "https://x/a.webp", opacity: 0.5 } } });
  assert.equal("url" in stored.fill.texture, false);
  const client = serializeTextEffect({
    slug: "gold",
    titleEn: "Gold",
    titleAr: "ذهبي",
    category: " Gold ",
    isPremium: true,
    previewUrl: null,
    textureUrl: "https://cdn/gold.webp",
    textureVideoUrl: "",
    spec: stored,
  });
  assert.equal(client.id, "gold");
  assert.equal(client.category, "gold");
  assert.equal(client.spec.fill.texture.url, "https://cdn/gold.webp");
  assert.equal("videoUrl" in client.spec.fill.texture, false);
  assert.equal(client.textureVideoUrl, null);
  assert.equal(normalizeTextEffectCategory("Glass & Ice!"), "glass-ice");
});

// A target with nothing on it, the Arabic word drawn big enough to sample.
function renderWord(spec: unknown, texture: unknown, options = {}) {
  const target = createCanvas(420, 200);
  const ctx = target.getContext("2d");
  const font = "bold 120px sans-serif";
  const layout = layoutSimpleText(ctx as never, {
    text: "محمد",
    font,
    fontSize: 120,
    direction: "rtl",
    align: "center",
    box: { x: 0, y: 20, width: 420 },
  });
  const painted = applyTextEffect(ctx as never, layout, { spec, texture: texture as never }, { createCanvas: factory, pixelRatio: 1, ...options });
  return { ctx, painted, layout };
}

function pixelsWithAlpha(ctx: { getImageData: (...a: number[]) => { data: Uint8ClampedArray } }) {
  const { data } = ctx.getImageData(0, 0, 420, 200);
  const inked: number[][] = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 250) inked.push([data[i], data[i + 1], data[i + 2]]);
  return { inked, total: data.length / 4 };
}

test("a texture fills the Arabic glyphs and leaves everything else transparent", () => {
  const red = createCanvas(64, 64);
  const rc = red.getContext("2d");
  rc.fillStyle = "#ff0000";
  rc.fillRect(0, 0, 64, 64);
  const { ctx, painted } = renderWord({ fill: { kind: "texture", color: "#0000ff" } }, red);
  assert.equal(painted, true);
  const { inked, total } = pixelsWithAlpha(ctx as never);
  assert.ok(inked.length > 1500, `expected ink, got ${inked.length}`);
  assert.ok(inked.length < total * 0.5, "the material must stay inside the letters");
  // Normal blend at full opacity: the texture replaces the base colour inside the glyphs.
  const redShare = inked.filter(([r, g, b]) => r > 240 && g < 20 && b < 20).length / inked.length;
  assert.ok(redShare > 0.95, `red share ${redShare}`);
});

test("a bw texture takes the tint; intensity 0 leaves the base colour", () => {
  const grey = createCanvas(32, 32);
  const gc = grey.getContext("2d");
  gc.fillStyle = "#ffffff";
  gc.fillRect(0, 0, 32, 32);
  const tinted = renderWord({ fill: { kind: "texture", texture: { renderMode: "bw" } } }, grey, { tintColor: "#00ff00" });
  const green = pixelsWithAlpha(tinted.ctx as never).inked;
  assert.ok(green.filter(([r, g, b]) => g > 240 && r < 20 && b < 20).length / green.length > 0.95);

  const off = renderWord({ fill: { kind: "texture", color: "#0000ff" } }, grey, { intensity: 0 });
  const blue = pixelsWithAlpha(off.ctx as never).inked;
  assert.ok(blue.filter(([r, g, b]) => b > 240 && r < 20 && g < 20).length / blue.length > 0.95);
});

test("a see-through base does not thin an opaque texture (glass)", () => {
  const red = createCanvas(16, 16);
  const rc = red.getContext("2d");
  rc.fillStyle = "#ff0000";
  rc.fillRect(0, 0, 16, 16);
  const { ctx } = renderWord({ fill: { kind: "texture", color: "rgba(0,0,255,0.2)" } }, red);
  const { inked } = pixelsWithAlpha(ctx as never);
  assert.ok(inked.length > 1500, "the texture keeps full alpha inside the glyphs");
  assert.ok(inked.filter(([r, g, b]) => r > 240 && g < 20 && b < 20).length / inked.length > 0.95);
});

test("a missing texture paints the base colour; empty text paints nothing", () => {
  const { ctx } = renderWord({ fill: { kind: "texture", color: "#0000ff" } }, null);
  assert.ok(pixelsWithAlpha(ctx as never).inked.length > 1500);
  const target = createCanvas(10, 10).getContext("2d");
  const none = applyTextEffect(target as never, { runs: [], fontSize: 10, bounds: { x: 0, y: 0, width: 1, height: 1 } }, { spec: {} });
  assert.equal(none, false);
});

test("multi-line layout stacks lines by line height inside the box", () => {
  const ctx = createCanvas(10, 10).getContext("2d");
  const layout = layoutSimpleText(ctx as never, {
    text: "دعوة\nزفاف",
    font: "60px sans-serif",
    fontSize: 60,
    lineHeight: 1.5,
    align: "center",
    direction: "rtl",
    box: { x: 0, y: 0, width: 400 },
  });
  assert.equal(layout.runs.length, 2);
  assert.equal(layout.runs[1].y - layout.runs[0].y, 90);
  assert.equal(layout.bounds.height, 180);
  assert.equal(layout.textBaseline, "middle");
});

// ---- inlay (gold rim + diamond pavé) ------------------------------------------

function solid(color: string, size = 16) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  context.fillStyle = color;
  context.fillRect(0, 0, size, size);
  return canvas;
}

function renderInlay(spec: unknown, inlayTexture: unknown) {
  const target = createCanvas(420, 200);
  const ctx = target.getContext("2d");
  const font = "bold 120px sans-serif";
  const layout = layoutSimpleText(ctx as never, {
    text: "محمد",
    font,
    fontSize: 120,
    direction: "rtl",
    align: "center",
    box: { x: 0, y: 20, width: 420 },
  });
  applyTextEffect(ctx as never, layout, { spec, inlayTexture: inlayTexture as never }, { createCanvas: factory, pixelRatio: 1 });
  return ctx;
}

test("inlay normalizes off by default with clamped fields; its URL rides only in the client spec", () => {
  const plain = normalizeTextEffectSpec({});
  assert.equal(plain.inlay.enabled, false);
  assert.equal(plain.inlay.texture.fit, "tile");
  assert.equal(plain.inlay.innerShadow.enabled, true);
  const clamped = normalizeTextEffectSpec({ inlay: { enabled: 1, inset: 5, outset: -1, texture: { fit: "weird", scale: 99 }, sparkles: { count: 9999 } } });
  assert.equal(clamped.inlay.enabled, true);
  assert.equal(clamped.inlay.inset, 0.2);
  assert.equal(clamped.inlay.outset, 0);
  assert.equal(clamped.inlay.texture.fit, "tile");
  assert.equal(clamped.inlay.texture.scale, 6);
  assert.equal(clamped.inlay.sparkles.count, 200);

  const stored = storableTextEffectSpec({ inlay: { enabled: true, texture: { url: "https://x/pave.webp" } } });
  assert.equal("url" in stored.inlay.texture, false);
  const client = serializeTextEffect({ slug: "diamond", spec: { inlay: { enabled: true } }, inlayTextureUrl: "https://cdn/pave.webp" });
  assert.equal(client.spec.inlay.texture.url, "https://cdn/pave.webp");
  assert.equal(client.inlayTextureUrl, "https://cdn/pave.webp");
});

test("a disabled inlay paints exactly what a spec without one paints", () => {
  const base = { fill: { kind: "solid", color: "#0000ff" }, bevel: { enabled: true } };
  const a = renderInlay(base, null).getImageData(0, 0, 420, 200).data;
  const b = renderInlay({ ...base, inlay: { enabled: false, outset: 0.1, inset: 0.1 } }, solid("#ff0000")).getImageData(0, 0, 420, 200).data;
  assert.deepEqual(Buffer.from(a), Buffer.from(b));
});

test("an inlay sets its material inside a rim of the main fill, and the rim grows outward", () => {
  const spec = {
    fill: { kind: "solid", color: "#0000ff" },
    inlay: { enabled: true, inset: 0.03, outset: 0.04, innerShadow: { enabled: false } },
  };
  const ctx = renderInlay(spec, solid("#ff0000"));
  const { inked } = pixelsWithAlpha(ctx as never);
  const red = inked.filter(([r, g, b]) => r > 240 && g < 20 && b < 20).length;
  const blue = inked.filter(([r, g, b]) => b > 240 && r < 20 && g < 20).length;
  assert.ok(red > 800, `inlay material inside the glyphs, got ${red}`);
  assert.ok(blue > 800, `rim of the main fill around it, got ${blue}`);

  const plain = pixelsWithAlpha(renderInlay({ fill: { kind: "solid", color: "#0000ff" } }, null) as never).inked.length;
  assert.ok(inked.length > plain * 1.1, `outset grows the lettering (${inked.length} vs ${plain})`);
  assert.ok(effectPadding(spec, 100) > effectPadding({}, 100));
});

test("the inner shadow darkens the inlay's edge but stays inside it", () => {
  const spec = (enabled: boolean) => ({
    fill: { kind: "solid", color: "#0000ff" },
    inlay: { enabled: true, inset: 0.03, outset: 0.04, innerShadow: { enabled, color: "rgba(0,0,0,1)", blur: 0.02, offsetY: 0.03 } },
  });
  const lit = pixelsWithAlpha(renderInlay(spec(false), solid("#ff0000")) as never).inked;
  const shaded = pixelsWithAlpha(renderInlay(spec(true), solid("#ff0000")) as never).inked;
  const pure = (list: number[][]) => list.filter(([r, g, b]) => r > 240 && g < 20 && b < 20).length;
  assert.ok(pure(shaded) < pure(lit), "some of the inlay falls in shadow");
  assert.equal(shaded.length, lit.length, "the shadow adds no ink outside the lettering");
});
