-- F3 (ADR 0018): content fingerprint + cross-listing annotation.
-- Additive only: both columns are nullable, so existing rows stay valid and
-- a revert strands no data.
ALTER TABLE "Job" ADD COLUMN "descriptionSimhash" BIGINT;
ALTER TABLE "Job" ADD COLUMN "crossListedOfJobId" INTEGER;

-- ON DELETE SET NULL: deleting the original must not cascade into the
-- duplicate — the annotation is a hint, not ownership.
ALTER TABLE "Job" ADD CONSTRAINT "Job_crossListedOfJobId_fkey"
  FOREIGN KEY ("crossListedOfJobId") REFERENCES "Job"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The dedup scan reads fingerprints from the last 90 days.
CREATE INDEX "Job_fetchedAt_descriptionSimhash_idx"
  ON "Job"("fetchedAt", "descriptionSimhash");
