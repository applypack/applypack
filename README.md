<div align="center">

# ApplyPack

**Free, open-source job search that gets your resume past the keyword filter.**

[![CI](https://github.com/applypack/applypack/actions/workflows/test.yml/badge.svg)](https://github.com/applypack/applypack/actions/workflows/test.yml)
[![Live demo](https://img.shields.io/badge/live%20demo-applypack.dev-047857)](https://applypack.dev/demo/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node 24](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](./package.json)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](./tsconfig.json)
[![Release](https://img.shields.io/github/v/release/applypack/applypack?display_name=tag)](./CHANGELOG.md)

[Quick start](#quick-start) · [What you get](#what-you-get) ·
[How it works](#how-it-works) · [Bring your own AI](#bring-your-own-ai) ·
[What it costs](#what-it-costs) · [Contributing](#contributing)

<img src="docs/screenshots/target.png" alt="Tailor resume: a deterministic 70/100 score capped by the primary-stack verdict, nine suggested edits, experience confirmations, and the posting beside the resume with every keyword weighted and counted" width="900">

<sub>Tailor resume: an honest, deterministic resume-vs-posting score,
one-click experience confirmations, live keyword highlights.</sub>

</div>

Companies screen resumes with AI and ATS keyword filters now. The filter
counts words, not years: "PHP 8, Laravel, Symfony" can miss a requirement
that says "PHP", and a recruiter never sees the fifteen years behind it.
Half the postings are noise on top: the wrong stack in paragraph four,
"Remote" that means remote in Germany, a listing nobody will ever fill.

ApplyPack watches 33 kinds of job source around the clock, drops the fake
and wrong-fit postings, shows exactly which words a posting wants and your
resume lacks, helps you fix it in place, and writes a cover letter that
cannot invent. Then it tracks the application. It is built for software
engineers: the sources are engineering boards, the resume scan reads for a
tech stack, and the scoring gates on one.

- **Find real jobs.** 33 kinds of job source hourly, a classifier with strict stack
  and location rules, a ghost-job check with evidence links, Telegram only
  above your fit threshold, several searches at once.
- **Fix the resume for this posting.** The model marks facts, code
  computes the score. Edit side by side with a live score; honest deltas
  between versions. [Try it live →](https://applypack.dev/demo/)
- **Write the letter without inventing.** Fact-gated against your resume
  and your confirmed facts. PDF / DOCX.

I built it during my own job search and found my job with it
([the story](https://applypack.dev/#story)). Everything runs on your
machine: your resume, your profile and every AI report stay in your own
Postgres, and `docker compose up` on a laptop or a $5 VPS is the whole
deployment. MIT, no accounts, no telemetry, no ads. Bring your own AI: a
subscription you already pay for, a key, or a local model.

## What you get

The three things above, in full. Every line is a shipped feature, not a
roadmap item.

<details>
<summary><b>The whole list, one line each</b></summary>

| | |
| --- | --- |
| 🔭 **33 kinds of job source, checked hourly** | The number counts *kinds* of board, not companies: twelve ATS vendors — Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Breezy, BambooHR, Pinpoint, Rippling, Personio, Teamtailor — on as many companies as you care to add, twenty cross-company aggregators (DOU and Djinni for Ukraine, solid.jobs for Poland, the DevITjobs sites for Germany, the UK and the Netherlands, Landing.jobs for Portugal, JobTech for Sweden, Adzuna and France Travail with your own free key, the monthly HN "Who is hiring" thread among them), and any RSS/Atom feed you paste. How many run on *your* install is the Companies page's number, not this one. Curated **starter packs** add a whole segment of companies at once |
| 🚀 **A guided first run** | `/welcome` walks a first install through connecting an AI, proving the search works, turning a resume into a profile, and scoring the first matches — four clicks and one file pick |
| 🎯 **Several searches at once** | Backend and QA, or contract and full-time: each search has its own stack, thresholds, resume and Telegram chat, and up to eight run in parallel. One AI call per posting scores all of them, so a second direction costs almost nothing |
| 🧠 **A classifier with strict rules** | AI reads the full description against your stack, role types, seniority, regions and salary floor. "Full-stack" in a title is not a tech match, and "Remote · Germany" is not a US-remote job |
| 📲 **Telegram or Discord instead of tab-refreshing** | alerts above your fit threshold, a daily digest, and a nudge when an application goes quiet for two weeks |
| 🕵️ **Ghost-job verification** | a live web-search checklist (careers page, company footprint, posting age, named humans) returns `legit` / `suspicious` / `fake` with evidence URLs |
| 📄 **Resume scores that can't flatter** | the model marks facts, application code computes the score. A Laravel resume cannot sweet-talk its way to 85 against a Node.js posting, and v2 is honestly comparable to v1 |
| ✍️ **Tailor resume** | posting and resume side by side, every keyword highlighted, coverage recomputed on each keystroke without spending a single AI call. Save writes the accepted edits back into your own `.docx`, formatting intact ([ADR 0038](./docs/adr/0038-save-patches-the-users-docx-in-place.md)) |
| 🖨 **A clean version of a resume that cannot be edited** | a PDF has no paragraphs to patch. One press re-typesets it as a single-column `.docx` and `.pdf` in your own font, sizes, accent and margins — and the `.docx` it saves is one the editor can write into ([ADR 0039](./docs/adr/0039-clean-render-from-json-resume.md)) |
| 💌 **Cover letters that can't invent facts** | drafted from the posting, your resume and your own angle notes; every claim passes a fact gate against stored evidence, and the letter exports to PDF / DOCX |
| 🗂 **Application tracking** | a kanban with columns you name yourself, the resume each application went out with, and reminders for the ones gone quiet |
| 🔌 **Five AI backends, auto-failover** | Claude Code / Gemini / Codex CLIs riding your subscriptions, the Anthropic API, or any OpenAI-compatible endpoint including free local models |
| ⭐ **A watchlist of companies you name** | paste a list of career-page URLs; each is resolved to the job board or feed behind it, checked on your interval, marked ★ in the list and in Telegram, and — if you say so — alerting on **every** posting it puts up, threshold or not. A company whose careers page publishes nothing a machine can read still gets watched: we hash the page and tell you when it changes, without pretending to know the jobs. It reads only what a site publishes for machines: no headless browser, and robots.txt decides ([ADR 0036](./docs/adr/0036-watchlist-reads-published-data-only.md)) |
| 🧭 **Board discovery** | harvests company ATS boards from HN comments and queues them for a one-click promote |
| 🛡 **Job posts can't hijack the prompt** | every posting, resume and web page reaches the model inside explicit untrusted-text markers, and a test fails the build if a new AI call site skips them |
| 🏠 **Self-hosted and private** | official public APIs and RSS only, dashboard bound to `127.0.0.1`, no accounts, no telemetry |
| 🪑 **Employer mode (off by default)** | the other side of the table: a folder of resumes against one position, screened against criteria you write in your own words — every answer with its quote, the score computed in code, names and personal details removed before any model reads a word, a shortlist compared side by side and by the model, your own decisions held against the order, a person deciding. See [Employer mode](#employer-mode-screening-a-folder-of-resumes) below before turning it on ([ADR 0047](./docs/adr/0047-screening-scores-evidence-not-keywords.md)–[0052](./docs/adr/0052-calibration-reports-agreement-and-never-tunes-the-rubric.md)) |

</details>

## Quick start

```bash
git clone https://github.com/applypack/applypack.git
cd applypack
cp .env.example .env    # nothing to fill in yet
docker compose up -d    # postgres + worker + dashboard → http://localhost:4747
```

**You don't need an API key before the first boot.** Paste one into the
dashboard instead — step 1 of `/welcome`, or **Settings → AI engine** any
time. Keys are stored in Postgres, shown masked, and never logged
([ADR 0027](./docs/adr/0027-ai-keys-in-the-database.md)); `.env` is only the
fallback for engines that have no key saved.

If you'd rather keep credentials in the file, one line still does it:

```bash
ANTHROPIC_API_KEY=sk-ant-...                              # Anthropic API
# or: AI_PROVIDER=claude_code + CLAUDE_CODE_OAUTH_TOKEN=… # Claude.ai subscription
# or: GEMINI_API_KEY=...                                  # Gemini (free tier)
# or: OPENAI_API_KEY=... (+ OPENAI_BASE_URL)              # OpenAI, OpenRouter, Groq, local
```

Either way the AI tab shows, per engine, whether it is usable on this
machine and where its credential came from.

### Your first fifteen minutes

The dashboard opens on a five-step setup (`/welcome`) and walks you
through it — about five clicks and one file pick:

1. **Connect an AI** — paste a key straight into the page, or let it
   detect the engine already configured in `.env` or logged in on this
   machine. A Test button proves the connection before you move on.
2. **Test the search** — one button asks the aggregator boards, the ones
   that publish every posting they have, and stores what it finds: no AI
   spent, about twenty seconds. Say where you work and the boards that can
   narrow by place will.
3. **Tell us about you** — upload your resume; the summary it comes back
   with ("looks like you're a senior backend engineer — PHP, Laravel…")
   becomes your search profile with one click. No resume handy: three
   questions instead.
4. **Turn on the boards for your countries** — DOU and Djinni for Ukraine,
   solid.jobs for Poland, Arbeitnow for Germany …, one press.
5. **See your first matches** — score the jobs found, read the top five,
   then **Start the hourly watch**.

Fetching starts **paused** until that last click, on purpose: a blank
profile would classify everything as a miss and waste your AI quota.
Telegram or Discord alerts are optional — **Settings → Notifications**
whenever you like. Skipped the wizard? The Overview keeps a "Finish setup" link.

From then on it runs itself. Every settings change saves to Postgres on
click: no restarts, no `.env` edits. The worker picks changes up within
the hour; dashboard actions use them immediately. Too impatient for the
hourly tick: **Fetch now** on the Overview.

<details>
<summary><b>Running without Docker</b></summary>

The stack is plain Node + Postgres, so a local setup is first-class:

```bash
docker compose up -d postgres   # or any Postgres 16 you already have
cp .env.example .env            # then point DATABASE_URL at that Postgres
npm install
npx prisma migrate deploy
npm run seed

npm run dev                     # the cron worker
npm run dev:web                 # the dashboard → http://localhost:4747
```

`DATABASE_URL` is the only line you must set — with an existing Postgres,
use a role and database you already have. Everything else in `.env.example`
works as shipped, engines included: the dashboard starts without any AI
credential and the AI tab shows you which engines are usable, so you can
pick one there instead of guessing up front.

Run both commands from the repository root — the dashboard serves its
browser modules from `src/web/public/` relative to the working directory.

`WEB_HOST` defaults to `127.0.0.1` here on purpose. The dashboard has no
authentication unless you set `WEB_BASIC_AUTH`, so bind it wider only
together with that. (Under Docker, compose sets `0.0.0.0` for the
container and publishes the port on loopback only.)

Writes are refused when they come from another origin: a POST whose
`Origin` is not this dashboard, or whose `Sec-Fetch-Site` says
`cross-site`, gets a 403. That is what stops a page open in the same
browser from posting to your `localhost:4747`. A request with no browser
origin headers at all — `curl`, a script — is not that attack and passes.
If you put the dashboard behind a reverse proxy, pass the browser's host
through (`proxy_set_header Host $host` in nginx); a proxy that rewrites
`Host` to `localhost` makes every form look cross-origin.

CLI engines (claude / gemini / codex) are simpler locally: install them
globally, log in once in your terminal, and the probe on the AI tab turns
green. Details per engine in [docs/ai-engines.md](./docs/ai-engines.md).

> `dev:web` compiles with `tsc` and reloads with Node's `--watch` rather
> than `tsx`, a deliberate workaround: see gotcha #2 in
> [CLAUDE.md](./CLAUDE.md#gotchas).

</details>

## How it works

```
 33 kinds of source ──▶ normalize ──▶ base filter ──▶ AI classifier ──▶ Postgres ──▶ Telegram
   hourly        + dedupe      pure code,      one call, a       dashboard    only when
   fetch                       zero cost       score per search               fit ≥ threshold
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

- **Direct boards**: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Personio, Teamtailor
  boards for companies *you* track. Add one by pasting its board URL on
  `/companies`; the form probes the API live and refuses slugs that
  don't resolve.
- **Aggregators**: RemoteOK, Remotive, We Work Remotely, Jobicy, Working
  Nomads, Himalayas, Laravel Jobs, Golang Projects, Arbeitnow, 4 Day Week,
  solid.jobs (Poland), GermanTechJobs / DevITjobs (Germany, UK, Netherlands),
  Landing.jobs (Portugal), JobTech (Sweden), Adzuna (19 markets, with your own free key —
  every listing carries the "Jobs by Adzuna" label its terms ask for), France Travail (every job
  ad in France, with your own free client id — reused under the board's licence, mirrored daily),
  the HN jobs feed and the monthly HN "Who is hiring" thread. Broad and
  noisy, which is fine: the filters and the classifier do the narrowing.

Leave the aggregators on. Turning them off to "only watch real boards"
sounds tidy and produces near-zero new jobs, because a dozen tracked
companies don't post matching roles every week. The long tail comes from
the aggregators; your profile keeps it quiet.

## Bring your own AI

Instead of one hard-coded API key, ApplyPack speaks to **five AI
backends**, and you can attach every subscription and key you own:

| Engine | What it is | Billing |
| --- | --- | --- |
| Claude Code CLI | headless `claude -p` | your Claude.ai Pro/Max subscription |
| Gemini CLI | headless `gemini -p` | your Google account (generous free tier) or an AI Studio key |
| Codex CLI | headless `codex exec` | your ChatGPT Plus/Pro subscription |
| Anthropic API | Messages API | per token |
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

Three model slots per engine keep costs sane: a cheap **classifier
model** reads every fetched job (Haiku 4.5 on the Claude engines), a
strong **resume model** handles the few judgment calls a day — resume
scans, matches, verification (Opus 5 on the Claude engines) — and an
optional **cover-letter model** that follows the resume model unless you
set it.

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
- **Anthropic API only**: roughly **$2–10/month**. A classified posting
  costs about **$0.003** — ~2,000 input and ~250 output tokens on Haiku
  4.5 — and the bill follows how many postings your sources produce, not
  how many you apply to. The two-stage classifier mode cuts 30–40% more
  by sending most postings a much shorter prompt.
  *No prompt-cache discount is included in that figure, and none applies:
  Haiku 4.5 only caches prefixes of 4,096 tokens or more and our
  classifier prompt is well under that. Measured, not assumed.*
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
| First run | `/welcome` | The four setup steps; `/` redirects here until you finish or skip |
| Overview | `/` | Counters by status, recent alerts, cron health, pause/resume, Fetch now |
| Jobs | `/jobs` | Filterable, sortable list of everything fetched |
| Paste a job | `/jobs/new` | Save a posting by hand (LinkedIn, email, referral); it gets classified like any other |
| Job detail | `/jobs/:id` | Full description, AI verdict, status actions, verification, resume match, tracking |
| Tailor resume | `/jobs/:id/target` | Posting ↔ resume side by side, live keyword score, edit in place |
| Compare | `/target` | One-shot comparison: paste any posting, pick / upload / paste any resume |
| Cover letter | `/letter` | Write a letter for a posting that isn't stored yet: pick, paste or link it, then draft |
| Applications | `/applications` | Kanban with drag-and-drop. Applied and Rejected/Ghosted are fixed; every column between them is yours to name, add and reorder ([ADR 0025](./docs/adr/0025-custom-work-stages.md)) |
| Resumes | `/resumes` | Upload `.pdf` / `.docx` / `.md` / `.txt`, AI scan, version history, template check |
| Clean version | `/resumes/:id/render` | Re-typeset a resume that cannot be edited in place as a single-column `.docx` / `.pdf` in its own typography |
| Companies | `/companies` | Tracked boards; add new ones with a live probe that refuses bad slugs. **Watch specific companies** takes a pasted list of career-page URLs and resolves each to the board or feed behind it |
| Discovery | `/discovery` | Board candidates harvested from HN, with the discovery toggles |
| Runs | `/runs` | The last 100 cron runs with stats and errors |
| Settings | `/settings` | Five tabs: General · Profile · AI engine · Notifications · Sources |

<div align="center">
<img src="docs/screenshots/jobs.png" alt="Jobs: full-width table with fit scores, status filters and sticky header" width="900">
</div>

**The resume toolkit, in practice.** Upload the resumes you actually send
on `/resumes`; each gets one AI scan (headline, seniority, skill tags,
job-agnostic ATS issues). On any job page, **Compare** runs the match and
stores the report: a quick check by default (every keyword graded and
marked, the gates, the score), the edit suggestions one click later. On
the resume editor you fix the resume in place, watching keyword coverage
update as you type, free of AI calls; re-upload a file and it is scored
in the editor before the AI is asked. Disagree with the model? Re-level a
keyword, ignore it, add the one it missed, or rebuild the whole list; your
edits survive every re-run. When the draft feels right, "Re-check with
AI" gives the honest rubric score and "Save as vN" keeps the version. The
next report shows "▲ +16 vs v1", and the delta is real because the
scoring is deterministic.

<details>
<summary><b>Your data, and how to keep it</b> (backup, restore, what a delete takes)</summary>

Everything lives in one Postgres database — jobs, resumes and their versions,
comparisons, cover letters, applications, and your AI keys if you pasted them
into the dashboard instead of `.env`. Nothing is sent anywhere but the AI
engine you chose and, if you set it up, your own Telegram bot.

Back it up with one command; it is a plain SQL dump:

```bash
docker compose exec -T postgres pg_dump -U jobhunter jobhunter > applypack-$(date +%F).sql
```

Restore into an empty database (stop the app first so nothing writes while it
loads):

```bash
docker compose stop app web
docker compose exec -T postgres psql -U jobhunter -d jobhunter < applypack-2026-09-02.sql
docker compose start app web
```

`docker compose down` keeps the data (it lives in the `pgdata` volume);
`docker compose down -v` deletes it. There is no undo, so take a dump first.

The database port is published on **`127.0.0.1:5433`** for `psql` and Prisma on
the host — loopback only, and 5433 so it does not collide with a Postgres you
already run on 5432. The app itself never uses that port; it reaches Postgres
over the compose network.

Deletes inside the dashboard cascade, and each confirm names what it will take:
deleting a resume takes its comparisons, its cover letters and its strength
reviews; deleting a company takes every job it posted, and with each job the
application you tracked against it.

</details>

<details>
<summary><b>The worker's schedule</b> (six cron jobs, <code>TZ</code> from <code>.env</code>)</summary>

| Cron | Job | What it does |
| --- | --- | --- |
| `mm * * * *` † | fetch | Pull all sources → filter → classify → alert |
| `0 9 * * *` | digest | Telegram digest of the last 24h of new/alerted jobs |
| `0 8 * * *` | stale-applications | Nudge for applications quiet for 14+ days |
| `0 3 * * 0` | cleanup | Drop dismissed jobs older than 30 days, trim usage counters |
| `mm 4 * * 0` † | discovery | Re-probe pending company candidates |
| `mm 6 1 * *` † | hn-hiring | Pull the monthly HN "Who is hiring" thread |

† `mm` is a fixed minute your install picks for itself, so that every
ApplyPack in your time zone doesn't ask the same free job board in the same
second. It's stable across restarts and printed at boot (`cron: registered`
in the worker log). The three jobs that reach somebody else's server get
their own minute; the ones that only touch your Telegram and your database
run at the hour written above. See
[ADR 0035](./docs/adr/0035-many-installs-one-set-of-boards.md).

Every cron has a matching one-shot script for manual runs
(`docker compose exec app node dist/scripts/<name>-once.js`, or
`npm run <name>:once` locally).

</details>

## Under the hood

TypeScript strict, Node 24, Prisma + Postgres 16, Hono for the dashboard
(server-side JSX; the only build is `tsc` and a committed Tailwind CSS,
nothing fetched from a third party at runtime), node-cron for scheduling. Deliberately
no Redis, no queues, no framework sprawl. Every external byte (env vars,
API responses, AI output) passes through zod before it's trusted. The
worker and the dashboard are separate processes sharing one database, so
a toggle flipped in the UI reaches the worker on its next tick.

```bash
npm run lint:types   # tsc --noEmit
npm test             # node --test, over a thousand unit tests on the pure modules
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

## Employer mode: screening a folder of resumes

ApplyPack is a candidate's tool, and this is the one feature that sits on
the other side of the table. It is off by default; Settings → Screening
turns it on and adds "Screening" to the menu, and nothing else changes.

**One position, the criteria in your words.** A screening is one position
— one of your stored jobs, or a pasted or uploaded posting, kept as the
screening's own editable snapshot — and its applicants. The posting is
read once into a draft list of criteria you edit before anyone is scored:
a gate (pass / unknown / fail, never points), a scored criterion with one
to five stars, or a note that is shown and not counted. Each row is a kind
and a line of text — "Playwright / Cypress !", "0–2 years", "fintech,
payments: 3+", "has led a team of three or more" — and the last row takes
anything in your own words, answered yes/no or on the evidence ladder.
Five presets bend the draft (Standard, Junior hire, Senior / lead,
Regulated, Agency work); a criterion naming age, gender, family, origin or
health is refused with the lawful criterion offered instead.

<img src="docs/screenshots/screening-criteria.png" alt="A screening: the position card, and the criteria card showing every criterion as a chip — gates, skills with stars, level, sector, impact — with a button that opens the editor" width="900">

**Blind by construction.** Resumes go in as files, a zip or a whole folder
with its subfolders; a second document of someone already in the list is
scored and labelled, the same file twice is skipped, a scanned PDF stays
in the list unscored so you can see it. Before any model reads a file the
name, contacts, links, date of birth, age, family, gender, citizenship,
street address and graduation years are removed; you see the name, the
model sees "Applicant №7", and that cannot be switched off. Scoring
starts the moment the files are in, one independent call per applicant,
and every row says where it is.

**Every answer with its quote; the score in code.** The model answers
each criterion in the shape its kind asks — a rung on the evidence ladder
for a skill (absent · skills list · project · in a role · production), a
pass / partial / unknown / fail for a gate, a level, an impact grade, the
overall read with reasons and concerns — each with the verbatim line that
earns it. A checker holds every quote against the text: an unquoted mark
falls to what the text shows, a list of terms supports at most "listed"
or, on a job's own stack line, "role" (production is a work bullet with an
outcome), a term the text never spells is absent whatever line was quoted.
Application code then sums stars × answer over the criteria the text could
answer, with caps a rubric cannot express — none of the core stack
anywhere → 30 at most — and years, sectors and company types read off the
dated roles. The table orders by gate bucket, then score, then confidence;
beside the score sit the facts the criteria did not ask for ("stands out",
each with its line), the career read off the dates, and your own ±30
adjustment with its reason, which the export carries.

<img src="docs/screenshots/screening-scorecard.png" alt="A scorecard: who / did / verdict, the stands-out facts with their quotes, and one row per criterion with the answer, the line from the resume and the points" width="900">

**The shortlist, argued on one page.** Tick two to five applicants →
Compare: one column each, one row per criterion with the quotes, no new
call. Compare with AI reads the same shortlist head to head, twice with
the order reversed, and says who is stronger on each criterion and why,
whom to talk to first, the one question that would decide between the
first two — and where the two readings disagree, which is information,
not a bug. Never a score; the table keeps its order. Copy as Markdown for
the meeting.

<img src="docs/screenshots/screening-compare.png" alt="Compare with AI: three applicants read head to head, the order to talk to from two readings, where they agree and differ per criterion" width="900">

**Does it rank the way you do?** The decision column is yours alone; the
tool never writes it. Once three decisions with a To interview and a
Declined among them exist, a calibration card reads them against the
order: how many of your k picks sit in the table's top k, what share of
the pairs you decided differently the table orders the same way (with the
counts), the surprises with the criteria behind each, and which criteria
tell your picks from the rest. It never re-weights a criterion by itself —
that is the editor, and yours. `npm run bench:screen` does the same over a
ranked gold folder, writing nothing.

<img src="docs/screenshots/screening-calibration.png" alt="Calibration: one of two interview picks in the table's top two, three quarters of the decided pairs ordered the way you did, the one surprise with the gates behind it, and the per-criterion gaps between the interviewed and the declined" width="900">

CSV and Markdown carry the whole table; the screening is deleted with its
files on its retention date (90 days by default) or at once from its page,
and your files on disk are never touched.

**Read this before turning it on.** Screening other people's resumes with
an AI tool is regulated in a way the rest of ApplyPack is not. Under the
EU AI Act (Annex III, 4(a)) a system that filters job applications is
high-risk, and the open-source exemption does not cover high-risk use;
under GDPR art. 22 nobody may be subject to a hiring decision made solely
by automated means, art. 13–14 require applicants to be told, and art. 35
wants an impact assessment; NYC Local Law 144, Colorado SB 24-205 and
Illinois HB 3773 add audit and notice duties in the US. The mode is built
to be the tool and not the decision, but two things are yours: tell
applicants (the settings tab has a copy-ready notice), and run it on an
engine you have a data-processing agreement with or on a local model — a
personal-subscription CLI is not that, and the screening page says so.
This is not legal advice. The decisions behind the mode are ADR
[0047](./docs/adr/0047-screening-scores-evidence-not-keywords.md)
(evidence, not keywords), [0048](./docs/adr/0048-applicant-data-is-redacted-and-expires.md)
(redaction and retention), [0049](./docs/adr/0049-employer-mode-is-a-mode-not-a-product.md)
(a mode, not a product), [0050](./docs/adr/0050-the-rubric-is-a-list-of-criteria-the-person-chooses.md)
(the criteria are the person's), [0051](./docs/adr/0051-a-shortlist-is-compared-head-to-head-twice.md)
(the comparison is never a score) and [0052](./docs/adr/0052-calibration-reports-agreement-and-never-tunes-the-rubric.md)
(calibration measures, never tunes).

## Hosting this for other people

ApplyPack is built as a personal tool: one person, their own machine, their
own keys. That is also the shape its sources assume. If you're putting it in
front of other people, three things change, and none of them are in the code.

**The vendors' terms become yours.** Adzuna's API is for personal research
and for publishing its listings; an organisation deploying it is on a
14-day trial and has to arrange its own licence. France Travail's licence
does not let you pass its content on to third parties, and does not let you
charge job seekers for access to it. A hosted, multi-user ApplyPack is
exactly the case both clauses are about — read them before you point either
source at somebody else's screen. Neither is on by default, and neither
appears anywhere in the UI until you paste a credential
([ADR 0034](./docs/adr/0034-keyed-sources.md)).

**The daily obligation doesn't pause when you do.** France Travail asks for
every stored offer to be re-checked every 24 hours; ApplyPack does that on
each tick, so leaving fetching paused for more than a day quietly puts your
stored offers out of compliance. The Sources tab says so next to the source.

**Be a good guest on the free ones.** The default sources are RSS feeds and
public APIs with no contract at all, which is a reason for more care rather
than less. Each install picks its own tick minute and its own source order,
and revalidates a feed instead of re-downloading it wherever the vendor
supports that ([ADR 0035](./docs/adr/0035-many-installs-one-set-of-boards.md),
measurements in [docs/scale-plan.md](./docs/scale-plan.md)). All of that is
per-install, so give each instance its own database rather than sharing one
— which is the default anyway.

One practical note: compose binds the dashboard to `127.0.0.1` on purpose.
Exposing it is your call and your reverse proxy; ApplyPack has no user
accounts and no authentication of its own.

## Contributing

Ideas are welcome, not just patches. Anything that fits the sourcing
policy can land here: open an issue with the
[feature template](https://github.com/applypack/applypack/issues/new/choose)
and it gets scoped in the open. The roadmap is the issue tracker, on
purpose; [#24](https://github.com/applypack/applypack/issues/24) (a Discord
channel next to Telegram and Discord) is the kind of task that is waiting for someone.

Three good entry points:

- **Add a job source.** The highest-value contribution, and close to a
  one-file change: CLAUDE.md ships three copy-paste fetcher templates
  (single RSS, per-company JSON, list + detail). Propose the source in an
  issue first if you're unsure it fits the sourcing policy.
- **Grab a [good first issue](https://github.com/applypack/applypack/labels/good%20first%20issue).**
  Scoped tasks with file pointers.
- **Break it and report.** A fresh-machine setup that stumbled, an ATS
  edge case, a resume that parses badly: issues with logs are gold.

[CONTRIBUTING.md](./CONTRIBUTING.md) is a five-minute read covering
setup, tests and conventions. The sourcing policy is non-negotiable:
official public APIs and RSS only, never scraping
([ADR 0005](./docs/adr/0005-no-linkedin-indeed-workday.md)).

<a href="https://github.com/applypack/applypack/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=applypack/applypack" alt="Contributors" />
</a>

## License

MIT — see [LICENSE](./LICENSE).

Built and maintained by [Nazar Boyko](https://github.com/nazboyko).
Every decision that was not obvious is written down in
[docs/adr/](./docs/adr/).
