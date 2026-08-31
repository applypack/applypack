-- F4 (ADR 0019): per-source health — status vocabulary + failure streak.
-- Additive only: every column is nullable or defaulted, so existing rows
-- stay valid and a revert strands no data.
ALTER TABLE "Company" ADD COLUMN "lastFetchStatus" TEXT;
ALTER TABLE "Company" ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Company" ADD COLUMN "lastOkAt" TIMESTAMP(3);

-- Digest line for sources that crossed the streak threshold (ADR 0019).
-- Default TRUE: the alert adds a signal, it never suppresses a job.
ALTER TABLE "AppSettings" ADD COLUMN "sourceHealthAlerts" BOOLEAN NOT NULL DEFAULT true;
