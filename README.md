# job-hunter

Local Docker worker that monitors Greenhouse, Lever, and LaraJobs for senior
remote-US PHP/Laravel + JS full-stack roles. Filters with keyword rules, scores
fit with Claude Haiku, and alerts via Telegram.

See `SPEC.md` for the full Phase 1 specification.

## Quick start

```bash
git clone <this-repo> job-hunter
cd job-hunter

cp .env.example .env
# Fill in:
#   ANTHROPIC_API_KEY=sk-ant-...
#   TELEGRAM_BOT_TOKEN=...   (optional — if empty, notifier just logs)
#   TELEGRAM_CHAT_ID=...     (optional — same)

docker compose up -d
docker compose logs -f app
```

On first run the stack brings up:

1. **postgres** — Postgres 16 with persistent volume.
2. **app** — the cron worker. Applies the Prisma schema (`db push` in Phase 1
   or `migrate deploy` if you generate migration files), seeds companies,
   registers cron jobs and idles.
3. **web** — the dashboard at <http://localhost:4747> (bound to `127.0.0.1`).

The dashboard is read-mostly with limited writes (status changes, re-classify).
It's bound to localhost only by default — see the *Dashboard auth* section if
you need to expose it.

## Cron schedule

| Cron        | Job          | What it does                                                |
| ----------- | ------------ | ----------------------------------------------------------- |
| `5 * * * *` | fetch-job    | Pull new postings, filter, classify with Claude, alert.     |
| `0 9 * * *` | digest-job   | Send a digest of all NEW/ALERTED jobs from the last 24h.    |
| `0 3 * * 0` | cleanup-job  | Delete DISMISSED jobs older than 30 days.                   |

Timezone is set by `TZ` (default `America/Chicago`).

## Manual one-shot runs

```bash
# Locally (requires Postgres running and DATABASE_URL pointing at it):
npm install
npm run fetch:once
npm run digest:once
npm run cleanup:once

# Inside Docker:
docker compose exec app node dist/scripts/fetch-once.js
docker compose exec app node dist/scripts/digest-once.js
docker compose exec app node dist/scripts/cleanup-once.js
```

## Adding companies

Edit `src/seed.ts` (the `SEED_COMPANIES` list) and rerun:

```bash
docker compose exec app node dist/seed.js
# or locally
npm run seed
```

The seed is idempotent (`upsert` on `(atsType, atsToken)`).

## Project layout

```
src/
  index.ts              # worker entrypoint: init + cron + graceful shutdown
  init.ts               # schema apply + db ping + seed
  config.ts             # zod-validated env (worker + web settings)
  logger.ts             # pino + pino-pretty
  db.ts                 # PrismaClient singleton
  http.ts               # fetchWithRetry + stripHtml
  types.ts              # NormalizedJob, ClaudeClassification, AlertJob
  filter.ts             # passesBaseFilter (pure)
  classifier.ts         # classifyWithClaude (Anthropic SDK + prompt caching)
  notifier.ts           # Telegram MarkdownV2 sender (logs if not configured)
  seed.ts               # SEED_COMPANIES list
  fetchers/
    index.ts            # runAllFetchers
    greenhouse.ts
    lever.ts
    larajobs.ts
  jobs/
    fetch-job.ts        # fetch + filter + classify + persist + alert
    digest-job.ts       # 24h digest
    cleanup-job.ts      # 30-day DISMISSED cleanup
    cron-run.ts         # recordCronRun() — writes runs to CronRun table
  scripts/
    fetch-once.ts
    digest-once.ts
    cleanup-once.ts
  web/                  # dashboard service (Hono + JSX + htmx + Tailwind CDN)
    server.ts           # entrypoint
    layout.tsx          # HTML shell
    ui.tsx              # shared UI components
    format.ts           # date/salary/colour helpers
    pages/              # JSX page components
    routes/             # Hono route handlers
prisma/
  schema.prisma         # Company, Job, CronRun models
docker-compose.yml
Dockerfile
```

## Local dev (no Docker for the app)

```bash
docker compose up -d postgres        # just the database
cp .env.example .env                  # set DATABASE_URL=postgresql://jobhunter:jobhunter@localhost:5432/jobhunter
npm install
npx prisma db push                    # or: npx prisma migrate dev --name init
npm run seed
npm run fetch:once

# Dashboard locally:
npm run dev:web                       # tsc + node --watch
# then open http://localhost:4747
```

Note: the dashboard's dev script compiles via `tsc` and reloads via Node's
built-in `--watch`. We don't use `tsx` for the web service because it has
a known issue propagating `jsxImportSource` across `.ts → .tsx` imports.

## Dashboard

The dashboard is a small Hono service served on port **4747** and bound to
`127.0.0.1` by default (never publicly exposed).

| Page          | URL          | What it shows                              |
| ------------- | ------------ | ------------------------------------------ |
| Overview      | `/`          | counters by status, recent alerts, cron health |
| Jobs          | `/jobs`      | filterable + sortable + paginated list     |
| Job detail    | `/jobs/:id`  | full description, classifier output, status actions, re-classify |
| Companies     | `/companies` | seeded sources, jobs/alerted counts, toggle active |
| Cron runs     | `/runs`      | last 100 cron runs with stats / errors     |
| Health        | `/health`    | JSON, useful for external uptime checks    |

Status actions on the detail page (`Mark applied`, `Save`, `Dismiss`, `Reopen`)
just write to `Job.status`. `Re-classify` calls Claude synchronously from the
web process and updates `fitScore`/`techMatch`/`redFlags`/`summary`.

### Auth

Add `WEB_BASIC_AUTH=user:password` to `.env` to enable HTTP Basic Auth. Leave
empty for no auth (safe because compose binds to `127.0.0.1` only). If you
ever expose the port, set this immediately.

### Why no manual "Run fetch now" button?

The worker (`app`) and dashboard (`web`) are separate processes — they share
Postgres but no in-process IPC. Triggering a worker cron from the web process
would need a shared queue or a polling flag, which is overkill for v1.
Workaround: from your shell run

```bash
docker compose exec app node dist/scripts/fetch-once.js
```

## Telegram setup (when ready)

1. Create a bot via [@BotFather](https://t.me/BotFather) — copy the token.
2. Start a chat with your bot, then call
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and grab `chat.id`.
3. Put both into `.env` and `docker compose restart app`.

Until both are set, `notifier.ts` logs a preview of each would-be message and
skips the HTTP call — no failures.
