-- ADR 0025: user-defined work columns on the /applications board.
-- Additive: one nullable JSONB column; null keeps the built-in
-- screen/tech/onsite/offer list, so existing deployments change nothing.
ALTER TABLE "AppSettings" ADD COLUMN "pipelineStages" JSONB;
