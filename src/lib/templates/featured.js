/**
 * Featured templates: the content team's hand-picked templates lead every mobile template
 * list. The order everywhere is featured (newest-featured first) → occasion-boosted → the
 * rest by recency — featured deliberately outranks the seasonal boost.
 *
 * The featured group is ordered by `featuredAt`, not `updatedAt`, so editing a featured
 * template never reshuffles it. The flag itself is only written by setTemplatesFeatured()
 * (featured.server.js), which never touches `updatedAt`.
 */
import { isUuid } from "@/lib/occasions/validate";
import { sortRowsBySnapshotOrder } from "@/lib/occasions/templateBoost";

/** Ids per setFeatured request — a page of the dashboard list is far below it. */
export const MAX_FEATURED_IDS_PER_REQUEST = 100;

/**
 * Prisma order for every mobile template list: featured first (newest-featured first),
 * then the usual recency order.
 * @type {import("@prisma/client").Prisma.TemplateOrderByWithRelationInput[]}
 */
export const FEATURED_FIRST_ORDER_BY = [
  { isFeatured: "desc" },
  { featuredAt: { sort: "desc", nulls: "last" } },
  { updatedAt: "desc" },
];

function timeOf(value) {
  const time = value instanceof Date ? value.getTime() : value ? Date.parse(String(value)) : NaN;
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function byTimeDesc(left, right) {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

/**
 * In-memory twin of FEATURED_FIRST_ORDER_BY for rows merged from more than one query:
 * featured rows first (newest-featured, then most recently updated), every other row after
 * them in its incoming order. Same reference when nothing is featured.
 * @template {{ isFeatured?: boolean | null, featuredAt?: Date | string | null, updatedAt?: Date | string | null }} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function sortFeaturedFirst(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const featured = [];
  const rest = [];
  for (const row of rows) (row?.isFeatured ? featured : rest).push(row);
  if (featured.length === 0) return rows;
  featured.sort(
    (left, right) =>
      byTimeDesc(timeOf(left.featuredAt), timeOf(right.featuredAt)) ||
      byTimeDesc(timeOf(left.updatedAt), timeOf(right.updatedAt))
  );
  return [...featured, ...rest];
}

/**
 * One home rail: featured rows (newest-featured first), then the occasion's boosted rows in
 * the occasion's own order, then the rest as the database returned them.
 *
 * `boosted` must be the rail's whole boosted set — trimming it to `take` by recency first
 * would drop templates the occasion lists earlier. `rest` excludes the boosted ids and
 * arrives in FEATURED_FIRST_ORDER_BY order, already limited to `take`.
 * @template {{ id: string, isFeatured?: boolean | null }} T
 * @param {{ boosted: T[], rest: T[], boostedIds: string[], take: number }} input
 * @returns {T[]}
 */
export function mergeRailRows({ boosted, rest, boostedIds, take }) {
  return sortFeaturedFirst([...sortRowsBySnapshotOrder(boosted, boostedIds), ...rest]).slice(0, take);
}

/**
 * Validates a dashboard `setFeatured` body: `{ ids: string[] }` (or a single `id`) plus a
 * real boolean `isFeatured` — the string "false" must not feature anything. Ids are trimmed,
 * lowercased and de-duplicated, and every one must be a UUID: a malformed id makes the
 * uuid cast throw.
 * @param {any} body
 * @returns {{ ok: true, ids: string[], isFeatured: boolean } | { ok: false, error: string }}
 */
export function parseSetFeaturedRequest(body) {
  if (typeof body?.isFeatured !== "boolean") {
    return { ok: false, error: "isFeatured must be true or false" };
  }
  const rawIds = Array.isArray(body?.ids) ? body.ids : body?.id !== undefined ? [body.id] : [];
  if (rawIds.length === 0) return { ok: false, error: "No template ids given" };
  if (!rawIds.every((id) => isUuid(id))) return { ok: false, error: "Every template id must be a UUID" };
  const ids = Array.from(new Set(rawIds.map((id) => id.trim().toLowerCase())));
  if (ids.length > MAX_FEATURED_IDS_PER_REQUEST) {
    return { ok: false, error: `At most ${MAX_FEATURED_IDS_PER_REQUEST} templates per request` };
  }
  return { ok: true, ids, isFeatured: body.isFeatured };
}
