// The dashboard takes a 600 MB request; an import over that loses its manifest ("Invalid request
// body"). Over budget, the largest PNG/JPEG parts are re-encoded as WebP, largest first, until the
// upload fits. Evaluated straight out of background.js between its marker comments.
//
// DAHYXQ2RE1U: 144 distinct ~1500 px PNGs, ~250 MB.
//
//   node --test extensions/canva-importer/test/upload-budget.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "background.js"), "utf8");
const start = source.indexOf("// ── canva-upload-budget:start");
const end = source.indexOf("// ── canva-upload-budget:end");
assert.ok(start >= 0 && end > start, "canva-upload-budget markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.plan = planUploadReencode; this.budget = DASHBOARD_UPLOAD_BUDGET_BYTES;`, context);
const plan = (parts, budget) => Array.from(context.plan(parts, budget));
const MB = 1024 * 1024;

test("under the budget nothing is touched", () => {
  assert.deepEqual(plan([{ bytes: 50 * MB, type: "image/png" }, { bytes: 40 * MB, type: "image/png" }], 100 * MB), []);
});

test("over the budget the largest raster parts go first, only as many as needed", () => {
  const parts = [
    { bytes: 30 * MB, type: "image/png" },
    { bytes: 90 * MB, type: "image/png" },
    { bytes: 60 * MB, type: "image/jpeg" },
    { bytes: 5 * MB, type: "video/mp4" },
  ];
  // 185 MB total, 100 MB budget: 90 MB → ~22 MB (projected −67.5) leaves 117 → the 60 MB one too.
  assert.deepEqual(plan(parts, 100 * MB), [1, 2]);
});

test("videos, SVGs, GIFs/WebPs and small parts are never re-encoded", () => {
  const parts = [
    { bytes: 150 * MB, type: "video/mp4" },
    { bytes: 80 * MB, type: "image/svg+xml" },
    { bytes: 70 * MB, type: "image/webp" },
    { bytes: 100 * 1024, type: "image/png" },
  ];
  assert.deepEqual(plan(parts, 10 * MB), []);
});

test("the budget sits under the dashboard's 600 MB request limit", () => {
  assert.ok(context.budget < 600 * MB);
});
