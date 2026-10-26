// A Canva gradient page colour → the editor's page background object. The block is evaluated
// straight out of background.js between its marker comments, so the test exercises the code
// that ships. The certificate DAHFE4GgR2Q paints its page #62bfd4 → #f1dd76 left to right and
// imported as one flat sage; the scraper now hands this helper the gradient in the app's
// convention (angle 0 = left→right).
//
//   node --test extensions/canva-importer/test/page-gradient-background.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "background.js"), "utf8");
const start = source.indexOf("// ── canva-page-gradient-background:start");
const end = source.indexOf("// ── canva-page-gradient-background:end");
assert.ok(start >= 0 && end > start, "canva-page-gradient-background markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.toBackground = canvaPageGradientToBackground;`, context);
const toBackground = (gradient) => {
  const value = context.toBackground(gradient);
  return value === null ? null : JSON.parse(JSON.stringify(value));
};

test("the certificate's left-to-right ramp becomes a two-colour page background with its stops", () => {
  assert.deepEqual(
    toBackground({ type: "gradient", gradientKind: "linear", angle: 0, stops: [{ color: "#62bfd4", position: 0 }, { color: "#f1dd76", position: 1 }] }),
    { type: "gradient", gradientFrom: "#62bfd4", gradientTo: "#f1dd76", angle: 0, stops: [{ color: "#62bfd4", position: 0 }, { color: "#f1dd76", position: 1 }] }
  );
});

test("stops are ordered, angles normalised, radial and opacity kept", () => {
  const value = toBackground({
    gradientKind: "radial",
    angle: -90,
    stops: [{ color: "#FFFFFF", position: 1, opacity: 0.5 }, { color: "#000000", position: 0, opacity: 1 }],
  });
  assert.equal(value.gradientFrom, "#000000");
  assert.equal(value.gradientTo, "#ffffff");
  assert.equal(value.angle, 270);
  assert.equal(value.gradientKind, "radial");
  assert.deepEqual(value.stops[1], { color: "#ffffff", position: 1, opacity: 0.5 });
  assert.equal("opacity" in value.stops[0], false);
});

test("nothing usable keeps the flat colour", () => {
  assert.equal(toBackground(null), null);
  assert.equal(toBackground({ stops: [{ color: "#62bfd4", position: 0 }] }), null);
  assert.equal(toBackground({ stops: [{ color: "red", position: 0 }, { color: "#f1dd76", position: 1 }] }), null);
});
