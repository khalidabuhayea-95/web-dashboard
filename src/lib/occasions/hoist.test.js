import assert from "node:assert/strict";
import test from "node:test";

import { applyOccasionCategoryOrder, hoistToFront, stablePartition } from "./hoist.js";

test("hoistToFront is a no-op (same reference) without keys or matches", () => {
  const items = [{ value: "a" }, { value: "b" }];
  assert.equal(hoistToFront(items, [], (i) => i.value), items);
  assert.equal(hoistToFront(items, ["zzz"], (i) => i.value), items);
  const empty = [];
  assert.equal(hoistToFront(empty, ["a"]), empty);
});

test("hoistToFront keeps linked order in front and original order behind", () => {
  const items = ["social", "ramadan", "events", "national", "food"];
  assert.deepEqual(hoistToFront(items, ["national", "ramadan"]), ["national", "ramadan", "social", "events", "food"]);
  // Duplicate keys and unknown keys are harmless.
  assert.deepEqual(hoistToFront(items, ["food", "food", "nope"]), ["food", "social", "ramadan", "events", "national"]);
});

test("applyOccasionCategoryOrder hoists categories and sub-categories, untouched otherwise", () => {
  const categories = [
    { value: "social", subCategories: [{ value: "post" }, { value: "story" }] },
    { value: "ramadan", subCategories: [{ value: "greeting" }, { value: "iftar" }, { value: "eid" }] },
    { value: "events", subCategories: [{ value: "invitation" }] },
  ];

  assert.equal(applyOccasionCategoryOrder(categories, null), categories);
  assert.equal(applyOccasionCategoryOrder(categories, { hoistedTemplateCategoryPairs: [] }), categories);
  assert.equal(
    applyOccasionCategoryOrder(categories, { hoistedTemplateCategoryPairs: [{ category: "missing" }] }),
    categories
  );

  const result = applyOccasionCategoryOrder(categories, {
    hoistedTemplateCategoryPairs: [{ category: "ramadan", subCategory: "eid" }, { category: "events" }],
  });
  assert.deepEqual(result.map((c) => c.value), ["ramadan", "events", "social"]);
  assert.deepEqual(result[0].subCategories.map((s) => s.value), ["eid", "greeting", "iftar"]);
  // The input was not mutated.
  assert.deepEqual(categories.map((c) => c.value), ["social", "ramadan", "events"]);
  assert.deepEqual(categories[1].subCategories.map((s) => s.value), ["greeting", "iftar", "eid"]);
});

test("stablePartition keeps relative order on both sides", () => {
  const items = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(stablePartition(items, (n) => n % 2 === 0), [2, 4, 6, 1, 3, 5]);
  assert.equal(stablePartition(items, () => false), items);
});
