-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "applicationTrackingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "staleApplicationsDigestEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "applicationNotes" TEXT,
ADD COLUMN     "appliedAt" TIMESTAMP(3),
ADD COLUMN     "pipelineStage" TEXT,
ADD COLUMN     "recruiterContact" TEXT;

-- CreateIndex
CREATE INDEX "Job_pipelineStage_appliedAt_idx" ON "Job"("pipelineStage", "appliedAt");

-- Backfill: existing APPLIED jobs get pipelineStage='applied' and an
-- approximate appliedAt so the new /applications kanban is not empty.
UPDATE "Job"
SET "pipelineStage" = 'applied',
    "appliedAt" = COALESCE("alertedAt", "fetchedAt")
WHERE status = 'APPLIED' AND "pipelineStage" IS NULL;
