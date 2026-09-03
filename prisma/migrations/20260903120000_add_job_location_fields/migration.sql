-- ADR 0031: the structured reading of Job.location. Additive only — the
-- string itself is never rewritten, every new column has a default, and a
-- revert strands no data. Existing rows read as "nothing recognised yet"
-- until backfill-locations.js fills them.
CREATE TYPE "Workplace" AS ENUM ('REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN');

ALTER TABLE "job" ADD COLUMN     "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "locationSource" TEXT,
ADD COLUMN     "regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "workplace" "Workplace" NOT NULL DEFAULT 'UNKNOWN';

-- The /jobs facets filter with `hasSome` (the && operator): GIN on the arrays.
CREATE INDEX "job_countries_idx" ON "job" USING GIN ("countries");
CREATE INDEX "job_regions_idx" ON "job" USING GIN ("regions");
CREATE INDEX "job_workplace_idx" ON "job"("workplace");
