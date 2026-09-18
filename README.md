<div align="center">

# ApplyPack

**Free, open-source AI job search that runs on your own computer.**

It watches 33 kinds of job board around the clock, drops the fake and
wrong-fit postings, shows which keywords your resume lacks and fixes them
with you, writes a cover letter that cannot invent, and tracks the
application. Built for software engineers. Bring the AI you already pay
for. MIT: no accounts, no subscription, no telemetry, no ads.

[![CI](https://github.com/applypack/applypack/actions/workflows/test.yml/badge.svg)](https://github.com/applypack/applypack/actions/workflows/test.yml)
[![Live demo](https://img.shields.io/badge/live%20demo-applypack.dev-047857)](https://applypack.dev/demo/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node 22+](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](./package.json)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](./tsconfig.json)
[![Release](https://img.shields.io/github/v/release/applypack/applypack?display_name=tag)](./CHANGELOG.md)

**[Try the live demo →](https://applypack.dev/demo/)** ·
**[Install in two minutes ↓](#install-in-two-minutes)** ·
[What it does](#what-it-does) · [What it costs](#what-it-costs) ·
[Bring your own AI](#bring-your-own-ai) · [Employer mode](#employer-mode-screening-a-folder-of-resumes)

<img src="docs/screenshots/target.png" alt="Tailor resume: a 70/100 score capped by the primary-stack verdict, nine suggested edits, experience confirmations, and the posting beside the resume with every keyword weighted and counted" width="900">

<sub>Tailor resume: a Laravel resume against a Laravel + React posting. The
score is capped at 70 because React and TypeScript are missing, nine edits
are ready to apply, and the number moves as you type.</sub>

</div>

## Why it exists

Companies screen resumes with keyword filters and AI now. The filter
counts words, not years: "PHP 8, Laravel, Symfony" can miss a requirement
that says "PHP", and no recruiter ever sees the fifteen years behind it.
Half the postings are noise on top: the wrong stack in paragraph four,
"Remote" that means remote in Germany, a listing nobody will ever fill.
You end up being the cron job.

I built ApplyPack during my own job search and found my current job with
it ([the story](https://applypack.dev/#story)). It is the same tool you
install, unchanged.

## What it does

**Find real jobs**

- **🔭 33 kinds of job source, checked every hour.** Twelve ATS vendors
  (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Breezy,
  BambooHR, Pinpoint, Rippling, Personio, Teamtailor) on the companies you
  pick; twenty aggregators, from RemoteOK to the monthly HN "Who is hiring"
  thread; country boards for Ukraine, Poland, Germany, the UK, the
  Netherlands, Portugal, Sweden and France; any RSS feed you paste. Starter
  packs add a whole segment of companies in one go.
- **🧠 A classifier with rules that burned me.** AI reads the full
  description against your stack, role types, seniority, countries and
  salary floor. "Full-stack" in a title is not a stack match, and
  "Remote · Germany" is not a US-remote job. Up to eight searches at once
  (backend and QA, contract and full-time); one AI call per posting scores
  all of them.
- **🕵️ "Is it real?" with evidence.** A free liveness check first, then a
  web-search checklist: careers page, company footprint, posting age, named
  humans. The verdict is legit, suspicious or fake, with the links.
- **📲 Telegram or Discord only when it matters.** An alert when a posting
  clears your fit threshold, a daily digest, quiet hours if you want them.
  Paste a posting from anywhere and it gets the same treatment.
- **⭐ Watch the companies you actually want.** Paste their career-page
  URLs; each resolves to the board or feed behind it and can alert on every
  posting, threshold or not. A page with nothing machine-readable is
  watched for changes.

<div align="center">
<img src="docs/screenshots/jobs.png" alt="Jobs: a full-width table with fit scores, sources, salaries, statuses and a ghost-job flag" width="900">
</div>

**Fix the resume for this posting**

- **📄 A score that cannot flatter you.** The model marks facts,
  unit-tested code computes the number. No core-stack overlap caps it at
  30, Vue is not React, and an unknown becomes a question instead of a
  guess. Score v2 and the "+16 vs v1" is real.
  [Try it in your browser →](https://applypack.dev/demo/)
- **✍️ Edit in place with the score live.** Posting and resume side by
  side, every keyword weighted and highlighted, coverage recomputed on each
  keystroke without an AI call. Apply a suggested edit with one press or
  write your own; disagree with a keyword and re-level, ignore or add it.
- **💾 Save into your own .docx.** The accepted edits are written back into
  your file with the formatting intact. A PDF, or a layout that cannot be
  patched, is re-typeset as a clean single-column `.docx` and `.pdf` in your
  own font
  ([ADR 0038](./docs/adr/0038-save-patches-the-users-docx-in-place.md),
  [0039](./docs/adr/0039-clean-render-from-json-resume.md)).

**Send it and track it**

- **💌 A cover letter that cannot invent.** Drafted from the posting, your
  resume and the facts you confirmed, nothing else. A fact gate reads every
  claim back against that evidence; a number that is not in your resume
  never reaches the letter. Your angle, your tone, PDF or DOCX.
- **🗂 One board for the applications.** A kanban with columns you name,
  drag and drop, the resume each application went out with, and a nudge
  when one goes quiet for two weeks.

Underneath: a five-step first run that ends with your first matches, five
AI engines with automatic failover, untrusted-text markers around every
posting a model reads (a test fails the build without them), board
discovery from HN comments, an alert when a board goes quiet, and an
opt-in [employer mode](#employer-mode-screening-a-folder-of-resumes).

## Install in two minutes

The only thing to install is [Node.js](https://nodejs.org) 22 or newer.
The database comes with ApplyPack: no Docker, no PostgreSQL, no AI key
before the first start.

```bash
git clone https://github.com/applypack/applypack.git   # or Code → Download ZIP
cd applypack
npm install
npm start    # → http://127.0.0.1:4747 opens on the setup
```

The setup is five clicks and one file pick:

1. **Connect an AI.** Paste a key, or let it detect the CLI you are
   already logged into. A Test button proves the connection.
2. **Test the search.** One button asks the boards and stores what it
   finds: no AI spent, about twenty seconds.
3. **Upload your resume.** The summary it comes back with ("senior backend
   engineer, PHP, Laravel…") becomes your search profile with one click.
   No resume handy: three questions instead.
4. **Switch on the boards for your countries.** One press.
5. **Read your first matches**, then start the hourly watch.

Fetching stays paused until that last click, so a blank profile never
burns your AI quota. From then on it runs on its own. Ctrl+C stops it,
`npm start` carries on where it left off, and your data lives outside the
folder (`~/Library/Application Support/ApplyPack`, `%APPDATA%\ApplyPack`,
`~/.local/share/applypack`), so an update or a fresh download finds it.

Step by step for macOS, Windows and Linux, with what to do when something
goes wrong: **[docs/install.md](./docs/install.md)**. On a server, or
always on:

```bash
cp .env.example .env
docker compose up -d    # postgres + worker + dashboard → http://localhost:4747
```

Every page of the dashboard, backups, the worker's schedule, your own
Postgres, development and hosting for other people:
[docs/operations.md](./docs/operations.md).

## What it costs

Nothing, except the AI you choose. MIT licence, no hosted version, no
accounts, no subscription, no telemetry, no ads. You pick the meter:

| You have | Extra cost |
| --- | --- |
| A Claude.ai, ChatGPT or Google subscription | **$0.** The Claude Code, Codex and Gemini CLIs ride it. When the usage window runs dry, the next engine takes over and the first comes back on its own |
| Gemini CLI's free tier | **$0** for a typical day of classification |
| A local model via Ollama or LM Studio | **$0** |
| An Anthropic API key | About **$2–10 a month**. A classified posting costs ~$0.003 on Haiku 4.5, and the bill follows how many postings your sources produce, not how many you apply to. The two-stage classifier cuts another 30–40 % |

Postgres, Telegram, Discord and the job boards cost nothing. The AI tab
counts which engine served your calls in the last seven days.

## Bring your own AI

Five backends, and you can attach every subscription and key you own:

| Engine | What it is | Billing |
| --- | --- | --- |
| Claude Code CLI | headless `claude -p` | your Claude.ai Pro/Max subscription |
| Gemini CLI | headless `gemini -p` | your Google account (generous free tier) or an AI Studio key |
| Codex CLI | headless `codex exec` | your ChatGPT Plus/Pro subscription |
| Anthropic API | Messages API | per token |
| OpenAI-compatible API | `POST /chat/completions` to any base URL | OpenAI, OpenRouter, Groq, DeepSeek, or a free local model |

Enable the ones you have on **Settings → AI engine**, order them, and pick
models per engine. Engine #1 serves every call; on an error, a rate limit
or an empty quota the next one takes over for that call, and #1 is back
the moment it recovers. Every card says whether the engine works on this
machine, and a Test button runs one real call. A cheap model reads every
fetched job; a stronger one handles the few judgment calls a day: resume
scans, matches, verification, letters.

Setup for every engine, local and Docker:
[docs/ai-engines.md](./docs/ai-engines.md). One honest note:
consumer-subscription terms do not spell out background services, so read
yours before making a subscription your primary engine.

## How it works

```
 33 kinds of source ──▶ normalize ──▶ base filter ──▶ AI classifier ──▶ Postgres ──▶ Telegram
   hourly        + dedupe      pure code,      one call, a       dashboard    only when
   fetch                       zero cost       score per search               fit ≥ threshold
```

Cheap deterministic filters drop the obvious misses first, so the AI only
reads postings that might be for you. Everything it reads arrives inside
untrusted-text markers, so a posting cannot hijack the prompt.

Coverage is two-tier, because the HR vendors have no "all jobs" API:
**direct boards** for the companies you track (paste a board URL; the form
probes it live and refuses one that does not resolve) and **aggregators**:
RemoteOK, Remotive, We Work Remotely, Jobicy, Working Nomads, Himalayas,
Laravel Jobs, Golang Projects, Arbeitnow, 4 Day Week, solid.jobs,
DevITjobs, Landing.jobs, JobTech, the HN feeds, and Adzuna and France
Travail with your own free key. Leave the aggregators on: a dozen tracked
companies do not post a matching role every week, and your profile keeps
the long tail quiet.

Sourcing is deliberately clean: official public APIs and RSS only, never
scraping. LinkedIn, Indeed, Glassdoor, Workday and Wellfound are
permanently out of scope
([ADR 0005](./docs/adr/0005-no-linkedin-indeed-workday.md)). Everything
runs on your machine, the dashboard binds to `127.0.0.1`, and nothing
leaves it but the calls to the AI engine you chose and to your own
Telegram bot or Discord webhook.

## Employer mode: screening a folder of resumes

The other side of the table, off by default: one switch on **Settings →
Screening**. A folder of resumes against one position, screened against
criteria in your own words ("Playwright / Cypress !", "0–2 years",
"fintech: 3+"). Names, contacts and personal details are removed before
any model reads a word; every answer carries its quote from the
resume; the score is arithmetic in code; a shortlist is compared side by
side and head to head; and a person makes the decision, with a calibration
card that says whether the table ranks the way they do.

Screening other people's resumes with AI is regulated (the EU AI Act, GDPR,
several US laws). The mode is built to be the tool and not the decision,
and two duties stay yours: tell applicants, and run it on an engine with a
data-processing agreement or on a local model. The full description, the
screenshots and the legal note:
**[docs/employer-mode.md](./docs/employer-mode.md)**.

## Under the hood

TypeScript strict, Node 24, Prisma + Postgres 16, Hono with server-side
JSX, node-cron. No Redis, no queues, no client framework; the only build
step is `tsc` and a committed Tailwind CSS, and no page fetches anything
from a third party. Every external byte (env vars, API responses, AI
output) passes through zod. The worker and the dashboard are separate
processes on one database, and `npm start` runs both beside a built-in
Postgres 16
([ADR 0054](./docs/adr/0054-npm-start-runs-a-built-in-database.md)).

```bash
npm run lint:types   # tsc --noEmit
npm test             # 2,300+ unit tests on the pure modules, in three seconds
```

> **Docs map:** [docs/install.md](./docs/install.md) — installing, per
> system · [docs/ai-engines.md](./docs/ai-engines.md) — AI setup, local +
> Docker · [docs/operations.md](./docs/operations.md) — the pages, data,
> schedule, hosting · [docs/employer-mode.md](./docs/employer-mode.md) — screening ·
> [SPEC.md](./SPEC.md) — current behaviour · [ARCHITECTURE.md](./ARCHITECTURE.md)
> — data flow + file map · [CLAUDE.md](./CLAUDE.md) — conventions, gotchas,
> where-to-look tables · [docs/adr/](./docs/adr/) — every non-obvious
> decision, with reasons · [CHANGELOG.md](./CHANGELOG.md) — releases ·
> [SECURITY.md](./SECURITY.md) — reporting a vulnerability.

## Contributing

Ideas are as welcome as patches, and the roadmap is the
[issue tracker](https://github.com/applypack/applypack/issues). Three good
entry points:

- **Add a job source.** The highest-value contribution and close to a
  one-file change: CLAUDE.md ships three copy-paste fetcher templates.
  Unsure it fits the sourcing policy? Open a
  [source proposal](https://github.com/applypack/applypack/issues/new?template=new_source.yml)
  first.
- **Grab a [good first issue](https://github.com/applypack/applypack/labels/good%20first%20issue).**
  Scoped tasks with file pointers.
- **Break it and report.** A fresh-machine setup that stumbled, an ATS
  edge case, a resume that parses badly: issues with logs are gold.

[CONTRIBUTING.md](./CONTRIBUTING.md) is a five-minute read covering setup,
tests and conventions. The sourcing policy is non-negotiable: official
public APIs and RSS only, never scraping.

<a href="https://github.com/applypack/applypack/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=applypack/applypack" alt="Contributors" />
</a>

## License

MIT — see [LICENSE](./LICENSE). Built and maintained by
[Nazar Boyko](https://github.com/nazboyko); every decision that was not
obvious is written down in [docs/adr/](./docs/adr/).
