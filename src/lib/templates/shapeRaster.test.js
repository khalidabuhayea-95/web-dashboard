/**
 *   node --import tsx --test src/lib/templates/shapeRaster.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadImage, createCanvas } from "canvas";

import { renderShapeLayerToDataUrl } from "@/lib/templates/shapeRaster";

async function alphaAt(dataUrl, x, y) {
  const image = await loadImage(dataUrl);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(x, y, 1, 1).data[3];
}

test("a stretched circle reaches the app as the oval that fills its box", async () => {
  const png = renderShapeLayerToDataUrl({ type: "circle", width: 200, height: 100, fill: "#ff0000" });
  // Near the left and right ends of the long side: inside the oval, outside a 50 px circle.
  assert.ok((await alphaAt(png, 10, 50)) > 200);
  assert.ok((await alphaAt(png, 190, 50)) > 200);
  // The box corners stay empty.
  assert.equal(await alphaAt(png, 2, 2), 0);
});

test("a square box is still a circle", async () => {
  const png = renderShapeLayerToDataUrl({ type: "circle", width: 120, height: 120, fill: "#ff0000" });
  assert.ok((await alphaAt(png, 60, 60)) > 200);
  assert.ok((await alphaAt(png, 4, 60)) > 200);
  assert.equal(await alphaAt(png, 6, 6), 0);
});

// ── the SVG twin the app gets ───────────────────────────────────────────────────────────────────
import { canRenderShapeLayerAsSvg, renderShapeLayerToSvg, shapeLayerSvgVersion } from "@/lib/templates/shapeRaster";

async function svgAlphaAt(svg, scale, x, y) {
  const image = await loadImage(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  const canvas = createCanvas(image.width * scale, image.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data[3];
}

test("the A6 ring: an outlined oval in hex, drawn as a vector", async () => {
  const ring = { type: "circle", width: 132, height: 35, fill: "transparent", stroke: "#caba9c", strokeWidth: 1 };
  const svg = renderShapeLayerToSvg(ring);
  assert.match(svg, /^<svg [^>]*viewBox="0 0 132 35"/);
  assert.match(svg, /<ellipse cx="66" cy="17.5" rx="65.5" ry="17" fill="none" stroke="#caba9c" stroke-width="1"/);
  // Drawn 3× (a phone): the outline sits on the oval's edge, the middle stays empty.
  assert.ok((await svgAlphaAt(svg, 3, 66, 0.5)) > 100);
  assert.equal(await svgAlphaAt(svg, 3, 66, 17.5), 0);
});

test("every simple shape becomes an SVG with the PNG's geometry", () => {
  const rect = renderShapeLayerToSvg({ type: "rect", width: 100, height: 60, fill: "rgba(255, 0, 0, 0.5)", cornerRadius: 10 });
  assert.match(rect, /<path d="M 10 0 L 90 0 A 10 10 0 0 1 100 10/);
  assert.match(rect, /fill="#ff0000" fill-opacity="0.5" stroke="none"/);
  const star = renderShapeLayerToSvg({ type: "star", width: 100, height: 100, fill: "gold" });
  assert.match(star, /<polygon points="50,0 /);
  assert.match(star, /fill="#ffd700"/);
  const arrow = renderShapeLayerToSvg({ type: "arrow", width: 200, height: 0, points: [0, 0, 200, 0], stroke: "#111111", strokeWidth: 4 });
  // The box is the line's own bounds (4 px tall here), exactly as the PNG frames it.
  assert.match(arrow, /viewBox="0 0 200 4"/);
  assert.match(arrow, /<polyline points="0,2 200,2" fill="none" stroke="#111111" stroke-width="4"/);
  assert.match(arrow, /<polygon points="200,2 186,-5 186,9" fill="#111111"/);
});

test("a paint the SVG can't express keeps the PNG path", () => {
  assert.equal(canRenderShapeLayerAsSvg({ type: "rect", width: 10, height: 10, fill: { type: "linear" } }), false);
  assert.equal(renderShapeLayerToSvg({ type: "rect", width: 10, height: 10, fill: "not-a-colour" }), null);
  assert.equal(canRenderShapeLayerAsSvg({ type: "image", width: 10, height: 10 }), false);
});

test("a fully transparent outline is no outline (the A6 divider: rgba(0,0,0,0))", () => {
  const rule = { type: "rect", width: 197, height: 1, fill: "#000000", stroke: "rgba(0,0,0,0)", strokeWidth: 0 };
  assert.equal(canRenderShapeLayerAsSvg(rule), true);
  assert.match(renderShapeLayerToSvg(rule), /fill="#000000" stroke="none"/);
});

test("the URL version changes when the shape changes", () => {
  const a = shapeLayerSvgVersion({ type: "circle", width: 50, height: 50, fill: "#000000" });
  const b = shapeLayerSvgVersion({ type: "circle", width: 50, height: 50, fill: "#ffffff" });
  assert.notEqual(a, b);
  assert.equal(a, shapeLayerSvgVersion({ type: "circle", width: 50, height: 50, fill: "#000000" }));
});
