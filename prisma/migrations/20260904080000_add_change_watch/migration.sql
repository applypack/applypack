-- TASKS §17 stage C: the change watch (ADR 0036).
--
-- The last rung of the watchlist ladder, for a careers page that publishes
-- nothing a machine can read. It never produces a Job: it hashes the page's
-- text and reports that the page changed, which is what a person checking
-- daily actually does. Measured 2026-09-04 (docs/company-watchlist.md): over
-- three fetches of ten careers pages ninety seconds apart, raw HTML changed
-- on 4 of 10 while stripHtml changed on none, and masking digits would have
-- erased the one useful signal those pages carry ("92 positions").

-- atsToken is the careers page URL.
ALTER TYPE "AtsType" ADD VALUE 'CAREER_PAGE';

-- The page text's hash as we last REPORTED it — not as we last saw it. It
-- advances only when an alert is actually sent, so a change noticed inside
-- the once-a-day window waits for the next one instead of being swallowed.
ALTER TABLE "company" ADD COLUMN "lastContentHash" TEXT;

-- When we last said "this page changed". NULL means never: the first fetch of
-- a page stores its hash and says nothing, because there is no change yet.
ALTER TABLE "company" ADD COLUMN "lastContentAlertAt" TIMESTAMP(3);
