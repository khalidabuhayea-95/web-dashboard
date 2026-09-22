import assert from "node:assert/strict";
import test from "node:test";

import { buildAssetBoostOrderBy, DEFAULT_ASSET_ORDER_BY } from "./assetBoostOrder.js";

function harness() {
  const params = [];
  const nextParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  return { params, nextParam };
}

test("no boost → today's clause, no parameters bound", () => {
  const { params, nextParam } = harness();
  assert.equal(buildAssetBoostOrderBy(undefined, nextParam), DEFAULT_ASSET_ORDER_BY);
  assert.equal(buildAssetBoostOrderBy({ ids: [], categoryKeys: [] }, nextParam), DEFAULT_ASSET_ORDER_BY);
  assert.equal(buildAssetBoostOrderBy({ ids: ["not-a-uuid"], categoryKeys: [" "] }, nextParam), DEFAULT_ASSET_ORDER_BY);
  assert.deepEqual(params, []);
});

test("ids and category keys bind as typed arrays after existing params", () => {
  const { params, nextParam } = harness();
  nextParam("freepik");
  const id = "0b7d8f0c-2c6e-4c2a-9b6e-3f4a5b6c7d8e";
  const clause = buildAssetBoostOrderBy({ ids: [id, id, "bad"], categoryKeys: ["Ramadan-Eid", "national-days"] }, nextParam);
  assert.equal(
    clause,
    "ORDER BY CASE WHEN id = ANY($2::uuid[]) THEN 0 WHEN category_value = ANY($3::text[]) THEN 1 ELSE 2 END, updated_at DESC"
  );
  assert.deepEqual(params, ["freepik", [id], ["ramadan-eid", "national-days"]]);
});

test("a single arm is emitted when only one side is boosted", () => {
  const { nextParam } = harness();
  assert.equal(
    buildAssetBoostOrderBy({ categoryKeys: ["islamic"] }, nextParam),
    "ORDER BY CASE WHEN category_value = ANY($1::text[]) THEN 1 ELSE 2 END, updated_at DESC"
  );
});
