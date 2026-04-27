# 0002 — Worker and web as separate processes

**Status:** Accepted (phase-2)

## Context

Phase 1 was just a worker (cron + fetchers + Telegram). Phase 2 added
the dashboard. Two ways to fit the dashboard in:

1. **Same process** — the worker also exposes an HTTP server on a
   separate port. One container, simpler ops, shared memory for caches.
2. **Two processes** — `app` runs only the cron worker, `web` runs only
   the HTTP server. Both share the database via Prisma.

## Decision

**Two processes.** Same Docker image, two `command:` entries in
`docker-compose.yml`. They share Postgres only.

## Consequences

✅ A bug in any web route can't crash the cron worker (and vice versa).
We've actually relied on this — when stage-1 of the two-stage
classifier was returning 404 from a deprecated model, the web
container's reclassify loop spammed errors but the worker's hourly
fetch kept running normally.
✅ `docker compose logs -f app` and `docker compose logs -f web` are
clearly separated. No interleaving.
✅ Either process can be restarted independently (e.g. after a UI-only
fix, just `docker compose up -d --build web`).
✅ The "worker MUST NOT open an HTTP port" rule is actually enforced by
the architecture, not just by convention.

❌ Cross-process triggers (manual "Run fetch now" from the dashboard)
need workarounds. We solved it by having the web process also have the
fetch / classify / discovery code available — it can run those itself
via `recordCronRun` + an async lock. The worker still owns the
scheduled cron entries; the web only runs them on demand.
❌ Any in-process state (caches, locks) doesn't help cross-process. We
have one in-process lock for `reclassifyInFlight` per process, which
is fine because user-initiated re-classify only happens in `web`.
❌ Two containers to update on a release. Negligible cost.

## Why not three (worker + web + db)?

We DO have three — Postgres is the third. The split here is about the
Node code. Adding a fourth (e.g. a queue worker) would buy us nothing
at our scale (single user, ~100 jobs/cron-tick).
