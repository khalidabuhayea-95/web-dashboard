import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTemplateBoostWhere,
  makeTemplateBoostPredicate,
  sortRowsBySnapshotOrder,
} from "./templateBoost.js";

const taxonomy = {
  categoryByValue: new Map([
    ["ramadan", { value: "ramadan", subCategories: [{ value: "greeting" }, { value: "eid" }] }],
    ["social", { value: "social", subCategories: [{ value: "post" }] }],
  ]),
};

test("buildTemplateBoostWhere returns null when nothing is boosted", () => {
  assert.equal(buildTemplateBoostWhere(null, taxonomy), null);
  assert.equal(buildTemplateBoostWhere({ templateIds: [], templateCategoryPairs: [] }, taxonomy), null);
  // A pair pointing at an unpublished / unknown category never promotes anything.
  assert.equal(
    buildTemplateBoostWhere({ templateIds: [], templateCategoryPairs: [{ category: "hidden" }] }, taxonomy),
    null
  );
  assert.equal(
    buildTemplateBoostWhere({ templateIds: [], templateCategoryPairs: [{ category: "ramadan", subCategory: "nope" }] }, taxonomy),
    null
  );
});

test("buildTemplateBoostWhere combines ids and category pairs under one OR", () => {
  const where = buildTemplateBoostWhere(
    { templateIds: ["a", "b"], templateCategoryPairs: [{ category: "ramadan", subCategory: "eid" }, { category: "social" }] },
    taxonomy
  );
  assert.ok(where && Array.isArray(where.OR));
  assert.deepEqual(where.OR[0], { id: { in: ["a", "b"] } });
  // ramadan/eid → scalar pair + jsonb arm; social → scalar + jsonb arm.
  assert.equal(where.OR.length, 5);
  assert.deepEqual(where.OR[1], { AND: [{ category: "ramadan" }, { subCategory: "eid" }] });
  assert.deepEqual(where.OR[2], { categories: { array_contains: [{ category: "ramadan", subCategory: "eid" }] } });
});

test("makeTemplateBoostPredicate mirrors the where fragment in memory", () => {
  assert.equal(makeTemplateBoostPredicate(null), null);
  const isBoosted = makeTemplateBoostPredicate({
    templateIds: ["a"],
    templateCategoryPairs: [{ category: "ramadan", subCategory: "eid" }, { category: "social" }],
  });
  assert.ok(isBoosted);
  assert.equal(isBoosted({ id: "a", category: "food", subCategory: "menu", categories: null }), true);
  assert.equal(isBoosted({ id: "x", category: "ramadan", subCategory: "eid", categories: null }), true);
  assert.equal(isBoosted({ id: "x", category: "ramadan", subCategory: "greeting", categories: null }), false);
  assert.equal(isBoosted({ id: "x", category: "social", subCategory: "post", categories: null }), true);
  assert.equal(
    isBoosted({ id: "x", category: "food", subCategory: "menu", categories: [{ category: "food", subCategory: "menu" }, { category: "ramadan", subCategory: "eid" }] }),
    true
  );
  assert.equal(isBoosted({ id: "x", category: "food", subCategory: "menu", categories: [] }), false);
});

test("sortRowsBySnapshotOrder follows the snapshot, unknown ids last", () => {
  const rows = [{ id: "c" }, { id: "a" }, { id: "zzz" }, { id: "b" }];
  assert.deepEqual(sortRowsBySnapshotOrder(rows, ["a", "b", "c"]).map((r) => r.id), ["a", "b", "c", "zzz"]);
  const single = [{ id: "a" }];
  assert.equal(sortRowsBySnapshotOrder(single, ["a"]), single);
});
