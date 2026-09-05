-- #162 stage 3 (ADR 0043): a posting refreshed from the company's own listing.
--
-- The verifier records the company's own listing URL when its careers-page
-- check finds one; "Refresh the description" reads that page and, on the
-- user's confirmation, replaces the stored text with it. The text the job was
-- stored with is kept next to it and the swap is dated, so "Restore the
-- original" can undo it and the page can say which text a verdict judged.
-- Nullable, no backfill: NULL means never refreshed.
ALTER TABLE "job_verification" ADD COLUMN "postingUrl" TEXT;
ALTER TABLE "job" ADD COLUMN "descriptionOriginal" TEXT, ADD COLUMN "descriptionRefreshedAt" TIMESTAMP(3);
