-- Lightweight AI usage counters (docs/ai-engine-improvements.md item 6).
ALTER TABLE "AppSettings" ADD COLUMN "aiUsage" JSONB;
