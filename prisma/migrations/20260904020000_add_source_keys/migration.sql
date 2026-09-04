-- Stage 3e (ADR 0034): pasted credentials for the keyed job sources, one
-- JSON map like "aiKeys" (ADR 0027).
ALTER TABLE "app_settings" ADD COLUMN "sourceKeys" JSONB;
