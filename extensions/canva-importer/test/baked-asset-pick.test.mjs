// When the isolation snapshot replaces a captured asset: only for an asset with the page
// background baked in (opaque, and markedly more opaque than the snapshot). An asset with real
// transparency is a clean cut-out and keeps its pixels. The block is evaluated straight out of
// background.js between its marker comments.
//
//   node --test extensions/canva-importer/test/baked-asset-pick.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "background.js"), "utf8");
const start = source.indexOf("// ── canva-baked-asset-pick:start");
const end = source.indexOf("// ── canva-baked-asset-pick:end");
assert.ok(start >= 0 && end > start, "canva-baked-asset-pick markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.pick = snapshotBeatsBakedAsset;`, context);
const pick = (input) => context.pick(input);

test("a round dot (21% clear) keeps its 800 px asset against its soft isolation crop", () => {
  assert.equal(pick({ hadSnapshot: true, assetOpaque: 0.785, snapshotOpaque: 0.5 }), false);
});

test("an opaque asset much more opaque than the snapshot is baked: the snapshot wins", () => {
  assert.equal(pick({ hadSnapshot: true, assetOpaque: 1, snapshotOpaque: 0.6 }), true);
  assert.equal(pick({ hadSnapshot: true, assetOpaque: 0.98, snapshotOpaque: 0.8 }), true);
});

test("no snapshot, an empty snapshot, or a close match keeps the asset", () => {
  assert.equal(pick({ hadSnapshot: false, assetOpaque: 1, snapshotOpaque: -1 }), false);
  assert.equal(pick({ hadSnapshot: true, assetOpaque: 1, snapshotOpaque: 0.01 }), false);
  assert.equal(pick({ hadSnapshot: true, assetOpaque: 1, snapshotOpaque: 0.9 }), false);
  assert.equal(pick({ hadSnapshot: true, assetOpaque: -1, snapshotOpaque: 0.5 }), false);
});
