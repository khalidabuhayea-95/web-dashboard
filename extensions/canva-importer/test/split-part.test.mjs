// A text split per paragraph (`<id>__p1`…) or into table/grid cells (`<id>__cell1`…) replaces its
// element: the parts count as that element when the model asks what was captured and when the
// element shows. Companions (`<id>__text`, `<id>__frame`) sit beside their element and do not.
// The block is evaluated straight out of canva-scraper.js between its marker comments.
//
// DAHNlFf3ad4's scene-3 paragraph was captured as four parts, rebuilt whole from the model on top
// of them, and the parts showed through all three scenes.
//
//   node --test extensions/canva-importer/test/split-part.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-split-part:start");
const end = source.indexOf("// ── canva-split-part:end");
assert.ok(start >= 0 && end > start, "canva-split-part markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.base = splitPartBaseId;`, context);
const base = (id) => context.base(id);

test("paragraph and cell parts name their element", () => {
  assert.equal(base("LBlYPygMHh9Lg1zY__p1"), "LBlYPygMHh9Lg1zY");
  assert.equal(base("LBlYPygMHh9Lg1zY__p12"), "LBlYPygMHh9Lg1zY");
  assert.equal(base("LBgrid__cell3"), "LBgrid");
});

test("whole elements and companions are no parts", () => {
  assert.equal(base("LBlYPygMHh9Lg1zY"), "");
  assert.equal(base("LBphoto__frame"), "");
  assert.equal(base("LBphoto__text"), "");
  assert.equal(base("LBx__p"), "");
  assert.equal(base(""), "");
  assert.equal(base(undefined), "");
});
