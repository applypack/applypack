# Onboarding & profile simplification plan

> Drafted 2026-08-31 from a live UI review of `/settings?tab=profile` and
> `/` (desktop + 375px) plus a source pass over `src/web/pages/settings.tsx`,
> `overview.tsx`, `resumes.tsx`, `src/profiles.ts`, `src/init.ts`,
> `src/resume/profile-draft.ts`, `src/resume/pick.ts` and the Prisma schema.
> Backlog tick: [TASKS.md §11](./TASKS.md). Pairs with
> [CLAUDE.md](../CLAUDE.md), the testing-gate / commit-discipline skills and
> the ADR register in [docs/adr](./adr/).
>
> **Status: analysis only.** Nothing here is implemented. Constants
> (batch caps, source subsets, timings) are starting hypotheses to
> re-measure at implementation time.

**Who this is for.** The target user of the wizard is explicitly
non-technical — a manager who can install Docker by following a README but
has never edited a config file and does not know what a "classifier" is.
Every screen must survive the test: *would a person who has never seen a
terminal understand what to click next?*

---

## 0. What the analysis found

### 0.1 The onboarding hole (P0)

- There is **no onboarding in the product**. The "first fifteen minutes"
  live only in the README. A fresh install lands on `/` showing four
  zeros, "No alerted jobs yet", cron rows saying "never ran" and a
  "Pipeline paused" badge with no explanation of *why* it is paused or
  what to do next (`src/web/pages/overview.tsx` has no first-run branch).
- There is **no way to verify the pipeline works from the UI**. No
  "fetch now" button exists anywhere (`Discovery` has "Run now"; fetch
  does not). A new user either waits up to an hour for cron or runs
  `docker compose exec … fetch-once.js` — which the target persona will
  never do.
- The resume → profile loop spans **two pages with a silent wait**:
  warning on the Profile tab links to `/resumes`, upload there, wait ~1
  min for the scan with no pointer back, return to `/settings?tab=profile`
  by memory, pick the resume, "Fill from resume", review, "Save profile".
  6–7 steps; this is precisely where users report getting lost.

### 0.2 The Profile tab itself (P0/P1)

- **Wrong order for the main journey.** The first screen is profile CRUD
  chrome (select + Activate + "+ New profile" + "Re-classify all jobs").
  The violet "Re-classify all jobs" — a paid AI action, useless at 0 jobs —
  is the most colourful button a brand-new user sees. On 375px the real
  first action ("Fill from a resume") is 1.5 screens down; the tab is
  2.8 viewports closed, ~3.3 with Advanced open.
- **Three identical-looking chip fields with load-bearing semantics**
  (required stack vs role types vs nice-to-have). The split is critical
  for the classifier (CLAUDE.md gotcha 8) so it must stay — but visually
  the fields differ only by fine print, and users cannot tell where
  "full-stack" goes vs "php".
- **Save-model contradiction.** The page header promises "changes save
  the moment you click", the profile editor is a submit-form with an
  "Unsaved changes" indicator.
- **Priority rules** (`LABEL | techs,csv | regions,csv | MIN_FIT`) plus an
  always-rendered warn paragraph is the single most intimidating block on
  the page, shown even when the textarea is empty.
- **Advanced auto-opens for most real users**: the `advancedOpen`
  condition includes `minSalaryUsd > 0`, and `init.ts` seeds salary from
  `.env` — so the block is permanently open and the page permanently long.
- **"Other profiles" table duplicates the activate select** — two UI
  mechanisms for one concept on one page.

Functionally no profile field is dead weight — every one feeds
`buildSystemPrompt` or `passesBaseFilter`. The fix is presentation and
sequencing, not the data model.

### 0.3 Multi-resume reality (P1)

Users have 3+ resumes (backend / full-stack / QA) and want **all**
directions hunted at once, choosing the resume per application:

- Any number of resumes is supported and `pickResumeForJob`
  (`src/resume/pick.ts`) already preselects the best one per job — the
  "choose at application time" half exists.
- But the **search is single-track**: one `AppSettings.activeProfileId`;
  fetch/HN/re-classify all score against one profile. Hunting three
  directions today means either one union-profile (muddy scores — exactly
  what gotchas 8/11 guard against) or manually switching profiles and
  re-classifying everything. Both are bad.
- `Job` records `appliedAt/pipelineStage/notes` but **not which resume
  was sent**. "Upload new version" replaces resume bytes and text in
  place, so a bare foreign key would lie after an update; the snapshot
  pattern already exists in `ResumeMatch.resumeText`.

---

## 1. Wizard design principles

1. **One screen — one action.** Each step has a single primary button.
   Everything else is a quiet "skip" link.
2. **Detect, don't ask.** Every step first checks the DB/env and
   auto-completes if the condition is already met. Steps are **derived
   from data**, never stored as a step counter: engine detected? jobs
   exist? profile has stack/roleTypes? a classified run finished?
3. **Plain human copy.** No "classifier", "ATS", "fit score" on wizard
   screens — "we read every job and score how well it matches you",
   "match score". Terminology stays in Settings for power users.
4. **Show real numbers fast.** The wow moment is live: "312 jobs found
   from 14 sources in 40s", then "18 match you — here are the top 5".
5. **Never spend AI before AI is connected and never classify against a
   blank profile** (that is why fetching ships paused — keep honouring it).
6. **Skippable for experts.** "Skip setup" marks setup complete;
   everything remains reachable through Settings as today. The wizard is
   sugar over existing flows, not a new source of truth.
7. **Existing primitives only** (`src/web/ui.tsx`, flash, confirm,
   no-JS-safe forms). Progress pages reuse the compare-run pattern.

## 2. First-run wizard — `/welcome`

**Entry:** `GET /` redirects to `/welcome` while
`AppSettings.setupCompletedAt IS NULL`. Any other page keeps working (no
lock-in). "Skip setup" sets the flag; Overview shows a small "Finish
setup →" chip while any step is incomplete (flag set or not).

**Schema:** one nullable column `AppSettings.setupCompletedAt DateTime?`.
Hand-written migration (gotcha 7). Nothing else is stored — see
principle 2.

### Step 1 — Connect AI

- Auto-detect engines exactly as `/settings?tab=ai` does. If at least one
  engine probes `ok`: run one tiny live test call on entry (same code as
  the Test button), show "✓ Claude connected" and auto-advance. Zero
  clicks for the README-follower who set one `.env` line.
- If none detected: per-engine plain-language cards ("I have a Claude
  subscription" / "I have a Gemini key — free tier works" / "OpenAI or
  compatible"), each with the exact `.env` line to paste and a "Check
  again" button. This is the weakest step for the non-technical persona
  until Phase B lands:
- **Phase B (separate stage, ADR required):** paste the API key directly
  into the wizard/Settings, stored in the DB, masked like Telegram bot
  tokens. Precedent: `TelegramTarget` tokens already live in DB rows and
  CLAUDE.md's secrets rule carves that exception explicitly; ADR 0013
  already resolves engine config DB-row-first with `.env` fallback. The
  ADR extends both to per-engine keys. Dashboard binds to 127.0.0.1 by
  default, which bounds the exposure. Until then the wizard shows the
  `.env` path honestly.

### Step 2 — Test the search (no AI, no profile needed)

The user's core question — *"does job search actually work?"* — answered
before any configuration, because this step spends no AI:

- One button: **"Run a test search"**. It fetches from the enabled
  sources, dedupes and stores jobs with `status NEW, fitScore null`,
  **classification explicitly skipped** (new `{ classify: false }` seam
  through `jobs/process-jobs.ts` — today a blank profile would send every
  job to the AI, which is the expensive accident the pause exists to
  prevent).
- Runs in the web process as a background run with an in-flight guard and
  `recordCronRun('fetch-test', …)` — the exact pattern of
  `POST /settings/reclassify` (`src/web/routes/settings.tsx:710`) — with a
  live progress page (auto-refresh, `src/web/target-runs.ts` pattern)
  showing sources ticking as they answer.
- Result screen: "✓ **312 jobs** found from **14 sources** in 40s. The
  search works — now let's find the ones that match *you*." Counts come
  from the run's `CronStats`.
- Failure is honest: which sources answered, which errored, with a plain
  retry. (Zero jobs from all sources ⇒ likely no network — say so.)
- This button is **not wizard-only**: the same run gets a permanent home
  as "Fetch now" on `/runs` (or Overview), closing the standalone P0 gap
  for existing users too.

### Step 3 — Your profile (from a resume)

- One card: **"Upload your resume"** (file input; `.pdf .docx .md .txt`,
  same accept-list as `/resumes`). Under it a quiet link: "no file handy?
  answer three questions instead".
- On upload: create the Resume row (first upload becomes default — logic
  unchanged), run the scan with a progress page, then show a
  plain-language summary card built from the existing
  `buildProfileDraft` (ADR 0015 machinery, unchanged):
  > "Looks like you're a **Senior Backend Engineer** — main tools
  > **PHP, Laravel, MySQL**, plus 12 more skills. We'll hunt for senior
  > backend roles using these."
  Buttons: **"Yes, that's me — start matching"** (applies the draft to
  the active profile and saves — one click, ADR 0015's
  review-before-save is honoured because nothing persisted until this
  click) and "Let me adjust" (jumps to `/settings?tab=profile` with the
  draft rendered, today's flow).
- The three-question fallback (no resume): main technologies (chips),
  role words (chips), seniority (pills) — writes the same profile fields,
  defaults for the rest. Nothing else is asked; regions/salary/etc. stay
  defaults and live in Settings.
- Auto-completes if the active profile already has stack or role types.

### Step 4 — First matches

- One button: **"Score the jobs we found"**. Classifies the stored
  unscored jobs against the fresh profile using the existing re-classify
  machinery, **capped to the most recent ~100** by `fetchedAt` (constant
  to measure: cost vs wow; the rest catches up on the next cron ticks).
  Same background-run + progress pattern as step 2.
- Result screen: "**18 of 100** look like a match. Top 5:" — five rows
  (title, company, match score) linking to `/jobs/:id`. Then one closing
  action: **"Start the hourly watch"** → `setFetchingEnabled(true)`,
  `setupCompletedAt = now()`, redirect to `/` with a flash.
- Telegram is a quiet card on this final screen — "Want new matches on
  your phone? Set up Telegram later in Settings → Notifications" — a
  link, not a step. (Per product decision: Telegram is skippable;
  AI + proven search + profile are the critical path.)
- Auto-completes if a classified job already exists (returning user).

**Click budget:** README-follower with a key in `.env`: step 1 = 0 clicks,
step 2 = 1, step 3 = file pick + 1, step 4 = 2. **~4 clicks + one file
pick** from install to watching real scored matches.

## 3. Profile tab restructure

Independent of the wizard; ships first as quick wins + one reorder.

Quick wins (each < 1h):

1. Remove the standalone "Re-classify all jobs" button from the top row —
   "Save & re-classify" at the form foot already covers it.
2. Real example placeholders in the three chip editors ("php, laravel,
   mysql…" / "backend, full-stack…" / "docker, aws…") instead of three
   identical "Add and press Enter…".
3. Render the priority-rules warn hint only when rules are non-empty;
   wrap the whole rules editor in its own nested `<details>`.
4. Drop `minSalaryUsd > 0` (and `telegramTargetId`) from the
   `advancedOpen` condition — notes/cities/rules only.
5. Fix the header copy contradiction for this tab (the profile editor is
   submit-to-save; say so, or scope the "saves on click" line to toggles).
6. Overview: the "Pipeline paused" badge gains one explanatory line —
   "paused on fresh install so a blank profile doesn't waste AI credit"
   — linking to the wizard/checklist.

Reorder (one PR):

- Section order becomes: contextual warning (if any) → **Fill from a
  resume** (now also accepting a direct file upload when no resumes
  exist, killing the two-page round trip) → **profile editor** →
  compact management row (select + Activate + New + Delete) at the
  bottom. Drop the "Other profiles" table — the select is the one
  mechanism.
- Group the three chip fields under one "What are we hunting for?"
  sub-heading with a two-line legend (languages/frameworks → required;
  job-title words → role types) so the distinction is explained once,
  not three times in fine print.

## 4. Multi-resume search

### Stage A — resume-linked profiles (small, no ADR)

- `Profile.resumeId Int?` — "this search hunts jobs I'd apply to with
  this resume". Hand-written migration.
- One-click **"Create profile from this resume"** on `/resumes/:id` and
  in the wizard's step 3 for second/third resumes: upload → scan →
  draft → save as a *new linked profile* (activation unchanged).
- Job page preselect: winning profile's resume when the link exists,
  `pickResumeForJob` fallback otherwise.

### Stage B — parallel search across active profiles (the big one, ADR)

- Multiple **active** profiles replace the single `activeProfileId`
  (keep it as "primary" for defaults, add `Profile.active Boolean`).
- Base filter passes a job if **any** active profile admits it (pure
  union — free).
- **One classifier call per job, not N:** the prompt describes every
  active profile; structured output returns
  `[{ profileId, fitScore, fitReasons }]`. New table
  `JobScore (jobId × profileId, fitScore, reasons…)`; `Job.fitScore`
  keeps best-of for list sorting. AI spend stays ~flat (output grows,
  calls don't). Prompt-cache-friendly: profiles are stable across a tick.
- Alerts: one alert per job with the best profile named
  ("Backend 87 · QA 41"); `Profile.telegramTargetId` **already exists**,
  so each direction can notify its own chat with zero new schema.
- UI: profile filter chips on `/jobs`; per-profile score row on
  `/jobs/:id`; per-profile `minFitScore` gates its own alerts.
- ADR covers: schema (JobScore, active flag), single-call multi-profile
  prompt contract, alert routing, migration of existing `fitScore` rows.
- Re-measure before building: prompt-size growth vs the two-stage
  prefilter; cap on simultaneous active profiles (hypothesis: 5).

### Stage C — remember the resume you applied with (small)

- On "Mark applied": a resume select (preselected from the match card /
  winning profile) writing `Job.appliedResumeId + appliedResumeVersion +
  appliedResumeText` (text snapshot — bytes are replaced in place on
  version bumps, so a bare FK would lie; `ResumeMatch.resumeText` is the
  proven pattern).
- Stale digest and the job page can then say "applied with Senior
  Backend v3".

## 5. Stage breakdown

One feature = one branch = one PR = one tag (release-discipline).
Verification per testing-gate; dashboard changes mean rebuild + curl +
1200/768/375 screenshots + 0 console errors; schema changes mean
hand-written migrations verified through a container rebuild.

| # | Branch | Scope | Schema | ADR | Key verification |
|---|--------|-------|--------|-----|------------------|
| 1 | `profile-tab-quickwins` | §3 quick wins + reorder, inline upload in Fill card | — | — | dashboard matrix; profile save round-trip; chip editor no-JS path |
| 2 | `fetch-now` | "Fetch now" button + `{classify: false}` seam + background run + progress page (standalone value) | — | — | smoke `fetch:once`; run visible on `/runs`; unscored jobs stored; dashboard matrix |
| 3 | `welcome-wizard` | `/welcome` steps 1–4, redirect, skip, Overview chip | `setupCompletedAt` | — | migration via container rebuild; full wizard walkthrough on a wiped DB (docker volume rm) at 1200/375; every step's auto-complete branch |
| 4 | `ai-key-in-db` | per-engine API key in DB, masked; wizard step 1 upgrade | engine-key column/JSON | **yes** (extends 0013 + secrets policy) | probe/test with DB key and with `.env` fallback; key never logged; masked render |
| 5 | `profile-resume-link` | Stage A | `Profile.resumeId` | — | create-from-resume flow; preselect unit test in `pick.test.ts` scope |
| 6 | `multi-profile-search` | Stage B | `JobScore`, `Profile.active` | **yes** | prompt/parser unit tests; live smoke on 2 profiles; alert routing test send; jobs-list filters |
| 7 | `applied-resume` | Stage C | 3 columns on `Job` | — | mark-applied round-trip; digest line render test |

Order rationale: 1–3 are the user-facing pain in the report and need no
policy decisions; 4 unblocks the truly non-technical persona; 5–7 build
the multi-resume story on top of a wizard that can then onboard several
resumes in one sitting.

## 6. Open decisions

- Step-2 source subset: all enabled sources vs a fast-aggregator subset
  (RemoteOK/Remotive answer in seconds; per-company boards add minutes).
  Hypothesis: all enabled, with the progress page making the wait fun.
- Step-4 classification cap (hypothesis 100 — measure cost/latency on
  Haiku 4.5 two-stage vs single).
- Whether "Fetch now" lives on `/runs`, Overview, or both.
- Wizard copy voice pass (stop-slop skill) once screens exist.
- Whether step 3 should offer multi-upload immediately or defer extra
  resumes to `/resumes` until stage 5 lands.
