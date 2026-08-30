-- AI engine chain (ADR 0014): ordered providers + per-provider models in one
-- JSON column. Backfills the single-provider columns from ADR 0013.
ALTER TABLE "AppSettings" ADD COLUMN "aiEngine" JSONB;

UPDATE "AppSettings"
SET "aiEngine" = jsonb_build_object(
  'order', jsonb_build_array("aiProvider"),
  'models', jsonb_build_object(
    "aiProvider", jsonb_build_object(
      'classifier', "aiModelClassifier",
      'resume', "aiModelResume"
    )
  )
)
WHERE "aiProvider" IS NOT NULL;

ALTER TABLE "AppSettings" DROP COLUMN "aiProvider";
ALTER TABLE "AppSettings" DROP COLUMN "aiModelClassifier";
ALTER TABLE "AppSettings" DROP COLUMN "aiModelResume";
