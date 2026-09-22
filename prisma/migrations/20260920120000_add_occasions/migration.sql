-- Occasions calendar: the Arabic/Islamic occasions the content team plans around
-- (Eid, Ramadan, National Days…) and the templates / elements / backgrounds / AI
-- templates linked to each one. The dashboard reminds the team while an occasion
-- is inside its lead window, and the mobile catalog routes surface linked content
-- first while the boost window is active (src/lib/occasions/boost.server.ts).
--
-- Hand-written for the same reason as the subscriptions migration: `prisma migrate
-- diff` against this database drags in pre-existing cutover drift.

-- CreateTable
CREATE TABLE "Occasion" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'islamic',
    "calendar" TEXT NOT NULL DEFAULT 'gregorian',
    "month" INTEGER NOT NULL,
    "day" INTEGER,
    "weekday" INTEGER,
    "weekOrdinal" INTEGER,
    "durationDays" INTEGER NOT NULL DEFAULT 1,
    "reminderLeadDays" INTEGER NOT NULL DEFAULT 30,
    "boostLeadDays" INTEGER NOT NULL DEFAULT 14,
    "countries" JSONB NOT NULL DEFAULT '[]',
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "dateOverrides" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT NOT NULL DEFAULT '',
    "emoji" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "boostEnabled" BOOLEAN NOT NULL DEFAULT true,
    "hoistCategories" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Occasion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OccasionItem" (
    "id" UUID NOT NULL,
    "occasionId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OccasionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Occasion_slug_key" ON "Occasion"("slug");

-- CreateIndex
CREATE INDEX "Occasion_enabled_calendar_month_idx" ON "Occasion"("enabled", "calendar", "month");

-- CreateIndex
CREATE UNIQUE INDEX "OccasionItem_occasionId_kind_itemId_key" ON "OccasionItem"("occasionId", "kind", "itemId");

-- CreateIndex
CREATE INDEX "OccasionItem_kind_itemId_idx" ON "OccasionItem"("kind", "itemId");

-- AddForeignKey
ALTER TABLE "OccasionItem" ADD CONSTRAINT "OccasionItem_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
