import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_FEATURED_IDS_PER_REQUEST,
  mergeRailRows,
  parseSetFeaturedRequest,
  sortFeaturedFirst,
} from "./featured.js";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = (rows) => rows.map((row) => row.id);

test("sortFeaturedFirst returns the same array when nothing is featured", () => {
  const rows = [{ id: "a" }, { id: "b", isFeatured: false }];
  assert.equal(sortFeaturedFirst(rows), rows);
  const empty = [];
  assert.equal(sortFeaturedFirst(empty), empty);
});

test("sortFeaturedFirst leads with featured rows, newest-featured first, and keeps the rest in order", () => {
  const rows = [
    { id: "r1", updatedAt: "2026-09-20T00:00:00Z" },
    { id: "f-old", isFeatured: true, featuredAt: new Date("2026-01-01T00:00:00Z"), updatedAt: "2026-09-22T00:00:00Z" },
    { id: "r2", updatedAt: "2026-09-21T00:00:00Z" },
    { id: "f-new", isFeatured: true, featuredAt: "2026-09-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z" },
  ];
  // r1 before r2 although r2 is newer: non-featured rows keep their incoming order.
  assert.deepEqual(ids(sortFeaturedFirst(rows)), ["f-new", "f-old", "r1", "r2"]);
});

test("sortFeaturedFirst breaks featuredAt ties by recency and sorts a missing featuredAt last", () => {
  const same = "2026-09-01T00:00:00Z";
  const rows = [
    { id: "no-date", isFeatured: true, featuredAt: null, updatedAt: "2026-09-23T00:00:00Z" },
    { id: "tie-older", isFeatured: true, featuredAt: same, updatedAt: "2026-01-01T00:00:00Z" },
    { id: "tie-newer", isFeatured: true, featuredAt: same, updatedAt: "2026-02-01T00:00:00Z" },
  ];
  assert.deepEqual(ids(sortFeaturedFirst(rows)), ["tie-newer", "tie-older", "no-date"]);
});

test("parseSetFeaturedRequest demands a real boolean", () => {
  for (const isFeatured of ["false", "true", 1, 0, null, undefined]) {
    assert.equal(parseSetFeaturedRequest({ ids: [uuid(1)], isFeatured }).ok, false, String(isFeatured));
  }
});

test("parseSetFeaturedRequest accepts one id or a batch, normalized and de-duplicated", () => {
  assert.deepEqual(parseSetFeaturedRequest({ id: uuid(1), isFeatured: true }), {
    ok: true,
    ids: [uuid(1)],
    isFeatured: true,
  });
  assert.deepEqual(
    parseSetFeaturedRequest({ ids: [` ${uuid(2).toUpperCase()} `, uuid(2), uuid(3)], isFeatured: false }),
    { ok: true, ids: [uuid(2), uuid(3)], isFeatured: false }
  );
});

test("parseSetFeaturedRequest rejects missing, malformed and oversized id lists", () => {
  assert.equal(parseSetFeaturedRequest({ isFeatured: true }).ok, false);
  assert.equal(parseSetFeaturedRequest({ ids: [], isFeatured: true }).ok, false);
  assert.equal(parseSetFeaturedRequest({ id: "", isFeatured: true }).ok, false);
  assert.equal(parseSetFeaturedRequest({ ids: [uuid(1), "nope"], isFeatured: true }).ok, false);
  assert.equal(parseSetFeaturedRequest({ ids: [uuid(1), 42], isFeatured: true }).ok, false);
  const tooMany = Array.from({ length: MAX_FEATURED_IDS_PER_REQUEST + 1 }, (_, index) => uuid(index + 1));
  assert.equal(parseSetFeaturedRequest({ ids: tooMany, isFeatured: true }).ok, false);
  assert.equal(parseSetFeaturedRequest({ ids: tooMany.slice(1), isFeatured: true }).ok, true);
});

test("mergeRailRows: featured beat the occasion, which beats recency", () => {
  const at = (day) => new Date(Date.UTC(2026, 8, day));
  const boosted = [
    { id: "b1", updatedAt: at(3) },
    { id: "b2", isFeatured: true, featuredAt: at(10), updatedAt: at(1) },
    { id: "b3", updatedAt: at(2) },
  ];
  const rest = [
    { id: "r-f", isFeatured: true, featuredAt: at(12), updatedAt: at(1) },
    { id: "r1", updatedAt: at(9) },
    { id: "r2", updatedAt: at(8) },
  ];
  // b3 before b1: boosted rows follow the occasion's link order, not recency.
  assert.deepEqual(ids(mergeRailRows({ boosted, rest, boostedIds: ["b3", "b1", "b2"], take: 4 })), [
    "r-f",
    "b2",
    "b3",
    "b1",
  ]);
});

// Deterministic PRNG so a failure reproduces.
function mulberry32(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, random) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

// What FEATURED_FIRST_ORDER_BY does in SQL.
function sqlFeaturedFirst(rows) {
  return [...rows].sort((left, right) => {
    if (Boolean(left.isFeatured) !== Boolean(right.isFeatured)) return left.isFeatured ? -1 : 1;
    const leftAt = left.featuredAt ? left.featuredAt.getTime() : null;
    const rightAt = right.featuredAt ? right.featuredAt.getTime() : null;
    if (leftAt !== rightAt) {
      if (leftAt === null) return 1;
      if (rightAt === null) return -1;
      return rightAt - leftAt;
    }
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  });
}

test("mergeRailRows matches the brute-force rail order, including more boosted ids than fit", () => {
  const random = mulberry32(20260923);
  let overflowCases = 0;

  for (let round = 0; round < 3000; round += 1) {
    const size = 1 + Math.floor(random() * 30);
    const times = shuffle(
      Array.from({ length: size * 2 }, (_, index) => index),
      random
    );
    const rows = Array.from({ length: size }, (_, index) => {
      const isFeatured = random() < 0.3;
      return {
        id: `t${index}`,
        isFeatured,
        featuredAt: isFeatured ? new Date(Date.UTC(2026, 0, 1) + times[index] * 1000) : null,
        updatedAt: new Date(Date.UTC(2020, 0, 1) + times[size + index] * 1000),
      };
    });
    const linked = rows.filter(() => random() < 0.4).map((row) => row.id);
    // Linked ids whose template the rail's `where` filters out (a draft, another rail).
    const boostedIds = shuffle([...linked, ...(random() < 0.5 ? ["ghost-1", "ghost-2"] : [])], random);
    const boostedSet = new Set(boostedIds);
    const take = 1 + Math.floor(random() * 12);
    if (linked.length > take) overflowCases += 1;

    // The two queries fetchRailTemplates runs: boosted rows in no particular order, the
    // rest in SQL order limited to `take`.
    const boosted = shuffle(rows.filter((row) => boostedSet.has(row.id)), random);
    const rest = sqlFeaturedFirst(rows.filter((row) => !boostedSet.has(row.id))).slice(0, take);

    const byId = new Map(rows.map((row) => [row.id, row]));
    const ideal = [
      ...sqlFeaturedFirst(rows.filter((row) => row.isFeatured)),
      ...boostedIds.map((id) => byId.get(id)).filter((row) => row && !row.isFeatured),
      ...sqlFeaturedFirst(rows.filter((row) => !row.isFeatured && !boostedSet.has(row.id))),
    ].slice(0, take);

    assert.deepEqual(
      ids(mergeRailRows({ boosted, rest, boostedIds, take })),
      ids(ideal),
      `round ${round}: size ${size}, take ${take}, boosted ${boostedIds.join(",")}`
    );
  }

  assert.ok(overflowCases > 100, `only ${overflowCases} rounds had more boosted rows than fit`);
});
