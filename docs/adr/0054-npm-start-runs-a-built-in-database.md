# 0054 — `npm start` runs ApplyPack with a built-in Postgres; Docker is the server option

**Status:** Accepted (2026-09-16) — owner decision, plan [docs/local-install-plan.md](../local-install-plan.md), TASKS §21

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

## Addendum (2026-09-28): always on, backed up, moved in, and Windows' CLIs

The stage this ADR left for later (`local-always-on`, TASKS S5–S8):

- **Start at login is opt-in** (the 2026-09 plan's Q29): Settings →
  General → **Start with this computer** writes the system's own entry — a
  launchd agent on macOS, a `systemctl --user` service on Linux, a script in
  the Windows Startup folder — for `npm start` in this checkout, under the
  Node that runs it now (by its PATH name, which outlives an upgrade), with
  the PATH the user has now so the CLI engines are found. The same button
  removes it. Only a dashboard the launcher started offers it
  (`child.ts:underLauncher`); `src/login-item.ts` is pure, the dashboard's
  `web/login-item-io.ts` writes.
- **A dated snapshot on start**: the launcher copies the database folder to
  `snapshots/<date>` before Postgres starts, once a day, the newest three kept
  (`APPLYPACK_SNAPSHOTS`, 0 = none; `local/snapshots.ts` plans it). A copy
  taken before the server runs is whole. It replaces "stop and copy the
  folder" as the everyday backup; restoring is putting it back.
- **`npm run db:import`** moves a Docker install in: `pg_dump --data-only
  --inserts --column-inserts`, split into statements by `src/sql-dump.ts`
  (the bundle has no psql), everything replaced in one transaction with
  foreign keys checked at the end (`session_replication_role = replica` —
  the built-in user is its superuser), the migration history never copied.
  It refuses while a worker runs beside the database.
- **Windows' CLI engines**: an npm `.cmd` shim is read for the script it
  runs, and Node runs that script (`src/cli-command.ts`). Never
  `shell: true` — cmd.exe would read the prompt, which carries a posting,
  as commands.

## Addendum (2026-10-11): a look that gets no answer is not "no such process"

The launcher recognises what a pid file names by that process's command
line: PowerShell on Windows, `ps` elsewhere, fifteen seconds at most
(`postgres.ts:commandLineOf`). Every failure of that look returned `null`,
the answer for "no such process" — and on a busy Windows machine the look
does run out of time. A CI run showed it: `npm run stop` printed "ApplyPack
is not running." 15.3 seconds after it started, and left the launcher
running (#470). The same `null` let a second `npm start` take a live
launcher's lock, let a start delete the pid file of a database that might be
running, and let `db:import` go ahead beside a worker.

The look has three answers now — a command line, no such process,
`NO_ANSWER` — and is made twice before the third is given. Whether the
process exists at all is asked of the system directly (`process.kill(pid,
0)`), so "no answer" about a number nobody holds is still nobody. For a
process that is there and could not be named:

- **`npm run stop`** asks it to stop anyway and waits. The request is a file
  in the data folder that only a launcher reads; left for anything else it
  does nothing.
- **`npm start`** does not take the lock from under it, and does not delete
  its `postmaster.pid`: it stops and says which file to remove if ApplyPack
  is in fact not running. A start that is refused once is cheaper than two
  servers on one data folder.
- **`npm run db:import`** refuses, as it does beside a worker.

The decisions are pure (`supervise.ts:lockHolder`,
`postgres-setup.ts:leftoverAction`); only the look itself touches the
system.
