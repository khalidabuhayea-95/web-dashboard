// A text whose paragraphs are styled differently becomes one layer per paragraph. The block is
// evaluated straight out of canva-scraper.js between its marker comments. (DAHP1gDecK4's title:
// a bold first line over a regular second line imported all bold, and the second line folded.)
//
//   node --test extension/canva-importer/test/paragraph-styles.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-paragraph-styles:start");
const end = source.indexOf("// ── canva-paragraph-styles:end");
assert.ok(start >= 0 && end > start, "canva-paragraph-styles markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.differ = paragraphStylesDiffer;`, context);
const differ = (keys) => context.differ(keys);

const bold = "700|96px|YAFdJr0OaFw_0, _fb_|rgb(56, 56, 56)|normal";
const regular = "400|96px|YAFdJr0OaFw_0, _fb_|rgb(56, 56, 56)|normal";

test("the title: a bold line over a regular line splits", () => {
  assert.equal(differ([bold, regular]), true);
});

test("uniform paragraphs, a single paragraph, or a paragraph mixing styles inside itself stay one layer", () => {
  assert.equal(differ([bold, bold, bold]), false);
  assert.equal(differ([bold]), false);
  assert.equal(differ([bold, null]), false);
  assert.equal(differ([bold, ""]), false);
  assert.equal(differ([]), false);
  assert.equal(differ(null), false);
});
