// Three Canva features the mind map DAHP1vJ1HHw lost on import, each a pure block evaluated
// straight out of the shipped files: list markers, outline text (stroke copies) and dashed /
// arrowed connector lines.
//
//   node --test extension/canva-importer/test/mind-map-elements.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, "..", file), "utf8");
const block = (source, name) => {
  const start = source.indexOf(`// ── ${name}:start`);
  const end = source.indexOf(`// ── ${name}:end`);
  assert.ok(start >= 0 && end > start, `${name} markers missing`);
  return source.slice(start, end);
};
const scraper = read("canva-scraper.js");
const background = read("background.js");
const context = vm.createContext({});
vm.runInContext(
  `${block(scraper, "canva-list-markers")}\n${block(scraper, "canva-vector-line")}\n${block(scraper, "canva-text-stroke")}\n${block(scraper, "canva-paragraph-direction")}\n${block(background, "canva-text-stroke-fabric")}\n` +
    "this.marker = listMarkerText; this.needsVector = lineNeedsVector; this.stroke = textStrokeFromCopies; this.direction = matchCanvaParagraphDirection; this.toFabric = canvaTextStrokeToFabric;",
  context
);
const plain = (value) => (value === null ? null : JSON.parse(JSON.stringify(value)));

test("list markers: bullets by list style, numbers and letters by ordinal", () => {
  assert.equal(context.marker("disc", 1), "• ");
  assert.equal(context.marker("circle", 2), "◦ ");
  assert.equal(context.marker("square", 3), "▪ ");
  assert.equal(context.marker("decimal", 3), "3. ");
  assert.equal(context.marker("lower-alpha", 2), "b. ");
  assert.equal(context.marker("upper-roman", 4), "IV. ");
  assert.equal(context.marker("none", 1), "");
  assert.equal(context.marker("", 1), "");
});

test("an Arabic item in Canva's left-to-right list keeps its bullet on the left", () => {
  // Prefixed at the start, then the paragraph-direction pass moves it to the end it shows at.
  assert.equal(context.direction(`${context.marker("disc", 1)}تحديد المشكلة`, "ltr"), "تحديد المشكلة •");
  // A right-to-left list keeps it leading (shown on the right).
  assert.equal(context.direction(`${context.marker("disc", 1)}تحديد المشكلة`, "rtl"), "• تحديد المشكلة");
});

test("the outline label: the stroke copy's width as a fraction of its font size", () => {
  const stroke = plain(
    context.stroke([
      { strokeWidthPx: 8.16928, strokeColor: "rgb(187, 25, 227)", fontSizePx: 33.344 },
      { strokeWidthPx: 0, strokeColor: "rgb(255, 255, 255)", fontSizePx: 33.344 },
    ])
  );
  assert.deepEqual(stroke, { color: "rgb(187, 25, 227)", widthRatio: 0.245 });
  assert.equal(context.stroke([{ strokeWidthPx: 0, strokeColor: "rgb(0,0,0)", fontSizePx: 20 }]), null);
  assert.equal(context.stroke([{ strokeWidthPx: 4, strokeColor: "", fontSizePx: 20 }]), null);
});

test("the fabric text outline: ratio ÷ 0.22 as the 0–100 width, clamped", () => {
  assert.deepEqual(plain(context.toFabric({ color: "#bb19e3", widthRatio: 0.245 })), { stroke: "#bb19e3", strokeWidth: 100 });
  // The title's cream outline: 7.327 px on 48.85 px → ratio 0.15 → 68.2.
  assert.deepEqual(plain(context.toFabric({ color: "#f8f9f0", widthRatio: 0.15 })), { stroke: "#f8f9f0", strokeWidth: 68.2 });
  assert.deepEqual(plain(context.toFabric(null)), {});
  assert.deepEqual(plain(context.toFabric({ color: "#000", widthRatio: 0 })), {});
});

test("connector lines: dashed, arrowed or bent stay vector; a plain bar does not", () => {
  const elbow = "M1.5,8.3L1.5,55.3C1.5,68.6 12.2,79.3 25.5,79.3L80.3,79.3";
  assert.equal(context.needsVector([{ dashed: true, filled: false, d: elbow }, { dashed: false, filled: true, d: "M6,7.5L1.5,1.5L-3,7.5Z" }]), true);
  assert.equal(context.needsVector([{ dashed: false, filled: false, d: elbow }]), true);
  assert.equal(context.needsVector([{ dashed: true, filled: false, d: "M0,1L100,1" }]), true);
  assert.equal(context.needsVector([{ dashed: false, filled: false, d: "M0,1L100,1" }, { dashed: false, filled: true, d: "M98,0L104,1L98,2Z" }]), true);
  assert.equal(context.needsVector([{ dashed: false, filled: false, d: "M0,1L100,1" }]), false);
  assert.equal(context.needsVector([{ dashed: false, filled: false, d: "M0,0L0,0L100,0" }]), false);
  assert.equal(context.needsVector([]), false);
});
