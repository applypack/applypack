# job-hunter

[![CI](https://github.com/nazboyko/job-hunter/actions/workflows/test.yml/badge.svg)](https://github.com/nazboyko/job-hunter/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node 24](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](./package.json)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](./tsconfig.json)
[![Release](https://img.shields.io/github/v/release/nazboyko/job-hunter?display_name=tag)](./CHANGELOG.md)

**Self-hosted AI job hunter.** Watches 16 ATS / aggregator sources, scores
every posting with Claude against *your* profile, tells you whether a
posting is a ghost job, compares your resume with it, and pings Telegram
when something is worth applying to. Runs on your laptop or a $5 VPS with
`docker compose up`.

Built for people who are tired of scrolling job boards and want a filter
that understands the difference between "Senior Rails engineer" and
"Senior PHP engineer".

![Job Hunter — Overview: status counters with 24h deltas, recent alerts, cron health](docs/screenshots/overview.png)

## Highlights

- **Profile, not keywords** — stack, role types, seniority, regions, salary
  floor, fit threshold. Claude reads each posting against the profile with
  explicit tech-stack and country-lock rules.
- **Two-stage classifier** — a short, cached prefilter prompt drops obvious
  misses; the full prompt only runs on survivors. Same model, 30–40 % fewer
  tokens.
- **Is this job real?** — ghost-job checklist run with web search: careers
  page, company footprint, posting age, named humans, scam flags. Verdict +
  evidence URLs.
- **Resume match** — upload your resume, compare it with any posting: match
  score, red flags, prioritised edits, keyword coverage. Then edit it in a
  side-by-side **targeted view** with a live score.
- **Application tracking** — kanban from *applied* to *offer*, plus a daily
  nudge for applications that went quiet.
- **Discovery** — harvests ATS URLs from HN "Who is hiring" threads and
  proposes new companies to track.
- **Clean sourcing** — official public APIs and RSS only. No LinkedIn /
  Indeed / Workday scraping ([ADR 0005](./docs/adr/0005-no-linkedin-indeed-workday.md)).
- **Five AI engines, one chain** — Anthropic API, Claude Code CLI, Gemini
  CLI, any OpenAI-compatible API (OpenAI / OpenRouter / Groq / local), Codex
  CLI. Enable what you own, set the priority, and calls fail over
  automatically when an engine errors or rate-limits
  ([setup guide](./docs/ai-engines.md)).

> **Docs map:** [SPEC.md](./SPEC.md) — current state.
> [ARCHITECTURE.md](./ARCHITECTURE.md) — diagrams + file map.
> [CLAUDE.md](./CLAUDE.md) — conventions + gotchas + where-to-look.
> [docs/adr/](./docs/adr/) — non-trivial decisions.
> [CHANGELOG.md](./CHANGELOG.md) — releases.
> [SPEC-phase1.md](./SPEC-phase1.md) — historical Phase 1 spec.

## Quick start

```bash
git clone https://github.com/nazboyko/job-hunter.git
cd job-hunter

cp .env.example .env
# Pick at least one AI engine (all five in docs/ai-engines.md), e.g.:
#   ANTHROPIC_API_KEY=sk-ant-...        (Anthropic API, pay per token)
#   AI_PROVIDER=claude_code + CLAUDE_CODE_OAUTH_TOKEN=...  (Claude.ai subscription)
#   GEMINI_API_KEY=... / OPENAI_API_KEY=...
# The rest is configured later on /settings → AI engine (priority + models).
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
   + a blank starter profile, registers 6 cron jobs, idles. Fetching
   starts **paused**: fill the profile (fastest: upload a resume and use
   "Fill from a resume" on `/settings` → Profile), then hit Resume on
   the Overview page or `/settings` → General.
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

16 source types, all on official public APIs / RSS — no scraping.

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

**Discovery:** if you turn on Auto-discovery + HN parser on `/discovery`,
the system auto-finds candidate companies from URLs in HN comments.
Review on `/discovery` and click **Promote** to start tracking.

**Seed (rare):** edit `src/seed.ts` and run `docker compose exec app
node dist/seed.js`. Idempotent on `(atsType, atsToken)`. Disabling a
company through the UI persists across reseeds.

## Dashboard

Bound to `127.0.0.1:4747`. Optional `WEB_BASIC_AUTH=user:password` in
`.env` to enable HTTP Basic Auth.

![Job Hunter — Jobs: full-width table with fit scores, status filters and sticky header](docs/screenshots/jobs.png)

| Page         | URL              | What it shows                                                        |
| ------------ | ---------------- | -------------------------------------------------------------------- |
| Overview     | `/`              | Counters by status, recent alerts, cron health                       |
| Jobs         | `/jobs`          | Filterable + sortable + paginated list                               |
| Paste a job  | `/jobs/new`      | Save a posting by hand (LinkedIn, email, referral) — classified like any other |
| Job detail   | `/jobs/:id`      | Full description, Claude output, status actions, **is this job real?**, **resume match**, application tracking, re-classify |
| Targeted     | `/jobs/:id/target` | Posting ↔ resume side by side, keyword highlights, in-place editing with live coverage score, AI re-analysis of the draft |
| Target       | `/target`        | Pure comparison: paste a posting, pick / upload / paste a resume — a live progress page runs classify → AI match and opens the targeted view. Uploads here never land in your Resumes |
| Applications | `/applications`  | Kanban (applied → screen → tech → onsite → offer / rejected / ghosted) |
| Resumes      | `/resumes`       | Upload `.pdf` / `.docx` / `.md` / `.txt`, AI scan (headline, skills, issues), comparison history |
| Resume       | `/resumes/:id`   | Scan result, job-agnostic issues, comparisons, extracted text, download |
| Companies    | `/companies`     | Sources list, manual add (with probe), per-row toggle / delete       |
| Discovery    | `/discovery`     | Pending / Promoted / Ignored / Dead candidates harvested by HN parser |
| Runs         | `/runs`          | Last 100 cron runs with stats / errors                               |
| Settings     | `/settings`      | Active profile editor, resumes, 8 toggles, telegram targets, source family on/off |
| Health       | `/health`        | JSON liveness for external monitoring                                |

### Profiles

`/settings` → "Active profile" lets you edit (or prefill in one click with
**"Fill from a resume"** — AI maps your scanned resume onto the fields and
shows a draft to review before saving):

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

The **Target** page in the menu (`/target`) starts this flow from scratch:
paste a posting, then pick an uploaded resume, upload a file or paste plain
text — a progress page shows each step (classify → AI match, ~1-2 min) and
opens the result. Target is a *pure comparison*: an uploaded or pasted
resume lives on one hidden scratch slot, every new upload replaces the
previous analysis, and nothing is added to your Resumes. The match score uses a
primary-stack gate — a posting's core language/framework missing from the
resume caps the score hard, so a Laravel resume cannot score 80+ against a
Node.js posting. Otherwise, "Open targeted view →" on any comparison (`/jobs/:id/target`) puts the
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
| Job fetching (master switch)  | No new jobs or alerts; dashboard, digest, cleanup and discovery keep running |
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
npm test               # node --test via tsx, ~300 tests
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

Every AI call goes through one seam, `src/ai-provider.ts`. On
**`/settings` → "AI engine"** you enable the engines you own, put them in
priority order, and pick per-engine models. **Engine #1 serves every call;
on an error or rate limit the next enabled engine takes over automatically**
and control returns as soon as #1 recovers (ADR 0013/0014). `AI_PROVIDER`
in `.env` only seeds the default before you configure anything.

| Engine | How it runs | Billing |
| --- | --- | --- |
| `anthropic_api` | `@anthropic-ai/sdk` → Messages API, system prompt cached | per token, `ANTHROPIC_API_KEY` |
| `claude_code` | spawns `claude -p` per job | Claude.ai Pro/Max subscription |
| `gemini_cli` | spawns `gemini -p` per job | Google account or `GEMINI_API_KEY` |
| `openai_api` | `POST /chat/completions` via fetch | OpenAI / OpenRouter / Groq key, or a free local server (`OPENAI_BASE_URL`) |
| `codex_cli` | spawns `codex exec` per job | ChatGPT Plus/Pro subscription |

Each engine has two model slots — the **classifier model** (cheap, runs on
every fetched job; Haiku 4.5 for the Claude engines) and the **resume
model** (resume scan / match / verification; Opus 5 for the Claude
engines). Closed families are dropdowns, so a wrong-family id cannot be
saved; every card has a **Test** button that runs one live call end-to-end.

**Setup for every engine — local (no Docker) and Docker, step by step:
[docs/ai-engines.md](./docs/ai-engines.md).**

CLI engine notes (claude_code / gemini_cli / codex_cli):

- Every call starts a process and carries the CLI's own system prompt —
  ~7 s per job on a laptop, 15–30 s inside Docker. `AI_CONCURRENCY`
  (default 3) runs that many processes at once; budget ~130 MB RAM each.
- A subscription has a rolling usage window. When it is exhausted the call
  fails over to the next engine (or, with a one-engine chain, the job is
  retried next tick).
- Running a background service on a consumer subscription is not something
  the vendors' consumer terms explicitly cover. Check them before making
  one your primary.
- The prompts are tuned against Claude (see CLAUDE.md gotchas 8 and 11) —
  expect somewhat different scoring from Gemini / GPT engines.

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

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Bug reports and new-source PRs
are welcome; the ATS templates in CLAUDE.md make a new fetcher a
one-file change.

## License

MIT — see [LICENSE](./LICENSE).

## Author

[Nazar Boyko](https://github.com/nazboyko). Designed, built and maintained
solo; every decision that was not obvious is written down in
[docs/adr/](./docs/adr/).
