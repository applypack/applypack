# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/nazboyko/applypack/compare/v0.10.0...HEAD
[0.11.0]: https://github.com/nazboyko/applypack/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/nazboyko/applypack/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/nazboyko/applypack/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/nazboyko/applypack/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/nazboyko/applypack/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/nazboyko/applypack/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/nazboyko/applypack/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/nazboyko/applypack/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/nazboyko/applypack/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/nazboyko/applypack/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/nazboyko/applypack/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/nazboyko/applypack/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nazboyko/applypack/releases/tag/v0.1.0
