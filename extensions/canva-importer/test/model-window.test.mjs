// A group child's model timing (startUs / durationUs) is LOCAL to its group, like its left/top.
// DAHNlB6Y2KI: three flower groups, one per 10.458 s scene, each child stored as startUs 0 /
// durationUs 10458333 — the raw stamp put every copy on scene 1. The resolver runs the block
// shipped in canva-scraper.js between its marker comments.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-model-window:start");
const end = source.indexOf("// ── canva-model-window:end");
assert.ok(start >= 0 && end > start, "canva-model-window markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.resolve = resolveModelWindowMs;`, context);
const resolve = (model, byId) => {
  const result = context.resolve(model, byId);
  return result ? JSON.parse(JSON.stringify(result)) : result;
};

const SCENE_US = 10458333;

test("a top-level element keeps its own window", () => {
  const byId = { a: { startUs: SCENE_US, durationUs: SCENE_US } };
  assert.deepEqual(resolve(byId.a, byId), { startMs: 10458, durMs: 10458 });
});

test("a group child on the second scene is shifted by its group's start", () => {
  const byId = {
    g2: { type: "group", startUs: SCENE_US, durationUs: SCENE_US },
    child: { parentId: "g2", startUs: 0, durationUs: SCENE_US },
  };
  assert.deepEqual(resolve(byId.child, byId), { startMs: 10458, durMs: 10458 });
});

test("a child never outlives its group, and nested groups accumulate", () => {
  const byId = {
    outer: { type: "group", startUs: 2_000_000, durationUs: 8_000_000 },
    inner: { type: "group", parentId: "outer", startUs: 1_000_000, durationUs: 5_000_000 },
    child: { parentId: "inner", startUs: 500_000, durationUs: 20_000_000 },
  };
  // 2 s + 1 s + 0.5 s start; the inner group leaves 4.5 s after the child's start.
  assert.deepEqual(resolve(byId.child, byId), { startMs: 3500, durMs: 4500 });
});

test("a child starting after its group ends, an untimed element, and a missing model give no window", () => {
  const byId = {
    g: { type: "group", startUs: 0, durationUs: 1_000_000 },
    late: { parentId: "g", startUs: 2_000_000, durationUs: 1_000_000 },
    untimed: { type: "rect" },
  };
  assert.equal(resolve(byId.late, byId), null);
  assert.equal(resolve(byId.untimed, byId), null);
  assert.equal(resolve(null, byId), null);
});

test("an untimed child of a timed group inherits the group's window", () => {
  const byId = {
    g3: { type: "group", startUs: 2 * SCENE_US, durationUs: SCENE_US },
    child: { parentId: "g3" },
  };
  assert.deepEqual(resolve(byId.child, byId), { startMs: 20917, durMs: 10458 });
});
