-- F1 liveness ladder (ADR 0016): additive, nullable — no backfill needed.
ALTER TABLE "Job" ADD COLUMN "liveness" TEXT;
ALTER TABLE "Job" ADD COLUMN "livenessCode" TEXT;
ALTER TABLE "Job" ADD COLUMN "livenessCheckedAt" TIMESTAMP(3);
