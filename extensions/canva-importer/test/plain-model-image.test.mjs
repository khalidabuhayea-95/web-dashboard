// A model-confirmed plain picture — a `rect` element with one media drawn over its whole frame —
// is reproduced exactly by the fetched asset, so nothing else found inside its DOM node makes it
// a "composite" that needs the screen snapshot. DAHYoZnBs9Y's three 800 px timeline dots were
// taken for composites at import time and came back as 33 px screen crops. The block is
// evaluated straight out of canva-scraper.js between its marker comments.
//
//   node --test extensions/canva-importer/test/plain-model-image.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const slice = (name) => {
  const start = source.indexOf(`// ── ${name}:start`);
  const end = source.indexOf(`// ── ${name}:end`);
  assert.ok(start >= 0 && end > start, `${name} markers missing`);
  return source.slice(start, end);
};
const context = vm.createContext({});
vm.runInContext(`${slice("canva-plain-model-image")}\nthis.plain = isPlainModelImage;`, context);
const plain = (entry) => context.plain(entry);

// Exactly as the model held one dot: a 32.727 px rect whose media rect equals its frame.
const dot = {
  elementType: "rect",
  width: 32.72726988989484,
  height: 32.72726988989484,
  image: { mediaId: "MAFcflee0fU", crop: { top: 0, left: 0, width: 32.72726988989484, height: 32.72726988989484, rotation: 0 } },
};

test("an uncropped rect picture is plain", () => {
  assert.equal(plain(dot), true);
  assert.equal(plain({ ...dot, image: { mediaId: "MA", crop: null } }), true);
});

test("a cropped picture, a shape, a text or no media is not", () => {
  assert.equal(plain({ ...dot, image: { mediaId: "MA", crop: { top: -10, left: 0, width: 40, height: 40 } } }), false);
  assert.equal(plain({ ...dot, elementType: "shape" }), false);
  assert.equal(plain({ ...dot, elementType: "text", image: null }), false);
  assert.equal(plain({ ...dot, image: { mediaId: "" } }), false);
  assert.equal(plain(null), false);
});
