/**
 * The text background box reaches the app through the mobile template API.
 *
 * The app's DTO (BackendTemplateDtos.kt) reads backgroundVisible / ColorHex / AngleSize / Opacity /
 * PaddingX / PaddingY off every TEXT layer; the dashboard used to send the first four only, and
 * only when the layer carried a colour. This pins the whole contract on the payload the
 * `/api/mobile/templates/[slug]` route actually serves (toMobileTemplateDetailSlim).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { toMobileTemplateDetailSlim } from "@/lib/templates/mobileProject";

const textElement = (overrides = {}) => ({
  id: "t1", type: "text", x: 100, y: 200, width: 400, height: 60, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
  text: "أمي شمس حياتي", fontFamily: "Cairo", fontSize: 32.6, fontWeight: "400", fontStyle: "normal",
  align: "center", lineHeight: 1.2, letterSpacing: 0, color: "#580e06", fill: "#580e06",
  ...overrides,
});

const textLayerOf = (data) => {
  const detail = toMobileTemplateDetailSlim({ id: "tpl", name: "bg", canvasWidth: 1080, canvasHeight: 1920, data }, {});
  return detail.project.layers.find((layer) => layer.type === "TEXT");
};

const pagesOf = (element) => ({
  pages: [{ id: "p1", width: 1080, height: 1920, background: { type: "color", color: "#ffffff" }, elements: [element] }],
});

test("an editor text background ships all six fields the app reads", () => {
  const layer = textLayerOf(
    pagesOf(
      textElement({
        textBackgroundEnabled: true, textBackgroundColor: "#e8e4de", textBackgroundOpacity: 0.9,
        textBackgroundAngleSize: 0.407, textBackgroundPaddingX: 0.804, textBackgroundPaddingY: 0.215,
      })
    )
  );
  assert.equal(layer.backgroundVisible, true);
  assert.equal(layer.backgroundColorHex, "#E8E4DE");
  assert.equal(layer.backgroundOpacity, 0.9);
  assert.equal(layer.backgroundAngleSize, 0.407);
  assert.equal(layer.backgroundPaddingX, 0.804);
  assert.equal(layer.backgroundPaddingY, 0.215);
});

test("switching the box off hides it in the app but keeps its settings", () => {
  const layer = textLayerOf(
    pagesOf(textElement({ textBackgroundEnabled: false, textBackgroundColor: "#e8e4de", textBackgroundPaddingX: 0.5 }))
  );
  assert.equal(layer.backgroundVisible, false);
  assert.equal(layer.backgroundColorHex, "#E8E4DE");
  assert.equal(layer.backgroundPaddingX, 0.5);
});

test("a text layer with no background ships none", () => {
  const layer = textLayerOf(pagesOf(textElement()));
  assert.equal(layer.backgroundVisible, false);
  assert.equal(layer.backgroundPaddingX, 0);
  assert.equal(layer.backgroundPaddingY, 0);
});

test("an older imported layer that only carries a colour still shows its box", () => {
  // Fabric-format import from before the on/off switch existed: a colour meant "on".
  const layer = textLayerOf({
    version: "7.0.0",
    objects: [{ type: "textbox", left: 100, top: 200, width: 400, height: 60, text: "old", fontSize: 32, fill: "#000000", textBackgroundColor: "rgb(232, 228, 222)" }],
  });
  assert.equal(layer.backgroundVisible, true);
  assert.equal(layer.backgroundColorHex, "#E8E4DE");
  assert.equal(layer.backgroundOpacity, 1);
});
