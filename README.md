# job-hunter

[![CI](https://github.com/nazboyko/job-hunter/actions/workflows/test.yml/badge.svg)](https://github.com/nazboyko/job-hunter/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node 24](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](./package.json)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](./tsconfig.json)
[![Release](https://img.shields.io/github/v/release/nazboyko/job-hunter?display_name=tag)](./CHANGELOG.md)

**A self-hosted AI job hunter.** It watches 16 job sources around the clock,
reads every posting the way you would, and only interrupts you when
something is actually worth applying to. Then it helps you apply well:
it checks whether the job is real, scores your resume against the posting,
and tells you exactly what to change.

Built for one specific kind of tired: you know what you're looking for,
the boards keep showing you everything else, and every "Senior Engineer"
listing needs three minutes of reading to discover it's the wrong stack,
the wrong country, or a ghost. This tool does that reading for you.

Everything runs on your machine — your resume, your profile, and every AI
report stay in your own Postgres. `docker compose up` on a laptop or a $5
VPS is all it takes.

![Job Hunter — Overview: status counters with 24h deltas, recent alerts, cron health](docs/screenshots/overview.png)

## How it works

Once an hour, the worker pulls fresh postings from every enabled source.
Cheap deterministic filters drop the obvious misses first (excluded words in
the title, dead locations). Everything that survives goes to an AI
classifier that reads the full description against **your profile** — the
stack you actually use, the role types you accept, seniority, regions,
salary floor — with strict rules about what counts as a match: `full-stack`
in a title is not a tech match, and "Remote · Germany" is not a US-remote
job. Postings that clear your fit threshold land in the dashboard and, if
you want, in your Telegram.

From there the toolkit takes over:

- **"Is this job real?"** runs a ghost-job checklist with live web search —
  careers page, company footprint, posting age, named humans, scam flags —
  and returns a verdict (`legit` / `suspicious` / `fake`) with the evidence
  URLs it used. Built for postings you paste in from LinkedIn or email.
- **Resume match** compares any resume against any posting: a score with a
  fixed rubric, keyword coverage (present / missing / can't honestly claim),
  red flags, prioritised edits — and what to *remove*. The score itself is
  computed by application code from facts the model marks, not invented by
  the model, so a Laravel resume cannot sweet-talk its way to 85 against a
  Node.js posting, and v2 is genuinely comparable to v1.
- **The targeted editor** puts the posting and your resume side by side with
  every keyword highlighted, lets you edit the resume in place, and recomputes
  keyword coverage live in the browser as you type. One click sends the
  draft back to the AI for the full rubric score; another saves it as a new
  version.
- **Application tracking** keeps a small kanban from *applied* to *offer*
  and nudges you about applications that went quiet for two weeks.
- **Discovery** harvests company ATS boards from Hacker News "Who is
  hiring" threads and proposes them as new sources to track.

Sourcing is deliberately clean: official public APIs and RSS feeds only,
never scraping. LinkedIn, Indeed, Glassdoor, Workday and Wellfound are
permanently out of scope ([ADR 0005](./docs/adr/0005-no-linkedin-indeed-workday.md)).

## Bring your own AI — all of it

This is the part that makes the tool practical to run all day. Instead of
one hard-coded API key, job-hunter speaks to **five AI backends**, and you
can attach every subscription and key you own:

| Engine | What it is | Billing |
| --- | --- | --- |
| Claude Code CLI | headless `claude -p` | your Claude.ai Pro/Max subscription |
| Gemini CLI | headless `gemini -p` | your Google account (free tier is generous) or an AI Studio key |
| Codex CLI | headless `codex exec` | your ChatGPT Plus/Pro subscription |
| Anthropic API | Messages API, prompt-cached | per token |
| OpenAI-compatible API | `POST /chat/completions` to any base URL | OpenAI, OpenRouter, Groq, DeepSeek — or a free local model via LM Studio / Ollama |

On **Settings → AI engine** each backend is a card: enable the ones you
have, arrange them with ↑ Priority, and pick models per engine from
dropdowns that only offer that family's models (a wrong id is impossible to
save). Engine **#1 serves every call. If it errors, hits a rate limit, or
runs out of quota, the next engine takes over automatically for that call —
and #1 is back in charge the moment it recovers.** An engine that fails
repeatedly is put on a short cooldown instead of slowing every job down.

The dashboard never guesses about your setup. Every card shows whether the
engine is actually usable on this machine ("available" vs "not detected",
with the exact missing step), metered engines carry a "pay per token" badge
and a warning when you place one behind subscriptions as a paid fallback,
and a **Test** button runs one real end-to-end call and reports the response
time. A "Last 7 days" line counts who actually served your calls, and any
report produced by a fallback engine is marked as such.

Two model slots per engine keep costs sane: a cheap **classifier model**
that reads every fetched job (Haiku 4.5 on the Claude engines) and a strong
**resume model** for the handful of judgment calls a day — resume scans,
matches, verification (Opus 5 on the Claude engines).

Setup for every engine, both with and without Docker, lives in
**[docs/ai-engines.md](./docs/ai-engines.md)** — including details like
using a Gemini API key with zero extra code through the OpenAI-compatible
engine, and why a Claude subscription needs `claude setup-token` inside
Docker on macOS.

One honest note: running a background service on a consumer AI subscription
is not something the vendors' terms explicitly cover — read yours before
making a subscription your primary engine. The prompts are tuned against
Claude, so expect somewhat different scoring from Gemini or GPT engines
(there's a bench for exactly that: `npm run bench:resume -- --engine all`).

## Quick start (Docker)

```bash
git clone https://github.com/nazboyko/job-hunter.git
cd job-hunter

cp .env.example .env
# Give it at least one AI engine — any of these works:
#   ANTHROPIC_API_KEY=sk-ant-...                          (Anthropic API)
#   AI_PROVIDER=claude_code + CLAUDE_CODE_OAUTH_TOKEN=... (Claude.ai subscription)
#   GEMINI_API_KEY=...                                    (Gemini, free tier)
#   OPENAI_API_KEY=... (+ OPENAI_BASE_URL for OpenRouter/Groq/local)
# Everything else is configured later in the dashboard.

docker compose up -d
```

Three containers come up: **postgres** (16, persistent volume), **app**
(the cron worker — applies migrations, seeds sources and a blank starter
profile, registers six cron jobs) and **web** (the dashboard at
<http://localhost:4747>, bound to `127.0.0.1` so it is never exposed to the
network by default; add `WEB_BASIC_AUTH=user:password` to `.env` if you
want a login prompt anyway).

### Your first fifteen minutes

Fetching starts **paused** on a fresh install — on purpose. A blank profile
would classify everything as a miss and waste your AI quota. The path:

1. Open <http://localhost:4747/settings?tab=ai>. Your engines from `.env`
   are already detected — press **Test** on each and watch it reply.
   Enable more engines, order them, adjust models if you care.
2. Go to the **Profile** tab. Fill in your stack and preferences by hand —
   or upload your resume on `/resumes` first and press **"Fill from a
   resume"**: the AI maps your scanned resume onto the profile fields and
   shows you a draft to review before anything is saved.
3. (Optional) **Notifications** tab: add a Telegram bot so alerts reach
   your phone. The form validates the token by actually sending you a
   message before it saves. To create a bot: [@BotFather](https://t.me/BotFather);
   your chat id comes from `https://api.telegram.org/bot<TOKEN>/getUpdates`
   after you message the bot once.
4. Back to **General** → press **Resume** on the "Job fetching" switch.
   The next hourly tick pulls, classifies and (if warranted) alerts. Too
   impatient to wait for the tick:

   ```bash
   docker compose exec app node dist/scripts/fetch-once.js
   ```

From then on it runs itself. Every settings change saves to Postgres the
moment you click — no restarts, no `.env` edits; the worker picks changes
up within the hour, dashboard actions use them immediately.

## Running without Docker

The stack is plain Node + Postgres, so a local setup is first-class — you
only need a database:

```bash
docker compose up -d postgres   # or any Postgres 16 you already have
cp .env.example .env            # DATABASE_URL=postgresql://jobhunter:jobhunter@localhost:5432/jobhunter
npm install
npx prisma migrate deploy
npm run seed

npm run dev                     # the cron worker
npm run dev:web                 # the dashboard → http://localhost:4747
```

CLI engines (claude / gemini / codex) are even simpler locally: install
them globally, log in once in your terminal, and the probe on the AI tab
turns green — no tokens or mounts needed. Details per engine in
[docs/ai-engines.md](./docs/ai-engines.md).

> `dev:web` compiles with `tsc` and reloads with Node's `--watch` rather
> than `tsx` — a deliberate workaround, see gotcha #2 in
> [CLAUDE.md](./CLAUDE.md#gotchas).

## Day to day

| Page | URL | What it's for |
| --- | --- | --- |
| Overview | `/` | Counters by status, recent alerts, cron health, pause/resume |
| Jobs | `/jobs` | Filterable, sortable list of everything fetched |
| Paste a job | `/jobs/new` | Save a posting by hand (LinkedIn, email, referral) — it gets classified like any other |
| Job detail | `/jobs/:id` | Full description, AI verdict, status actions, verification, resume match, tracking |
| Targeted editor | `/jobs/:id/target` | Posting ↔ resume side by side, live keyword score, edit in place |
| Target | `/target` | One-shot comparison: paste any posting, pick/upload/paste any resume — without touching your saved resumes |
| Applications | `/applications` | Kanban: applied → screen → tech → onsite → offer / rejected / ghosted |
| Resumes | `/resumes` | Upload `.pdf` / `.docx` / `.md` / `.txt`, AI scan, version history |
| Companies | `/companies` | Tracked boards; add new ones with a live probe that refuses bad slugs |
| Discovery | `/discovery` | Board candidates harvested from HN, with the discovery toggles |
| Runs | `/runs` | The last 100 cron runs with stats and errors |
| Settings | `/settings` | Five tabs: General · Profile · AI engine · Notifications · Sources |

![Job Hunter — Jobs: full-width table with fit scores, status filters and sticky header](docs/screenshots/jobs.png)

The worker's schedule (`TZ` from `.env`, UTC by default):

| Cron | Job | What it does |
| --- | --- | --- |
| `5 * * * *` | fetch | Pull all sources → filter → classify → alert |
| `0 9 * * *` | digest | Telegram digest of the last 24h of new/alerted jobs |
| `0 8 * * *` | stale-applications | Nudge for applications quiet for 14+ days |
| `0 3 * * 0` | cleanup | Drop dismissed jobs older than 30 days, trim usage counters |
| `0 4 * * 0` | discovery | Re-probe pending company candidates |
| `0 6 1 * *` | hn-hiring | Pull the monthly HN "Who is hiring" thread |

Every cron has a matching one-shot script for manual runs
(`docker compose exec app node dist/scripts/<name>-once.js`, or
`npm run <name>:once` locally).

## Where the jobs come from

Coverage is two-tier by design, because the big HR vendors have no "all
jobs" API — only per-company endpoints:

- **Direct boards** — Greenhouse, Lever, Ashby, Workable, SmartRecruiters
  boards for companies *you* choose to track. Precise, but only as broad as
  your list. Add one by pasting its board URL on `/companies`; the form
  probes the API live and refuses slugs that don't resolve.
- **Aggregators** — RemoteOK, Remotive, We Work Remotely, Jobicy, Working
  Nomads, Himalayas, Laravel Jobs, Golang Projects, Arbeitnow, the HN jobs
  feed and the monthly HN "Who is hiring" thread. Broad and noisy — which
  is fine, because the filters and the classifier do the narrowing.

Leave the aggregators on. Turning them off to "only watch real boards"
sounds tidy and reliably produces near-zero new jobs — a dozen tracked
companies simply don't post matching roles every week. The long tail comes
from the aggregators; your profile keeps it quiet.

When you spot a company elsewhere, paste its board URL on `/companies` —
or let **Discovery** do it: the HN parser spots Greenhouse/Lever/Ashby URLs
in comments and queues them on `/discovery` for a one-click promote.

## The resume toolkit, in practice

Upload the resumes you actually send on `/resumes`. Each gets one AI scan
(headline, seniority, skill tags, job-agnostic ATS issues — including a
"what the ATS sees" text check). Then, on any job page, **Compare** runs
the match and stores the report; on the targeted editor you fix the resume
right there, watching keyword coverage update on every keystroke without
spending a single AI call. When the draft feels right, "Re-analyze with
AI" gives the honest rubric score, and "Save as vN" keeps the version —
the next report shows "▲ +16 vs v1", and the delta is real because the
scoring is deterministic.

The **Target** page runs the same flow for things outside your pipeline: a
posting from anywhere, a resume from anywhere (even pasted plain text — say,
a friend's), one progress page, full report. Nothing from it lands in your
saved resumes.

## What it costs

The realistic setups:

- **Subscriptions you already pay for** (Claude.ai, ChatGPT, Google) —
  $0 extra. The CLI engines ride the subscription's usage window; when it
  runs dry mid-day, the chain fails over to your next engine and comes
  back on its own.
- **Anthropic API only** — roughly **$2–10/month**: about $0.001 per
  classified job at 5–10 matching jobs a day, with prompt caching covering
  ~90% of the system-prompt tokens. The two-stage classifier mode (Settings
  → AI engine) cuts another 30–40% by letting a short prefilter drop
  obvious misses before the full prompt runs.
- **Free tier** — Gemini CLI's free quota comfortably covers the
  classifier for a typical day; a local model via LM Studio/Ollama through
  the OpenAI-compatible engine costs nothing at all.

Postgres, Telegram and GitHub Actions are free. The "Last 7 days" counter
on the AI tab shows exactly which engine your calls went to.

## Under the hood

TypeScript strict, Node 24, Prisma + Postgres 16, Hono for the dashboard
(server-side JSX, no build step), node-cron for scheduling — deliberately
no Redis, no queues, no framework sprawl. Every external byte (env vars,
API responses, AI output) passes through zod before it's trusted. The
worker and the dashboard are separate processes sharing one database, so a
toggle flipped in the UI reaches the worker on its next tick.

```bash
npm run lint:types   # tsc --noEmit
npm test             # node --test, 400+ unit tests on the pure modules
```

CI runs both on every push. AI- and DB-touching modules are verified by
smoke runs and the dashboard instead of mocks — the philosophy is written
down in [CLAUDE.md](./CLAUDE.md).

> **Docs map:** [SPEC.md](./SPEC.md) — current behaviour, phase by phase ·
> [ARCHITECTURE.md](./ARCHITECTURE.md) — data-flow diagrams + file map ·
> [CLAUDE.md](./CLAUDE.md) — conventions, gotchas, where-to-look tables ·
> [docs/ai-engines.md](./docs/ai-engines.md) — AI setup, local + Docker ·
> [docs/adr/](./docs/adr/) — every non-obvious decision, with reasons ·
> [CHANGELOG.md](./CHANGELOG.md) — releases.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Bug reports and new-source PRs
are welcome — the ATS templates in CLAUDE.md make a new fetcher close to a
one-file change.

## License

MIT — see [LICENSE](./LICENSE).

## Author

[Nazar Boyko](https://github.com/nazboyko). Designed, built and maintained
solo; every decision that was not obvious is written down in
[docs/adr/](./docs/adr/).
