-- First-run wizard flag (docs/onboarding-plan.md §2). NULL = show /welcome.
-- A settings row that exists at migration time belongs to a deployment
-- that was set up by hand already: backfill it so the wizard never
-- interrupts an existing install. A fresh install has no row yet.
ALTER TABLE app_settings ADD COLUMN "setupCompletedAt" TIMESTAMP(3);
UPDATE app_settings SET "setupCompletedAt" = NOW();
