import assert from "node:assert/strict";
import test from "node:test";

import { resolvePinnedWindow } from "./pinnedPagination.js";

test("resolvePinnedWindow walks pinned rows first, then the remainder", () => {
  assert.deepEqual(resolvePinnedWindow({ skip: 0, take: 5, pinnedCount: 7 }), {
    pinnedSkip: 0, pinnedTake: 5, restSkip: 0, restTake: 0,
  });
  assert.deepEqual(resolvePinnedWindow({ skip: 5, take: 5, pinnedCount: 7 }), {
    pinnedSkip: 5, pinnedTake: 2, restSkip: 0, restTake: 3,
  });
  assert.deepEqual(resolvePinnedWindow({ skip: 10, take: 5, pinnedCount: 7 }), {
    pinnedSkip: 7, pinnedTake: 0, restSkip: 3, restTake: 5,
  });
});

test("resolvePinnedWindow degrades to plain paging without pinned rows", () => {
  assert.deepEqual(resolvePinnedWindow({ skip: 20, take: 10, pinnedCount: 0 }), {
    pinnedSkip: 0, pinnedTake: 0, restSkip: 20, restTake: 10,
  });
  assert.deepEqual(resolvePinnedWindow({ skip: 0, take: 3, pinnedCount: 3 }), {
    pinnedSkip: 0, pinnedTake: 3, restSkip: 0, restTake: 0,
  });
});
