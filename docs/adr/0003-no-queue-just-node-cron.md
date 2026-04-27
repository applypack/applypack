# 0003 — No job queue; node-cron is enough

**Status:** Accepted (phase-1, reaffirmed phase-3)

## Context

Cron-style "do thing every hour" is normally the moment people reach
for BullMQ / Sidekiq / Temporal. The temptation gets louder as we add
more jobs (we now have 6: fetch, digest, cleanup, stale-applications,
discovery, hn-hiring) plus on-demand jobs (reclassify, hn-run, manual
discovery probe).

Alternatives considered:

- **BullMQ + Redis** — standard Node queue. Retries, delays, priority,
  dashboard.
- **pg-boss** — Postgres-backed queue (no Redis, but adds tables and
  polling).
- **Inline `node-cron`** — what Phase 1 did.

## Decision

Stay with `node-cron` (`cron.schedule(expr, fn, { timezone })`) plus
our own `recordCronRun(name, fn)` wrapper that writes a row to the
`CronRun` table on start/finish. On-demand triggers from the web run
the same job functions inside an in-process async-void block with a
boolean lock.

## Consequences

✅ Zero new infrastructure. Postgres is already there for everything.
The `CronRun` table gives us run history visible in `/runs` — the
operational equivalent of a queue dashboard.
✅ Idempotency comes from the database (`@@unique([companyId,
externalId])`, deterministic candidate keys). We don't need queue
deduplication.
✅ Retries are per-API: `fetchWithRetry` does HTTP retries; classifier
has its own 1-retry-on-rate-limit logic; alert delivery is per-target.
None of this needs queue semantics.

❌ If a cron tick takes longer than the next interval (we cap fetch at
~2 minutes; cron is hourly), we might overlap. We mitigate with a
`shuttingDown` guard plus the in-flight counter in `src/index.ts`. Two
concurrent fetches would both write through the unique constraint, so
nothing corrupts — just wasted API calls.
❌ "Start running this in 4 hours" delayed jobs aren't possible. We
don't have any. If we ever need them, revisit pg-boss.
❌ No priority queue. Not needed at our scale.

## When to revisit

If we hit any of:
- > 1 cron tick takes >5 minutes regularly
- A real need for delayed jobs (e.g. "follow up in 7 days")
- Multi-user mode where each user gets their own cron schedule

…then pg-boss is the natural next step (it stays in Postgres).
