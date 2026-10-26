// An inline `rotate(0deg)` is not a rotation. Canva writes one on the first wrapper inside every
// picture; reading `hasAngle` as "turned" sent every image (DAHYoZnBs9Y's 800 px timeline dots
// included) down to a design-size screen crop. The block is evaluated straight out of
// canva-scraper.js between its marker comments.
//
//   node --test extensions/canva-importer/test/style-transform.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-style-transform:start");
const end = source.indexOf("// ── canva-style-transform:end");
assert.ok(start >= 0 && end > start, "canva-style-transform markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.parse = parseStyleTransform; this.turned = inlineRotationIsMeaningful;`, context);

test("Canva's rotate(0deg) wrapper is written but does not turn", () => {
  const inline = context.parse("transform: translate(0px, 0px) rotate(0deg); width: 10px;");
  assert.equal(inline.hasAngle, true);
  assert.equal(inline.angle, 0);
  assert.equal(context.turned(inline), false);
  assert.equal(context.turned(context.parse("transform: rotate(-0.1deg)")), false);
});

test("a real turn still counts, and no rotate() at all never does", () => {
  const turned = context.parse("transform: translate(767px, 1224px) rotate(-15.3deg)");
  assert.equal(turned.hasAngle, true);
  assert.equal(context.turned(turned), true);
  assert.equal(context.turned(context.parse("transform: rotate(90deg)")), true);
  const plain = context.parse("transform: translate(1px, 2px)");
  assert.equal(plain.hasAngle, false);
  assert.equal(context.turned(plain), false);
  assert.equal(context.turned(null), false);
});
