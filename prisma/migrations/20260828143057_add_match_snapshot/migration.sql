-- AlterTable
ALTER TABLE "ResumeMatch" ADD COLUMN     "draft" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resumeText" TEXT NOT NULL DEFAULT '';

-- Existing matches judged the resume's text at the time; its current text is the closest we have.
UPDATE "ResumeMatch" m SET "resumeText" = r."text" FROM "Resume" r WHERE r."id" = m."resumeId";
