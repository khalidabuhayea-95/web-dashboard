// A page backdrop's clip list keeps each clip's placement TURN, in both copies of the model walk.
// DAHNlPG57uU's bokeh clip is 1920×1084 turned -90° to fill the portrait page; the list path kept
// left/top/width/height only, so the clip lay flat across the middle of every scene.
//
//   node --test extensions/canva-importer/test/backdrop-clip-rotation.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

for (const file of ["canva-fiber-main.js", "background.js"]) {
  test(`${file}: a backdrop clip's rect carries its rotation`, () => {
    const source = fs.readFileSync(path.join(here, "..", file), "utf8");
    const start = source.indexOf("let rb = null;");
    assert.ok(start >= 0, "clip rect builder missing");
    const block = source.slice(start, source.indexOf("return { videoId: v[refKey]", start));
    assert.match(block, /rotation: Number\(cand\.rotation\) \|\| 0,/);
  });
}
