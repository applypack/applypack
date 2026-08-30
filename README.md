<div align="center">

# job-hunter

**A self-hosted AI job hunter: it reads the boards so you don't have to.**

[![CI](https://github.com/nazboyko/job-hunter/actions/workflows/test.yml/badge.svg)](https://github.com/nazboyko/job-hunter/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node 24](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](./package.json)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](./tsconfig.json)
[![Release](https://img.shields.io/github/v/release/nazboyko/job-hunter?display_name=tag)](./CHANGELOG.md)

[Quick start](#quick-start) · [What you get](#what-you-get) ·
[How it works](#how-it-works) · [Bring your own AI](#bring-your-own-ai) ·
[What it costs](#what-it-costs) · [Contributing](#contributing)

<img src="docs/screenshots/target.png" alt="Resume match: deterministic 81/100 score with primary-stack verdict, experience confirmations, and the side-by-side editor with keyword highlights" width="900">

<sub>The targeted editor: an honest, deterministic resume-vs-posting score,
one-click experience confirmations, live keyword highlights.</sub>

</div>

You know what you're looking for. The boards keep showing you everything
else, and every "Senior Engineer" listing takes three minutes of reading
to reveal the wrong stack, the wrong country, or a ghost posting.

job-hunter does that reading for you. It watches 16 job sources around
the clock, scores each posting against your real profile, and pings your
Telegram only when something deserves an application. Then it helps you
apply well: it checks whether the job is real, scores your resume against
the posting, and shows you exactly what to change.

Everything runs on your machine. Your resume, your profile and every AI
report stay in your own Postgres. `docker compose up` on a laptop or a
$5 VPS is the whole deployment story.

## What you get

| | |
| --- | --- |
| 🔭 **16 sources, checked hourly** | Greenhouse / Lever / Ashby / Workable / SmartRecruiters boards you pick, plus 11 aggregators and the monthly HN "Who is hiring" thread |
| 🧠 **A classifier with strict rules** | AI reads the full description against your stack, role types, seniority, regions and salary floor. "Full-stack" in a title is not a tech match, and "Remote · Germany" is not a US-remote job |
| 📲 **Telegram instead of tab-refreshing** | alerts above your fit threshold, a daily digest, and a nudge when an application goes quiet for two weeks |
| 🕵️ **Ghost-job verification** | a live web-search checklist (careers page, company footprint, posting age, named humans) returns `legit` / `suspicious` / `fake` with evidence URLs |
| 📄 **Resume scores that can't flatter** | the model marks facts, application code computes the score. A Laravel resume cannot sweet-talk its way to 85 against a Node.js posting, and v2 is honestly comparable to v1 |
| ✍️ **Targeted resume editor** | posting and resume side by side, every keyword highlighted, coverage recomputed on each keystroke without spending a single AI call |
| 🗂 **Application tracking** | a small kanban from *applied* to *offer*, plus reminders for applications gone quiet |
| 🔌 **Five AI backends, auto-failover** | Claude Code / Gemini / Codex CLIs riding your subscriptions, the Anthropic API, or any OpenAI-compatible endpoint including free local models |
| 🧭 **Board discovery** | harvests company ATS boards from HN comments and queues them for a one-click promote |
| 🏠 **Self-hosted and private** | official public APIs and RSS only, dashboard bound to `127.0.0.1`, no accounts, no telemetry |

## Quick start

```bash
git clone https://github.com/nazboyko/job-hunter.git
cd job-hunter
cp .env.example .env    # add one AI engine, see below
docker compose up -d    # postgres + worker + dashboard → http://localhost:4747
```

One line in `.env` is enough to start; the rest is configured in the
dashboard later:

```bash
ANTHROPIC_API_KEY=sk-ant-...                              # Anthropic API
# or: AI_PROVIDER=claude_code + CLAUDE_CODE_OAUTH_TOKEN=… # Claude.ai subscription
# or: GEMINI_API_KEY=...                                  # Gemini (free tier)
# or: OPENAI_API_KEY=... (+ OPENAI_BASE_URL)              # OpenAI, OpenRouter, Groq, local
```

### Your first fifteen minutes

Fetching starts **paused** on a fresh install, on purpose: a blank
profile would classify everything as a miss and waste your AI quota.

1. **Settings → AI engine**: engines from `.env` are already detected.
   Press **Test** on each and watch it reply.
2. **Profile tab**: fill in your stack and preferences by hand, or upload
   your resume on `/resumes` and press **"Fill from a resume"** to review
   an AI-drafted profile before anything is saved.
3. **Notifications tab** (optional): add a Telegram bot. The form
   validates the token by sending you a real message before it saves.
4. **General tab**: press **Resume** on the "Job fetching" switch. Too
   impatient for the hourly tick:
   `docker compose exec app node dist/scripts/fetch-once.js`

From then on it runs itself. Every settings change saves to Postgres on
click: no restarts, no `.env` edits. The worker picks changes up within
the hour; dashboard actions use them immediately.

<details>
<summary><b>Running without Docker</b></summary>

The stack is plain Node + Postgres, so a local setup is first-class:

```bash
docker compose up -d postgres   # or any Postgres 16 you already have
cp .env.example .env            # DATABASE_URL=postgresql://jobhunter:jobhunter@localhost:5432/jobhunter
npm install
npx prisma migrate deploy
npm run seed

npm run dev                     # the cron worker
npm run dev:web                 # the dashboard → http://localhost:4747
```

CLI engines (claude / gemini / codex) are simpler locally: install them
globally, log in once in your terminal, and the probe on the AI tab turns
green. Details per engine in [docs/ai-engines.md](./docs/ai-engines.md).

> `dev:web` compiles with `tsc` and reloads with Node's `--watch` rather
> than `tsx`, a deliberate workaround: see gotcha #2 in
> [CLAUDE.md](./CLAUDE.md#gotchas).

</details>

## How it works

```
 16 sources ──▶ normalize ──▶ base filter ──▶ AI classifier ──▶ Postgres ──▶ Telegram
   hourly        + dedupe      pure code,      your profile,     dashboard    only when
   fetch                       zero cost       strict rules                   fit ≥ threshold
```

Cheap deterministic filters drop the obvious misses first (excluded words
in the title, dead locations). Everything that survives goes to an AI
classifier that reads the full description against **your profile**, with
explicit rules about what counts as a stack match and what counts as a
country lock. Postings that clear your fit threshold land in the
dashboard and, if you want, in your Telegram.

Sourcing is deliberately clean: official public APIs and RSS feeds only,
never scraping. LinkedIn, Indeed, Glassdoor, Workday and Wellfound are
permanently out of scope
([ADR 0005](./docs/adr/0005-no-linkedin-indeed-workday.md)).

### Where the jobs come from

Coverage is two-tier by design, because the big HR vendors have no "all
jobs" API, only per-company endpoints:

- **Direct boards**: Greenhouse, Lever, Ashby, Workable, SmartRecruiters
  boards for companies *you* track. Add one by pasting its board URL on
  `/companies`; the form probes the API live and refuses slugs that
  don't resolve.
- **Aggregators**: RemoteOK, Remotive, We Work Remotely, Jobicy, Working
  Nomads, Himalayas, Laravel Jobs, Golang Projects, Arbeitnow, the HN
  jobs feed and the monthly HN "Who is hiring" thread. Broad and noisy,
  which is fine: the filters and the classifier do the narrowing.

Leave the aggregators on. Turning them off to "only watch real boards"
sounds tidy and produces near-zero new jobs, because a dozen tracked
companies don't post matching roles every week. The long tail comes from
the aggregators; your profile keeps it quiet.

## Bring your own AI

Instead of one hard-coded API key, job-hunter speaks to **five AI
backends**, and you can attach every subscription and key you own:

| Engine | What it is | Billing |
| --- | --- | --- |
| Claude Code CLI | headless `claude -p` | your Claude.ai Pro/Max subscription |
| Gemini CLI | headless `gemini -p` | your Google account (generous free tier) or an AI Studio key |
| Codex CLI | headless `codex exec` | your ChatGPT Plus/Pro subscription |
| Anthropic API | Messages API, prompt-cached | per token |
| OpenAI-compatible API | `POST /chat/completions` to any base URL | OpenAI, OpenRouter, Groq, DeepSeek, or a free local model via LM Studio / Ollama |

On **Settings → AI engine** each backend is a card: enable the ones you
have, arrange them with ↑ Priority, and pick models per engine. Engine #1
serves every call. If it errors, hits a rate limit, or runs out of quota,
the next engine takes over for that call, and #1 is back in charge the
moment it recovers. An engine that fails repeatedly gets a short cooldown
instead of slowing every job down.

The dashboard never guesses about your setup. Every card shows whether
the engine is usable on this machine ("available" vs "not detected", with
the exact missing step), metered engines carry a "pay per token" badge,
and a **Test** button runs one real end-to-end call. A "Last 7 days" line
counts who actually served your calls.

Two model slots per engine keep costs sane: a cheap **classifier model**
reads every fetched job (Haiku 4.5 on the Claude engines) and a strong
**resume model** handles the few judgment calls a day: resume scans,
matches, verification (Opus 5 on the Claude engines).

Setup for every engine, local and Docker, lives in
**[docs/ai-engines.md](./docs/ai-engines.md)**.

One honest note: vendors' consumer-subscription terms don't explicitly
cover running a background service, so read yours before making a
subscription your primary engine. The prompts are tuned against Claude;
expect somewhat different scoring from Gemini or GPT engines (there's a
bench for exactly that: `npm run bench:resume -- --engine all`).

## What it costs

- **Subscriptions you already pay for** (Claude.ai, ChatGPT, Google): $0
  extra. The CLI engines ride the subscription's usage window; when it
  runs dry mid-day, the chain fails over to your next engine and comes
  back on its own.
- **Anthropic API only**: roughly **$2–10/month**. About $0.001 per
  classified job at 5–10 matching jobs a day, with prompt caching
  covering ~90% of the system-prompt tokens. The two-stage classifier
  mode cuts another 30–40%.
- **Free tier**: Gemini CLI's free quota covers the classifier for a
  typical day; a local model via LM Studio / Ollama through the
  OpenAI-compatible engine costs nothing at all.

Postgres, Telegram and GitHub Actions are free. The "Last 7 days" counter
on the AI tab shows exactly which engine your calls went to.

## Day to day

<div align="center">
<img src="docs/screenshots/overview.png" alt="Overview: status counters with 24h deltas, recent alerts, cron health" width="900">
</div>

| Page | URL | What it's for |
| --- | --- | --- |
| Overview | `/` | Counters by status, recent alerts, cron health, pause/resume |
| Jobs | `/jobs` | Filterable, sortable list of everything fetched |
| Paste a job | `/jobs/new` | Save a posting by hand (LinkedIn, email, referral); it gets classified like any other |
| Job detail | `/jobs/:id` | Full description, AI verdict, status actions, verification, resume match, tracking |
| Targeted editor | `/jobs/:id/target` | Posting ↔ resume side by side, live keyword score, edit in place |
| Target | `/target` | One-shot comparison: paste any posting, pick / upload / paste any resume |
| Applications | `/applications` | Kanban: applied → screen → tech → onsite → offer / rejected / ghosted |
| Resumes | `/resumes` | Upload `.pdf` / `.docx` / `.md` / `.txt`, AI scan, version history |
| Companies | `/companies` | Tracked boards; add new ones with a live probe that refuses bad slugs |
| Discovery | `/discovery` | Board candidates harvested from HN, with the discovery toggles |
| Runs | `/runs` | The last 100 cron runs with stats and errors |
| Settings | `/settings` | Five tabs: General · Profile · AI engine · Notifications · Sources |

<div align="center">
<img src="docs/screenshots/jobs.png" alt="Jobs: full-width table with fit scores, status filters and sticky header" width="900">
</div>

**The resume toolkit, in practice.** Upload the resumes you actually send
on `/resumes`; each gets one AI scan (headline, seniority, skill tags,
job-agnostic ATS issues). On any job page, **Compare** runs the match and
stores the report. On the targeted editor you fix the resume in place,
watching keyword coverage update as you type, free of AI calls. When the
draft feels right, "Re-analyze with AI" gives the honest rubric score and
"Save as vN" keeps the version. The next report shows "▲ +16 vs v1", and
the delta is real because the scoring is deterministic.

<details>
<summary><b>The worker's schedule</b> (six cron jobs, <code>TZ</code> from <code>.env</code>)</summary>

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

</details>

## Under the hood

TypeScript strict, Node 24, Prisma + Postgres 16, Hono for the dashboard
(server-side JSX, no build step), node-cron for scheduling. Deliberately
no Redis, no queues, no framework sprawl. Every external byte (env vars,
API responses, AI output) passes through zod before it's trusted. The
worker and the dashboard are separate processes sharing one database, so
a toggle flipped in the UI reaches the worker on its next tick.

```bash
npm run lint:types   # tsc --noEmit
npm test             # node --test, 400+ unit tests on the pure modules
```

CI runs both on every push. AI- and DB-touching modules are verified by
smoke runs and the dashboard instead of mocks; the philosophy is written
down in [CLAUDE.md](./CLAUDE.md).

> **Docs map:** [SPEC.md](./SPEC.md) — current behaviour, phase by phase ·
> [ARCHITECTURE.md](./ARCHITECTURE.md) — data-flow diagrams + file map ·
> [CLAUDE.md](./CLAUDE.md) — conventions, gotchas, where-to-look tables ·
> [docs/ai-engines.md](./docs/ai-engines.md) — AI setup, local + Docker ·
> [docs/adr/](./docs/adr/) — every non-obvious decision, with reasons ·
> [CHANGELOG.md](./CHANGELOG.md) — releases.

## Contributing

Three good entry points:

- **Add a job source.** The highest-value contribution, and close to a
  one-file change: CLAUDE.md ships three copy-paste fetcher templates
  (single RSS, per-company JSON, list + detail). Propose the source in an
  issue first if you're unsure it fits the sourcing policy.
- **Grab a [good first issue](https://github.com/nazboyko/job-hunter/labels/good%20first%20issue).**
  Scoped tasks with file pointers.
- **Break it and report.** A fresh-machine setup that stumbled, an ATS
  edge case, a resume that parses badly: issues with logs are gold.

[CONTRIBUTING.md](./CONTRIBUTING.md) is a five-minute read covering
setup, tests and conventions. The sourcing policy is non-negotiable:
official public APIs and RSS only, never scraping
([ADR 0005](./docs/adr/0005-no-linkedin-indeed-workday.md)).

<a href="https://github.com/nazboyko/job-hunter/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=nazboyko/job-hunter" alt="Contributors" />
</a>

## License

MIT — see [LICENSE](./LICENSE).

Built and maintained by [Nazar Boyko](https://github.com/nazboyko).
Every decision that was not obvious is written down in
[docs/adr/](./docs/adr/).
