-- CreateTable
CREATE TABLE "Template" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Template_ownerId_idx" ON "Template"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_ownerId_name_key" ON "Template"("ownerId", "name");
