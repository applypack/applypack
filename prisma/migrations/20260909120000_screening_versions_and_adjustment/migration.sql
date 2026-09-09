-- Another document of a person already in the list is scored, not dropped:
-- the column that pointed at the earlier row keeps its meaning under a name
-- that says so, and rows marked duplicate for that reason become readable.
ALTER TABLE "applicant" RENAME COLUMN "duplicateOfId" TO "sameAsId";
ALTER TABLE "applicant" ADD COLUMN "scoreAdjustment" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "adjustmentNote" TEXT;

UPDATE "applicant" a
SET "parseStatus" = 'ok', "parseNote" = NULL
WHERE a."parseStatus" = 'duplicate'
  AND length(a."text") > 0
  AND NOT EXISTS (
    SELECT 1 FROM "applicant" b
    WHERE b."screeningId" = a."screeningId" AND b."id" < a."id" AND b."textHash" = a."textHash"
  );
