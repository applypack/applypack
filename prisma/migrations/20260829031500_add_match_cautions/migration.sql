-- Scoring v3: soft concerns live in cautions (displayed, never scored) so the
-- model stops stuffing them into redFlags where each costs 10 points.
ALTER TABLE "ResumeMatch" ADD COLUMN "cautions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
