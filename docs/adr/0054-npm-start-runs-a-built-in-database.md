# 0054 — `npm start` runs ApplyPack with a built-in Postgres; Docker is the server option

**Status:** accepted (2026-09-16) — owner decision, plan [docs/local-install-plan.md](../local-install-plan.md), TASKS §21

## Context

The only first-class install was `docker compose up -d`. Most people who
would use ApplyPack do not run Docker, and many do not know what it is; the
"Running without Docker" block still started Postgres from compose and
needed five commands and two terminals. Measured before deciding:

- The obstacle is Postgres, not Docker. PGlite blocked a second connection
  for as long as the first held a transaction; SQLite would have been a
  rewrite (53 schema errors, 14 raw SQL sites) and cannot fold Cyrillic
  case; installing Postgres by hand is more steps than Docker.
- `embedded-postgres@16.14.0-beta.17` carries PostgreSQL 16 binaries per
  platform (23–51 MB download). From a fresh copy, `/welcome` answered
  1.8 s after a cold start and 0.8 s warm; the route smoke passed against it.
- Three traps, each reproduced: initdb without a locale makes `SQL_ASCII`,
  where `'Київ' ILIKE '%КИЇВ%'` is false; a hard-killed parent leaves the
  server running and the next start fails with no message; npm announces
  it will stop running the package's symlink script, without which Postgres
  cannot load its libraries.

## Decision

- **`npm install && npm start` is the default install; Node.js 22+ is the
  only prerequisite.** `src/local/launcher.ts` takes a lock in the data
  folder, starts the database, forks the worker, waits for its "ready",
  forks the dashboard, and stops them in reverse. The two processes stay
  separate (ADR 0002); a crash restarts the process with a backoff.
- **The database runs under `pg_ctl`, in its own session**, so Ctrl+C
  reaches the launcher first. initdb gets `UTF8` and `C.UTF-8` (ICU on
  Windows); `postgresql.conf` gets loopback-only, no Unix socket, UTC.
  The app uses initdb's `postgres` database. A leftover `postmaster.pid`
  is stopped only when its PID is a postgres serving this folder, and is
  removed otherwise. The library symlinks are recreated before every start.
- **Data lives in the OS app-data folder** (`APPLYPACK_DATA_DIR` moves
  it), so a fresh clone or ZIP finds it. `db.json` (mode 0600) holds the
  port and a random password — a third secrets carve-out beside ADR 0027
  and 0041: it guards a loopback database whose files sit in the same
  folder. `config.ts` fills an empty `DATABASE_URL` from it.
- **`DATABASE_URL` set → no built-in database.** Docker is unchanged:
  compose sets its own URL and runs the two commands; the image deletes the
  binaries.

## Consequences

✅ No Docker, no Postgres install, no `.env` for a first run; the logged-in
AI CLIs work as they are; one CI job proves it on Linux, macOS and Windows.
❌ A dependency tagged `-beta` with one main maintainer (the launcher uses
only its binaries); no `pg_dump` in the bundle, so a local backup is a copy
of the stopped data folder; ApplyPack searches only while `npm start` runs.

## When to revisit

The Windows leg cannot be made green, or the built-in database draws
support issues the launcher cannot fix — then SQLite is the fallback worth
the rewrite. Before PostgreSQL 16 leaves support (November 2028): a major
upgrade path for existing data folders. A desktop app would replace the
terminal, not this database.
