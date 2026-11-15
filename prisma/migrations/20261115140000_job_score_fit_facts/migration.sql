-- ADR 0064: the facts each search's fit is computed from, so a weight change
-- or an edited search re-scores without a model call. Rows scored before the
-- classifier reported facts stay NULL until they are classified again.
ALTER TABLE "job_score" ADD COLUMN "fitFacts" JSONB;
