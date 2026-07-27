-- Hot-path composite indexes for Template (PERF-B2).
-- Backs the mobile/editor list + browse queries that filter on
-- status/category/subCategory and order by updatedAt DESC. Without these,
-- Postgres filtered by the low-selectivity "status" index and then sorted all
-- matches in memory on every request.

-- CreateIndex
CREATE INDEX "Template_status_category_subCategory_updatedAt_idx" ON "Template"("status", "category", "subCategory", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Template_status_updatedAt_idx" ON "Template"("status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Template_ownerId_updatedAt_idx" ON "Template"("ownerId", "updatedAt" DESC);
