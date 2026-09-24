import prisma from "@/lib/prisma";
import { preserveTemplateUpdatedAt } from "@/lib/templates/featured.server";

/**
 * Sets a template's Pro flag and returns the row read back with `select`.
 *
 * Pricing is not an edit, so `updatedAt` must not move: a bump makes the mobile API treat the
 * template's ready preview as stale and drop the video (isTemplatePreviewStale in
 * mobileProject.js), moves the template to the top of every newest-first list and changes its
 * thumbnail cache token. Hence raw SQL that never mentions `updatedAt` (Prisma's update always
 * sends `@updatedAt`) inside a transaction that opts out of the table's updatedAt trigger — the
 * same approach as setTemplatesFeatured.
 *
 * @param {string} id template UUID; the caller has already loaded the row
 * @param {boolean} isPremium
 * @param {Record<string, boolean>} select Prisma select for the returned row
 */
export async function setTemplatePremium(id, isPremium, select) {
  const [, , template] = await prisma.$transaction([
    preserveTemplateUpdatedAt(),
    prisma.$executeRaw`UPDATE "Template" SET "isPremium" = ${Boolean(isPremium)}::boolean WHERE "id" = ${id}::uuid`,
    prisma.template.findUnique({ where: { id }, select }),
  ]);
  return template;
}
