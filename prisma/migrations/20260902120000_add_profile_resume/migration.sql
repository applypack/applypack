-- Stage A of the multi-resume search (docs/onboarding-plan.md §4): a profile
-- can name the resume it hunts with, so a job page preselects that resume
-- instead of guessing from skill overlap.
--
-- ON DELETE SET NULL, matching profile."telegramTargetId": a profile owns
-- regions, thresholds, priority rules and alert routing that no resume can
-- speak for, so deleting a resume must neither delete the search nor be
-- blocked by it. A cleared link falls back to the skill-overlap pick.
-- Existing rows start unlinked — that is exactly today's behaviour.
ALTER TABLE "profile" ADD COLUMN "resumeId" INTEGER;
ALTER TABLE "profile" ADD CONSTRAINT "profile_resumeId_fkey"
  FOREIGN KEY ("resumeId") REFERENCES "resume"("id") ON DELETE SET NULL ON UPDATE CASCADE;
