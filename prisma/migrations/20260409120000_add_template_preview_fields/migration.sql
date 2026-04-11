ALTER TABLE "Template"
ADD COLUMN "previewVideoUrl" TEXT,
ADD COLUMN "previewPosterUrl" TEXT,
ADD COLUMN "previewStatus" TEXT,
ADD COLUMN "previewDurationMs" INTEGER,
ADD COLUMN "previewVersion" INTEGER,
ADD COLUMN "previewError" TEXT,
ADD COLUMN "previewUpdatedAt" TIMESTAMP(3);
