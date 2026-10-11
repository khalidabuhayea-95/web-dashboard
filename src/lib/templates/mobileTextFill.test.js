/**
 * A gradient-coloured text reaches the app as its own glyph fill.
 *
 * The app's TextLayer carries `fill: TextFill.Gradient(Background.Gradient)`; the backend payload
 * sends the same fields under `fill: { type: "gradient", ... }` (BackendTextFillDto) on both the
 * imported fabric format and the editor's saved format, and keeps `colorHex` as the flat fallback
 * older builds draw. Regression: Canva's gradient text (Ramadan tips post DAHPQOCtDPM) imported as
 * an image slab with flat-colour words on top.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { toMobileTemplateDetailSlim } from "@/lib/templates/mobileProject";

const green = {
  type: "gradient",
  gradientKind: "linear",
  angle: 0,
  stops: [
    { color: "#214132", position: 0.1262 },
    { color: "#0f1c15", position: 1 },
  ],
};

const textLayerOf = (data) => {
  const detail = toMobileTemplateDetailSlim({ id: "tpl", name: "fill", canvasWidth: 1080, canvasHeight: 1350, data }, {});
  return detail.project.layers.find((layer) => layer.type === "TEXT");
};

const expectedFill = {
  type: "gradient",
  gradientKind: "linear",
  angle: 0,
  startColorHex: "#214132",
  endColorHex: "#0F1C15",
  stops: [
    { colorHex: "#214132", position: 0.1262 },
    { colorHex: "#0F1C15", position: 1 },
  ],
};

test("an imported (fabric) gradient text ships the app's fill and keeps its flat colour", () => {
  const layer = textLayerOf({
    version: "7.0.0",
    objects: [
      {
        type: "textbox", text: "أذكار الصباح والمساء", left: 709, top: 417, width: 173, height: 76,
        fontSize: 34.67, fontFamily: "IBM Plex Sans Arabic", textAlign: "right", fill: "rgb(33, 65, 50)",
        textFill: green,
      },
    ],
  });
  assert.deepEqual(layer.fill, expectedFill);
  assert.equal(layer.colorHex, "#214132");
});

test("an editor-saved gradient text ships the same fill", () => {
  const layer = textLayerOf({
    pages: [
      {
        id: "p1", width: 1080, height: 1350, background: { type: "color", color: "#e0dcc7" },
        elements: [
          {
            id: "t1", type: "text", x: 709, y: 417, width: 173, height: 76, rotation: 0, scaleX: 1, scaleY: 1,
            opacity: 1, text: "أذكار الصباح والمساء", fontFamily: "IBM Plex Sans Arabic", fontSize: 34.67,
            fontWeight: "400", fontStyle: "normal", align: "right", lineHeight: 1.1, letterSpacing: 0,
            color: "#214132", fill: "#214132", textFill: green,
          },
        ],
      },
    ],
  });
  assert.deepEqual(layer.fill, expectedFill);
});

test("a flat-colour text ships no fill at all", () => {
  const layer = textLayerOf({
    version: "7.0.0",
    objects: [{ type: "textbox", text: "رواه أبو داود", left: 0, top: 0, width: 200, height: 40, fontSize: 28, fill: "#214132" }],
  });
  assert.equal("fill" in layer, false);
});
