/**
 * A multi-style text reaches the app as ONE TEXT layer with `spans`.
 *
 * The editor keeps per-range style overrides on the text (`textSpans`, lib/editor/textSpans.ts);
 * the app's TEXT layer gets the same ranges under `spans`, in its own field names and units
 * (`fontName` + `font`, `size`, `fontWeight`/`bold`, `italic`, `colorHex`, `letterSpacing`,
 * `underline`/`strikethrough`, `stroke`, `highlight`) — both for an imported (fabric) template and
 * an editor-saved one, and through the slim serializer GET /api/mobile/templates/[slug] uses.
 * Regression: Canva DAHQBJ7cipQ's white/yellow sentence reached the app all white.
 *
 *   node --import tsx --test src/lib/templates/mobileTextSpans.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import { toMobileTemplateDetailSlim } from "@/lib/templates/mobileProject";

const DELIVERY = "طلّب أونلاين وخليك مرتاح… إحنا نوصل لعندك وين ما كنت.";
const firstYellow = [DELIVERY.indexOf("وخليك"), DELIVERY.indexOf("…")];
const secondYellow = [DELIVERY.indexOf("وين"), DELIVERY.length];

const textLayerOf = (data, options = {}) => {
  const detail = toMobileTemplateDetailSlim({ id: "tpl", name: "spans", canvasWidth: 1080, canvasHeight: 1080, data }, options);
  return detail.project.layers.find((layer) => layer.type === "TEXT");
};

test("an imported (fabric) multi-colour text ships its yellow ranges", () => {
  const layer = textLayerOf({
    version: "7.0.0",
    objects: [
      {
        type: "textbox", text: DELIVERY, left: 120, top: 520, width: 377, height: 135,
        fontSize: 32.59, fontFamily: "IBM Plex Sans Arabic", fontWeight: 700, textAlign: "center", fill: "rgb(255, 255, 255)",
        textSpans: [
          { start: firstYellow[0], end: firstYellow[1], color: "#ffbf51" },
          { start: secondYellow[0], end: secondYellow[1], color: "#ffbf51" },
        ],
      },
    ],
  });
  assert.equal(layer.colorHex, "#FFFFFF");
  assert.deepEqual(layer.spans, [
    { start: firstYellow[0], end: firstYellow[1], colorHex: "#FFBF51" },
    { start: secondYellow[0], end: secondYellow[1], colorHex: "#FFBF51" },
  ]);
});

test("an editor-saved text ships every kind of override in the app's own field names", () => {
  const text = "نحن لا نرى الأشياء كما هي";
  const start = text.indexOf("الأشياء");
  const layer = textLayerOf(
    {
      pages: [
        {
          id: "p1", width: 1080, height: 1080, background: { type: "color", color: "#2b1d8f" },
          elements: [
            {
              id: "t1", type: "text", x: 100, y: 200, width: 800, height: 120, rotation: 0, scaleX: 1, scaleY: 1,
              opacity: 1, text, fontFamily: "Lalezar", fontSize: 60, fontWeight: "400", fontStyle: "normal",
              align: "center", lineHeight: 1.2, letterSpacing: 0, color: "#5eead4", fill: "#5eead4",
              stroke: "#000000", strokeWidth: 0,
              textSpans: [
                {
                  start, end: text.length, fontFamily: "Cairo", fontSize: 96, fontWeight: "800", fontStyle: "italic",
                  color: "rgba(254, 243, 199, 0.5)", letterSpacing: 2, textDecoration: "underline",
                  stroke: "#ff0000", strokeWidth: 20, highlightColor: "#9d4edd", highlightOpacity: 0.8,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      fontLookup: new Map([
        ["cairo", { id: "font-cairo", displayName: "Cairo", downloadUrl: "https://cdn/cairo.ttf", mobileDownloadUrl: "https://cdn/cairo-mobile.ttf", mobileCompatible: true }],
      ]),
    }
  );
  // Letter spacing on Arabic goes where Chrome puts it (lib/editor/arabicLetterSpacing.ts): the
  // range splits at its spaces, every piece keeps the other overrides, and only the spaces keep
  // the range's 2 px.
  const style = {
      fontName: "Cairo",
      font: {
        id: "font-cairo",
        fontName: "Cairo",
        displayName: "Cairo",
        downloadUrl: "https://cdn/cairo.ttf",
        mobileDownloadUrl: "https://cdn/cairo-mobile.ttf",
        mobileCompatible: true,
      },
      size: 96,
      fontWeight: 800,
      bold: true,
      italic: true,
      colorHex: "#80FEF3C7",
      underline: true,
      strikethrough: false,
      stroke: { enabled: true, colorHex: "#FF0000", opacity: 1, width: 20 },
      highlight: { colorHex: "#9D4EDD", opacity: 0.8 },
  };
  const firstSpace = text.indexOf(" ", start);
  const secondSpace = text.indexOf(" ", firstSpace + 1);
  assert.deepEqual(JSON.parse(JSON.stringify(layer.spans)), [
    { start, end: firstSpace, ...style },
    { start: firstSpace, end: firstSpace + 1, ...style, letterSpacing: 2 },
    { start: firstSpace + 1, end: secondSpace, ...style },
    { start: secondSpace, end: secondSpace + 1, ...style, letterSpacing: 2 },
    { start: secondSpace + 1, end: text.length, ...style },
  ]);
  assert.equal(layer.letterSpacing, 0);
});

test("a one-style text ships no spans, and malformed spans are cleaned up", () => {
  const plain = textLayerOf({
    version: "7.0.0",
    objects: [{ type: "textbox", text: "رواه أبو داود", left: 0, top: 0, width: 200, height: 40, fontSize: 28, fill: "#214132" }],
  });
  assert.equal("spans" in plain, false);
  const messy = textLayerOf({
    version: "7.0.0",
    objects: [
      {
        type: "textbox", text: "abcdef", left: 0, top: 0, width: 200, height: 40, fontSize: 28, fill: "#000000",
        textSpans: [{ start: 4, end: 99, color: "#00ff00" }, { start: 0, end: 2, color: "nope" }, { start: 3, end: 3, color: "#ff0000" }],
      },
    ],
  });
  assert.deepEqual(messy.spans, [{ start: 4, end: 6, colorHex: "#00FF00" }]);
});
