// A shape whose path is filled with media (a photo or a VIDEO) is a frame, never a vector shape.
// The guard lives in all three copies of the model extractor, which must agree.
//
// DAHNlJePGh0's oval is a two-path shape: a path filled with the wedding-rings video plus an
// outline-ring path. The vector builder only skipped image fills, so the oval came in as its bare
// ring and the video id never reached the clip capture.
//
//   node --test extensions/canva-importer/test/media-filled-vector-shape.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

for (const file of ["canva-fiber-main.js", "canva-scraper.js", "background.js"]) {
  test(`${file}: extractVectorShape leaves image- and video-filled shapes to the frame path`, () => {
    const source = fs.readFileSync(path.join(here, "..", file), "utf8");
    const start = source.indexOf("const extractVectorShape = (el) => {");
    assert.ok(start >= 0, "extractVectorShape missing");
    const head = source.slice(start, start + 900);
    assert.match(head, /p\.fill\.image \|\| p\.fill\.video\)\)\) return null;/);
  });
}
