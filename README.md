# job-hunter

Local Docker stack that monitors **16 ATS / aggregator sources** for
roles matching a configurable **profile** (stack, role types, regions,
salary, fit threshold), classifies each through Claude Haiku, and
fires Telegram alerts. Includes a dashboard at `localhost:4747` for
review, settings, application tracking, and discovery of new
companies from HN.

> **Docs map:** [SPEC.md](./SPEC.md) — current state.
> [ARCHITECTURE.md](./ARCHITECTURE.md) — diagrams + file map.
> [CLAUDE.md](./CLAUDE.md) — conventions + gotchas + where-to-look.
> [docs/adr/](./docs/adr/) — non-trivial decisions.
> [SPEC-phase1.md](./SPEC-phase1.md) — historical Phase 1 spec.

## Quick start

```bash
git clone <this-repo> job-hunter
cd job-hunter

cp .env.example .env
# Required (one of):
#   ANTHROPIC_API_KEY=sk-ant-...        (AI_PROVIDER=anthropic_api, default)
#   AI_PROVIDER=claude_code             (uses your Claude.ai subscription, see below)
# Optional (bootstrap-only — managed in /settings after first boot):
#   TELEGRAM_BOT_TOKEN=...
#   TELEGRAM_CHAT_ID=...

docker compose up -d
docker compose logs -f app    # worker
docker compose logs -f web    # dashboard
```

Three containers come up:

1. **postgres** — Postgres 16 with persistent volume.
2. **app** — cron worker. Runs `prisma migrate deploy`, seeds companies
   + default profile, registers 6 cron jobs, idles.
3. **web** — Hono dashboard at <http://localhost:4747> (bound to
   `127.0.0.1`, never exposed publicly by default).

The dashboard is read-mostly with limited writes (status changes,
profile / settings edits, candidate promote, company add).

## Cron schedule (TZ = `America/Chicago` by default)

| Cron expr   | Job                | What it does                                        |
| ----------- | ------------------ | --------------------------------------------------- |
| `5 * * * *` | fetch              | Pull all sources, filter, classify, alert.          |
| `0 9 * * *` | digest             | Telegram digest of NEW/ALERTED jobs from last 24h.  |
| `0 8 * * *` | stale-applications | Nudge for `applied >14d ago, no recruiter contact`. |
| `0 3 * * 0` | cleanup            | Delete DISMISSED jobs older than 30 days.           |
| `0 4 * * 0` | discovery          | Re-probe pending CompanyCandidates.                 |
| `0 6 1 * *` | hn-hiring          | Pull latest HN Who-is-hiring + harvest candidates.  |

## Manual one-shot runs

```bash
# Inside Docker (recommended):
docker compose exec app node dist/scripts/fetch-once.js
docker compose exec app node dist/scripts/digest-once.js
docker compose exec app node dist/scripts/cleanup-once.js
docker compose exec app node dist/scripts/stale-once.js
docker compose exec app node dist/scripts/hn-once.js
docker compose exec app node dist/scripts/discovery-once.js

# Locally (requires Postgres running, DATABASE_URL pointing at it):
npm install
npm run fetch:once
npm run digest:once
# … etc
```

## Sources

12 source types, all on official public APIs / RSS — no scraping.

| Type            | Shape         | Notes                                              |
| --------------- | ------------- | -------------------------------------------------- |
| GREENHOUSE      | per-company   | Add via /companies                                 |
| LEVER           | per-company   | Add via /companies                                 |
| ASHBY           | per-company   | Add via /companies                                 |
| WORKABLE        | per-company   | Add via /companies. Title-only classification.     |
| SMARTRECRUITERS | per-company   | Add via /companies. List + per-job detail.         |
| LARAJOBS_RSS    | aggregator    | Single seeded feed.                                |
| REMOTEOK        | aggregator    | Single seeded feed.                                |
| REMOTIVE        | aggregator    | Single seeded feed (?category=software-dev).       |
| ARBEITNOW       | aggregator    | EU-skewed; **disabled** by default.                |
| HN_HIRING       | aggregator    | Monthly HN Who-is-hiring thread (Algolia API).     |
| WEWORKREMOTELY  | per-category  | atsToken = category slug. Two seeded.              |
| GOLANGPROJECTS  | aggregator    | Go-only feed; **disabled** by default.             |
| JOBICY          | aggregator    | Single seeded feed (?job_categories=dev).          |
| HN_JOBS         | aggregator    | HN /jobs firehose (Algolia tags=job, 14-day window). |
| WORKINGNOMADS   | aggregator    | Free JSON API, ~30 most recent cross-company jobs. |
| HIMALAYAS       | aggregator    | Free JSON API, 20 newest jobs/call, all categories. |

**Hard exclusions** (never adding): LinkedIn, Indeed, Glassdoor,
Workday, Wellfound, JobSpy. See
[ADR 0005](./docs/adr/0005-no-linkedin-indeed-workday.md).

## Adding companies

**Easiest:** the manual form on `/companies` runs a live probe of the
ATS endpoint and refuses to save if the slug doesn't resolve.

**Discovery:** if you turn on Auto-discovery + HN parser in `/settings`,
the system auto-finds candidate companies from URLs in HN comments.
Review on `/discovery` and click **Promote** to start tracking.

**Seed (rare):** edit `src/seed.ts` and run `docker compose exec app
node dist/seed.js`. Idempotent on `(atsType, atsToken)`. Disabling a
company through the UI persists across reseeds.

## Dashboard

Bound to `127.0.0.1:4747`. Optional `WEB_BASIC_AUTH=user:password` in
`.env` to enable HTTP Basic Auth.

| Page         | URL              | What it shows                                                        |
| ------------ | ---------------- | -------------------------------------------------------------------- |
| Overview     | `/`              | Counters by status, recent alerts, cron health                       |
| Jobs         | `/jobs`          | Filterable + sortable + paginated list                               |
| Paste a job  | `/jobs/new`      | Save a posting by hand (LinkedIn, email, referral) — classified like any other |
| Job detail   | `/jobs/:id`      | Full description, Claude output, status actions, **is this job real?**, **resume match**, application tracking, re-classify |
| Targeted     | `/jobs/:id/target` | Posting ↔ resume side by side, keyword highlights, in-place editing with live coverage score, AI re-analysis of the draft |
| Applications | `/applications`  | Kanban (applied → screen → tech → onsite → offer / rejected / ghosted) |
| Resumes      | `/resumes`       | Upload `.docx` / `.md` / `.txt`, AI scan (headline, skills, issues), comparison history |
| Resume       | `/resumes/:id`   | Scan result, job-agnostic issues, comparisons, extracted text, download |
| Companies    | `/companies`     | Sources list, manual add (with probe), per-row toggle / delete       |
| Discovery    | `/discovery`     | Pending / Promoted / Ignored / Dead candidates harvested by HN parser |
| Runs         | `/runs`          | Last 100 cron runs with stats / errors                               |
| Settings     | `/settings`      | Active profile editor, resumes, 7 toggles, telegram targets, source family on/off |
| Health       | `/health`        | JSON liveness for external monitoring                                |

### Profiles

`/settings` → "Active profile" lets you edit:

- **Tech stack required** — actual technologies (e.g. `php`, `laravel`, `javascript`, `go`)
- **Role types** — title hints (`full-stack`, `backend`, `frontend`)
- **Nice-to-have** — boost only
- **Exclude** — auto-reject in title (`junior`, `intern`, `wordpress`)
- **Notes** — free-form context appended to the Claude prompt
- **Seniority, location, regions, on-site cities, hybrid OK**
- **Min salary**, **min fit score**
- **Telegram target** — route alerts to a specific bot (or broadcast)

Multiple profiles can coexist; one is active. Switch via dropdown,
then click **Re-classify all jobs** to rescore existing rows under
the new profile.

### Resumes

Upload the resumes you actually send (`/settings` → "Resumes" or
`/resumes`). Each upload is scanned once by `CLAUDE_MODEL_RESUME`
(headline, seniority, skill tags, job-agnostic ATS issues). On any job
page, "Resume match" → **Compare** runs one comparison and stores a report:
match score, what already sells you, red flags, a to-do list (section →
where → what → why, with priority) and keyword coverage
(`present` / `add` / `can't claim` — the last one is what the resume
cannot honestly claim), and **what to remove** so the resume reads
cleaner. Recruiter reality is baked into the prompt: the title, summary and
most recent role get the edits; older roles get trims.

Then iterate: edit the resume, **Upload a new version** on its page, hit
Compare again — the score uses a fixed rubric, so the card shows
"▲ +16 vs v1". Files and reports stay in your Postgres.

### Targeted view

"Open targeted view →" on any comparison (`/jobs/:id/target`) puts the
posting and your resume side by side, Resume Worded style: every keyword
highlighted in the posting (found / missing / can't claim), keywords and
suggested removals highlighted in the resume, and the resume **editable in
place**. A live **keyword coverage** score recomputes as you type (in the
browser, no AI call — see ADR 0010); "Re-analyze with AI" sends the draft to
the resume model for the full rubric score; "Save as vN" stores the draft as
a text version; "Re-upload resume" does version + scan + compare in one go.
Drafts live in the browser tab until you save.

### Is this job real?

Any job page → **Verify**. The model gets web search (server tools on the
API, `WebSearch`/`WebFetch` on the Claude Code CLI) and runs the ghost-job
checklist: company careers page, LinkedIn footprint, reputation, posting
age, salary, named humans, hard scam flags. Result: `legit` / `suspicious`
/ `fake`, a recommendation (apply / caution / skip), confidence, and
evidence rows with the URLs it used. Takes 2-4 minutes. Pasted jobs
(`/jobs/new`) are the main use — LinkedIn postings you'd otherwise have to
judge by eye.

### Toggles

Every feature can be disabled in `/settings`:

| Toggle                        | Effect when off                                |
| ----------------------------- | ---------------------------------------------- |
| Telegram alerts               | Notifier no-ops with log preview               |
| Classifier mode               | `single` (full Haiku 4.5) vs `two_stage` (cheap prefilter + full) |
| Application tracking          | Hides per-job tracking card, no auto-set on APPLIED |
| Stale-applications digest     | Daily nudge cron exits early                   |
| HN parser                     | Monthly HN cron + manual run skip              |
| Auto-discovery                | HN parser doesn't write CompanyCandidates      |
| Disabled sources (multi)      | Skip whole AtsType families in fetch tick      |

## Local dev

```bash
docker compose up -d postgres        # just the database
cp .env.example .env                  # set DATABASE_URL=postgresql://jobhunter:jobhunter@localhost:5432/jobhunter
npm install
npx prisma migrate deploy             # apply real migrations
npm run seed
npm run fetch:once

# Dashboard locally:
npm run dev:web                       # tsc + node --watch
# then open http://localhost:4747
```

Note: the dashboard's dev script compiles via `tsc` and reloads via
Node's `--watch`. We don't use `tsx` for the web service because of
[a known issue with jsxImportSource](./CLAUDE.md#gotchas) — see
gotcha #2 in CLAUDE.md.

## Tests + CI

```bash
npm run lint:types     # tsc --noEmit
npm test               # node --test via tsx, ~135 tests
```

GitHub Actions runs both on every push and PR — see
`.github/workflows/test.yml`. Tests cover **pure modules only**:
filter, text-utils, http, hn-parser, notifier helpers, fetcher
mappers, prefilter parser, stale-applications formatter. Modules that
touch Prisma or the Anthropic SDK are verified via smoke runs and
dashboard integration testing instead.

## Telegram

Two paths:

**Bootstrap from .env:** set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`,
boot the stack, `init.ts` imports them as a `TelegramTarget` row and
turns alerts on. After this, `.env` is no longer consulted at runtime.

**Manage in dashboard:** `/settings` → "Add target". The form runs
`getMe` + `sendMessage` against your bot and refuses to save if either
fails. Add multiple targets if you want parallel delivery; route a
profile to one specific target via `Profile.telegramTargetId`.

To create a bot: [@BotFather](https://t.me/BotFather) → copy token.
To find your chat id: send any message to your bot, then visit
`https://api.telegram.org/bot<TOKEN>/getUpdates` and grab `chat.id`.

## Project layout

See [ARCHITECTURE.md](./ARCHITECTURE.md) — full file map with
descriptions, plus Mermaid diagrams of the data flow.

## AI backend

Both classifier stages go through one seam, `src/ai-provider.ts`. Pick the
backend with `AI_PROVIDER`:

| Value | How it runs | Billing |
| --- | --- | --- |
| `anthropic_api` (default) | `@anthropic-ai/sdk` → Messages API, system prompt cached | per token, `ANTHROPIC_API_KEY` required |
| `claude_code` | spawns `claude -p --output-format json` per job | your Claude.ai Pro/Max subscription |

`CLAUDE_MODEL` (Haiku 4.5) runs the classifier; `CLAUDE_MODEL_RESUME`
(Opus 5 by default) runs the resume scan and resume-vs-job comparison —
a few calls a day where judgment matters more than cost.

`claude_code` notes:

- Requires the Claude Code CLI on the host running the worker
  (`npm i -g @anthropic-ai/claude-code`, then `claude` once to log in).
  The Docker image installs the CLI; mount your credentials with the
  `~/.claude` volume line in `docker-compose.yml`.
- Every call carries Claude Code's own system prompt (~5k tokens) and
  starts a new process — ~7 s per job on a laptop, 15–30 s inside Docker.
  `AI_CONCURRENCY` (default 3) runs that many CLI processes at once, so
  wall-clock for a tick or "Re-classify all" divides by roughly that
  number; budget ~130 MB RAM per process.
- The subscription has a rolling usage window. When it is exhausted the
  provider logs `claude-code rate-limited`, the job counts as
  `classifyFailed` for this tick, and it is retried on the next tick.
- Running a background service on a consumer subscription is not something
  Anthropic's consumer terms explicitly cover. Check them before making it
  your default.

## Costs

With `AI_PROVIDER=anthropic_api`, roughly **$2-10/month** depending on
classifier mode and how many sources are active:

- Single-stage classifier mode (default): ~$0.001 per classified job, ~5-10 jobs/day = ~$5/month.
- Two-stage classifier mode: ~30-40% reduction in token spend on a
  typical day where most fetched jobs are off-target.
- Discovery harvest doesn't call Claude (only HN parsing → ATS-URL
  detection).
- Anthropic prompt caching gives ~90% read discount on the system
  prompt within the 5-minute window. `AI_CONCURRENCY` requests run at
  once, so the first few of a tick may each pay the cache write.

Postgres + Telegram + GitHub Actions are all free. The whole stack
runs on a $5/month VPS or your laptop.
