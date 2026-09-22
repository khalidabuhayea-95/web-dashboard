/**
 * Page arithmetic for a list whose first `pinnedCount` virtual rows are the pinned
 * (boosted) rows and whose remainder is the ordinary query. Both halves are disjoint, so
 * the page at `skip` takes `pinnedTake` rows from the pinned list and `restTake` rows from
 * the remainder starting at `restSkip`. `total` never changes — pinning only reorders.
 *
 * pinnedCount = 7, take = 5:
 *   page 1 (skip 0)  → pinned [0, 5)            rest none
 *   page 2 (skip 5)  → pinned [5, 7)            rest [0, 3)
 *   page 3 (skip 10) → pinned none              rest [3, 8)
 *
 * @param {{ skip: number, take: number, pinnedCount: number }} input
 */
export function resolvePinnedWindow({ skip, take, pinnedCount }) {
  const safeSkip = Math.max(0, Math.floor(Number(skip) || 0));
  const safeTake = Math.max(0, Math.floor(Number(take) || 0));
  const safePinned = Math.max(0, Math.floor(Number(pinnedCount) || 0));

  const pinnedSkip = Math.min(safeSkip, safePinned);
  const pinnedTake = Math.max(0, Math.min(safeTake, safePinned - safeSkip));
  const restSkip = Math.max(0, safeSkip - safePinned);
  const restTake = safeTake - pinnedTake;

  return { pinnedSkip, pinnedTake, restSkip, restTake };
}
