-- F5 (ADR 0024): append-only funnel ledger. Additive: a new table plus a
-- backfill snapshot — one source=backfill event per job that already has
-- a pipelineStage, dated appliedAt when known (the stats module keeps
-- backfill rows out of day-math, so a reconstructed date cannot poison
-- velocity medians).
CREATE TABLE "JobStageEvent" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT,
    "occurredOn" DATE NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "JobStageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobStageEvent_jobId_recordedAt_idx" ON "JobStageEvent"("jobId", "recordedAt");

ALTER TABLE "JobStageEvent" ADD CONSTRAINT "JobStageEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "JobStageEvent" ("jobId", "fromStage", "toStage", "occurredOn", "source")
SELECT "id", NULL, "pipelineStage", COALESCE("appliedAt"::date, CURRENT_DATE), 'backfill'
FROM "Job"
WHERE "pipelineStage" IS NOT NULL;
