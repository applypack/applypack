# Local install without Docker (plan)

> Analysis 2026-09-16, nothing built. Answers the owner's question: most
> people who would run ApplyPack do not use Docker, and many do not know
> what it is — can the default install run straight on the computer, with
> Docker described as the other way to run it? The owner's goal behind
> it: **non-technical people** should be able to use ApplyPack, and how
> they install it depends on their operating system and on how technical
> they are — README today assumes Docker is already there and says nothing
> about getting it. Backlog ticks live in [TASKS.md §21](./TASKS.md). Pairs with
> [ADR 0002](./adr/0002-worker-and-web-as-separate-processes.md) (two
> processes), [ADR 0027](./adr/0027-ai-keys-in-the-database.md) and
> [ADR 0041](./adr/0041-notification-channels.md) (why `.env` is
> optional after the first boot) and [docs/ai-engines.md](./ai-engines.md).

**Verdict**

- **Yes, and Docker is not the obstacle — Postgres is.** Everything else
  Docker does here (start two processes in order, build, pin Node) is a
  small launcher's work. With an embedded Postgres 16 behind `npm start`,
  a fresh copy of the repo answered on `/welcome` **1.8 s** after a cold
  start from nothing (initdb, 77 migrations, seed, worker, dashboard) and
  **0.8 s** warm, and the CI route smoke passed against it: 39 requests,
  39 as expected.
- **Recommended default:** `npm install && npm start` with a built-in
  database. **Docker stays exactly as it is** — the way to run it on a
  server or always on. **Your own Postgres** stays too: set `DATABASE_URL`
  and the built-in database is never started.
- **`npm start` is the foundation, not the finish line for a non-technical
  person.** It still takes Node, a terminal and a download. The finish is
  one pasted line per operating system that fetches its own Node, installs,
  and leaves an "ApplyPack" icon (§3.7, stage 2); below that is only a
  signed installer, which costs a yearly certificate (§3.6). README
  becomes a "which one is you" table with a guide per OS (§0.1, §4.8).
- **Nothing the app does changes** (§0.2): no fetcher, prompt, score,
  page, table or migration. Docker keeps its two commands; the new code is
  a wrapper that starts the same two processes.
- **Three things must be code from day one; each broke in this analysis:**
  initdb without explicit UTF-8 flags creates a `SQL_ASCII` database in
  which `'Київ' ILIKE '%КИЇВ%'` is false (§3.1); a hard-killed launcher
  leaves Postgres running and the next start fails with no message
  (§3.1); `npm run build` does not copy the PDF fonts, so the clean
  render fails today for everyone who runs without Docker (§2).
- **Rejected:** PGlite (measured: one open transaction blocked the other
  connection), SQLite (counted: a rewrite of the schema and the raw SQL),
  asking users to install Postgres (more steps than Docker), one process
  (ADR 0002).
- **Owner calls (§7):** the dependency size (23–51 MB download), where the
  data folder lives, the README/site lead, and how far down the technical
  ladder to go (the pasted line, or a signed installer later).

## 0. Who installs it, and what must not break

### 0.1 Four kinds of person, three systems

| Who | Has | Today | After this plan |
| --- | --- | --- | --- |
| Has never opened a terminal | a browser; macOS or Windows | install Docker Desktop (on Windows, with WSL 2), git or a ZIP, then `cp` and `docker compose` — README explains none of it | open Terminal / PowerShell once and paste one line; from then on an "ApplyPack" icon (stage 2, §3.7) |
| Follows a guide, copies commands | a terminal, maybe Node | the same, plus working out what Docker is | install Node from nodejs.org, `npm install`, `npm start`, each step for their OS in `docs/install/` (stage 1) |
| Developer | Node, git | `docker compose up -d`, or README's collapsed contributor block | `npm install && npm start`, or Docker, unchanged |
| Runs a server | Docker | `docker compose up -d` | unchanged, and README says how to install Docker on each OS |

The paths differ per system in the parts a newcomer trips on: how to open
a terminal, where Node comes from, what the OS asks the first time
(Gatekeeper on macOS, SmartScreen on Windows), where the data lives, how to
stop and update. Those go in one guide per system, not in README.

### 0.2 What changes, and what does not

| Part | Changes? |
| --- | --- |
| Fetchers, filter, classifier, AI engines, prompts, scoring, dashboard pages, schema, migrations | No |
| Docker: compose, the image's two commands, `.env` handling | No. The build copies the fonts itself, and the image drops Postgres binaries it never starts |
| The worker | One line: after `init()` it tells the launcher "ready". Under Docker, CI or `npm run dev` there is no launcher to tell, and nothing happens |
| `config.ts` | Only when `DATABASE_URL` is empty; compose, CI and every existing `.env` set it |
| `npm start` | Yes: it started the worker alone, now the database, the worker and the dashboard. Nothing in the repo calls it — Docker runs `node dist/index.js` |
| New files | `src/local/` (the launcher), the install scripts, `docs/install/` |

Every stage is its own PR, merged only after its verification matrix,
which builds the Docker image and runs the route smoke inside it (§4.10).

## 1. What Docker does for ApplyPack today

| Need | Today (compose / Dockerfile) | Without Docker |
| --- | --- | --- |
| A Postgres 16 with a user, a database, a volume | `postgres:16-alpine`, `jobhunter/jobhunter`, volume `pgdata` | a built-in Postgres 16 in a data folder, random password (§4.3) |
| Start in order, restart on a crash, start at login | `depends_on` + healthcheck, `restart: unless-stopped`, Docker Desktop at login | the launcher (§4.2); start-at-login is stage 4 |
| Build | `npm install`, `prisma generate`, `tsc`, fonts and `src/web/public` copied | `npm install` (postinstall generates) + a build on start (§4.6) |
| A pinned runtime | Node 24 + tini + three AI CLIs installed globally | the user's Node ≥ 22.12; the CLIs they already use |
| Loopback only | dashboard on `127.0.0.1:4747`, DB on `127.0.0.1:5433` | `WEB_HOST=127.0.0.1` (already the default), Postgres on `127.0.0.1` only |

What Docker costs a first-time user, measured on this machine: the
`applypack-app` image is **2.08 GB** (it carries three global AI CLIs) and
`postgres:16-alpine` **389 MB**, on top of Docker Desktop and its VM. A
local install is the `node_modules` any `npm install` makes (**368 MB**)
plus the Postgres binaries (**58–134 MB**, §3.1).

It also costs the subscription engines: locally the `claude` CLI you are
logged into just works; in Docker the macOS Keychain login does not reach
the container, so it takes `claude setup-token` and a pasted token, and a
call takes 15–30 s instead of ~7 s ([ai-engines.md](./ai-engines.md)).

## 2. What running without Docker looks like today

README's collapsed "Running without Docker" block is a contributor setup,
not an install:

- It still starts Postgres from compose (`docker compose up -d postgres`,
  "or any Postgres 16 you already have").
- Five commands, then two terminals with watchers (`npm run dev` is `tsx
  watch`, `npm run dev:web` is `tsc` + `node --watch`). Nothing orders
  them, nothing restarts them, nothing stops them together.
- **A live bug.** `dev:web` serves from `dist/`, and `tsc` does not copy
  binaries: `renderPdf` from `dist/` fails with
  `ENOENT … dist/resume/fonts/LiberationSans-Bold.ttf`; with
  `src/resume/fonts` copied beside `dist/` the same call returns a
  14 632-byte PDF. The Dockerfile copies the fonts, so Docker never saw it,
  and the route smoke never will: the render is a POST.
- Three paths resolve against the working directory, not the file:
  `web/app.ts:92` (`serveStatic` root), `resume/keyword-matcher.ts:36` and
  `resume/line-diff.ts:25`. README warns about the first one only.
- `.env.example` points `DATABASE_URL` at `localhost:5432` — the port a
  Postgres already on the host answers on, the trap compose's own comment
  (and this repo's history) describes.
- CI runs the route smoke in-process on Linux against a Postgres service
  container. Nothing starts the worker and the dashboard the way a user
  would, and nothing here has ever run on macOS or Windows in CI.

## 3. The options, measured

Setup for every measurement: a fresh `git archive` copy of `main`
(`4bf000c`), a clean environment (no AI keys, CLI binaries pointed at
nothing), a scratch data folder and port 5439. The live database was only
read (two read-only queries). macOS 27 arm64, Node 26.4.0, npm 11.17.0.

### 3.1 An embedded Postgres 16 — recommended

[`embedded-postgres`](https://github.com/leinelissen/embedded-postgres)
(MIT, ~359 k downloads a week, last publish 2026-06-05) ships the
PostgreSQL binaries built by zonky as one npm package per platform;
`16.14.0-beta.17` is the current 16.x (the package tags every version
`-beta.N`). The same major as compose, so data can move between the two
(stage 4 builds the import).

| Measured | Result |
| --- | --- |
| Download (tarball) | macOS arm64 50.8 MB · Windows x64 37.3 MB · Linux x64 23.2 MB |
| On disk | macOS 134 MB · Windows 100 MB · Linux 58 MB |
| What is in it | `initdb`, `pg_ctl`, `postgres` — **no `pg_dump`, no `psql`** |
| initdb | 0.36 s (3.3 s the very first time macOS runs the new binaries) |
| Postgres ready after spawn | 26–30 ms |
| Cold start → dashboard listening | 1.8 s (worker ready at 1.5 s: 77 migrations + seed) |
| Warm start → dashboard listening | 0.8 s |
| `/` · `/welcome` · `/settings` · `/static/*.mjs` · `tailwind.css` | 303 → `/welcome` · 200 · 200 · 200 · 200 |
| Route smoke (`dist/scripts/route-smoke.js`) | 39 requests, 39 as expected |
| Stop (web + worker, then Postgres) | 0.2 s + 0.06 s, nothing left running |
| Data folder after all of the above | 48 MB (16 MB of it WAL) |
| Linux, Debian arm64, a normal user | PostgreSQL 16.14 up in 0.6 s |
| Linux as root | refused: "Postgres does not support running as root" |

Three failures found on the way, each with its fix measured:

1. **Encoding depends on the shell that ran initdb.** The compose database
   is `UTF8 / en_US.utf8`: `lower('ПРИВІТ Київ ŁÓDŹ Größe')` →
   `привіт київ łódź größe`, both ILIKEs true. Embedded initdb with no
   `LANG` in the environment — a login item, a service, a GUI launcher —
   makes **`SQL_ASCII / C`**: `lower` returns `ПРИВІТ Київ ŁÓdŹ größe`
   and `'Київ' ILIKE '%КИЇВ%'` is **false**, which silently breaks every
   case-insensitive search (`mode: 'insensitive'`) on Ukrainian, Polish or
   German text. With `LANG=en_US.UTF-8` it is right, so it would pass on
   the developer's machine and fail on a user's. Explicit
   `--encoding=UTF8 --locale=C.UTF-8` reproduces the compose database
   exactly, whatever the environment: the same case mapping and the same
   order — `Alpha Zeta alpha beta Ärger Łódź Київ` in both, because the
   Alpine image's musl has no collation and compose sorts by code point
   despite its `en_US.utf8` name. ICU (`--locale-provider=icu
   --icu-locale=und --locale=C`) fixes the case mapping too but sorts
   differently (`alpha Alpha Ärger beta Łódź Zeta Київ`). `C.UTF-8` is the
   pick; Windows, where it may not be a locale name, settles in the CI leg
   with ICU as its fallback.
2. **A hard kill leaves Postgres running.** `kill -9` on the launcher: the
   `postgres` child survives, and the next start logs
   `FATAL: lock file "postmaster.pid" already exists` while
   `EmbeddedPostgres.start()` rejects with `undefined` — no message at all.
   A closed terminal is not this case: SIGHUP to the process group stopped
   both, because the package's `async-exit-hook` catches SIGHUP, SIGINT and
   SIGTERM and stops Postgres. Only a death nothing can catch (`kill -9`, a
   crashed Node) leaves the orphan. `pg_ctl stop -D <dir> -m fast` stopped
   it in under a second and the next start succeeded, so the launcher reads
   `postmaster.pid`, stops a live leftover that way, and prints Postgres's
   own last log lines when a start fails.
3. **npm is about to skip the package's install script.** npm 11.17 lists
   `@embedded-postgres/darwin-arm64` (and `prisma`, `esbuild`) under
   `allow-scripts`, and its docs say "a future release will block
   unreviewed install scripts". With scripts skipped (`--ignore-scripts`),
   0 of the 17 library symlinks exist and Postgres dies on
   `dyld: Library not loaded: @loader_path/../lib/libicudata.68.dylib`.
   Re-creating them at runtime from the package's own
   `native/pg-symlinks.json` fixes it: 17 symlinks, the start succeeds.
   So: an `allowScripts` entry in `package.json` **and** the runtime
   repair, because pnpm and `ignore-scripts=true` users skip scripts anyway.

Costs to accept: the download above; no `pg_dump` for backups (§5); a
pinned major version that will need an upgrade path before PostgreSQL 16
leaves support in November 2028 (§5); one maintainer wrote 315 of its
commits (5 contributors, 145 stars) — the launcher needs only three binary
paths and an initdb, so a replacement stays small.

### 3.2 PGlite (Postgres in WebAssembly) — rejected

The worker and the dashboard are separate processes (ADR 0002), so PGlite
would have to sit behind `@electric-sql/pglite-socket`, whose own README
says "not all use cases are guaranteed to work" with more than one
connection. Measured with `pglite@0.5.8`, `pglite-socket@0.2.11`,
`maxConnections: 4`: connection A runs `BEGIN; INSERT`, and connection
B's `SELECT` **is still waiting after 3 s** while A's transaction stays
open. One session serves everyone, so a worker transaction would freeze
the dashboard. Prisma's own PGlite path (`prisma dev`) is a development
server.

### 3.3 SQLite — rejected

A second database dialect forever, and data could no longer move between a
local and a Docker install. Counted in the schema and code: 6 enums, 30
scalar-list fields (Prisma has no lists on SQLite), 28 `Json` fields, 14 raw
SQL call sites, 3 case-insensitive filters, 77 migrations holding 1 163
lines of Postgres SQL.

### 3.4 "Install Postgres yourself" as the default — rejected, kept as an option

Homebrew / Postgres.app / the EDB installer / apt, then a role, a database
and a `DATABASE_URL`: more steps than Docker for someone new to both, and
it lands on port 5432, where an existing Postgres answers from the wrong
database. It stays as the third way for people who already run Postgres.

### 3.5 One process for local installs — rejected

ADR 0002 keeps the worker free of HTTP, and it paid off once already. The
launcher runs the same two processes; nothing in them changes.

### 3.6 No terminal at all: a signed installer — not now

Below "paste one line" is a file you download and double-click. The
browser marks that download, and macOS checks the native code inside it
before it runs. Measured on the pieces such a bundle would carry: the
Prisma engine is only ad-hoc signed (`flags=0x20002(adhoc,linker-signed)`),
and the EDB-built `postgres` binary fails `syspolicy_check distribution`
("Bad Load Command"). A zip with everything inside therefore risks the
"cannot be verified" dialog on the first start; confirming it takes a clean
Mac, because the dialog is a system window. Doing it properly means
re-signing and notarizing the whole bundle (Apple Developer Program, a
yearly fee) and signing a Windows installer, in CI — and the same for
Electron/Tauri or a single binary (Node SEA, `bun build --compile`). A
money-and-maintenance decision (§7), not a first step.

### 3.7 One pasted line per system — recommended for people new to a terminal

A file a script downloads itself carries no quarantine mark: measured, the
Node tarball fetched with `curl` has no `com.apple.quarantine` attribute,
and `npm install` fetches everything else the same way. That is why the
`npm start` path in this analysis ran with no dialog, and why one line gets
the same result without signing anything:

- macOS, Linux: `curl -fsSL https://applypack.dev/install.sh | sh`
- Windows (PowerShell): `irm https://applypack.dev/install.ps1 | iex`

What the script does: a private Node 24 in ApplyPack's own folder, beside
the data (no admin rights, nothing installed globally; 52.9 MB download on
macOS arm64, 37.6 MB on Windows x64), the latest release tag from GitHub,
`npm ci` and the build, a shortcut ("ApplyPack" in Applications, the Start
menu or the app menu), the first start, the browser. Updating is the same
line again; uninstalling removes the program and asks before it touches
the data.
On disk: Node 199 MB, dependencies 368 MB (340 MB without the build
tools), Postgres 58–134 MB. The scripts live in `site/public/`, readable
before anyone pipes them into a shell; people who would rather not keep the
`npm start` path.

Unverified here: whether a PowerShell download escapes Windows' Mark of the
Web the way `curl` escapes quarantine — the script's CI job on
`windows-latest` checks its downloads for a `Zone.Identifier` stream — and
whether the firewall asks anything when a loopback-only Postgres starts,
which takes one run on a real Windows machine before the stage ships.

## 4. The design

### 4.1 What the user types

```bash
# Node.js 22.12 or newer — https://nodejs.org
git clone https://github.com/applypack/applypack.git    # or Code → Download ZIP
cd applypack
npm install
npm start      # → http://127.0.0.1:4747 opens on the setup wizard
```

Ctrl+C stops everything; `npm start` again carries on. Updating is
`git pull && npm install && npm start`. No `.env` is needed: AI keys and
notification targets are pasted in the dashboard (ADR 0027 / 0041), and an
empty `DATABASE_URL` means the built-in database.

### 4.2 The launcher (`src/local/`, entry `dist/local/launcher.js`)

1. Check Node ≥ 22.12 and a supported platform (macOS arm64/x64, Linux
   x64/arm64, Windows x64). On Linux/macOS as root: stop with "run it as a
   normal user, or use Docker".
2. Read `.env` the way `config.ts` does. `DATABASE_URL` set → your own
   database: skip to step 5.
3. Resolve the data folder: `APPLYPACK_DATA_DIR`, else
   `~/Library/Application Support/ApplyPack` (macOS), `%APPDATA%\ApplyPack`
   (Windows), `$XDG_DATA_HOME/applypack` or `~/.local/share/applypack`
   (Linux). Print it.
4. Start the built-in database (§4.3).
5. Spawn the worker (`node dist/index.js`, working directory = the install
   root, which the three cwd-relative paths of §2 need, `DATABASE_URL` in
   its environment) and wait for its "ready"
   message over IPC, sent after `init()` has migrated and seeded. Only then
   spawn the dashboard, so it never meets an unmigrated schema.
6. Print one block: the URL, the data folder, "Ctrl+C to stop". Open the
   browser while setup is unfinished (never under `CI` or
   `APPLYPACK_NO_OPEN=1`).
7. A child that exits on its own is restarted with a backoff (1 s → 30 s);
   five crashes in two minutes stop everything with the name of the process
   and where its log is. A worker that dies before "ready" (a failed
   migration) is not restarted.
8. SIGINT / SIGTERM / SIGHUP: stop the dashboard, stop the worker (it
   already waits up to 60 s for an in-flight tick; a second Ctrl+C forces
   it), then stop Postgres.
9. Port 4747 taken: if it answers like ApplyPack, "already running at …"
   and exit 0; otherwise name `WEB_PORT`.

### 4.3 The built-in database

- `db.json` in the data folder, mode 0600: port, user `applypack`, a random
  32-byte password, database `applypack`, major `16`. The port is 5434 when
  free (5432 is a host Postgres, 5433 is compose), else any free port, and
  is kept, so the URL stays stable for scripts and a GUI client.
- The binary package's symlinks are repaired before every start (§3.1,
  failure 3).
- initdb: `--auth=scram-sha-256 --encoding=UTF8 --locale=C.UTF-8` (§3.1,
  failure 1). Every start checks `server_encoding = 'UTF8'` and refuses a
  data folder that fails it, instead of using it quietly.
- A `postmaster.pid` whose process is alive is stopped with
  `pg_ctl stop -m fast` before the start (§3.1, failure 2).
- `postgres -D <dir> -p <port> -c listen_addresses=127.0.0.1
  -c unix_socket_directories=''`, spawned in its own process group, so
  Ctrl+C reaches the launcher and not Postgres, and the app stops before
  its database. The platform packages export the three binary paths;
  `embedded-postgres` itself is only needed for the initdb step, and its
  `start()` is not used — it spawns in our process group and rejects
  without a reason. Its exit hook goes with it, so the launcher stops
  Postgres on SIGHUP, SIGINT and SIGTERM itself (§4.2, step 8).
- Postgres writes to `<data>/logs/postgres.log`; a failed start prints its
  last lines.
- `embedded-postgres` and its platform packages are ESM-only while this
  build is CommonJS, where TypeScript turns `import()` into `require()`:
  `engines.node` becomes `>=22.12`, where `require()` of ES modules works
  without a flag.

### 4.4 Config, scripts, contributors

- Pure and unit-tested, as `src/watchlist/` splits it: the data folder per
  platform, `db.json` (zod), the initdb flags, reading `postmaster.pid`,
  the restart policy. The I/O stays in three files: the Postgres process,
  the supervisor, the entry point.
- `DATABASE_URL` stays the one variable Prisma reads. When it is empty,
  `config.ts` fills it from `<data>/db.json` through a pure
  `resolveDatabaseUrl(env, dbJson)`, so `npm run fetch:once`, `npm run dev`,
  `npm run dev:web` and the benches work against the built-in database
  while it runs.
- `npm run db` runs only the built-in database, in the foreground — the
  contributor's replacement for `docker compose up -d postgres`.
- `.env.example`: `DATABASE_URL` commented out, with "empty = the built-in
  database". compose already sets its own in `environment:`, CI sets its own.

### 4.5 Docker keeps working, unchanged

- compose passes `DATABASE_URL`, and the containers keep running
  `node dist/index.js` and `node dist/web/server.js`; the launcher never
  runs there.
- The runtime stage deletes `node_modules/embedded-postgres` and
  `node_modules/@embedded-postgres`, which nothing in the image starts. The
  image size is measured before and after (2.08 GB today).

### 4.6 Build

- `npm start` builds first: `tsc` took 4 s from scratch and
  `tsc --incremental` 1 s with nothing changed, so an update never runs a
  stale `dist/`.
- `npm run build` copies `src/resume/fonts` into `dist/resume/fonts` (the
  §2 bug; the Dockerfile's separate `COPY` goes).
- `npm start` today means "the worker"; it becomes the launcher, and
  `start:worker` keeps the old command. Docker never used `npm start`.
- `allowScripts` in `package.json` for `@embedded-postgres/*`, `prisma` and
  `esbuild`.

### 4.7 Security

At least as strict as compose, whose database has fixed credentials
published on `127.0.0.1:5433`: a random password with scram-sha-256,
loopback only, the data folder 0700 (measured: initdb's own mode),
`db.json` 0600. No Unix socket: this build's default is
`unix_socket_directories=/tmp`, where it made `/tmp/.s.PGSQL.5439`,
`srwxrwxrwx`. The dashboard binding does not change.

`db.json` is a secret outside `.env`, which CLAUDE.md allows in two named
places only. ADR 0054 makes it the third, for the reason compose's
committed `jobhunter` password never was one: it guards a loopback database
whose files sit in the same folder, readable by exactly the same user. The
alternative — no TCP at all, a socket in a 0700 folder and no password —
was set aside: Prisma's engine reaches a Unix socket only on Unix systems,
and macOS caps a socket path at 104 bytes, which a custom data folder can
pass.

### 4.8 Every place that says "Docker" and has to change

| File | Change |
| --- | --- |
| `README.md` | "Install" opens with the §0.1 table as "which one is you", each row linking to its guide; the developer row is §4.1; Docker is one row, with how to get Docker on each OS; "Your own Postgres" last; the intro line "`docker compose up` … is the whole deployment"; "Your data" per way (the folder, a backup, restore); the one-shot scripts line; "Under the hood" |
| `docs/install/macos.md`, `windows.md`, `linux.md` (new) | per system: how to open Terminal or PowerShell, Node from nodejs.org, `npm install` + `npm start` (stage 1; the one line from stage 2), what the first start looks like, stop, update, uninstall, where the data lives, the errors people actually hit — filled from the stage's own runs, not guessed |
| `src/web/pages/welcome.tsx` :158 | "add OPENAI_BASE_URL to .env" is the one file edit left on the non-technical path: a free Gemini key or a local model needs it (stage 3) |
| `site/public/index.html` | hero button "Install with Docker" → "Install"; the install section's title, lead and commands local-first with a Docker line; JSON-LD `operatingSystem` "Docker, Node.js" → "macOS, Windows, Linux" |
| `package.json` | `description` without "with Docker"; its "33 sources" stays, because `source-count.test.ts` reads the field |
| `CONTRIBUTING.md` | dev setup without Docker (`npm run db` + `npm run dev` + `npm run dev:web`) |
| `CLAUDE.md` | the "Docker" section becomes "Running" with both ways; local commands in the operational-tasks table; a where-to-look row for `src/local/` |
| `.claude/skills/testing-gate` | the local variant of the dashboard and worker checks |
| `docs/ai-engines.md` | the log lines lead with the local terminal |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | install method "Local (npm start)" and where its logs are |
| `SPEC.md` :24, `ARCHITECTURE.md` :10–14 | both deployment shapes in the text and the diagram |
| `docs/launch/*.md` | "two containers behind docker compose", "docker compose up -d brings up …", the awesome-selfhosted platform list |
| `docs/adr/0054-…` | the local default and the built-in database (dependency, deployment shape, the pinned major) |

### 4.9 CI

A `local-start` job on `ubuntu-latest`, `macos-latest` and
`windows-latest`, Node 22.12 and 24: `npm ci` → `npm start` in the
background with a temp data folder → poll `/` for the 303 → the route smoke
against the built-in database → stop → assert no `postgres` process is
left. The Windows leg is the first time anything in this repo runs on
Windows. Free on a public repository.

### 4.10 Verification matrix (stage 1)

- A fresh `git archive` copy, clean environment: `npm install && npm start`
  → `/` 303 → `/welcome` 200, the browser opens once.
- Ctrl+C → no process left; `npm start` again → warm start, data kept.
- `kill -9` on the launcher → `npm start` recovers from the stale lock.
- 4747 held by ApplyPack / by something else → the two messages.
- initdb with no `LANG` → `server_encoding` UTF8, `lower('ПРИВІТ')` =
  `привіт`, `'Київ' ILIKE '%КИЇВ%'` true, and the same `ORDER BY` as the
  compose database.
- `npm install --ignore-scripts` + `npx prisma generate` → `npm start`
  still starts.
- `DATABASE_URL` set → no built-in Postgres is started (against a throwaway
  database, never the live one).
- The route smoke against the built-in database; a clean PDF from `dist/`.
- `docker compose build` + the route smoke in the image; image size before
  and after.
- The CI job green on three systems.

## 5. What the local default will not do (say it in the README)

1. **It runs while `npm start` runs.** A laptop asleep or a closed terminal
   means no hourly search until it is back; nothing is lost but the time.
   Docker Desktop at login is today's always-on answer; stage 4 adds a
   start-at-login switch.
2. **Backups.** No `pg_dump` in the bundle. Stage 1: stop ApplyPack and
   copy the data folder. Stage 4: a dated snapshot on start. The Docker way
   keeps its `pg_dump`.
3. **Major upgrades.** Both ways stay on PostgreSQL 16 (supported until
   November 2028). Moving a built-in database to 17+ needs an upgrade path
   this plan does not build; ADR 0054 records it.
4. **Windows is unverified** until the CI leg. There `embedded-postgres`
   stops Postgres with `taskkill /f`, so the next start runs crash recovery
   (safe, slower). The CLI engines are started with `execFile(bin)` without
   a shell, and npm installs `claude` / `gemini` / `codex` on Windows as
   `.cmd` shims, which Node refuses to start that way: expect the API
   engines to work and the CLI engines to need a fix (stage 4).
5. **Linux as root** is refused: a normal user, or Docker.
6. **Node versions drift.** Docker pins 24; a laptop has what it has. On
   Node 26 the dashboard prints a harmless
   `ExperimentalWarning: localStorage is not available`, from the `docx`
   package's bundled `util-deprecate`. CI covers 22.12 and 24.

## 6. Stages

- **Stage 0 — `dist-fonts`** (patch): `npm run build` copies the fonts; the
  Dockerfile `COPY` goes; the route smoke gains the clean-render POST, so CI
  renders one PDF from `dist/`. Fixes today's non-Docker bug on its own.
- **Stage 1 — `local-start`** (minor, ADR 0054): §4 whole — the launcher,
  the built-in database with the three fixes of §3.1, `npm run db`, the
  config fallback, `.env.example`, the image clean-up, every file in §4.8
  including the three `docs/install/` guides for the Node and Docker paths,
  the CI job, the verification matrix in §4.10.
- **Stage 2 — `one-line-install`** (minor): `install.sh` and `install.ps1`
  in `site/public/` (§3.7) — a private Node, the latest release, the
  build, the shortcut per system, the first start. A CI job per system
  runs the line on a fresh runner and checks `/` answers, the shortcut
  exists and (Windows) nothing it downloaded carries a `Zone.Identifier`.
  The guides and the site lead with the line from then on.
- **Stage 3 — `ai-without-env`** (patch): the OpenAI-compatible engine's
  base URL on its card and in `/welcome` step 1, so a free Gemini key, a
  local model or OpenRouter needs no `.env` edit.
- **Stage 4 — `local-always-on`** (minor): `npm run autostart:on|off` (a
  launchd user agent, a `systemd --user` unit, a Windows Startup entry);
  logs in the data folder; a dated snapshot of the data folder on start
  (keep 7); `npm run db:import <dump.sql>` to move a Docker database in (a
  `pg_dump --inserts` dump, since `COPY … FROM stdin` needs `psql`); the
  Windows CLI engines.
- **Stage 5 — owner decision:** a signed installer per system (§3.6), or
  `npx applypack` (the npm name is free, checked 2026-09-16) — only if
  stage 2 still loses people.

## 7. Owner decisions

1. **The built-in database as the default** — a 23–51 MB download and
   58–134 MB on disk per install. Recommended: yes; the alternatives in §3
   are either broken (PGlite), a rewrite (SQLite) or harder than Docker.
2. **Where the data lives.** Recommended: the OS app-data folder — it
   survives a fresh clone or a new ZIP, and it is the place a future
   `npx applypack` needs. The alternative, `./data` inside the clone, is
   easier to find but starts empty in every new download.
3. **README and site lead with the local install; Docker becomes "for a
   server, or to keep it running".** Recommended.
4. **How far down the ladder.** Recommended: the one pasted line (stage 2)
   — no cost, and the least technical person meets a terminal once. A
   signed double-click installer (stage 5) means a yearly certificate and
   signing in CI; decide it after stage 2 has been in people's hands.
