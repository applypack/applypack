-- The posting belongs to the screening: a snapshot taken from the Job at
-- creation, editable on the screening page, never written back.
ALTER TABLE "screening" ADD COLUMN "postingText" TEXT,
ADD COLUMN "postingUpdatedAt" TIMESTAMP(3);

UPDATE "screening" s SET "postingText" = j."description" FROM "job" j WHERE j."id" = s."jobId";

ALTER TABLE "screening" ALTER COLUMN "postingText" SET NOT NULL;
