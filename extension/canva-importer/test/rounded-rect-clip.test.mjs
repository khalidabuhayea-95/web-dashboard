// Canva's image "corner rounding" → the image's own corner radius (editor + app). Canva draws the
// rounding as an inline CSS `clip-path: path("M …")` in the element's px; the scraper samples that
// outline and fits a rounded rectangle to it. The fit block is evaluated straight out of
// canva-scraper.js between its marker comments, so the test exercises the code that ships.
//
// The "www.nayroz.com" pill on the coffee post DAHPQI-mqB8 imported with square corners because
// only url(#clipPath) masks were read.
//
//   node --test extension/canva-importer/test/rounded-rect-clip.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-rounded-rect-fit:start");
const end = source.indexOf("// ── canva-rounded-rect-fit:end");
assert.ok(start >= 0 && end > start, "canva-rounded-rect-fit markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.fit = fitRoundedRectCornerFraction;`, context);
const fit = (points) => context.fit(points);

const SAMPLES = 360;

// Evenly spaced points along the outline of a w×h rectangle with corner radius r, clockwise from
// the top-left corner's end — what path.getPointAtLength hands the scraper.
function roundedRectOutline(width, height, radius, offsetX = 0, offsetY = 0) {
  const straightX = width - 2 * radius;
  const straightY = height - 2 * radius;
  const arc = (Math.PI / 2) * radius;
  const pieces = [
    { length: straightX, at: (t) => [radius + t * straightX, 0] },
    { length: arc, at: (t) => corner(width - radius, radius, -Math.PI / 2 + (t * Math.PI) / 2) },
    { length: straightY, at: (t) => [width, radius + t * straightY] },
    { length: arc, at: (t) => corner(width - radius, height - radius, (t * Math.PI) / 2) },
    { length: straightX, at: (t) => [width - radius - t * straightX, height] },
    { length: arc, at: (t) => corner(radius, height - radius, Math.PI / 2 + (t * Math.PI) / 2) },
    { length: straightY, at: (t) => [0, height - radius - t * straightY] },
    { length: arc, at: (t) => corner(radius, radius, Math.PI + (t * Math.PI) / 2) },
  ];
  function corner(cx, cy, angle) {
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  }
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const points = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    let distance = (total * index) / SAMPLES;
    const piece = pieces.find((candidate) => {
      if (distance <= candidate.length) return true;
      distance -= candidate.length;
      return false;
    });
    const [x, y] = piece.at(piece.length > 0 ? distance / piece.length : 0);
    points.push([x + offsetX, y + offsetY]);
  }
  return points;
}

const close = (actual, expected, epsilon) =>
  assert.ok(actual !== null && Math.abs(actual - expected) <= epsilon, `${actual} ≉ ${expected}`);

test("the URL pill: a fully rounded 362×60 clip is a half-height radius", () => {
  close(fit(roundedRectOutline(362, 60, 30)), 0.5, 1e-9);
});

test("a softly rounded card keeps its radius within a step of the fit", () => {
  // Steps are 1/200 of half the shorter side (0.3 px here), so 12 px lands on 0.1 ± 0.0025.
  close(fit(roundedRectOutline(200, 120, 12)), 0.1, 0.0025);
  // The outline may sit anywhere in its element; only its own box matters to the fit.
  close(fit(roundedRectOutline(200, 120, 12, 40, 25)), 0.1, 0.0025);
});

test("a circle is the fully rounded square", () => {
  close(fit(roundedRectOutline(90, 90, 45)), 0.5, 1e-9);
});

test("square corners, ellipses and arches are not corner rounding", () => {
  assert.equal(fit(roundedRectOutline(200, 120, 0)), null);

  const ellipse = Array.from({ length: SAMPLES }, (_, index) => {
    const angle = (2 * Math.PI * index) / SAMPLES;
    return [100 + 100 * Math.cos(angle), 50 + 50 * Math.sin(angle)];
  });
  assert.equal(fit(ellipse), null);

  // An arch window: a semicircle over a square-cornered body.
  const arch = [];
  for (let index = 0; index <= 180; index += 1) {
    const angle = Math.PI + (Math.PI * index) / 180;
    arch.push([50 + 50 * Math.cos(angle), 50 + 50 * Math.sin(angle)]);
  }
  for (let index = 0; index <= 90; index += 1) arch.push([100, 50 + (100 * index) / 90]);
  for (let index = 0; index <= 90; index += 1) arch.push([100 - (100 * index) / 90, 150]);
  for (let index = 0; index <= 90; index += 1) arch.push([0, 150 - (100 * index) / 90]);
  assert.equal(fit(arch), null);
});

test("degenerate outlines come back null", () => {
  assert.equal(fit([]), null);
  assert.equal(fit(null), null);
  assert.equal(fit(Array.from({ length: 20 }, (_, index) => [index, 5])), null);
});
