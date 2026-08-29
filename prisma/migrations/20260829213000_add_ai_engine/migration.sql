-- AI engine override (ADR 0013). NULL = follow .env defaults.
ALTER TABLE "AppSettings" ADD COLUMN "aiProvider" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "aiModelClassifier" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "aiModelResume" TEXT;
