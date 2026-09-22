/**
 * ORDER BY clause for the raw-SQL element/background lists when an occasion boost is
 * active: linked rows first, rows in a linked category next, then today's recency order.
 * Returns today's clause verbatim when there is nothing to boost, so the SQL text (and the
 * bound parameter list) is unchanged for every caller that passes no boost.
 *
 * Arrays are bound through the caller's `nextParam` so `$n` numbering stays consistent
 * with the rest of the statement — call it AFTER any count query has already executed
 * with the shared params, or the count statement receives parameters it has no
 * placeholders for.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULT_ASSET_ORDER_BY = "ORDER BY updated_at DESC";

function uniq(list) {
  return Array.from(new Set(list));
}

/**
 * @param {{ ids?: string[], categoryKeys?: string[] } | null | undefined} boost
 * @param {(value: unknown) => string} nextParam
 */
export function buildAssetBoostOrderBy(boost, nextParam) {
  const ids = uniq(
    (Array.isArray(boost?.ids) ? boost.ids : []).map((id) => String(id || "").trim()).filter((id) => UUID_RE.test(id))
  );
  const categoryKeys = uniq(
    (Array.isArray(boost?.categoryKeys) ? boost.categoryKeys : [])
      .map((key) => String(key || "").trim().toLowerCase())
      .filter(Boolean)
  );
  if (ids.length === 0 && categoryKeys.length === 0) return DEFAULT_ASSET_ORDER_BY;

  const arms = [];
  if (ids.length > 0) arms.push(`WHEN id = ANY(${nextParam(ids)}::uuid[]) THEN 0`);
  if (categoryKeys.length > 0) arms.push(`WHEN category_value = ANY(${nextParam(categoryKeys)}::text[]) THEN 1`);
  return `ORDER BY CASE ${arms.join(" ")} ELSE 2 END, updated_at DESC`;
}
