# Job Hunter — Spec (current state)

> Compact spec for the **current** system. Phase 1 spec is preserved as
> [SPEC-phase1.md](./SPEC-phase1.md) for historical context.

## Goal

Single-user, locally hosted job-search assistant. Pulls listings from a
dozen public ATS / aggregator sources, classifies each through Claude
against a **profile** that the user edits in a small dashboard, and
fires Telegram alerts for matches. Designed to run continuously on a
laptop or VPS without babysitting, with all configuration editable
from the web UI (no SSH-and-restart).

## Architecture (one-line)

```
postgres ←─ worker (cron, fetchers, classifier, notifier)
postgres ←─ web    (Hono dashboard, read-mostly + settings writes)
```

Two separate Node 24 processes inside the same docker-compose stack.
Both share the database and the Prisma client. The dashboard never
runs an HTTP server inside the worker; the worker never opens a web
port.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for diagrams.

## Sources (16 ATS / aggregator types + MANUAL)

| AtsType            | Shape         | Auth      | Notes                                           |
| ------------------ | ------------- | --------- | ----------------------------------------------- |
| GREENHOUSE         | per-company   | none      | `boards-api.greenhouse.io/v1/boards/<token>`    |
| LEVER              | per-company   | none      | `api.lever.co/v0/postings/<slug>`               |
| ASHBY              | per-company   | none      | `api.ashbyhq.com/posting-api/job-board/<org>`   |
| WORKABLE           | per-company   | none      | POST `apply.workable.com/api/v3/accounts/<slug>/jobs`. List has **no description body** — Claude classifies on title alone. |
| SMARTRECRUITERS    | per-company   | none      | List + per-posting detail. 60 details/cycle.    |
| LARAJOBS_RSS       | aggregator    | none      | Single RSS, all jobs under one synthetic Company |
| REMOTEOK           | aggregator    | none      | First array element is meta (`legal:`) — dropped via `slice(1)` |
| REMOTIVE           | aggregator    | none      | `?category=software-dev`                        |
| ARBEITNOW          | aggregator    | none      | EU-skewed; **disabled by default**              |
| HN_HIRING          | aggregator    | none      | Algolia API → monthly "Ask HN: Who is hiring?" |
| WEWORKREMOTELY     | aggregator    | none      | Per-category RSS, atsToken = category slug      |
| GOLANGPROJECTS     | aggregator    | none      | Single RSS; **disabled by default** (Go-only)   |
| JOBICY             | aggregator    | none      | RSS `?job_categories=dev`, custom `job_listing:` namespace |
| HN_JOBS            | aggregator    | none      | Algolia `tags=job` → individual YC posts, 14-day window; URLs feed discovery harvest |
| WORKINGNOMADS      | aggregator    | none      | `/api/exposed_jobs/` JSON, ~30 most recent, mixed categories |
| HIMALAYAS          | aggregator    | none      | `/jobs/api?limit=20` JSON (limit cap 20), all categories, salary folded into description |

**Hard exclusions** — never added regardless of demand:
- LinkedIn / Indeed / Glassdoor (TOS, anti-bot, account ban risk)
- Workday (`*.myworkdayjobs.com`) — POST with dynamic facetCriteria, fragile per-company
- JobSpy / similar grey-zone scrapers
- Headless-browser scrapers of any kind

## Pipeline

Per-tick flow inside `runFetchJob`:

```
runAllFetchers()         filter by Company.active and AppSettings.disabledSources
   ↓
NormalizedJob[]          unified shape (companyId, externalId, title, location, …)
   ↓
passesBaseFilter()       admit if title contains stackRequired OR roleTypes; reject stackExclude
   ↓
findUnique (companyId, externalId)
   ↓ (skip if seen before)
classifyJob(input, profile, mode)
   ├─ mode='single':   Haiku 4.5 only
   └─ mode='two_stage': Haiku 4.5 prefilter → Haiku 4.5 full only on yes
   ↓
ClaudeClassification     {fit_score, location_match, salary, tech_match, red_flags, summary}
   ↓
decideDismissReason()    fit < minFitScore | !location_match | salary < minSalaryUsd → DISMISSED
   ↓ otherwise
Job(status=NEW) → sendTelegramAlert(profile-routed) → Job.status=ALERTED
```

The same inner loop is reused by `runHnHiringJob` (extracted into
`src/jobs/process-jobs.ts`).

## Cron schedule (all `America/Chicago`)

| Cron expr   | Job                | What it does                                   |
| ----------- | ------------------ | ---------------------------------------------- |
| `5 * * * *` | fetch              | full fetch + filter + classify + alert         |
| `0 9 * * *` | digest             | Telegram digest of last 24h NEW/ALERTED        |
| `0 8 * * *` | stale-applications | Telegram nudge for `applied >14d ago, no contact` |
| `0 3 * * 0` | cleanup            | Delete DISMISSED older than 30 days            |
| `0 4 * * 0` | discovery          | Re-probe pending CompanyCandidates             |
| `0 6 1 * *` | hn-hiring          | Pull latest HN Who-is-hiring + extract candidates |

## Profiles

A `Profile` row encodes "what kind of role am I looking for". One profile
is **active** at a time (`AppSettings.activeProfileId`). Switching profiles
is instant; a "Re-classify all" button reruns Claude across existing jobs
under the new profile.

Profile fields that drive matching:
- `stackRequired` — actual technologies (e.g. `php`, `laravel`, `javascript`, `go`)
- `roleTypes` — job categories (e.g. `full-stack`, `backend`). Title hint only — Claude is told a role-type alone is **not** a tech match.
- `stackNiceToHave` — boost
- `stackExclude` — drop on title hit (`junior`, `intern`, `wordpress`)
- `seniority`, `remoteOk`, `remoteRegions`, `onsiteCities`, `hybridOk`
- `minFitScore`, `minSalaryUsd`
- `notes` — free-form prose appended to the Claude prompt
- `telegramTargetId` — optional: route alerts to a specific bot (else broadcast)

## Toggles in `/settings`

All gating is in `AppSettings` (singleton row). Each toggle has a guard
clause at the start of the affected job/handler.

| Field                            | Default  | Effect when off                              |
| -------------------------------- | -------- | -------------------------------------------- |
| `telegramEnabled`                | false (+true after .env bootstrap) | Notifier no-ops with log line       |
| `classifierMode`                 | `single` | `two_stage` adds Haiku-4.5 prefilter        |
| `applicationTrackingEnabled`     | true     | Hides the per-job tracking card + auto-set on APPLIED |
| `staleApplicationsDigestEnabled` | true     | Daily nudge job exits early                  |
| `hnParserEnabled`                | false    | Monthly HN cron + manual run skip            |
| `discoveryEnabled`               | false    | HN parser does not record CompanyCandidates  |
| `fetchingEnabled`                | false    | Master pause: hourly fetch + monthly HN pull exit early (`fetching-paused`); digest/cleanup/discovery/dashboard unaffected. Deployments start PAUSED — enable via `/settings` → "Job fetching" |
| `disabledSources` (String[])     | `[]`     | Skip whole AtsType families in runAllFetchers |

## Discovery

When `discoveryEnabled=true`, the HN parser scans each comment for ATS
URLs (`extractAtsToken` in `src/text-utils.ts` covers
greenhouse/lever/ashby/workable/smartrecruiters) and writes
`CompanyCandidate` rows. The user reviews on `/discovery` and clicks
**Promote** → adds to `Company` with `active=true`. A weekly probe job
re-validates each pending candidate's slug and updates `jobsSeen`,
marking 4xx-returning slugs as DEAD.

## Resumes (Phase 8.1)

`Resume` rows hold an uploaded file (`original` bytes, `.docx` / `.md` /
`.txt`) and its plain-text extraction (`text`). On upload the web process
runs one AI call (the resume model, `CLAUDE_MODEL_RESUME` by default) that fills headline, seniority,
years, skill tags, role types and job-agnostic `issues`. The first upload
becomes the default.

`ResumeMatch` is one comparison of a resume against a job, triggered from
`/jobs/:id` → "Resume match" → Compare (the dropdown preselects the resume
with the most skill-tag overlap). Stored per run: `matchScore`, `summary`,
`strengths`, `redFlags`, `keywords` (`present | add | cannot_claim`, where,
note) and `actions` (section, where, what, why, priority). Nothing edits
the resume — the report is the to-do list. See ADR 0008.

The targeted view (`/jobs/:id/target`, ADR 0010) shows one match as two
panes: the posting with every keyword highlighted, and the resume text in an
editor. `src/web/public/target.mjs` scores keyword coverage in the browser
on every edit (P1 = 3, P2 = 2, P3/P4 = 1, `cannot_claim` excluded by
default) and renders both panes' highlights from the match's `keywords`
(with `aliases`), `actions` and `removals` (with verbatim `quote`s).
"Re-analyze with AI" posts the draft (`draftText`) → a `ResumeMatch` with
`draft = true`; `resumeText` snapshots the judged text on every match.
"Save as vN" turns the draft into a `.md` resume version.

The loop: edit the resume → "Upload a new version" on `/resumes/:id`
(`Resume.version` +1, re-scan) → Compare again. `ResumeMatch.resumeVersion`
records which version scored; the card shows the delta vs the previous run.
The prompt uses a fixed rubric (60 keyword coverage / 20 title+summary /
20 most-recent role, −10 per hard red flag) so scores are comparable, and
returns `removals` — what to cut so the resume reads cleaner.

## Manual jobs + verification (Phase 8.2)

`/jobs/new` pastes a posting the fetchers never see. It is stored as a
normal `Job` under a per-employer `Company` with `atsType = MANUAL`
(`active = false`, so `runAllFetchers` skips it) and `status = SAVED`,
then classified against the active profile without touching the status.

"Is this job real?" on `/jobs/:id` runs the ghost-job checklist with web
search (`AiRequest.webTools`, ADR 0009) and stores a `JobVerification`:
`verdict` legit | suspicious | fake, `recommendation` apply | caution |
skip, confidence, evidence rows with URLs, red flags, company snapshot.

## Hard out-of-scope (Phase 7+)

- Multi-user / per-user views (auth, sessions). Single-deployment-per-friend stays the answer.
- Adzuna / Jooble / The Muse paid aggregators (have free tiers, just not added)
- Built In, Wellfound, YC WAAS — fragile or behind anti-bot
- Workday — see exclusions above
- Embedding-based duplicate detection across sources
- Web push / native mobile notifications

## Tech stack (locked)

- TypeScript strict, Node 24 (runtime image; >=22 locally), pino, zod, native fetch with `fetchWithRetry` + `AbortController`
- Prisma 6 + Postgres 16 (real migrations from `phase-3.0` baseline onward)
- node-cron for scheduling, no Redis / BullMQ
- Hono 4 for the dashboard, JSX SSR with `hono/jsx`, Tailwind via CDN over semantic CSS-variable tokens (no build pipeline; light SaaS theme, see DESIGN.md)
- `src/ai-provider.ts` seam, five engines: `anthropic_api` (SDK, per-token), `claude_code` (headless CLI, subscription), `gemini_cli` (headless CLI, Google account), `openai_api` (fetch → any /chat/completions endpoint via OPENAI_BASE_URL), `codex_cli` (headless CLI, ChatGPT subscription). `/settings` → "AI engine" stores an ordered chain + per-engine classifier/resume models (AppSettings.aiEngine JSON, ADR 0013/0014); calls fail over down the chain automatically; `.env` seeds the default (Haiku 4.5 classifier, Opus 5 resume); `AI_CONCURRENCY` jobs classified at once (default 3)
- node:test runner (`npm test`), no jest

## Project layout

See [README.md](./README.md) for the full source tree.
See [docs/adr/](./docs/adr/) for the "why" behind non-trivial choices.
