-- TASKS §16: when the search runs and when alerts arrive.
--
-- Both columns are nullable and stay NULL on every existing install: a NULL
-- schedule means the defaults in src/user-schedule.ts, which are exactly the
-- behaviour before this migration (hourly, around the clock, alerts sent the
-- moment a match is scored). Nothing changes until the user opens the card.
ALTER TABLE "app_settings" ADD COLUMN "schedule" JSONB;

-- Set when a match was scored outside the alert window and is waiting for the
-- next heartbeat inside it. The row stays NEW; its verdicts are already in
-- job_score. NULL for every row stored before this migration, which is the
-- truth: they were all sent, or dismissed, at the time.
ALTER TABLE "job" ADD COLUMN "alertHeldAt" TIMESTAMP(3);

-- Delivery asks for the held rows on every heartbeat and almost always finds
-- none; the index keeps that read off a full scan of the job table.
CREATE INDEX "job_alertHeldAt_idx" ON "job"("alertHeldAt");
