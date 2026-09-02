-- ADR 0028: several searches run at once, and one classifier call per posting
-- returns a verdict per search. Two structural changes and one data move.
--
-- 1. profile."active" — the new switch. AppSettings."activeProfileId" stays as
--    the PRIMARY (defaults, preselects, the /settings landing tab).
-- 2. job_score — one row per (posting, search). job."fitScore" and its
--    neighbours keep the best-of, so everything written against job renders
--    unchanged; the profile that produced a score is named here.
-- 3. The backfill. 986 of 989 stored postings are already scored against the
--    profile that was active when they were scored. Leaving them behind would
--    empty every per-search view on day one, so each scored posting is copied
--    into job_score against the current primary — the profile those scores
--    actually came from.

-- AlterTable
ALTER TABLE "profile" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "job_score" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "profileId" INTEGER NOT NULL,
    "fitScore" INTEGER NOT NULL,
    "locationMatch" BOOLEAN NOT NULL,
    "techMatch" TEXT[],
    "redFlags" TEXT[],
    "summary" TEXT,
    "priorityRulesApplied" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_score_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_score_profileId_fitScore_idx" ON "job_score"("profileId", "fitScore");

-- CreateIndex
CREATE UNIQUE INDEX "job_score_jobId_profileId_key" ON "job_score"("jobId", "profileId");

-- CreateIndex
CREATE INDEX "profile_active_idx" ON "profile"("active");

-- AddForeignKey
ALTER TABLE "job_score" ADD CONSTRAINT "job_score_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_score" ADD CONSTRAINT "job_score_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The primary profile keeps running: it was the only active one until now, and
-- a deployment whose searches are all switched off silently stops scoring.
UPDATE "profile" SET "active" = true
WHERE "id" = (SELECT "activeProfileId" FROM "app_settings" WHERE "id" = 1);

-- Backfill: every already-scored posting becomes that profile's JobScore.
-- "locationMatch" is not stored on job — a scored row that was not dismissed
-- for location passed the check, so true is the honest reconstruction, and it
-- only ever feeds a re-render, never a new alert.
INSERT INTO "job_score" (
  "jobId", "profileId", "fitScore", "locationMatch",
  "techMatch", "redFlags", "summary", "priorityRulesApplied", "scoredAt"
)
SELECT
  j."id",
  s."activeProfileId",
  j."fitScore",
  j."status" <> 'DISMISSED',
  j."techMatch",
  j."redFlags",
  j."summary",
  j."priorityRulesApplied",
  j."fetchedAt"
FROM "job" j
CROSS JOIN "app_settings" s
WHERE s."id" = 1
  AND s."activeProfileId" IS NOT NULL
  AND j."fitScore" IS NOT NULL
ON CONFLICT ("jobId", "profileId") DO NOTHING;
