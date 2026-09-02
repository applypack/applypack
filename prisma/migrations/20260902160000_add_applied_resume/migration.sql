-- Stage C: remember the resume an application went out with.
--
-- Three columns, not one FK. "Upload a new version" replaces the bytes of the
-- SAME resume row and bumps resume."version", so an id on its own would name
-- "Senior Backend v3" and hand back v5's words. The version pins what was sent
-- and the text keeps it readable after the resume moves on — the same snapshot
-- pattern resume_match."resumeText" has used since phase 9.
--
-- No backfill is possible or wanted: postings applied to before this migration
-- were sent with a resume nobody recorded, so they stay NULL and render without
-- the line. ON DELETE SET NULL because deleting a resume must not delete the
-- application history that used it (same stance as profile."resumeId").

-- AlterTable
ALTER TABLE "job" ADD COLUMN     "appliedResumeId" INTEGER,
ADD COLUMN     "appliedResumeText" TEXT,
ADD COLUMN     "appliedResumeVersion" INTEGER;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_appliedResumeId_fkey" FOREIGN KEY ("appliedResumeId") REFERENCES "resume"("id") ON DELETE SET NULL ON UPDATE CASCADE;
