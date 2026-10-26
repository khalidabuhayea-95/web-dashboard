import assert from "node:assert/strict";
import test from "node:test";

import { clearSearchTranslationCache, planSearchQuery } from "./searchTranslate.server.js";

const variants = (plan, kind) => plan.concepts.flatMap((concept) => concept.variants.filter((v) => v.kind === kind).map((v) => v.terms.join(" ")));

test("unbridged words are translated once, cached, and become variants", async () => {
  clearSearchTranslationCache();
  const calls = [];
  const translator = async (text, options) => {
    calls.push([text, options.to]);
    return { غزال: "Gazelle", giraffe: "زرافة" }[text] || text;
  };
  const plan = await planSearchQuery("غزال زفاف", { translator });
  assert.deepEqual(calls, [["غزال", "en"]], "«زفاف» is bridged by a synonym and never sent");
  assert.ok(variants(plan, "translation").includes("gazelle"));
  await planSearchQuery("غزال", { translator });
  assert.equal(calls.length, 1, "the second search hits the cache");
  const english = await planSearchQuery("giraffe", { translator });
  assert.ok(variants(english, "translation").includes("زرافه"), "folded like every other variant");
});

test("a slow or failing translator never blocks the search", async () => {
  clearSearchTranslationCache();
  const slow = () => new Promise((resolve) => setTimeout(() => resolve("late"), 500));
  const started = Date.now();
  const plan = await planSearchQuery("غزال", { translator: slow, budgetMs: 50 });
  assert.ok(Date.now() - started < 300);
  assert.deepEqual(variants(plan, "translation"), []);
  clearSearchTranslationCache();
  const failing = await planSearchQuery("غزال", { translator: async () => { throw new Error("429"); } });
  assert.deepEqual(variants(failing, "translation"), []);
  const skipped = await planSearchQuery("غزال", { translate: false, translator: async () => assert.fail("not called") });
  assert.equal(skipped.concepts.length, 1);
});
