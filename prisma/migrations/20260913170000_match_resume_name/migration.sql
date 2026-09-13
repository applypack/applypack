-- The name of the file a comparison judged. The launchers' one hidden scratch
-- resume is renamed by every upload, so a one-off comparison has to keep the
-- name it was made under, the way it already keeps the text.
ALTER TABLE "resume_match" ADD COLUMN "resumeName" TEXT NOT NULL DEFAULT '';

-- Rows whose text is still their resume's text were made under its current
-- name. The rest keep '' and read as an earlier one-off file.
UPDATE "resume_match" m SET "resumeName" = r."name"
FROM "resume" r
WHERE r."id" = m."resumeId" AND m."resumeText" = r."text";
