# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [1.14.0] — 2026-09-02

### Changed
- **Keyword highlights tolerate spellings, plurals and separators**
  ([docs/target-plan.md](docs/target-plan.md) §4 F3–F6, TASKS §13 block 2).
  The matcher behind the `/target` panes and the live score now treats the
  separators inside a multi-word term as interchangeable and optional
  (`CI/CD` = `CI / CD` = `CI-CD`, `Node.js` = `NodeJS`, `front-end` =
  `front end` = `frontend`), matches the regular plural of a term and the
  singular of a plural one (`microservice(s)`, `API(s)`, `query` /
  `queries`, `patch(es)`), and unions a curated table of 170 spelling groups
  (`node.js` / `node` / `nodejs`, `go` / `golang`, `postgresql` / `postgres` /
  `pgsql`, `k8s` / `kubernetes`, `ci/cd` / `continuous integration` …) into
  every keyword — when an analysis is stored and again when one is loaded, so
  earlier analyses highlight the same way. The whole-token guards stay: `C`
  is not `C++`, `Java` is not `JavaScript`, a Capitalised name that ends in
  s (`Rails`, `Windows`, `Kubernetes`) is not a plural, and there is no
  stemming beyond plurals.
- **Every keyword is anchored to the posting when the analysis is stored.**
  A term the model paraphrased is rewritten to the longest verbatim phrase of
  itself the posting contains, spelled as the posting spells it; one the
  posting contains in no recognisable form is flagged — the keyword table
  shows *not in posting*, and the `resume: matched` log line counts
  `anchored` / `unanchored`, the regression metric for future prompt
  changes. No prompt change and no schema change (an optional field in the
  keyword JSON).
- The job-description pane says that benefits, perks and legal boilerplate
  are never keywords, so an unmarked paragraph there stops reading as a miss.

### Added
- `npm run keywords:audit` — read-only: lists every stored keyword row that
  highlights nowhere, as stored and with the alias table. Measured on the 15
  stored comparisons: rows with no highlight in the posting 54 → 53 of 305,
  `present` rows with no highlight in the resume 36 → 35 of 181 — what
  remains are paraphrases from analyses older than the verbatim rule.

## [1.13.0] — 2026-09-02

### Changed
- **A compare waits for one AI call, not three**
  ([docs/target-plan.md](docs/target-plan.md) §3.1, TASKS §13 block 1). On
  `/target` the posting's fit score is now classified in the background while
  the resume-model call runs — the comparison never read it, and that leg
  alone measured 49–55 s on the `claude_code` engine. On "Upload vN &
  re-analyze" the new version's scan runs the same way instead of ahead of
  the match (26–33 s measured). Known cost of the second one: until the
  background scan lands, the resume's headline / skills / core stack still
  describe the previous version — `scannedAt: null` marks it, and nothing but
  `/resumes` and other resumes' "elsewhere" hints read those fields.
- **Repeating a comparison is free.** A double submit, a back button, a
  re-paste or a re-upload whose text did not change no longer buys a second
  resume-model call: when the latest stored analysis for that resume and
  posting judged the identical text under the same prompt version, the page
  shows it with *"Unchanged since the last analysis (3m ago)"* and a
  **Re-run anyway** button for the rare time a fresh call is wanted. Plain
  string equality — a one-character edit is a new analysis
  (`src/resume/match-reuse.ts`, unit-tested).
- **The progress page tells the truth about time.** Every step shows the
  seconds it took once done and a live count while it runs, next to a total
  that ticks every second. Step copy now quotes measured durations instead of
  "about a minute": the match is 1½–2 minutes on Opus (83–109 s measured), a
  scan about half a minute, posting-fact detection 10–40 s on a CLI engine.
  The same numbers replaced the promises on the job page, the targeted
  editor, `/welcome` and Settings.
- Per-step timing logs: `resume: scanned`, `posting-extract: done`,
  `classify-existing: scored` and `run: step finished` all carry `ms`, so the
  next optimisation round starts from numbers, not estimates.

### Notes
- `ResumeMatch` has no prompt-version column and this release changes no
  schema, so the version rides inside the `breakdown` JSON (written by
  `createMatch` / `updateMatchScoring`). Rows from before this release carry
  no marker and are never reused. No migration.

## [1.12.0] — 2026-09-02

### Fixed
- **No resume write freezes the browser any more**
  ([docs/resumes-plan.md](docs/resumes-plan.md) Part A, TASKS §12 block 1).
  Upload, "Upload a new version", Re-scan and the targeted editor's
  "Save as vN" each awaited a ~60 s call to the resume model inline, on a form
  whose submit button stayed live — a second click created a **duplicate
  resume and a second AI call**. All four now run through the same run
  registry that `/target` and Compare already used: the POST returns at once
  and you watch a progress page you are free to close. The forms that start
  one also disable themselves on the first press.
- **The `/resumes` rows are usable on a phone.** The hub forced a 52 rem
  minimum width inside a horizontal scroller, which put Skills, Scanned and
  *both* action buttons off-screen at 375 px. Delete has left the hub for the
  detail page — a destructive action should not be one click from a list —
  and the remaining columns now drop out by width instead: Name, Matches and
  Set default survive everywhere, Scanned returns at 640 px, Core stack at
  1024, Headline at 1280.
- **The delete confirm no longer understates what it destroys.** Deleting a
  resume cascades its cover letters — including text the user wrote by hand —
  and the dialog said only "and its comparisons". It now counts both:
  *"Delete "Senior Backend" and 14 comparisons and 17 cover letters?"*

### Added
- A **Matches** column on `/resumes`: the best score a resume has ever
  reached plus how many comparisons it has been through, so the hub answers
  "is this one working?" and not just "does this one exist?".
- The Skills column became **Core stack** and reads `Resume.primarySkills`.
  The scanned `skills` list runs to ~85 entries that open the same way on
  every resume ("php, go, javascript…"); the 2-5 core technologies actually
  tell two resumes apart. A version badge joins the name.

### Changed
- `Table` accepts `thClasses` — the only place a responsive `hidden
  sm:table-cell` can live, since a class on the header label still leaves the
  cell occupying its column. Table gutters tighten below 640 px.

## [1.11.0] — 2026-09-02

### Added
- **The resume an application went out with is recorded**
  ([docs/onboarding-plan.md §4](docs/onboarding-plan.md) stage C, TASKS §11
  block 7 — the block that closes §11). "Mark applied" on `/jobs/:id` now
  carries a resume select, and the job page and the stale-applications digest
  answer "applied with Senior Backend v3" instead of leaving you to remember.
- The select starts on the resume this posting was actually compared with; with
  no comparison it falls back to the page's own preselect — since 1.10.0 that
  is the resume of the search that scored the posting **best**, not merely the
  primary (ADR 0028), so stage 5's behaviour is unchanged where it applied.
- New `Job.appliedResumeId` (FK, `SET NULL`), `appliedResumeVersion` and
  `appliedResumeText`. The text snapshot is not redundant with the id:
  "Upload a new version" replaces the bytes of the *same* `Resume` row, so an
  id alone would name v3 and hand back v5's words — the pattern
  `ResumeMatch.resumeText` has used since phase 9. Applications recorded before
  this release stay NULL and render exactly as they did.

### Changed
- `/applications` reads six columns instead of whole `Job` rows. The board
  query is unbounded in the number of applications, and every card it draws is
  an applied posting — the one place where a per-application text column would
  land on 100% of the rows.
- Documentation caught up with 1.8.0–1.10.0, three releases behind:
  - **Quick start no longer demands an API key in `.env`.** Since 1.8.0
    ([ADR 0027](docs/adr/0027-ai-keys-in-the-database.md)) the key is pasted
    into `/welcome` step 1 or Settings → AI engine and lives in Postgres;
    `.env` is documented as the fallback it became.
  - The Anthropic API row no longer claims "prompt-cached", and the cost
    section no longer bills a caching discount that never applied: Haiku 4.5
    caches nothing under a 4,096-token prefix and our classifier prompt is
    1,216 (`cache_creation_input_tokens` was 0 on every measured call). The
    per-posting figure is restated as ~$0.003 from token counts.
  - "22 sources" now says what it counts — 22 fetchable `AtsType` branches in
    `fetchOne`, i.e. kinds of board, not the 73 companies this install tracks.
    The aggregator list had been missing 4 Day Week.
  - The feature table learns parallel searches, starter packs, the first-run
    wizard and the prompt fence; the page table gains `/welcome` and `/letter`
    and stops advertising a fixed funnel that
    [ADR 0025](docs/adr/0025-custom-work-stages.md) made configurable.
  - `docs/screenshots/overview.png` and `jobs.png` retaken: the stored pair
    predated "Fetch now" and the Target → Compare rename.
  - SPEC's pipeline diagram still described one profile and one verdict;
    ARCHITECTURE's ER diagram was missing `Profile.active`, `Profile.resumeId`,
    `AppSettings.aiKeys` and `setupCompletedAt`.

## [1.10.0] — 2026-09-02

### Added
- **Several searches run at once**
  ([docs/onboarding-plan.md §4](docs/onboarding-plan.md) stage B, TASKS §11
  block 6, [ADR 0028](docs/adr/0028-parallel-searches-one-call-per-posting.md),
  which supersedes 0004). A backend search and a QA search now hunt in
  parallel: each new posting is scored against every running search in **one**
  AI call, and each search keeps its own threshold, its own priority rules and
  its own Telegram chat. New `Profile.active` is the switch;
  `AppSettings.activeProfileId` stays as the **primary** — the search that
  supplies defaults everywhere, and the one that always runs. Up to 8 at once.
- New `JobScore` table, one row per (posting, search), holding that search's
  fit, location verdict, tech tags, flags and summary. `Job.fitScore` and its
  neighbours keep the **best-of**, so every list, badge, sort and digest reads
  exactly as before.
- **Search chips on `/jobs`** narrow the list to one search, and the Fit column
  then shows that search's own score rather than the best-of. The Fit ≥ filter
  follows the same score.
- **"By search" on `/jobs/:id`** — every search's fit, verdict and location
  call, best first. The top row is the search the page speaks for: the resume
  the Compare and Cover letter cards preselect now follows the search that
  scored the posting best, not merely the primary.
- **A "Searches" list on `/settings` → Profile** replaces the single Activate
  control: Run / Pause / Make primary / Delete per row, with the primary
  protected from being paused or deleted.
- Alerts name the winning search in the header and carry a `🎯` line with every
  search's score ("Backend 87 · QA 41"); they are delivered to the winning
  search's `Profile.telegramTargetId`, which already existed and was unused.
  The daily digest still broadcasts, with each entry naming its search.

### Changed
- A posting is admitted when **any** running search's base filter admits it,
  and dismissed only when **every** search rejects it. `passesBaseFilter` stays
  pure and single-search; `passesAnyBaseFilter` is the union wrapper.
- Issue #50's blank-search guard is now per search: an empty search is dropped
  from the roster for the tick instead of silencing the ones beside it, and its
  fit ≤ 50 cap is applied to its own verdict only.
- The two-stage classifier's stage-1 gate was rewritten. Measured on 24 stored
  postings, the shipped wording admitted 2 and kept only **1 of the 8** the full
  classifier had scored 75-90: the gate sees just the first 800 characters and
  read "the stack is not mentioned" as "the stack mismatches". Saying that
  explicitly, plus "unambiguous mismatch for every search", takes the same
  single search to 17 of 24 and 5 of 8. The mode has never been on in
  production (`classifierMode` defaults to `single`), so nothing was lost —
  but it was unusable and is now usable.
- `CLASSIFIER_PROMPT_VERSION` → 3; `max_tokens` scales with the number of
  searches (400 + 180·N), measured with headroom through 12.

### Fixed
- CLAUDE.md gotcha 3 claimed the two-stage classifier's economics rest on the
  prompt cache. They do not, and never did: `cache_creation_input_tokens` is
  **0 on every call**, because Haiku 4.5 needs a 4096-token prefix and the
  classifier prompt is 1216. The saving is the short prompt and tiny
  `max_tokens`. The note now says so, with the per-model floor.

### Migration
- `20260902140000_add_job_score_and_active_profiles` adds the column, the table
  and its indexes, marks the primary as running, and **backfills every already
  scored posting into `JobScore`** against the profile those scores came from.
  Verified on the live database: 986 rows moved, 0 orphans, 0 mismatches.

## [1.9.0] — 2026-09-02

### Added
- **A search can name the resume it hunts with**
  ([docs/onboarding-plan.md §4](docs/onboarding-plan.md) stage A, TASKS §11
  block 5). New `Profile.resumeId`: "this search is for jobs I'd apply to
  with *this* CV". A job page found by that search preselects its resume in
  the Resume match and Cover letter cards instead of guessing from
  skill-tag overlap; profiles without a link behave exactly as before.
  Editable on `/settings` → Profile → "Resume for this search", where
  clearing it returns to the overlap pick.
- **"Create a search from this resume"** on `/resumes/:id`. The card shows
  the whole profile a click would produce — name from the resume's
  headline, primary stack → required, other skills → nice-to-have, plus
  role types and seniority — and one press saves it, linked to that resume
  ([ADR 0015](docs/adr/0015-profile-draft-from-resume-scan.md) unchanged:
  the draft is rendered, never written before the press). The card also
  names the searches already hunting with that resume.
- The same action in the wizard's step 3, once the first search exists:
  "Another resume for a different kind of role?" takes one file (or one
  already-uploaded resume), reads it on the usual progress page, and offers
  the second search as a draft.

### Changed
- New profiles created from a resume are **born inactive**, like every
  other new profile — creating a search never switches the one the pipeline
  is scoring against. The flash and the card copy say where to activate it.
- "Fill from a resume" now proposes that resume as the search's resume
  alongside the fields it fills, in the same unsaved draft.
- Deleting a resume clears the link (`ON DELETE SET NULL`) rather than
  deleting the search or refusing the delete: a profile owns regions,
  thresholds, priority rules and alert routing that no resume can speak
  for. The preselect falls back to skill overlap.
- One read of `AppSettings.aiKeys` per `/settings` render instead of two
  (the page and the engine probe now share it).
- `docs/TASKS.md` §11–§13 headers state what actually shipped; §11 had
  claimed nothing was implemented while four of its seven stages were live.

## [1.8.0] — 2026-09-02

### Added
- **Paste an AI key instead of editing `.env`** ([ADR 0027](docs/adr/0027-ai-keys-in-the-database.md),
  [docs/onboarding-plan.md §2](docs/onboarding-plan.md) Phase B, TASKS §11
  block 4). Every engine card on `/settings` → AI engine now has a key row,
  and so does each card in step 1 of `/welcome` — paste, Save, Test, done.
  The key lands in the new `AppSettings.aiKeys` column, applies to the
  dashboard immediately and to the worker on its next tick, and wins over
  the matching `.env` variable. Four engines take one: Anthropic API
  (`ANTHROPIC_API_KEY`), Claude Code CLI (`CLAUDE_CODE_OAUTH_TOKEN`),
  Gemini CLI (`GEMINI_API_KEY`) and the OpenAI-compatible API
  (`OPENAI_API_KEY`); Codex CLI stays `codex login`.
- The stored key is never handed back: the field always renders empty, the
  card shows only the last four characters and where the credential comes
  from ("saved here" / "from .env"), and **Remove** deletes it.

### Changed
- `.env` keeps working exactly as before and stays the documented choice
  for anyone who would rather keep secrets out of the database — the ADR is
  explicit that a database dump contains a pasted key.
- The `claude_code` badge is honest about a logged-out CLI. `claude
  --version` answers whether or not anyone is signed in, so the engine used
  to read "available" on `/settings` and in the wizard and then fail on its
  first real call. The probe now reads the CLI's own auth signals (token in
  the environment, `.credentials.json`, the recorded account) without
  spending a call or slowing the page down.
- Provider constructors no longer hold credentials — the key arrives per
  call on `AiRequest`, so whether an engine can run at all is decided in one
  place (`ai-engine.ts:providerUnusable`) instead of two.

## [1.7.0] — 2026-09-01

### Added
- **First-run wizard at `/welcome`** ([docs/onboarding-plan.md §2](docs/onboarding-plan.md),
  TASKS §11 block 3). A fresh install lands there from `/` until setup is
  finished or skipped; every other page keeps working. Four steps, each
  derived from data and auto-completing when its result already exists:
  1. **Connect an AI** — detected engines are listed (zero clicks for a
     `.env` key); with nothing detected, plain-language cards say which
     line to add per engine. "Send a test message" runs the same tiny live
     call as the Settings Test button.
  2. **Test the search** — "Run a test search" is Fetch now with the
     verdict routed back into setup: no AI, no profile needed, jobs stored
     unscored.
  3. **Tell us about you** — upload a resume (or pick one), the scan runs
     on a progress page and comes back as a one-paragraph summary ("Looks
     like you're a Senior Backend Engineer — main tools PHP, Laravel…");
     "Yes, that's me" applies the draft to the active profile, "Let me
     adjust" opens it in the profile editor. No file handy: three
     questions (technologies, role words, seniority) write the same fields.
  4. **See your first matches** — "Score the best matches" scores the ten
     stored jobs that mention the most of your profile (`runScoreUnscored`
     over the pure ranking in `jobs/score-pick.ts`: a title hit counts
     double a description hit, required stack outranks role words);
     everything that mentions none of your words is set aside without
     spending anything. Result: "8 of 10 look like a match" with the top
     five, "Score 10 more" while jobs are waiting, then "Start the hourly
     watch" (turns fetching on, marks setup done). Ten because a CLI
     engine needs 15-30 s per job — 100 would have meant a 24-minute wait
     on the first screen. Telegram is a quiet link.
- "Skip setup" marks setup done; the Overview shows a "Finish setup →"
  chip while any step is still open, flag or no flag.
- Progress pages carry their own heading and subtitle and can show
  data-driven progress ("12 of 100 jobs scored").

### Changed
- The engine connectivity test moved into `src/web/ai-test.ts`, shared by
  Settings and the wizard; the file-input style is one constant in `ui.tsx`.

### Schema
- `AppSettings.setupCompletedAt` (nullable) — migration
  `20260901220000_add_setup_completed_at` backfills existing deployments
  with `now()`, so nobody who already set up by hand is walked through the
  wizard.

## [1.6.0] — 2026-09-01

### Added
- **"Fetch now"** ([docs/onboarding-plan.md §2 step 2](docs/onboarding-plan.md),
  TASKS §11 block 2): a button in the Overview header and on `/runs` runs
  the hourly fetch tick immediately, in the web process, with a live
  progress page (`/runs/fetch-now/:id`) that narrates the sources as they
  answer and lands back on `/runs` with a one-line verdict ("312 jobs from
  71 sources in 40s — 118 new stored…"). One run at a time; recorded as a
  `fetch-now` row on `/runs`.
- **Unscored ingestion seam**: `processNormalizedJobs` accepts
  `{ classify: false }` and stores what passes the base filter with no fit
  score, no AI call and no alert. "Fetch now" uses it while the pipeline is
  paused — paused still means no AI spend — so a fresh install can prove the
  search works before any profile exists (the wizard's step 2 builds on it).
  Score those rows later with Re-classify; the hourly tick dedupes them and
  never revisits them.

### Changed
- Fetch stats on `/runs` carry `sources` / `sourcesFailed` per tick, and a
  run started while paused shows `classify: false`.
- A posting stored by another run meanwhile (the hourly tick and a manual
  fetch can overlap) now counts as a duplicate instead of failing the whole
  tick.

## [1.5.0] — 2026-09-01

### Changed
- **Settings → Profile now follows the user's journey**
  ([docs/onboarding-plan.md §3](docs/onboarding-plan.md)): contextual
  warnings first, then "Fill from a resume", then the editor; the profile
  management row (switch / Activate / Delete / + New) moved to the bottom
  and the "Other profiles" table is gone — the select is the one
  mechanism. The standalone "Re-classify all jobs" button was removed:
  "Save & re-classify" in the editor footer covers it, and a paid AI
  action no longer greets a fresh install at the top of the page.
- **"Fill from a resume" accepts a direct file upload** when no resumes
  exist yet — no more round trip to `/resumes` and back. The upload
  becomes a normal Resume row (first one becomes the default), is
  scanned, and the profile draft renders as before; nothing is saved
  until "Save profile".
- The three chip fields sit under one "What are we hunting for?" heading
  with a two-line legend (languages/frameworks → required; job-title
  words → role types), each with real example placeholders
  ("php, laravel, mysql…") instead of three identical "Add and press
  Enter…" prompts.
- Priority rules live in their own collapsed sub-section; the
  region-phrase warning shows only when rules exist. The Advanced block
  no longer auto-opens because of a seeded salary or a Telegram target —
  only notes, on-site cities or rules open it.
- The Settings header no longer claims everything saves on click — the
  profile editor saves on submit, and the copy now says so.
- Overview explains a paused pipeline: fresh installs start paused so a
  blank profile doesn't spend AI credit, with a link to fill the profile.
- **Moved to the `applypack` organization** — the repository now lives at
  `applypack/applypack`. Old URLs redirect, so existing clones and forks
  keep working, but the outbound `User-Agent` job boards see, the README
  badges, the `CHANGELOG` compare links and the launch drafts all point at
  the new address. `scripts/archive-traffic.sh` follows via its `REPO`
  default.
- **Database tables are snake_case now** ([ADR 0026](docs/adr/0026-snake-case-table-names.md),
  [#59](https://github.com/applypack/applypack/pull/59),
  [#61](https://github.com/applypack/applypack/pull/61)): all 13 models map
  to snake_case tables (`"Job"` → `job`, `"AppSettings"` → `app_settings`)
  and the autoincrement sequences follow in a second migration; columns and
  enum types keep their names. Both migrations run on the next boot — back
  up an existing deployment first. #61 also fixed the two raw-SQL sites (AI
  usage counters, nightly cleanup) that still named `"AppSettings"`.

## [1.4.1] — 2026-09-01

### Fixed
- **Blank-profile guardrails** ([#50](https://github.com/applypack/applypack/issues/50)).
  A freshly created "New profile" used to activate immediately; with no
  required stack and no role types the base filter's title gate turns off
  and the classifier scores generic job quality — one tick classified 118
  off-stack jobs and alerted 17 of them at scores up to 93. Four
  independent guards now close this, all deciding through the pure
  `src/profile-guards.ts` module:
  - "+ New profile" creates the profile **inactive** and opens it in the
    editor (`/settings?tab=profile&profile=<id>`); the first save that
    gives it a required stack or role types activates it. "Fill from a
    resume" flows into the same rule.
  - The worker skips classification and alerts for the whole tick when
    the active profile is blank (fetching and source health stay alive);
    `/runs` shows `skippedBlankProfile`, and "Re-classify all jobs"
    refuses to run. Banners on `/jobs` and Settings → Profile say
    "classification idle" until the profile is fixed.
  - Code-side floor: a classification made while `stackRequired` is empty
    is clamped to fit ≤ 50, tagged with a `no-profile-stack` red flag,
    and never alerts — whatever the threshold or priority boosts say.
  - Activating a blank profile is refused server-side, and its Activate
    controls are disabled with a hint.

## [1.4.0] — 2026-09-01

### Added
- **Board columns are yours now** ([ADR 0025](docs/adr/0025-custom-work-stages.md)):
  add, rename, reorder and remove the `/applications` work columns from
  Settings → General → "Board columns" (the board's "Edit columns" link
  lands there). Applied and the Closed pair stay fixed — they anchor
  appliedAt, the stale digest and the archive fold. A column holding jobs
  can't be removed (server-enforced), and renames never touch the stored
  key, so stage history stays intact.

### Changed
- The board now fills the window height exactly (the app-frame `fill`
  layout) — columns end at the viewport bottom and scroll inside, instead
  of stopping at a 70% cap with dead space below.

### Removed
- The three funnel stat cards ("Ever reached", "Days per hop", "Does fit
  predict interviews?") and their math. At a handful of applications every
  cell read `— n=0` / `— (0/5)` — noise below the board. The stage ledger
  keeps recording every move (time-in-stage on cards still uses it), so
  the analytics can return from git history once there is enough data to
  mean something.

## [1.3.0] — 2026-09-01

### Added
- **Drag-and-drop on the `/applications` board** (TASKS §10): drag a card
  into a column and the stage changes on drop — optimistic move, then the
  page re-renders from the server with a confirmation flash; on failure
  the card snaps back with an error notice. Dragging over the collapsed
  Closed panel opens it, so a card can be dropped straight onto Rejected
  or Ghosted. Dependency-free ES module (`src/web/public/board.mjs`),
  desktop pointers only — phones and no-JS keep the form path below.
- **Quick-move on every card** (the keyboard / no-JS path): a stage
  select + Move button as a plain form. With drag active it stays out of
  the way — collapsed until the card is hovered or keyboard-focused. The
  new stage-only endpoint writes the `JobStageEvent` ledger row in the
  same transaction and never touches appliedAt / recruiter / notes —
  those still belong to the tracking card on the job page.
- **Time-in-stage on cards**: "in screen 12d" from the ledger (falls back
  to "applied Nd ago" where no real event dates the stage), absolute date
  in the tooltip, and a warn-tone "· stalled" once a non-terminal stage
  sits still past 14 days. Backfilled history never dates a stage — same
  honesty rule as the funnel math.

### Changed
- Board columns cap at 70% of the viewport and scroll internally — with
  a hundred cards in one stage the page stays one screen tall instead of
  ~13,000&nbsp;px, and the funnel stats are visible without a journey.
- Rejected and Ghosted moved off the board into a collapsed **Closed**
  panel below it (with the same cards and quick-move for revivals), so
  the five work columns fit a laptop width.
- On phones the board stacks into one stage-grouped list with count
  chips that jump to each stage.
- Board detail pass: header meta reads "N active · M closed", the Onsite
  column dot no longer shares its colour with Tech, calibration cells
  shorten "— (n=0, need 5)" to "— (0/5)".

## [1.2.0] — 2026-09-01

### Fixed
- **Pausing "Job fetching" now stops an in-flight tick within seconds**
  (#51, #52). The flag used to be read once at tick start, so a running
  tick kept fetching, classifying (AI spend) and sending Telegram alerts
  until it finished. Every long phase — fetchers, discovery harvest, the
  classify/alert loop — now polls the flag through a throttled latching
  probe (`makeLatchingProbe`, one read per 5s) and aborts gracefully,
  recording `paused-mid-run` in the run stats on `/runs`.

### Added
- "Ready to apply" cue on the targeted-resume view: at a match score of
  85+ the card says so explicitly — stop polishing, send it (#48).

### Changed
- The paste-posting-vs-resume flow is named **Compare** in the nav and on
  its start page (was "Target") (#48).
- Match history lists (per job and per resume) are capped to the 50
  newest entries; re-runs no longer grow them without bound (#48).

## [1.1.0] — 2026-09-01

### Added
- **Status-transition ledger** (F5, [ADR 0024](docs/adr/0024-append-only-stage-ledger.md)):
  an append-only `JobStageEvent` row per pipeline-stage change, written in
  the same transaction at both web write sites; the current funnel is
  backfilled (3 rows, real apply dates). Notes-only resubmits write
  nothing; clearing a stage and editing the apply date land as
  `correction` events.
- Funnel, days-per-hop and fit-calibration cards on `/applications`, with
  the honesty rules as code: backfilled dates never enter medians,
  in-flight applications never enter rates, and a rate below n=5 renders
  as "need 5", never a number.
- Verification verdict badge (`legit` / `suspicious` / `fake`) on `/jobs`
  rows and a "Verified" filter pill (#21).
- Launch drafts in `docs/launch/` — Show HN, r/selfhosted and an
  awesome-selfhosted entry, all for manual posting (#44).

### Fixed
- Worker boot marks stale `RUNNING` cron runs as `FAILED — interrupted`,
  so `/runs` stops showing phantom in-flight jobs after a restart (#18).
- `cleanup-job` no longer garbage-collects jobs that have funnel history.
- Site deploys: Workers Builds ran `wrangler` with no config anywhere and
  every build failed with "Missing entry-point" — the repo root now
  carries an assets-only `wrangler.jsonc`, and `site/README.md` documents
  the real setup (a Cloudflare Worker with static assets, not Pages).

## [1.0.0] — 2026-09-01

First stable release: the whole arc — find → verify → tailor → apply →
track — is deployed, documented and demonstrated at
[applypack.dev](https://applypack.dev).

### Added
- Live scoring demo at applypack.dev/demo/ — the vendored `score.mjs` /
  `target.mjs` (byte-parity enforced by `site-vendor.test.ts`) running on the
  synthetic Fernway / Dana Ruiz fixture; edit the resume, watch the
  deterministic score, highlights and missing-keyword chips recompute with
  zero AI calls.
- Landing site for applypack.dev in `site/public` — static, zero-build,
  zero-dependency (Cloudflare Pages: root `site`, empty build command,
  output `public`). Reuses the README copy, the regenerated screenshots
  and the social card as `og:image`.

## [0.11.1] — 2026-08-31

### Changed
- **Renamed to ApplyPack.** The project outgrew "job hunter": it scores and
  tailors resumes, drafts cover letters and tracks applications, not just
  finds postings. The repository moved to `nazboyko/applypack` and old URLs
  redirect. The Postgres role, database and volume keep their `jobhunter`
  names, so an existing deployment needs no migration — but if you rename
  your local checkout directory, copy the Docker volume first: Compose
  derives the project name from the folder.
- Corrected a stale count in the README: 22 source types, not 16.
- README screenshots regenerated under the new brand; the hero shows a
  synthetic Fernway / Dana Ruiz comparison (82/100), no real personal data.
- The default `User-Agent` now derives its version from `package.json`
  (guard-tested) — it had sat on `0.1` for ten releases.
- The "What you get" table gained the cover-letter row (F8 shipped in 0.10.0
  but never made the README).

### Added
- `SECURITY.md` (private vulnerability reporting, scope, supported versions)
  and `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1); CONTRIBUTING now
  states the MIT in-bound license.

## [0.11.0] — 2026-08-31

### Added
- **Apply-link flags (ADR 0023).** Postings whose apply link cannot be applied
  through are tagged at ingest: `apply-url-missing` (a fetched row with no
  URL), `apply-url-unusable` (unparseable, or a scheme a browser cannot open a
  posting with), `apply-url-shortened` (a destination-hiding redirector) and
  `apply-url-not-an-application` (a host that cannot serve one — a YouTube
  video, a LinkedIn company page, a Telegram handle). The tags join the
  classifier's own in `Job.redFlags`, so they appear on `/jobs/:id` and in the
  Telegram alert with no new UI and no schema change.
- `backfill-apply-link-flags` annotates already-stored rows without spending
  an AI call. Additive and idempotent; `--dry-run` reads only.

### Changed
- The plan's trust *score* was dropped after measuring its four penalties on
  all 814 stored jobs. Three would have been wrong: the `http://` penalty
  marks 22.7% of the corpus and every one of those rows is Block's own
  Greenhouse-served careers domain, which redirects to https; the missing-URL
  penalty only ever hits jobs pasted by hand; and the company↔apply-domain
  mismatch produces either nothing, 26 rows that are false by construction, or
  302 (37%) depending on a string-matching detail — with a non-Latin-name
  exemption that protects zero rows. ADR 0023 records the measurements.

## [0.10.0] — 2026-08-31

### Security
- **The dashboard no longer binds to every network by default.** `WEB_HOST`
  defaulted to `0.0.0.0` in both the config schema and `.env.example`, whose
  comment justified it with a Docker-only argument. Following the README's
  "Running without Docker" steps put an unauthenticated dashboard — jobs,
  resume text, cover letters, settings, the Telegram token form — on every
  network the machine joined. It listens on loopback now; `docker-compose`
  sets `0.0.0.0` for the container, whose published port was already
  loopback-only, so Docker installs are unchanged.

### Fixed
- **A fresh install starts without an AI credential.** `cp .env.example .env`
  followed by any command died on `ANTHROPIC_API_KEY: required`, including
  the dashboard — the one place that key is configured. The engine chain
  already resolves at runtime (ADR 0013/0014) and Settings → AI engine
  already reports the missing key, so the boot-time check only got in the way.
- README's local section now says what it actually takes: `DATABASE_URL` is
  the only value you must set, and both commands run from the repository root.

## [0.9.0] — 2026-08-31

### Added
- **Untrusted-content fences (ADR 0022).** Job descriptions, resumes and
  pasted pages are wrapped in an explicit fence before any model sees them,
  with one shared directive stating the text inside is data, never
  instructions. Covers the classifier — which every fetched job passes
  through and which had no protection at all — plus the resume, match,
  cover-letter, verification and paste-extraction prompts.
- An injection attempt is recorded as a `prompt-injection-attempt` red flag
  on the job instead of being silently ignored.
- Verification, the only path with web search, refuses to fetch a URL the
  posting nominates or to treat such a page as corroboration.
- A CI guard derives its roster from the code itself, so a prompt builder or
  an AI call site added later cannot skip the fence.

### Fixed
- Posting text starting with a dash could be read as a command-line flag by
  the local Claude CLI; the liveness checker now re-verifies a URL after
  redirects.

## [0.8.0] — 2026-08-31

### Added
- **Cover letters (ADR 0021).** A card on every job page drafts a short
  letter from your resume, confirmed facts and the posting, with tone,
  remembered angle fields, in-place editing that autosaves, Regenerate and
  PDF / DOCX export.
- **A Cover letter page** (`/letter`): pick a job from a searchable list, or
  bring a new posting by URL or pasted text.
- **Fact gate (F7, ADR 0020).** Every generated letter is checked
  deterministically against your resume and confirmed facts; an invented
  number, employer, title or denied tool triggers one regeneration and a
  second failure discards the letter. Your own edits are flagged, never
  blocked.
- Per-engine "Cover letter model" on Settings → AI engine; all model pickers
  save on change.

## [0.7.0] — 2026-08-31

### Added
- **Source health monitoring (ADR 0019).** Every fetch records a per-source
  status; a "Quiet sources" card on `/companies` lists boards failing three
  ticks in a row or silent for 14 days, each with one-click Re-probe.
- Health read from each board's raw output rather than from stored jobs, so
  a strict profile filter never looks like a broken board.
- Optional Telegram digest line naming sources that went quiet.

## [0.6.0] — 2026-08-31

### Added
- **Cross-source dedup (ADR 0018).** The same job arriving from two sources
  is spotted by a SimHash fingerprint and flagged in both directions, on the
  job page and in the Telegram alert. Nothing is merged or hidden.
- `backfill-fingerprints.js` for existing jobs.

### Fixed
- Feed rows that nothing identifies are skipped instead of sharing one
  synthesised id; tracking parameters (`utm_*`, `gh_src`, `fbclid`) no longer
  change a job's id, while functional ones like `gh_jid` are kept.

## [0.5.0] — 2026-08-31

### Added
- **Company starter packs (ADR 0017).** 86 companies across 5 curated
  segments, every board re-probed live before anything is written. Preview
  before insert; companies land disabled with an "Enable all" button.

### Fixed
- ATS probe failures say what actually happened — rate limiting and vendor
  outages no longer report "token likely invalid".

## [0.4.0] — 2026-08-31

### Added
- Six new sources: Recruitee, Breezy, BambooHR, Pinpoint, Rippling and
  4 Day Week. JustJoin, NoFluffJobs and NoDesk were rejected on robots
  grounds (ADR 0005 addendum).

## [0.3.0] — 2026-08-31

### Added
- **Liveness ladder (ADR 0016).** Free ATS-API and page checks run before
  the AI verification, so dead Greenhouse / Lever / Ashby postings resolve
  as expired at no cost. Liveness chip on the job page.

## [0.2.1] — 2026-08-30

### Fixed
- **Job descriptions are readable again.** `stripHtml` used to strip tags
  before decoding entities, so feeds that ship the body HTML-escaped
  (Greenhouse — 82 % of stored jobs) kept raw `<div>…` markup as visible
  text, and the final `\s+` collapse flattened every description into a
  single-line wall. Entities now decode first (`&amp;` last, so
  double-escaped input stays literal), line structure is rebuilt from block
  tags, `<br>` and `<li>` (→ `• ` bullets), and prose like `salary > 100k`
  or `<3` survives stripping. Covered by new unit tests.
- **Stored rows repaired.** Two one-shot scripts (both support `--dry-run`):
  `backfill-descriptions` re-cleans rows that still carry markup and decodes
  entities in pasted jobs; `refetch-descriptions` re-pulls the boards and
  updated 601 stored descriptions in place. stripHtml is deliberately NOT
  re-run on clean plaintext — it is not idempotent (CLAUDE.md gotcha 12).
- Manual pastes decode literal entities (`&nbsp;`, `&amp;`) before saving.

### Changed
- **Full-width dashboard.** Every page now stretches to the screen like the
  Jobs table: the prose-width caps (`max-w-prose`, `75ch`) and per-page
  column limits are gone, so the job description, classifier summary, hints,
  Settings, the paste form and the Target editor all fill their containers.
  The /companies explainer reflows into two columns; the description card
  renders decoded paragraphs via `whitespace-pre-line`.

## [0.2.0] — 2026-08-30

### Added
- **AI engine chain (ADR 0013/0014).** Five interchangeable backends behind
  one seam — Anthropic API, Claude Code CLI, Gemini CLI, Codex CLI, and any
  OpenAI-compatible `/chat/completions` endpoint (OpenAI, OpenRouter, Groq,
  local LM Studio/Ollama via `OPENAI_BASE_URL`). Enable the ones you own on
  `/settings` → AI engine, order them with ↑ Priority, and every call is
  served by engine #1 with automatic per-call failover to the next on
  errors, rate limits or exhausted quota — control returns as soon as the
  primary recovers. Per-engine classifier/resume model slots use
  family-locked dropdowns (a wrong-family id cannot be saved); each card has
  an availability probe (binary + auth detection) and a live **Test** button
  that runs one real call and reports the response time.
- **Engine-chain hardening.** CLI child processes get an env allowlist —
  only their own auth variables, so a stray `ANTHROPIC_API_KEY` can no
  longer silently switch the Claude subscription engine to API billing, and
  no AI process ever sees the database URL or Telegram token. Failing
  engines go into a short cooldown (3 consecutive misses → 60 s skip)
  instead of stalling bulk runs, and one logical call is capped at three
  engines inside a hard deadline.
- **Honest cost surface.** Metered engines carry a "pay per token" badge and
  a warning when enabled behind subscription engines; reports produced by a
  fallback engine are marked `· fallback`; a "Last 7 days" line counts runs
  per engine (stored in `AppSettings.aiUsage`, trimmed to 60 days by the
  cleanup cron).
- **Settings tabs.** `/settings` is now five link-based tabs — General ·
  Profile · AI engine · Notifications · Sources — and every save returns to
  the tab it came from.
- **Fill profile from a resume (ADR 0015).** One click maps a scanned
  resume onto the profile fields (stack, role types, seniority) and shows a
  reviewable draft — nothing is saved until you confirm. Resume scans now
  extract primary skills to power it.
- **Cross-engine bench.** `npm run bench:resume -- --engine <id>|all` runs
  the gold fixtures through any usable engine; `--list-engines` shows who is
  ready without spending a call.
- **Setup guide.** `docs/ai-engines.md` — step-by-step setup for every
  engine, local and Docker, plus a pipeline pause/resume control on the
  Overview page.

### Changed
- Settings & discovery refactor: human source names (LARAJOBS_RSS → "Laravel
  Jobs"), a `warn` flash variant for pausing states, confirm on
  "Save & re-classify", discovery/HN toggles moved to `/discovery`, the
  resumes card deduplicated to a list + link, bot tokens masked to the last
  4 characters, and a jargon-free copy pass.
- First boot is stack-neutral: a blank starter profile, `TZ` defaults to
  UTC, no salary floor, and fetching starts paused until the profile is
  filled.
- README rewritten around the actual first-run path (engines → profile →
  resume → alerts).

### Fixed
- Saving job sources no longer re-adds the internal MANUAL type to the
  disabled list on every save.
- Personal data removed from test fixtures and UI copy.

## [0.1.1] — 2026-08-29

### Added
- **Deterministic match score (ADR 0012).** The model now returns facts only
  — per-keyword status, `must/preferred/nice/context` requirement levels,
  primary-stack flags, three alignment grades — and `src/resume/score.ts`
  computes the number (60 keywords + 40 alignment − 10/red-flag, primary cap
  last). The stored breakdown renders as "why this score" chips, and the live
  editor re-runs the *same formula* on every keystroke (`score.mjs`, parity-
  tested), so the two numbers finally share one scale.
- **"Confirm your experience" (ask_user).** A fourth keyword status for
  plausible-but-unevidenced skills: the comparison asks, your yes/no (plus
  optional where/when context) is stored as a `CandidateFact`, the score
  recomputes instantly with no AI call, and every future comparison reuses
  the answer. Denied terms are never asked again. Facts are managed on
  `/resumes`.
- **Cross-resume evidence.** A term this resume can't claim but another
  stored resume evidences gets an `in "<resume>"` badge — "you have it, but
  this resume hides it" — and the model may mark it addable, naming the source.
- **Hard-requirements panel.** Work authorization, on-site, minimum years and
  other gates now render as pass / unknown / fail outside the score; silence
  is "unknown — confirm", never a fail.
- **What the ATS sees.** `/resumes/:id` runs deterministic parse checks over
  the extracted text (unreadable characters, missing email/phone, glued
  words, scanned-file suspicion, length) above the raw-text view.
- **Explained version deltas.** "vs v4" now lists which keywords were gained
  or lost and how each score component moved, computed from stored
  breakdowns (`src/resume/diff.ts`) — not narrated by the model.
- **Prompt-injection guard + live bench.** Both resume prompts treat resume
  and posting text as untrusted data, and `npm run bench:resume` smoke-tests
  the prompt against gold fixtures (stack mismatch, stack match, injection)
  through the real provider.
- **PDF resume uploads.** `.pdf` joins `.docx` / `.md` / `.txt`, extracted via
  unpdf (ADR 0011) with clear errors for password-protected and scanned /
  outlined files; upload limit raised from 2 to 5 MB.
- **Target page (`/target`).** Paste a posting and pick, upload or paste a
  resume — one run detects, classifies and scores, then opens the side-by-side
  targeted view. The description alone is enough: empty company / title /
  location / salary are extracted inside the run as a visible "Detect posting
  facts" step that never blocks (unfound facts fall back to visible defaults,
  the run header renames live), detected salary lands on the job, and a
  Ctrl+A paste gets its page chrome trimmed in the textarea while the
  job-header block (title · company · salary) survives. Uploaded / pasted
  resumes land on one hidden scratch row (`Resume.hidden`, migration) —
  /target is a pure comparison, nothing accumulates in Resumes.
- **Live progress pages.** Long runs (/target, Compare, Re-analyze,
  Re-upload) show polled step-by-step progress — no meta-refresh — with a
  violet activity line that walks the real analysis checklist, a ticking
  elapsed counter and auto-redirect into the result.

### Changed
- **Resume-match workspace decluttered** (two external UX audits, verified
  against the code; adopted plan in docs/TASKS.md §6). Everything needed for
  a decision sits above the tabs: one primary score with a quality word, the
  hard-requirement digest, confirm-your-experience questions, suggestion
  counts. The live estimate appears only while the text is edited (with a
  ±N-vs-AI delta, mirrored in a sticky unsaved-changes bar), the Suggestions
  tab pairs the advice column with a sticky editor — clicking a suggestion
  selects its exact text in place — keyword tables list needs-attention rows
  first with matched behind a disclosure, one status vocabulary everywhere
  (matched / missing / confirm / no evidence), run chips cap at two plus an
  "older runs" disclosure, Re-upload is the one visible action (the rest in
  a light-dismiss ⋯ menu), and the page belongs to Jobs (breadcrumb, active
  nav, 1536px content cap).
- Match replies are capped tighter for speed (~25 keywords, ~10 actions, ~8
  removals, 12-word notes) — less output ≈ faster analysis. Suggested
  experience bullets follow explicit **bullet rules** (prompt v4): verb-first,
  ≤28 words, the posting's own vocabulary, each bullet aimed at a named
  requirement, business outcome stated; metrics may never be invented and
  placeholders like "[add your real number]" are banned from the wording —
  a missing figure becomes "ask the candidate for the real number" in "why".

### Fixed
- **The 65-point treadmill (scoring v3).** A fully tailored resume (keywords
  57.9/60, alignment 40/40, primary 3/3) was stuck at 65-68 because the model
  kept inventing three soft "red flags" (−30) — style and domain nitpicks that
  rotated every run — and the keyword set itself drifted between analyses.
  Now: red flags are application-blockers only (each −10, bounded at −20,
  flags restating missing primaries are free — the cap already owns those);
  soft concerns land in a new unscored **cautions** list; a "primary" mark on
  a merely-preferred technology no longer caps the score; re-analyses of the
  same posting receive the previous keyword frame so terms stay comparable
  across resume versions; and every breakdown now carries a **ceiling** — the
  honest maximum this resume can reach on this posting — shown in the UI
  ("max reachable 92" / "at its ceiling"). The same tailored resume now
  scores its actual work (78+ on the recorded real case, 90+ once the ask is
  confirmed and flags are clean).
- Keywords are now verifiable end-to-end: every extracted term must be a
  verbatim 1-4-word phrase from the posting (so it always highlights in the
  description pane), aliases must cover the resume's own spellings, and the
  live counter names the missing terms ("… · missing: Azure, troubleshoot,
  health") instead of a bare count.
- The targeted view leads with the honest number: the big ring is now the
  **AI match** with the rubric's stack verdict beside it; live keyword
  coverage is secondary, counts "can't claim" keywords by default, and the
  AI score is marked "edited — Re-analyze to refresh" once you type.
- Removal suggestions got two hard rules: the contact line (email, phone,
  links) is untouchable — only a street-level address may be trimmed — and a
  removal may never quote text containing a keyword the posting wants; mixed
  skills lines get itemised "drop X, keep Y" advice instead.
- Resume-match scoring got a **primary-stack gate**: the posting's core
  languages/frameworks cap the score (none present → ≤30), sibling tech never
  counts (Vue ≠ React, PHP ≠ Node.js), and the summary must open with the
  stack verdict. Before: Laravel/Vue vs a Node/React posting scored 82/100;
  after: 10/100 (and 92/100 against a Laravel posting).
## [0.1.0] — 2026-08-28

First tagged release. Everything below was designed and built between
2026-04-26 and 2026-08-28 by a single author (AI-assisted; every non-obvious
decision is recorded in [docs/adr/](./docs/adr/)). The phase labels match the
commit history.

### Dashboard
- Light-theme redesign of every page: shared layout, design tokens, tables,
  forms, empty states, mobile job header.
- Overview with status counters, recent alerts and cron health.
- Jobs list (filter / sort / paginate), job detail with Claude output,
  status actions and re-classify.
- `/jobs/new` — paste a posting the fetchers cannot see; it is classified like
  any other.
- Applications kanban (applied → screen → tech → onsite → offer / rejected /
  ghosted) with a stale-applications digest.
- Companies page with manual add and a live ATS probe before save; per-row
  toggle and delete.
- Discovery review page for companies harvested from HN comments.
- Runs log, settings (profiles, toggles, Telegram targets, source families),
  `/health` JSON endpoint, optional HTTP Basic Auth.

### Resume module
- Upload `.docx` / `.md` / `.txt`; pure zip + docx text extraction with tests.
- One-time AI scan per version: headline, seniority, skill tags, ATS issues.
- Resume-vs-job comparison with a fixed rubric: match score, red flags,
  prioritised to-do list, keyword coverage (`present` / `add` / `can't claim`),
  removals; version-over-version delta.
- Targeted view: posting and resume side by side, keyword highlights, in-place
  editing with a live keyword-coverage score computed in the browser, AI
  re-analysis, save as new version (ADR 0010).

### Job verification
- "Is this job real?" — ghost-job checklist run with web search through the
  AI seam; verdict `legit` / `suspicious` / `fake`, recommendation, confidence
  and evidence URLs (ADR 0009).

### Classifier and AI backend
- Profile-driven Claude classifier with explicit tech-stack vs role-type and
  country-lock rules.
- Optional two-stage mode: short cached prefilter prompt, full prompt only for
  survivors.
- Priority rules: post-classification fit-score floor per profile.
- Single AI provider seam (`src/ai-provider.ts`): Anthropic Messages API or
  Claude Code CLI on a subscription (ADR 0007).
- Concurrency limiter (`AI_CONCURRENCY`) for fetch ticks and re-classify.
- Configurable models per task (`CLAUDE_MODEL`, `CLAUDE_MODEL_RESUME`).

### Sources
- Per-company: Greenhouse, Lever, Ashby, Workable, SmartRecruiters.
- Cross-company: LaraJobs, RemoteOK, Remotive, Jobicy, Arbeitnow,
  WeWorkRemotely, Golangprojects, Working Nomads, Himalayas, HN
  "Who is hiring", HN /jobs.
- Universal ATS-URL discovery from HN text; candidates reviewed on
  `/discovery` and promoted with one click.
- Per-source-family toggles and a global "pause fetching" switch
  (deployments start paused).
- Policy: official public APIs and RSS only; no LinkedIn / Indeed / Glassdoor /
  Workday / Wellfound (ADR 0005).

### Worker and infrastructure
- Separate cron worker and dashboard processes sharing Postgres (ADR 0002);
  node-cron, no queue (ADR 0003).
- Prisma migrations baseline; `init.ts` applies migrations and seeds on boot.
- Multi-stage Dockerfile on `node:24-alpine`, docker-compose with Postgres 16.
- Telegram alerts and daily digest; targets managed from the dashboard.
- GitHub Actions CI: type check, unit tests, `prisma validate`, format check.
- Documentation set: SPEC, ARCHITECTURE (Mermaid), CLAUDE.md conventions and
  gotchas, ten ADRs.

### Milestones

| Date | Milestone |
| --- | --- |
| 2026-04-26 | Initial worker + dashboard, CI, migrations baseline |
| 2026-04-27 | Two-stage classifier, HN parser, application tracking, discovery, priority rules, docs set, ADR 0001–0006 |
| 2026-04-28 | Fetcher fixes (LaraJobs namespace, Lever re-seed) |
| 2026-04-29 | Pure fetcher mappers + tests, Jobicy, HN /jobs, universal ATS discovery |
| 2026-08-27 | Node 24, pause toggle, AI provider seam, first dashboard redesign, parallel classifier |
| 2026-08-28 | Resume module, targeted view, ghost-job verification, light-theme redesign — **v0.1.0** |
| 2026-08-29 | PDF uploads, /target auto-detect flow, deterministic score, match-workspace UX refactor — **v0.1.1** |
| 2026-08-30 | AI engine chain, settings tabs, profile fill — **v0.2.0**; readable descriptions + full-width dashboard — **v0.2.1** |
| 2026-08-31 | Liveness ladder — **v0.3.0**; fetchers wave 1 — **v0.4.0**; starter packs — **v0.5.0**; cross-source dedup — **v0.6.0**; source health — **v0.7.0**; cover letters + fact gate — **v0.8.0**; untrusted-content fences — **v0.9.0**; safe local defaults — **v0.10.0** |

[1.14.0]: https://github.com/applypack/applypack/compare/v1.13.0...v1.14.0
[1.13.0]: https://github.com/applypack/applypack/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/applypack/applypack/compare/v1.11.0...v1.12.0
[1.11.0]: https://github.com/applypack/applypack/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/applypack/applypack/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/applypack/applypack/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/applypack/applypack/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/applypack/applypack/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/applypack/applypack/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/applypack/applypack/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/applypack/applypack/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/applypack/applypack/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/applypack/applypack/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/applypack/applypack/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/applypack/applypack/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/applypack/applypack/compare/v0.11.1...v1.0.0
[0.11.1]: https://github.com/applypack/applypack/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/applypack/applypack/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/applypack/applypack/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/applypack/applypack/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/applypack/applypack/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/applypack/applypack/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/applypack/applypack/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/applypack/applypack/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/applypack/applypack/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/applypack/applypack/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/applypack/applypack/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/applypack/applypack/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/applypack/applypack/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/applypack/applypack/releases/tag/v0.1.0
