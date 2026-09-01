-- Per-engine API keys pasted in the dashboard (ADR 0027):
-- { "anthropic_api": "sk-ant-…", "openai_api": "…" }. NULL, or a missing
-- entry, means the engine falls back to its .env variable — every existing
-- deployment keeps working with no backfill and no user action.
ALTER TABLE app_settings ADD COLUMN "aiKeys" JSONB;
