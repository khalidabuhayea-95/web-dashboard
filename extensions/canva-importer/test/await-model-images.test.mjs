// Which nodes the scan waits for before it reads the page: a photo-filled element (model `image`
// fill) whose <img> has not decoded yet. DAHYjeZFTxw, imported right after opening it: its one
// 1152×2048 photo had no <img> in its node yet, the scan took the shape path, and the whole design
// came in as a blank white page. The block is evaluated straight out of canva-scraper.js.
//
//   node --test extensions/canva-importer/test/await-model-images.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-await-model-images:start");
const end = source.indexOf("// ── canva-await-model-images:end");
assert.ok(start >= 0 && end > start, "canva-await-model-images markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.awaits = nodeAwaitsModelImage;`, context);
const awaits = (...args) => context.awaits(...args);

const photo = { type: "rect", image: { mediaId: "MAHQliophhg" } };

test("a photo element with no image on the page yet is waited for", () => {
  assert.equal(awaits(photo, []), true);
  assert.equal(awaits(photo, [{ naturalWidth: 0 }]), true);
});

test("a decoded image, or no photo in the model, is not waited for", () => {
  assert.equal(awaits(photo, [{ naturalWidth: 900 }]), false);
  assert.equal(awaits(photo, [{ naturalWidth: 0 }, { naturalWidth: 4 }]), false);
  // DAHYjTZd758: Canva painted the photo into a 900×1600 canvas — ready, nothing to wait for.
  assert.equal(awaits(photo, [{ tagName: "CANVAS", width: 900, height: 1600 }]), false);
  assert.equal(awaits(photo, [{ tagName: "CANVAS", width: 0, height: 0 }]), true);
  assert.equal(awaits({ type: "shape", shape: { shapeKind: "rect" } }, []), false);
  assert.equal(awaits({ type: "text" }, []), false);
  assert.equal(awaits(null, []), false);
});
