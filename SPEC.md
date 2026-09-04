# ApplyPack — Spec (current state)

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

## Sources (26 ATS / aggregator types + MANUAL)

| AtsType            | Shape         | Auth      | Notes                                           |
| ------------------ | ------------- | --------- | ----------------------------------------------- |
| GREENHOUSE         | per-company   | none      | `boards-api.greenhouse.io/v1/boards/<token>`    |
| LEVER              | per-company   | none      | `api.lever.co/v0/postings/<slug>`               |
| ASHBY              | per-company   | none      | `api.ashbyhq.com/posting-api/job-board/<org>`   |
| WORKABLE           | per-company   | none      | POST `apply.workable.com/api/v3/accounts/<slug>/jobs`. List has **no description body** — Claude classifies on title alone. |
| SMARTRECRUITERS    | per-company   | none      | List + per-posting detail. 60 details/cycle.    |
| RECRUITEE          | per-company   | none      | `<slug>.recruitee.com/api/offers/` — rich rows incl. description + salary |
| BREEZY             | per-company   | none      | `<slug>.breezy.hr/json?verbose=true` (`verbose` adds the description) |
| BAMBOOHR           | per-company   | none      | `<slug>.bamboohr.com/careers/list`. List-only: **no description, no date** (postedAt = first-seen). Unknown slug 302s to marketing site → `redirect: 'error'`. |
| PINPOINT           | per-company   | none      | `<slug>.pinpointhq.com/postings.json` — rich rows, **no date** (postedAt = first-seen) |
| RIPPLING           | per-company   | none      | List + per-job detail (`api.rippling.com/platform/api/ats/v1/board/<slug>/jobs`). 60 details/cycle. |
| TEAMTAILOR         | per-company   | none      | `<slug>.teamtailor.com/jobs.rss` (or a custom career domain as the token; private hosts refused) — `remoteStatus` (fully / hybrid / none) as the arrangement, `tt:locations` city + country name through the gazetteer, department and role in the head, full HTML; `jobs.json` beside it has ISO codes but no remote status, so the RSS is the feed read; an unknown slug is a 404 |
| PERSONIO           | per-company   | none      | `<slug>.jobs.personio.de/xml?language=en` — documented XML (`<workzag-jobs><position>`), parsed without a dependency; `office` + `additionalOffices` free text for the parser, sections of `jobDescriptions` as the description, employment / seniority / schedule / salary in its head, `createdAt` as the date; an unknown slug is a 307 to personio.com (refused as "no feed") |
| FEED               | per-company   | none      | A generic RSS / Atom job feed; the atsToken IS the feed URL, re-checked through the posting-URL guards on every tick. The rung below the vendor types — `watchlist/resolve.ts` only reaches it when no board resolves (ADR 0036) |
| CAREER_PAGE        | per-company   | none      | A careers page with nothing machine-readable on it; the atsToken is the page URL. **Never yields a job** — it hashes the page's text and reports that it changed (ADR 0036) |
| LARAJOBS_RSS       | aggregator    | none      | Single RSS, all jobs under one synthetic Company |
| REMOTEOK           | aggregator    | none      | First array element is meta (`legal:`) — dropped via `slice(1)` |
| REMOTIVE           | aggregator    | none      | `?category=software-dev`                        |
| ARBEITNOW          | aggregator    | none      | EU-skewed; **disabled by default**              |
| DOU                | aggregator    | feed query (`category=PHP&remote`) | Ukraine's board via its RSS; one row per query; **disabled by default** (stage 3b) |
| DJINNI             | aggregator    | feed filter (`primary_keyword=PHP&employment=remote&region=UKR`) | Ukraine's marketplace via its RSS; location comes from the filter; **disabled by default** (stage 3b) |
| HN_HIRING          | aggregator    | none      | Algolia API → monthly "Ask HN: Who is hiring?" |
| WEWORKREMOTELY     | aggregator    | none      | Per-category RSS, atsToken = category slug      |
| GOLANGPROJECTS     | aggregator    | none      | Single RSS; **disabled by default** (Go-only)   |
| JOBICY             | aggregator    | none      | RSS `?job_categories=dev`, custom `job_listing:` namespace |
| HN_JOBS            | aggregator    | none      | Algolia `tags=job` → individual YC posts, 14-day window; URLs feed discovery harvest |
| WORKINGNOMADS      | aggregator    | none      | `/api/exposed_jobs/` JSON, ~30 most recent, mixed categories |
| HIMALAYAS          | aggregator    | none      | `/jobs/api?limit=20` JSON (limit cap 20), all categories, salary folded into description |
| FOURDAYWEEK        | aggregator    | none      | `4dayweek.io/api/v2/jobs?page=N` (the robots-allowed versioned API), 25/page, cap 3 pages; salary arrives in minor units (÷100) |
| JOBTECH            | aggregator    | none      | `jobsearch.api.jobtechdev.se/search?<token>&published-after=<24 h ago>&sort=pubdate-desc&limit=100` + offset pages (cap 3); the token is the filter string (seed: `occupation-field=apaJ_2ja_LuF` = Data/IT); `workplace_address` municipality + country, SE hint from the taxonomy country code, `text` description, deadline in the head; CC0 ads; seeded off |
| ADZUNA             | aggregator    | **your key** | `api.adzuna.com/v1/api/jobs/<cc>/search/1` with the user's app_id + app_key (Settings → Sources; ADR 0034), one row per market (`de`, `gb`, `pl` …), IT category, last day, 50 newest; polled four times a day (00/06/12/18 UTC) and at most ten rows — the 2 500/month limit; descriptions are snippets and say so; every displayed listing carries "Jobs by Adzuna"; errors redacted of the keys |
| FRANCETRAVAIL      | aggregator    | **your key** | `api.francetravail.io/partenaire/offresdemploi/v2/offres/search` with an OAuth client-credentials token (Settings → Sources; ADR 0034); the token is the filter (`codeROME=M1805`, `motsCles=…`), the fetcher adds `publieeDepuis=1`, `sort=1`, pages of 150 (cap 3); the offer is stored whole (`Job.sourcePayload`) and shown whole; the daily mirror (`jobs/france-travail-sync.ts`) re-checks every stored offer, deletes withdrawn ones or anonymises the user's own records; source + update date + licence link on every display; 4 calls/s |
| LANDINGJOBS        | aggregator    | none      | Atom `https://landing.jobs/feed` (~55 newest; the JSON API is robots-disallowed); `lj:city` / `lj:country` / `lj:remote_policy` (Full remote → REMOTE, Partial remote → HYBRID) as hints, company from `<author>`, the full HTML posting as the description; seeded off |
| DEVITJOBS          | aggregator    | none      | `https://<host>/rss` for germantechjobs.de / devitjobs.uk / devitjobs.nl (the token is the host, one row each); title `Role @ Company [salary]`; `content:encoded` sections Salary / Requirements / Responsibilities / Technologies; no city, no arrangement — the country hint is the site's; items older than 90 days skipped; conditional GET (ETag / Last-Modified, in-process cache, 304 answers the last parse); seeded off |
| SOLIDJOBS          | aggregator    | none      | `solid.jobs/public-api/offers/IT?campaign=applypack&pageSize=500&pageIndex=N` (+ `X-Api-Version: 1.0`), cap 3 pages; Polish cities, `isRemote`/`isHybrid`, PLN salary + employment type + skills folded into the description; PL hint on every row; seeded off |

**Hard exclusions** — never added regardless of demand:
- LinkedIn / Indeed / Glassdoor (TOS, anti-bot, account ban risk)
- Workday (`*.myworkdayjobs.com`) — POST with dynamic facetCriteria, fragile per-company
- JobSpy / similar grey-zone scrapers
- Headless-browser scrapers of any kind
- Anything whose robots.txt refuses the path we'd call or bans AI agents —
  see the "Evaluated, not supported" table in
  [ADR 0005](./docs/adr/0005-no-linkedin-indeed-workday.md)
  (JustJoin.it, NoFluffJobs, NoDesk rejected there at F2)

## Pipeline

Per-tick flow inside `runFetchJob`:

```
runAllFetchers()         filter by Company.active and AppSettings.disabledSources
   ↓
NormalizedJob[]          unified shape (companyId, externalId, title, location, …)
                         + locationHints where the feed has structured geodata (ADR 0031);
                         geo-filtered sources (Jobicy, Himalayas, 4dayweek) read the FetchContext —
                         the union of the running searches' countries + regions — instead of the whole feed
   ↓
passesAnyBaseFilter()    admit if ANY running search admits it (title contains its
                         stackRequired OR roleTypes; its stackExclude rejects)
   ↓
findUnique (companyId, externalId)
   ↓ (skip if seen before)
classifyJob(input, profiles[], mode)   ONE call for every running search
   ├─ mode='single':   Haiku 4.5 only
   └─ mode='two_stage': Haiku 4.5 prefilter → Haiku 4.5 full only on yes
   ↓
{salary, scores: [{profile_id, fit_score, location_match, tech_match, …}]}
   ↓
mergeVerdicts()          per-search decideDismissReason() against that search's
                         thresholds; the winner's numbers become Job.fitScore,
                         every verdict becomes a JobScore row
   ↓ dismissed only when every search dismissed it
Job(status=NEW) → one alert, named for the winner, routed to its telegramTargetId
```

Every persisted Job also carries `workplace`, `countries`, `regions` and
`locationSource` — the structured reading of the location string by
`src/location.ts` (hints from the fetcher first, the parser for the rest);
the string itself is never rewritten (ADR 0031). `/jobs` filters on them
(`country=`, `workplace=`, `posted=`).

The same inner loop is reused by `runHnHiringJob` (extracted into
`src/jobs/process-jobs.ts`).

## Cron schedule (all `America/Chicago`)

`mm` is this install's own minute, hashed from `AppSettings.instanceId` so
that every deployment does not knock on the same board in the same second
(ADR 0035); it applies to the three jobs that reach somebody else's server.

The cron list itself never changes. What the user picks on Settings →
General → Schedule is read by a pure gate (`src/user-schedule.ts`) at the
start of each beat: `isFetchDue` decides whether the fetch tick searches (a
"no" is `outside-schedule` on /runs), `canAlertNow` decides whether a fresh
match is sent or held on `Job.alertHeldAt`, and `isDigestHour` decides
whether the two hourly summary beats do anything at all — a beat that is not
a digest hour writes no run row. An empty `AppSettings.schedule` means every
hour, around the clock, one message per match: the behaviour before v1.47.0.

| Cron expr    | Job                | What it does                                   |
| ------------ | ------------------ | ---------------------------------------------- |
| `mm * * * *` | fetch              | full fetch + filter + classify + alert — gated by the user's schedule |
| `0 * * * *` | digest             | Telegram digest of last 24h NEW/ALERTED — only on the digest hours |
| `0 * * * *` | stale-applications | Telegram nudge for `applied >14d ago, no contact` — only on the digest hours |
| `0 3 * * 0` | cleanup            | Delete DISMISSED older than 30 days            |
| `mm 4 * * 0` | discovery         | Re-probe pending CompanyCandidates             |
| `mm 6 1 * *` | hn-hiring         | Pull latest HN Who-is-hiring + extract candidates |

## Profiles

A `Profile` row encodes "what kind of role am I looking for" — a **search**.
Several run at once, up to 8 (ADR 0028): `Profile.active` is the switch, and
`AppSettings.activeProfileId` names the **primary**, the one that supplies
defaults everywhere and always runs. One classifier call scores each posting
against every running search and returns a verdict each; those land in
`JobScore` (jobId × profileId) while `Job.fitScore` keeps the best-of for
sorting. A posting is admitted when any search's base filter admits it, and
dismissed only when every search rejects it. Alerts are one per posting,
named for the winner and routed to that search's `telegramTargetId`.
"Save & re-classify" reruns the classifier across existing jobs.

Profile fields that drive matching:
- `stackRequired` — actual technologies (e.g. `php`, `laravel`, `javascript`, `go`)
- `roleTypes` — job categories (e.g. `full-stack`, `backend`). Title hint only — Claude is told a role-type alone is **not** a tech match.
- `stackNiceToHave` — boost
- `stackExclude` — drop on title hit (`junior`, `intern`, `wordpress`)
- `seniority`
- `countries` (ISO-2), `regions` (group codes — a group stays a group), `workplace`
  (arrangements accepted), `onsiteCities` — where the search hunts (ADR 0032);
  both lists empty = anywhere, empty `workplace` = any arrangement
- `minFitScore`, `minSalaryUsd`
- `notes` — free-form prose appended to the Claude prompt
- `telegramTargetId` — optional: route alerts to a specific bot (else broadcast)
- `resumeId` — optional: the resume this search hunts with. A job page
  preselects it for comparisons and cover letters; unset falls back to
  skill-tag overlap (`src/resume/pick.ts:preselectResume`). `SET NULL` on
  resume delete — the search survives, the preselect goes back to guessing.

The editor shows the essentials (stack, role types, seniority, location);
excludes, notes, on-site cities, priority rules, thresholds and Telegram
routing sit in a collapsed "Advanced" block that opens itself when any of
them is customised.

**Fill from a resume** (ADR 0015): the Profile tab can prefill
`stackRequired` (from `Resume.primarySkills`), `stackNiceToHave` (remaining
scanned skills), `roleTypes` and `seniority` from any scanned resume —
rendered as an unsaved draft in the editor; nothing persists until Save.
Resumes scanned before `primarySkills` existed are re-scanned on demand.
Filling also proposes that resume as the search's `resumeId`, in the same
unsaved draft.

**Create a search from a resume**: `/resumes/:id` renders the profile a
click would create (name from the resume's headline, primary stack →
required, remaining skills → nice-to-have, plus role types and seniority)
and saves it on one press, linked to that resume. The wizard's step 3
offers the same for a second resume once the first search exists. New
profiles are **born inactive** — creating a search never switches the one
the pipeline is scoring against; activation stays a deliberate press on
`/settings` → Profile.

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

## Application tracking

`Job.pipelineStage` is the funnel state, orthogonal to `Job.status`
(`status=APPLIED` + `pipelineStage='ghosted'` is a valid pair). Columns are
configured on `/settings` → General: **Applied** and **Rejected/Ghosted** are
fixed, everything between them is user-named and reorderable, and keys never
change once created (ADR 0025). Every stage move writes a `JobStageEvent`
ledger row in the same transaction (ADR 0024).

**Which resume it went out with.** "Mark applied" on `/jobs/:id` carries a
resume select — preselected from the comparison on screen, else from the
search that scored the posting best — and writes `Job.appliedResumeId`,
`appliedResumeVersion` and `appliedResumeText`. The text snapshot is not
redundant: "Upload a new version" replaces the bytes of the same `Resume`
row, so an id alone would name v3 and hand back v5's words (the pattern
`ResumeMatch.resumeText` already uses). The job page and the stale digest
then say "applied with Senior Backend v3"
(`src/jobs/applied-with.ts`, pure). Deleting the resume sets the FK NULL and
leaves the snapshot; rows applied before the feature stay NULL and render as
they always did.

## Discovery

When `discoveryEnabled=true`, the HN parser scans each comment for ATS
URLs (`extractAtsToken` in `src/text-utils.ts` covers
greenhouse/lever/ashby/workable/smartrecruiters) and writes
`CompanyCandidate` rows. The user reviews on `/discovery` and clicks
**Promote** → adds to `Company` with `active=true`. A weekly probe job
re-validates each pending candidate's slug and updates `jobsSeen`,
marking 4xx-returning slugs as DEAD.

## Cross-source dedup (F3)

Dedup is per `(companyId, externalId)`, which cannot see the same posting
arriving through two sources. `src/fingerprint.ts` adds a 64-bit SimHash over
the description (3-token shingles, markup/entities/URLs stripped first).

A new job is compared against the last 90 days **at other companies only**, at
Hamming ≤ 7; a hit sets `Job.crossListedOfJobId` and shows as "Also listed
elsewhere — apply through one channel only" on `/jobs/:id` (both directions)
and as a line in the Telegram alert. **Annotation only** — nothing is merged,
hidden or skipped, so a wrong link costs a confusing note and nothing else.

Bodies under 400 normalized characters get no fingerprint and never match:
truncated aggregator teasers (Jobicy, LaraJobs, Rippling) carry only a company
blurb, so two different roles at one company would otherwise look identical.
Same-company matches are deliberately left alone — a quarter of them are
genuinely different roles sharing boilerplate (ADR 0018); reposts are F11.

Existing rows are fingerprinted by
`node dist/scripts/backfill-fingerprints.js` (`--dry-run` first); re-running
it links nothing new.

## Company starter packs (F14)

`/companies` → **Add a starter pack**: curated segments (PHP/Laravel & CMS,
JS infra & dev tools, JS/TS product & headless CMS, remote-first,
UA-friendly remote) held in `src/starter-packs/catalog.json`. Each entry
pins an `(atsType, atsToken)` that was resolved *and* identity-checked
against the live vendor API — a probe hit alone proves a board exists, not
whose it is (ADR 0017).

Picking segments re-probes every board now and shows a preview split into
new / already tracked / **unresolved** (listed with a reason, never dropped).
Confirming inserts the boards **inactive**, then an "Enable all" button
activates them. A board only counts as resolved at ≥ 1 open job, and the
resolve chain falls back through all ten per-company vendors
(greenhouse → ashby → lever → workable → smartrecruiters → recruitee →
breezy → bamboohr → pinpoint → rippling) if the pinned board has moved.
Re-importing a pack adds nothing.

## Company watchlist (§17 stage A, ADR 0036)

`/companies` → **Watch specific companies**: paste career-page or board URLs,
one per line (optionally `Name — URL`). Each one is resolved by a ladder that
reads only what a site publishes for machines — the ATS behind the page
(confirmed against the vendor's API), then an RSS/Atom feed whose own path
names jobs and which carries entries. Nothing else: **no headless browser**,
ever. `robots.txt` is read first by `src/robots.ts` (RFC 9309, plus ADR 0005's
rule that an AI-agent ban binds us), and at most five requests go to the site,
only at add time.

A watched company is a `Company` row with four columns — `watched`,
`checkEvery` (`hour | day | week`), `nextCheckAt`, `alertPolicy`
(`matches | all`) — and no cron of its own: the hourly tick selects
`active AND (nextCheckAt IS NULL OR nextCheckAt <= now)` and stamps
`nextCheckAt` after every attempt, failures included. That means watched
companies **follow the user's search schedule** (§16) and are not checked
during hours the search sleeps.

`alertPolicy = 'all'` bypasses the base filter and the fit threshold: the
posting is still classified, so it carries a score, but the alert reads
`★ New posting` rather than claiming a match. `★` marks the company on
`/jobs`, on the job page and in Telegram, and the `★ Watched` chip filters
the list.

When a page publishes no board and no feed but does publish prose, the last
rung takes it: **the change watch**. It hashes `stripHtml(page)` with
whitespace collapsed — and nothing else, because on the sampled pages the only
digits in the text were the counts that ARE the signal ("92 positions") — and
says *"this careers page changed, have a look"* at most once a day, with the
link. It never claims to know the jobs, produces no `Job` rows and costs no
AI; `/companies` says *Page changes* and *watching* rather than a count. The
hash advances only once the alert is actually sent, so a change seen inside
the quiet window waits instead of being lost.

Measured on twenty JavaScript-heavy companies and sixteen European ones
(2026-09-04, [docs/company-watchlist.md](./docs/company-watchlist.md)): 7
resolved to a board, 0 to a feed, and the rest to a change watch or an honest
refusal. The sitemap + JSON-LD rung the plan called stage B was measured and
**not built** — across 41 career pages, none publishes `JobPosting`.

## Resumes (Phase 8.1)

`Resume` rows hold an uploaded file (`original` bytes, `.docx` / `.md` /
`.txt`) and its plain-text extraction (`text`). On upload the web process
runs one AI call (the resume model, `CLAUDE_MODEL_RESUME` by default) that fills headline, seniority,
years, skill tags, role types and job-agnostic `issues`. The first upload
becomes the default.

`ResumeMatch` is one comparison of a resume against a job, triggered from
`/jobs/:id` → "Resume match" → Compare (the dropdown preselects the resume
with the most skill-tag overlap). Stored per run: `matchScore`, `summary`,
`strengths`, `redFlags`, `keywords` (`present | add | ask_user |
cannot_claim`, where, note) and `actions` (section, where, what, why,
priority). Nothing edits the resume — the report is the to-do list. See
ADR 0008.

A comparison has two shapes (ADR 0029). **Compare** runs the quick check:
one call that returns the keywords, alignment grades, hard-requirement gates
and red flags — everything the score is computed from — and no edit
suggestions. **Full analysis** runs the same rules plus the suggestions, and
**Get suggestions** adds them to a stored quick check in a second call that
reuses its verdicts and leaves the score untouched. The mode is recorded in
the `breakdown` JSON next to the prompt version, so a re-run of unchanged
text is still free and a full request over a stored quick check pays only
for the suggestions.

The targeted view (`/jobs/:id/target`, ADR 0010) shows one match as two
panes: the posting with every keyword highlighted, and the resume text in an
editor. `src/web/public/target.mjs` scores keyword coverage in the browser
on every edit (P1 = 3, P2 = 2, P3/P4 = 1, `cannot_claim` excluded by
default) and renders both panes' highlights from the match's `keywords`
(with `aliases`), `actions` and `removals` (with verbatim `quote`s).
"Re-check with AI" posts the draft (`draftText`) → a `ResumeMatch` with
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
then classified against every running search without touching the status.

"Is this job real?" on `/jobs/:id` first runs the free liveness ladder
(ADR 0016): rung 1 asks the ATS vendor's public posting API (the five
tracked vendors), rung 2 fetches the posting page and classifies it with
strict rule order — every ambiguity resolves to `uncertain`, never
`expired`. A resolved verdict stops there ($0, seconds) and lands in
`Job.liveness` / `livenessCode` / `livenessCheckedAt`; the "Deep check"
button (or an `uncertain` ladder) runs the ghost-job checklist with web
search (`AiRequest.webTools`, ADR 0009) and stores a `JobVerification`:
`verdict` legit | suspicious | fake, `recommendation` apply | caution |
skip, confidence, evidence rows with URLs, red flags, company snapshot.

## Cover letters (F8, ADR 0021)

"Cover letter" on `/jobs/:id` writes a short letter (120–180 words, capped
at 200 — the band of the user's real sent letter) from stored inputs only:
resume text, `CandidateFact` rows, the posting, plus — when they exist —
the latest `ResumeMatch` of the selected resume and the stored
verification's `companySnapshot`. Match and verification are optional
enrichers, not prerequisites (they cover ~1% of jobs). Tone select
(neutral | warm | direct) and four optional angle fields steer emphasis —
three per-story inputs plus standing "anything every letter should
mention" notes; all four are saved to `AppSettings.coverAngles` on every
generation and prefilled on every job page, so they are typed once. Angle
text is never treated as evidence. Letters are written for a non-technical
first reader (no acronym soup, at least as much about the company's need
as the candidate's past) and normalized to plain keyboard punctuation by
`toPlainPunctuation` before the gate — no em dashes, curly quotes, bullets
or emoji ever reach a stored letter. English only until a non-English
posting or resume exists.

The menu's **Cover letter** page (`/letter`) is the standalone entry point.
Two job sources: a searchable picker over the newest jobs that clear the
primary search's fit threshold, or one "new posting" box taking a URL
and/or pasted text (pasted text wins; a bare URL is fetched — ADR 0005
hosts and the private address space refused, bot checks fail honestly, and
an unreadable page returns the user to the form with the URL kept). Resume
by pick / upload / paste (scratch row, like /target).

**The default run is one model call.** The letter path never asks for a fit
score (a letter does not read one; "Re-classify" fills it in later), and the
resume match (+1 min) and company research (+2–4 min) are opt-in behind a
disclosure — measured end to end at ~26 s from submit to letter. Both
analyses are stored on the job, so a later letter reuses them for free.
Every slow stage — the page fetch included — is a visible run step, so the
form never hangs.

Letter writing has its own per-engine model slot on `/settings` → AI engine;
an empty slot follows the resume model. Each letter row offers Regenerate (same resume + tone,
current saved angles and prompt) and "Save as PDF" / "Save as DOCX"
downloads built in-process (`zip-write` / `docx-write` / `pdf-write`, no new
dependencies); the edited text wins in exports. Edits autosave (debounced,
flushed on blur and on unload) and re-run the gate warn-only; the Save
button remains as the no-JS path.

Every draft passes the fact gate (`fact-check.ts`, ADR 0020) before it is
shown: `block` → one regeneration with the violations quoted → still
`block` → the run errors and nothing is persisted. Stored rows
(`CoverLetter`) carry the text, `keywordsUsed` / `gapsAcknowledged`, the
engine `model` (with the `· fallback` marker), `gateVerdict` and
`gateNotes`; the card lists all letters newest-first with copy and in-place
editing. Manual edits are re-checked warn-only — the gate polices the
model, not the user. The generation call is tool-free (`webTools` stays
exclusive to verification, ADR 0009).

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
- `src/ai-provider.ts` seam, five engines: `anthropic_api` (SDK, per-token), `claude_code` (headless CLI, subscription), `gemini_cli` (headless CLI, Google account), `openai_api` (fetch → any /chat/completions endpoint via OPENAI_BASE_URL), `codex_cli` (headless CLI, ChatGPT subscription). `/settings` → "AI engine" stores an ordered chain + per-engine classifier/resume/cover models (AppSettings.aiEngine JSON, ADR 0013/0014) and, for the four key-bearing engines, the API key itself (AppSettings.aiKeys, ADR 0027 — DB first, `.env` as fallback, never rendered in full); calls fail over down the chain automatically; `.env` seeds the default (Haiku 4.5 classifier, Opus 5 resume); `AI_CONCURRENCY` jobs classified at once (default 3)
- node:test runner (`npm test`), no jest

## Project layout

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the data flow and file map.
See [docs/adr/](./docs/adr/) for the "why" behind non-trivial choices.
