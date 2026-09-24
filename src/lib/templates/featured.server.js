import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

/**
 * Leading statement for a batch `$transaction` whose Template updates must keep `updatedAt`
 * as the statement wrote it. The table's BEFORE UPDATE trigger (set_template_updated_at)
 * otherwise stamps now() on every update, whatever Prisma sends. Transaction-scoped, so a
 * pooled connection never carries it past the commit.
 */
export function preserveTemplateUpdatedAt() {
  return prisma.$queryRaw`SELECT set_config('nayroz.preserve_updated_at', 'on', true)`;
}

/**
 * Features (or unfeatures) templates in one statement and returns the rows it changed —
 * the only writer of `Template.isFeatured` / `featuredAt`.
 *
 * Featuring is curation, not an edit, so `updatedAt` must not move: a bump would hide the
 * template's ready preview video from the app (isTemplatePreviewStale in mobileProject.js),
 * change its thumbnail cache token and move it in every newest-first list. Hence raw SQL that
 * never mentions `updatedAt` (Prisma stamps `@updatedAt` on every update) inside a transaction
 * that opts out of the table trigger. Reading rows and writing their old `updatedAt` back
 * instead would undo a designer's save that lands in between. Re-featuring keeps the original
 * `featuredAt`, so repeating a request is harmless.
 *
 * @param {string[]} ids UUIDs, already validated by parseSetFeaturedRequest
 * @param {boolean} isFeatured
 * @returns {Promise<Array<{ id: string, isFeatured: boolean, featuredAt: Date | null }>>}
 */
export async function setTemplatesFeatured(ids, isFeatured) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const flag = Boolean(isFeatured);
  const [, rows] = await prisma.$transaction([
    preserveTemplateUpdatedAt(),
    prisma.$queryRaw`
      UPDATE "Template"
      SET "isFeatured" = ${flag}::boolean,
          "featuredAt" = CASE WHEN ${flag}::boolean
                              THEN COALESCE("featuredAt", now() AT TIME ZONE 'UTC')
                              ELSE NULL END
      WHERE "id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      RETURNING "id"::text AS "id", "isFeatured", "featuredAt"`,
  ]);
  return rows;
}
