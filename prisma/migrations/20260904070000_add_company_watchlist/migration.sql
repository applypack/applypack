-- TASKS §17 stage A: the company watchlist (ADR 0036).
--
-- No new table: a watched company is a Company row with four more columns.
-- Every default reproduces today's behaviour exactly, so an existing install
-- sees no change until the user adds a company through the new form.

-- A generic RSS/Atom job feed. atsToken is the feed URL; the vendor-shaped
-- types are preferred whenever one of them resolves, so this is the rung
-- below them, never a replacement for one.
ALTER TYPE "AtsType" ADD VALUE 'FEED';

-- ★ on /jobs and its own section on /companies. False for every seeded and
-- previously added row: nothing the user did not choose becomes watched.
ALTER TABLE "company" ADD COLUMN "watched" BOOLEAN NOT NULL DEFAULT false;

-- hour | day | week. 'hour' is what every source did before this migration —
-- one attempt per heartbeat — so the default changes nothing.
ALTER TABLE "company" ADD COLUMN "checkEvery" TEXT NOT NULL DEFAULT 'hour';

-- When the row is next due. NULL means due now, which is what a fresh row and
-- a "Check now" both mean, and what every existing row is on the tick after
-- this migration. Written after every attempt, failures included: a board
-- that throws must wait its interval like a healthy one, or a broken feed is
-- retried every heartbeat while a working one waits an hour.
ALTER TABLE "company" ADD COLUMN "nextCheckAt" TIMESTAMP(3);

-- matches | all. 'all' keeps and alerts every posting the company puts up,
-- whatever the base filter and the fit threshold say. 'matches' is the
-- pipeline as it stands, and is the default for every existing row.
ALTER TABLE "company" ADD COLUMN "alertPolicy" TEXT NOT NULL DEFAULT 'matches';

-- The tick's selection is (active, due) on every heartbeat; the index keeps
-- that off a scan as the tracked-company list grows.
CREATE INDEX "company_active_nextCheckAt_idx" ON "company"("active", "nextCheckAt");
