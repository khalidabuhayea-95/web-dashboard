-- Featured templates: the content team hand-picks templates that lead every mobile
-- template list (featured → occasion boost → recency, see src/lib/templates/featured.js).
-- `featuredAt` orders the featured group newest-first and is null exactly when the
-- template is not featured; the CHECK keeps the pair consistent for the ordering.
--
-- Hand-written for the same reason as the subscriptions migration: `prisma migrate
-- diff` against this database drags in pre-existing cutover drift.

-- AlterTable
ALTER TABLE "Template"
  ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "featuredAt" TIMESTAMP(3),
  ADD CONSTRAINT "Template_featured_consistent" CHECK ("isFeatured" = ("featuredAt" IS NOT NULL));
