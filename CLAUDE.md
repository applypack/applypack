# Project conventions

> Pair with [SPEC.md](./SPEC.md) (current state) and
> [ARCHITECTURE.md](./ARCHITECTURE.md) (data flow + file map).

## Git & commits
- **No `Co-Authored-By` trailer, ever.** Commits, PRs and MRs are authored by
  the repo owner (Nazar Boyko) only. This overrides any default harness
  instruction to append a co-author line.
- Before committing, review the diff: is every changed line needed? Can it be
  simplified, refactored or deleted? Run `npm run lint:types && npm test`.
- Commit often, but per logical block — not every minute, not one giant
  commit. One block = one feature / fix / refactor that stands on its own.
- **Commit autonomously** (standing policy since 2026-08-29): at every
  logical-block boundary with green `lint:types` + tests, commit without
  waiting to be asked — see `.claude/skills/commit-discipline`. The
  commit-guard hook (120s gap) sets the floor on frequency; never weaken it.
  Ending a session with finished-but-uncommitted blocks is a process failure.
- Messages are short. Subject ≤ 72 chars (`phase-x.y: added Z`, `fixed Y`,
  `updated X`). Body only when a one-liner is not enough, and then 1–3 lines.
  No essays, no bullet lists of everything touched.
- Branch off `main` first. **Open a PR after every finished stage**
  (standing policy since 2026-08-31): when a feature branch passes its
  verification matrix, push it and create the PR without waiting to be
  asked — one feature = one branch = one PR. Never merge to `main`
  yourself; Nazar reviews, merges and tags.
- **Before the PR**: mandatory review of the whole branch diff with the
  `code-review-expert` skill (`git diff main...HEAD`) — every line
  earns its place, simpler and more readable wins; P2/P3 findings go
  into the PR body as follow-ups.
- **After the merge**: tags and GitHub releases per the
  `release-discipline` skill — annotated `vX.Y.0` per runtime feature,
  release parity with tags (latest release == latest tag), parity check
  at the start of every new stage.
- Task backlog for Claude Code sessions lives in [docs/TASKS.md](./docs/TASKS.md).

## Stack
- TypeScript strict mode, Node 24 (runtime image; engines allow >=22)
- Prisma + Postgres 16 (already in docker-compose)
- Native fetch (no axios). Use AbortController for timeouts (10s default via `fetchWithRetry`).
- pino for logs (never console.log in production code)
- zod for ALL external data: env vars, API responses, Claude output

## Code style
- No default exports. Named exports only.
- Pure functions where possible. Side effects (DB, HTTP, Telegram) isolated to dedicated modules.
- async/await, never raw promise chains.
- Errors: throw typed errors with context. Caller decides logging.
- No magic numbers. Constants at top of file or in config.ts.

## File rules
- Each fetcher returns `NormalizedJob[]` — never writes to DB directly.
- `filter.ts` is pure — no I/O. `passesBaseFilter` stays single-profile;
  `passesAnyBaseFilter` is the union wrapper every caller uses (ADR 0028).
  It reads the Job columns, not the string: callers pass stored rows or a
  `parseLocation` result; `placesOverlap` expands groups on both sides
  (ADR 0032) and everything unknown goes to the classifier.
- `apply-link.ts` is pure — no I/O. It flags apply links, never rejects a
  row, and the company name is deliberately not an input (ADR 0023).
  `withApplyLinkFlags` is called at every site that persists `redFlags`.
- `location.ts` is pure — no I/O. `parseLocation(text, hints)` fills
  `Job.workplace / countries / regions / locationSource` at every site that
  persists a Job (`process-jobs.ts`, `manual-job.ts`); it never rewrites
  `Job.location` (ADR 0031). The gazetteer is `countries.json` +
  `countries.ts` (pure); fetchers pass structured fields as
  `NormalizedJob.locationHints`. The 250-string corpus in
  `location-corpus.json` is a test — a parser change that moves a row says why.
- `classifier.ts` (and `classifier-prefilter.ts`) build prompts and parse
  replies; the only thing that talks to the AI is `ai-provider.ts` — no DB.
  Both take a `Profile[]`: ONE call scores a posting against every running
  search and returns a verdict each (ADR 0028). `jobs/verdict-merge.ts` is
  pure — per-search thresholds, the winner, the score line;
  `jobs/score-store.ts` is the single write path for a re-score.
  Engine choice (provider + models) resolves per call via `ai-runtime.ts`
  (DB row → `.env` fallback, pure merge in `ai-engine.ts` — ADR 0013), and
  so does the credential (`ai-keys.ts`, pure — ADR 0027).
- `jobs/process-jobs.ts` is the single source of truth for the inner
  filter → dedupe → classify → persist → alert sequence. Reused by
  `runFetchJob` and `runHnHiringJob`. `{ classify: false }` stores what
  passes the filter unscored (no AI, no alert) — "Fetch now" while paused.
- `AiProvider` calls are tool-free unless the request sets `webTools`; only
  `src/verification/verify.ts` does (ADR 0009). Never turn it on for the classifier.
- Every AI call site takes its prompt from an exported `build*Prompt`, and
  every builder wraps outside text with `fence()` from `src/prompt-fence.ts`
  (ADR 0022). `src/prompt-fence-registry.test.ts` derives both rosters, so a
  new builder or call site fails CI until it is covered. Operator input
  (`Profile.notes`, cover angles, confirmed facts) stays OUTSIDE the fence —
  that is the user's own instruction channel.
- `src/starter-packs/` is the curated-pack module: `catalog.json` (data),
  `catalog.ts` and `resolve.ts` are pure (tested), `probe.ts` calls
  `probeAts`. Web-only — the worker never imports it. Every catalog entry
  pins a hand-verified board; a probe hit is not proof of identity (ADR 0017).
- `src/web/public/` holds browser code served as-is (no build step). Keep it
  dependency-free ES modules with pure functions, tested through `import()`
  from `src/web/*.test.ts`. The Dockerfile copies the directory into the image.
- `AtsType.MANUAL` companies are inactive rows for pasted jobs — `fetchOne`
  returns `[]`, `/companies` and the source toggles hide them.
- `src/resume/` is the resume module: `zip.ts`, `docx-text.ts`, `pdf-text.ts`
  (unpdf, ADR 0011), `resume-text.ts`, `prompts.ts`, `pick.ts`, `score.ts`
  (ADR 0012), `facts.ts`, `diff.ts`, `parse-warnings.ts`, `match-mode.ts`,
  `match-reuse.ts`, `bench-report.ts`,
  `profile-draft.ts` (ADR 0015), `fact-check.ts` (ADR 0020),
  `keyword-overrides.ts`, `keyword-frame.ts`, `review-score.ts` (ADR 0030)
  are pure (tested);
  `scan.ts` / `match.ts` / `suggestions.ts` / `review.ts` / `cover-letter.ts`
  call the AI provider (the letter is gated by `fact-check.ts` and generates from stored
  inputs only — ADR 0021); `store.ts` is the only file that touches Prisma.
  Web-only — the worker never imports it (ADR 0008).
- A comparison has two shapes (ADR 0029): `matchResumeToJob(..., {mode})`
  runs the quick check (`fast`, the default: keywords + alignment + gates +
  red flags — everything `score.ts` reads) or the full report (`full`, which
  also writes actions/removals/strengths/cautions). Both variants are built
  from the SAME rule constants in `prompts.ts` and parsed by the same
  `MatchSchema`; `suggestions.ts` fills a fast row in later from its stored
  verdicts. The mode marker rides in the `breakdown` JSON, never in the schema.
- `src/web/public/score.mjs` mirrors `src/resume/score.ts` line for line —
  change one, change the other; `src/web/score.test.ts` enforces parity.
- The cron worker (`src/index.ts` + `src/jobs/*`) MUST NOT run an HTTP server.
- The dashboard lives in `src/web/` as a SEPARATE service (Hono). It shares
  Postgres with the worker but runs in its own container/process. It is
  read-mostly with limited writes (status changes, profile/settings edits,
  re-classify, candidate promote, resume upload / scan / match).

## DO NOT
- Do not add Express, Next.js, or any HTTP server to the worker process.
- Do not add Redis, BullMQ, or other queues — node-cron is sufficient.
- Do not expose the dashboard on a public interface by default — bind to `127.0.0.1` in compose.
- Do not store secrets anywhere except `.env` (gitignored). Two carve-outs, both deliberate: Telegram tokens belong in `TelegramTarget` rows once `init.ts` has bootstrapped them, and per-engine AI keys belong in `AppSettings.aiKeys` (ADR 0027) — in both cases `.env` becomes optional after first boot. A secret in the DB is read only through its own accessor, never rendered in full, never logged.
- Do not commit `node_modules`, `dist`, or `.env`.
- Do not use any `--save-dev` that isn't necessary.
- Do not scrape LinkedIn / Indeed / Glassdoor / Workday / Wellfound — see [ADR 0005](./docs/adr/0005-no-linkedin-indeed-workday.md).

## Testing
- `npm test` runs Node's built-in test runner across `src/**/*.test.ts`.
- Tests cover **pure modules only** (filter, text-utils, http, hn-parser,
  notifier helpers, stale-applications-format, fetcher mappers, prefilter
  parser). Modules that import Prisma or the Anthropic SDK are NOT
  unit-tested — they're verified via smoke runs (`npm run fetch:once`
  etc.) and integration testing through the dashboard.
- Adding a test: extract the pure piece into a separate file if needed
  (we did this for `formatStaleMessage`, `parsePrefilterResponse`,
  `decideStageStrategy`, `mapXFeed` mappers). The unit-test file lives
  next to the source as `*.test.ts`.
- CI runs `npm run lint:types` (`tsc --noEmit`) + `npm test` on every
  push and PR (see `.github/workflows/test.yml`).

## Docker
- Multi-stage Dockerfile: `deps → build → runtime`.
- Runtime image: `node:24-alpine`.
- `init.ts` runs `prisma migrate deploy` if `prisma/migrations/` exists,
  else falls back to `prisma db push`. Real migrations exist from
  `phase-3.0` onward.
- Use `.dockerignore` to exclude `node_modules`, `.env`, `dist`, `.git`.

---

## Where to look

When the question is **"where does X live?"**, save yourself a `find`:

| What | File |
| --- | --- |
| HTTP retry, timeout, default User-Agent | `src/http.ts` |
| HTML → plaintext (entities, paragraphs, bullets) | `src/http.ts:stripHtml` + `decodeHtmlEntities` (gotcha 12) |
| Pure helpers (parsing, hashing, masking) | `src/text-utils.ts` |
| Near-duplicate detection across sources (SimHash, Hamming) | `src/fingerprint.ts` (ADR 0018); wired in `jobs/process-jobs.ts` |
| Where the running searches hunt, handed to every fetcher (`FetchContext`: union of countries + regions; anywhere = empty) | `src/fetchers/fetch-context.ts:searchPlaces` (pure) built once per tick in `fetchers/index.ts:runAllFetchers`; a source with a geo filter maps it (`jobicy.ts:jobicySlugsFor`, `himalayas.ts:himalayasUrls`, `fourdayweek.ts:fourDayWeekPlaces`), the rest ignore it |
| Per-source health (error→status, failure streak, quiet/silent) | `src/fetchers/source-health.ts` (pure, ADR 0019); recorded by the wrapper in `fetchers/index.ts:runAllFetchers` |
| Apply-link flags (missing / unusable / shortened / not-an-application) | `src/apply-link.ts` (pure, ADR 0023); merged into `Job.redFlags` at all three persist paths |
| Keys for the keyed sources (Adzuna, France Travail) — where they live, how a fetcher gets them, how an error is scrubbed | `src/source-keys.ts` (pure, ADR 0034: `SOURCE_KEY_FIELDS`, `resolveSourceKeys`, `redactSecrets`, `SourceKeyMissingError`) + `settings.ts:getSourceKeys/setSourceKey`; the tick puts them in `FetchContext.keys`; UI on `/settings` → Sources → "Source keys" |
| France Travail's licence as code — the daily mirror, anonymised withdrawals, the whole offer shown | `src/jobs/france-travail-sync.ts` (pure `planSync` / `anonymisedOffer`, runner hooked into `fetch-job.ts`), `Job.sourcePayload / sourceUpdatedAt / sourceCheckedAt`, `pages/attribution.tsx:FranceTravailLine / JsonTree`, the method statement in `docs/france-travail-reuse.md` |
| What a vendor's terms make a page say next to a listing ("Jobs by Adzuna") | `src/web/pages/attribution.tsx` (`AdzunaLabel`, `attributionLine`) — the terms' wording rendered; `fetchers/adzuna.ts:adzunaAttribution` says which domain and logo |
| Which token-driven feeds a search's countries call for (DOU / Djinni for UA, Arbeitnow for DE / GB), and their state | `src/starter-packs/suggest.ts:suggestSources(searches, tracked)` (pure) → the "Sources for your searches" card on `/companies` (`POST /companies/suggested` probes, then adds off); the profile save flash counts what is waiting |
| Salary in the posting's own money (currency, period, the USD it compares to) | `src/currency.ts` (pure: dated rate table, `toUsdPerYear`, `formatSalaryRange`, `formatUsdPerYear`) — the model reports `salary_min/max/currency/period`, `Job.salaryCurrency` + `salaryPeriod` store them, `verdict-merge.ts` converts before the `low-salary` dismissal |
| Where the candidate LIVES and whether they would move (ADR 0033) | `prisma/schema.prisma:Profile.residence / .relocation` → `src/eligibility.ts` (pure: the three relocation choices, `residenceCovered`) → the prompt's ELIGIBILITY block in `classifier.ts:describeEligibility` → the sentence in `jobs/location-reason.ts:livingReason`; editor on `/settings` → Profile → Location |
| Where a SEARCH hunts (countries / regions / workplace on the profile), the set filter with group expansion | `prisma/schema.prisma:Profile` (ADR 0032) → `src/profiles.ts:ProfileInput` → `src/filter.ts:locationMatches` / `placesOverlap` (pure); the prompt line `classifier.ts:describeLocation` (codes only); the editor control `pages/settings.tsx` Location fieldset + `public/countries.mjs` over `GET /countries.json` |
| The classifier's own reading of a posting's place, and how it meets the parser's | reply block `location` in `classifier.ts:LocationBlockSchema` → `src/jobs/location-merge.ts:mergeAiLocation` (pure: fill or narrow, never blank; `locationSource = 'ai'`) at all three write paths |
| Why a verdict says "location mismatch" | `src/jobs/location-reason.ts:locationMismatchReason` (pure, columns only) → the Classifier card on `/jobs/:id` |
| Location string → workplace + countries + regions (ADR 0031) | `src/location.ts:parseLocation` (pure; the §7.1 traps are its tests) over the gazetteer `src/countries.json` + `src/countries.ts` (`findCountry`, `countriesOf`, `groupsOf`); hints from fetchers in `NormalizedJob.locationHints`; backfill `src/scripts/backfill-locations.ts --dry-run` |
| The /jobs place / workplace / posted facets (query params, where-clause, chip counts) | `src/web/job-facets.ts` (pure) — `country=PL,DE,EUROPE,unknown`, `workplace=remote,hybrid`, `posted=24h\|7d\|30d`; rendered in `pages/jobs-list.tsx`, chips on `/jobs/:id` |
| Stable id for a feed row with no id of its own | `src/text-utils.ts:feedItemKey` (URL key → text key → null, never `''`) |
| The cron list (6 schedules) | `src/index.ts:registerCron` |
| First-run wizard (`/welcome`: steps derived from data, `/` redirect, skip/finish) | `src/web/welcome-steps.ts` (pure: step rules + score summary) · `src/web/welcome-facts.ts` (loads the facts) · `src/web/routes/welcome.tsx` + `pages/welcome.tsx`; step 4 = `runScoreUnscored` in `src/jobs/reclassify-job.ts`, which picks its batch with `src/jobs/score-pick.ts` (pure ranking, `SCORE_BATCH`) |
| "Fetch now" (the tick from the dashboard: live progress, unscored while paused) | `POST /runs/fetch-now` in `src/web/routes/runs.tsx` → `runFetchJob({ manual: true })` in `src/jobs/fetch-job.ts`; registry `src/web/fetch-runs.ts`; verdict line `src/web/fetch-summary.ts` (pure) |
| What runs on container boot | `src/init.ts` |
| Adding a new ATS source — single-feed template | `src/fetchers/larajobs.ts` (LARAJOBS_RSS) or `src/fetchers/golangprojects.ts` (single RSS) |
| Adding a new ATS source — per-company JSON | `src/fetchers/ashby.ts` (cleanest), `src/fetchers/greenhouse.ts` |
| Adding a new ATS source — POST endpoint | `src/fetchers/workable.ts` (POST + body) |
| Adding a new ATS source — list + detail | `src/fetchers/smartrecruiters.ts` |
| Where to register a new ATS | `src/fetchers/index.ts:fetchOne` switch + `prisma/schema.prisma:AtsType` enum |
| Where to add a new toggle | `prisma/schema.prisma:AppSettings` (column) → `src/settings.ts` (getter/setter) → `src/web/pages/settings.tsx` (UI) → `src/web/routes/settings.tsx` (POST) |
| Where to add a new profile field | `prisma/schema.prisma:Profile` → `ProfileInput` + `blankProfileInput()` in `src/profiles.ts` (the compiler then names every construction site) → `ProfileFormSchema` + the save route in `src/web/routes/settings.tsx` → the editor in `src/web/pages/settings.tsx` |
| The Claude system prompt | `src/classifier.ts:buildSystemPrompt` |
| Fence markers, the untrusted directive, the forged-marker sanitiser | `src/prompt-fence.ts` (pure, ADR 0022); guard `src/prompt-fence-registry.test.ts` |
| Which AI engines run (priority chain + per-engine models, auto-failover) | `src/ai-runtime.ts:getAiRuntime().complete({role})` + pure chain merge in `src/ai-engine.ts` (ADR 0013/0014); UI on `/settings` → "AI engine" tab |
| Adding a new AI backend | `src/ai-provider.ts` (`CliProvider` spec or fetch class) + `AI_PROVIDER_IDS`/labels/options in `src/ai-engine.ts` + probe in `src/ai-runtime.ts` + `AI_KEY_ENV_VARS` in `src/ai-keys.ts` if it takes a key |
| Per-engine API keys (DB-first, `.env` fallback, masking) | `src/ai-keys.ts` (pure, ADR 0027) + `settings.ts:getAiKeys/setAiKey`; resolved in `ai-runtime.ts`, spent as `AiRequest.apiKey` |
| How users set up each engine (local + Docker) | `docs/ai-engines.md` |
| AI usage counters (runs per engine × role) | `AppSettings.aiUsage` — incremented in `ai-runtime.ts:recordUsage`, 7-day summary on `/settings` AI tab, 60-day trim in `cleanup-job.ts` |
| What a CLI child process may see in env | `ai-provider-parse.ts:CLI_PROVIDER_ENV_KEYS` (allowlist; ANTHROPIC_API_KEY never reaches claude_code) |
| How many jobs are classified at once | `AI_CONCURRENCY` in `.env` (default 3); limiter in `src/concurrency.ts`, used by `jobs/process-jobs.ts` and `jobs/reclassify-job.ts` |
| The two-stage prefilter prompt | `src/classifier-prefilter.ts:buildPrefilterPrompt` |
| Per-job filter rules (pre-Claude) | `src/filter.ts:passesBaseFilter`; union across running searches = `passesAnyBaseFilter` |
| One posting → a verdict per running search (winner, score line, thresholds) | `src/jobs/verdict-merge.ts` (pure, ADR 0028); parser `classifier.ts:parseClassifications`; write path `src/jobs/score-store.ts` |
| Which searches are running, and the ceiling on them | `src/profiles.ts:listActiveProfiles` / `setProfileActive`; `MAX_ACTIVE_PROFILES` in `src/profile-guards.ts` |
| Blank-profile guards (skip tick, fit ≤ 50 cap, activation gate) | `src/profile-guards.ts` (pure, issue #50) — wired in `process-jobs.ts`, `classifier.ts`, `routes/settings.tsx` |
| Telegram MarkdownV2 escape | `src/notifier.ts:escapeMarkdownV2` |
| Profile-to-prompt translation | `src/classifier.ts:buildSystemPrompt` (stack/role/location/notes lines) |
| Discovery candidate extraction | `src/discovery.ts:recordCandidatesFromText` (calls `extractAtsToken`) |
| URL → ATS recognition (greenhouse/lever/ashby/workable/SR) | `src/text-utils.ts:extractAtsToken` |
| Manual company probe before save | `src/ats-probe.ts:probeAts` |
| Curated company packs (catalog, resolve order, preview) | `src/starter-packs/` — `catalog.json` + `resolve.ts` (pure) + `probe.ts`; ADR 0017 |
| Resume upload → text (.pdf/.docx/.md/.txt) | `src/resume/resume-text.ts:extractResumeText` (docx via `zip.ts` + `docx-text.ts`, pdf via `pdf-text.ts` / unpdf — ADR 0011) |
| Paste posting + resume → one-shot targeted analysis | `/target` — `src/web/routes/target.tsx` (composes `jobs/manual-job.ts` + `resume/match.ts`; upload/paste land on the hidden scratch resume, old scratch matches auto-deleted) |
| Resume scan + resume-vs-job prompts and their zod schemas | `src/resume/prompts.ts` (`PROMPT_VERSION` bump on material change) |
| The match-score formula (weights, alignment points, primary-stack cap) | `src/resume/score.ts` (ADR 0012) — mirrored in `src/web/public/score.mjs`, parity test `src/web/score.test.ts` |
| Quick check vs full analysis (which prompt variant runs, what a stored row holds) | `src/resume/match-mode.ts` (pure) + the `MATCH_STEPS` / `MATCH_OUTPUT` tables in `src/resume/prompts.ts` (ADR 0029) |
| "Get suggestions" on a quick check (the lazy second call) | `src/resume/suggestions.ts` + `buildSuggestionsPrompt`; run wiring `src/web/suggestions-run.ts`, route `POST /jobs/:id/matches/:matchId/suggestions` |
| Comparing models / modes on the gold fixtures | `npm run bench:resume -- --model <id> --mode fast\|full --out f.json`, then `--table a.json b.json` (pure renderer `src/resume/bench-report.ts`) |
| What counts as primary stack / sibling-tech rules (prompt side) | `src/resume/prompts.ts:MATCH_SYSTEM` steps 3-4 — guard-tested in `prompts.test.ts` |
| ask_user confirmations (CandidateFact rows, instant re-score) | `src/resume/facts.ts` (pure) + `src/web/routes/facts.ts` (POST /facts), managed on `/resumes` |
| Per-keyword overrides (re-level / ignore / add your own term) | `src/resume/keyword-overrides.ts` (pure): `effectiveKeywords` feeds the score, `carryOverrides` re-applies them to the next reply; route `src/web/routes/keywords.ts` |
| Whether a run inherits the posting's keyword frame (rebuild, prompt bump) | `src/resume/keyword-frame.ts:planKeywordFrame` (pure, issue #79) — the reason is stored in the `breakdown` JSON and read back by `freshFrame` |
| Keyword display order + mark intensity (weight, then posting frequency) | `src/web/public/target.mjs:keywordRank` / `orderKeywords` — one implementation for the panes, the chips and the server-rendered table |
| Anti-hallucination gate for generated prose (pass/warn/block) | `src/resume/fact-check.ts:factCheck` (pure, ADR 0020) — sources arrive as arguments, `store.ts` loads them |
| Cover letter generation (gated, stored-inputs-only) | `src/resume/cover-letter.ts` + `COVER_SYSTEM` in `prompts.ts` (ADR 0021); card `src/web/pages/cover-letter-card.tsx` |
| Letter → .pdf / .docx bytes | `src/resume/pdf-write.ts`, `docx-write.ts` (over `zip-write.ts`) — all pure, no dependencies |
| Fetch one posting page by URL (user-requested, not a crawler) | `src/jobs/posting-url.ts` — ADR 0005 blocklist + private-host SSRF guard; bot checks fail honestly |
| "In another resume" evidence hints | `src/resume/store.ts:listOtherResumeSkills` → `facts.ts:annotateElsewhere` |
| ATS parse warnings ("What the ATS sees") | `src/resume/parse-warnings.ts`, rendered on `/resumes/:id` |
| Resume strength review (job-agnostic rubric) | `src/resume/review.ts` (the call) + `REVIEW_SYSTEM` in `prompts.ts`; card `src/web/pages/resume-review-card.tsx`, route `POST /resumes/:id/review` (ADR 0030) |
| The strength formula (six dimensions, weights, the duties-only cap) | `src/resume/review-score.ts` (pure) — the model grades, the code scores, exactly as ADR 0012 does for the match |
| Version delta (gained/lost keywords, component moves) | `src/resume/diff.ts:diffMatches`, rendered in `resume-match-card.tsx` |
| Live smoke bench of the match prompt (3 gold fixtures) | `npm run bench:resume` — `src/scripts/resume-bench-once.ts` |
| Compare-run progress pages (async classify/scan/match) | `src/web/target-runs.ts` (in-memory registry) + `src/web/pages/target-run.tsx`; started by `/target`, `/jobs/:id/match`, `/jobs/:id/target/reupload` |
| Which resume a job page preselects | `src/resume/pick.ts:preselectResume` — the active profile's `resumeId` first, then `pickResumeForJob` (skill-tag overlap) |
| Creating a search profile from a resume (both entry points) | `src/web/profile-from-resume.ts` → `POST /resumes/:id/profile` and `POST /welcome/profile/create`; born inactive |
| Prefill the profile from a resume scan | `src/resume/profile-draft.ts:buildProfileDraft` (pure) + `POST /settings/profiles/:id/fill-from-resume` (renders a draft, saves nothing — ADR 0015) |
| Model for cover letters (empty = follows the resume model) | `/settings` → AI engine → "Cover letter model" (role `cover` in `ai-engine.ts`; pickers save on change) |
| Model for resume calls | per-engine "Resume model" on `/settings` → AI engine; Claude engines fall back to `CLAUDE_MODEL_RESUME` in `.env` (default `claude-opus-5`) |
| Ghost-job checklist prompt + verdict schema | `src/verification/prompts.ts` |
| Liveness ladder (free ATS-API + page checks before AI verify) | `src/verification/liveness.ts` (ADR 0016), run by `verify.ts:checkLiveness` |
| Letting a call use web search (API server tools / CLI WebSearch) | `AiRequest.webTools` in `src/ai-provider.ts`, args in `ai-provider-parse.ts:buildClaudeCodeArgs` |
| Classify one stored job (Re-classify button, pasted jobs) | `src/jobs/classify-existing.ts` |
| Live keyword score + highlights in the browser | `src/web/public/target.mjs` (served at `/static/`, tested from `src/web/target.test.ts`) |
| The targeted-resume page (editor, tabs, score ring) | `src/web/pages/target.tsx` (`TARGET_JS` wires the DOM) |
| Each cron's once-script (manual trigger) | `src/scripts/{fetch,digest,cleanup,stale,hn,discovery}-once.ts` |

When the question is **"how does the user toggle / configure X?"**:

| What | Page |
| --- | --- |
| Pause / resume all new-job fetching | `/settings` General tab → "Job fetching" |
| Walk through first-run setup again (AI → test search → profile → first matches) | `/welcome` — `/` redirects there while `AppSettings.setupCompletedAt` is NULL; "Skip setup" or "Start the hourly watch" ends it; Overview shows "Finish setup →" while a step is open |
| Pull jobs right now instead of waiting for the hourly tick | Overview header or `/runs` → "Fetch now" (progress page; while paused the jobs land unscored — score them later with Save & re-classify) |
| See which boards stopped answering | `/companies` → "Quiet sources" card (Re-probe to repair) |
| Telegram line when a source goes quiet | `/settings` Notifications tab → "Source health alerts" |
| Pick / order AI engines + models, test them | `/settings` AI engine tab (per-engine cards: Enable, ↑ priority, model selects, Test) |
| Paste an AI key without touching `.env` | `/settings` AI engine tab → the key row on each engine card, or step 1 of `/welcome` (ADR 0027) |
| Add / remove tracked company | `/companies` (with manual probe before save) |
| Bulk-add a curated segment of companies | `/companies` → "Add a starter pack" (preview → confirm → added disabled → "Enable all") |
| Turn on a source that needs your own vendor account (and read whether you need it) | `/settings` → Sources → "Extra sources — a free account of your own": what each adds, when it is worth it, what the vendor asks, where to register. Until both fields are saved the source is hidden everywhere (`source-keys.ts:sourceUnlocked`, ADR 0034 rule 4) |
| Use Adzuna (free key) for a country a search names | register at developer.adzuna.com, paste app_id + app_key on `/settings` → Sources → "Source keys", then `/companies` → "Sources for your searches" → Add (off) the market row → Enable; polled four times a day, ten markets at most (ADR 0034) |
| Use France Travail (free client id) for a search that names France | create an app on francetravail.io, paste the client id + secret on `/settings` → Sources → "Source keys", then `/companies` → "Sources for your searches" → Add (off) the `codeROME=M1805` row → Enable; keep fetching on — the licence asks every stored offer to be re-checked daily (ADR 0034) |
| Get the DOU / Djinni / Arbeitnow feeds a search's countries call for | `/companies` → "Sources for your searches" (shown when a running search names UA, DE, AT, CH or GB; Add (off) probes first, then the row's toggle enables it) |
| Disable whole ATS family (e.g. all Workable) | `/settings` Sources tab |
| Enable two-stage classifier (cheaper, less precise) | `/settings` AI engine tab → "Classifier" |
| Edit profile (stack, role types, regions, fit threshold) | `/settings` Profile tab (excludes, notes, priority rules, thresholds live in its "Advanced" block) |
| Say where you live and whether you would relocate | `/settings` Profile tab → "Location" → "I live in" + the three relocation choices (ADR 0033); both stay empty-ish by default, and then nothing changes |
| Say where a search hunts (countries, groups, remote / hybrid / on-site) | `/settings` Profile tab → "Location": arrangement pills, the Countries chip input (type "Poland", "Polska", "PL" or a city, pick from the list; any spelling works without JS), region pills (🇪🇺 European Union, Europe, DACH, 🌍 Worldwide …). Empty countries + regions = anywhere |
| Fill the profile from a resume (AI draft, review before save) | `/settings` Profile tab → "Fill from a resume" |
| Create a second search from another resume | `/resumes/:id` → "Search profile" card, or `/welcome?step=profile` → "Another resume for a different kind of role?" |
| Which resume a search hunts with | `/settings` Profile tab → "Resume for this search" (empty = pick by skill overlap) |
| Run / pause a search, or make one primary | `/settings` Profile tab → "Searches" list (up to 8 running; the primary always runs) |
| See only one search's matches | `/jobs` → the search chips (the Fit column then shows that search's score) |
| See only roles you could actually take from where you live | `/jobs` → the "Open to me" chip (reads each search's own location verdict; set "I live in" on `/settings` → Profile → Location first) |
| See jobs in one country, region or arrangement, or posted this week | `/jobs` → the "Where" chips (🇵🇱 Poland, 🇪🇺 European Union, Unknown … — OR within the row, "More…" opens the rest), the "Work" chips (Remote / Hybrid / On-site / Unknown) and the "Posted" chips; the search box also matches the location string |
| Fill the country columns on jobs stored before v1.24 | `docker compose exec app node dist/scripts/backfill-locations.js --dry-run`, read the distribution, then without the flag (no AI call; `location` and `description` untouched) |
| What each search made of one posting | `/jobs/:id` → Classifier card → "By search" |
| Re-classify all jobs against new profile | `/settings` Profile tab → "Save & re-classify" in the editor (async, watch /runs) |
| Telegram on/off | `/settings` Notifications tab |
| Add Telegram bot or chat | `/settings` Notifications tab → "Add target" (validates with getMe + sendMessage) |
| Pipeline stage on a job | `/jobs/:id` → "Application tracking" card; on `/applications` drag the card between columns (`public/board.mjs`) or use its quick-move select — both hit the stage-only endpoint that never touches appliedAt/notes |
| Add / rename / reorder board columns | `/settings` General tab → "Board columns" (ADR 0025: Applied + Rejected/Ghosted fixed, delete needs an empty column; keys never change, labels do) |
| Review newly discovered companies | `/discovery` (sorted by jobsSeen DESC) |
| Toggle auto-discovery / HN parser | `/discovery` (card at the top; moved off `/settings` 2026-08-29) |
| Upload / scan a resume | `/resumes` (the Settings card only lists + links) |
| Ask how strong a resume is on its own (no posting) | `/resumes/:id` → "Resume strength" → Run strength review (one AI call, ~1 min; nothing runs on its own). Scores show in the `/resumes` Strength column |
| Compare a resume with a posting | `/jobs/:id` → "Resume match" card — **Compare** = quick check (keywords, gates, score), **Full analysis** = also the edit suggestions (ADR 0029) |
| Get the edit suggestions for a quick check | the comparison → "Get suggestions" (second call, reuses the stored verdicts, score unchanged) |
| Re-level, ignore or add a keyword by hand | the keyword table on `/jobs/:id` or `/jobs/:id/target` → the "Wants it" select, `ignore` / `reset`, and "Add a keyword" (instant re-score, no AI call; the edit sticks to the posting across re-runs) |
| Throw away a keyword list the model got wrong | the keyword table → "Rebuild keywords" (one run with the stored frame withheld; your own keyword edits survive it, the new score is not comparable with the old) |
| Paste a posting the fetchers don't see | `/jobs` → "+ Paste a job" (`/jobs/new`) |
| Compare a pasted posting with any resume in one step | menu → Compare (`/target`): paste posting, pick / upload / paste resume, Compare |
| Check whether a posting is real | `/jobs/:id` → "Is this job real?" → Verify (web search, 2-4 min) |
| Draft / edit / copy a cover letter | `/jobs/:id` → "Cover letter" card (Generate / Regenerate; edits autosave and re-check facts) |
| Standing angle inputs for letters (typed once, remembered) | `/jobs/:id` → Cover letter card → "Angle" — saved to `AppSettings.coverAngles` on every Generate |
| Write a letter for a NEW posting (searchable picker / URL / paste; match & research opt-in) | menu → Cover letter (`/letter`) |
| Download a letter as .pdf / .docx | `/jobs/:id` → Cover letter card → PDF / DOCX buttons |
| Re-check an edited resume | `/resumes/:id` → "Upload a new version", then Compare again |
| Edit in place with a live score | comparison → "Open targeted view →" (`/jobs/:id/target`); "Re-check with AI" for the rubric score (or "Full analysis with suggestions"), "Save as vN" to keep the draft |

---

## Gotchas (real bugs we paid for, codified so we don't pay again)

### 1. Hono `parseBody()` collapses multi-value form fields
Multiple checkboxes with the same name (e.g. `<input type="checkbox" name="seniority">` x4) collapse to **just the last value** with `c.req.parseBody()`. Use `parseBody({ all: true })` to get arrays. We hit this on the profile save form — it silently dropped 3 of 4 seniority values until we noticed.
- Pattern: any time the form contains `<input type="checkbox" name="X" multiple>` or repeated fields, the route handler MUST call `parseBody({ all: true })`.
- Test it: see `text-utils.test.ts:toStringArray` — the helper that wraps single → array.

### 2. `tsx` ignores `jsxImportSource` in tsconfig when entry is `.ts`
We use `hono/jsx` (server-side JSX). The `.tsx` files have a `/** @jsxImportSource hono/jsx */` pragma and tsconfig has `jsx: "react-jsx", jsxImportSource: "hono/jsx"`. **`tsc` honors both, `tsx` (the runner) does not** when a `.ts` entry-point imports a `.tsx` file. Symptoms: runtime "React is not defined" errors at request time.
- Fix: `npm run dev:web` does `tsc && node --watch dist/web/server.js`. Don't switch it back to `tsx watch`.
- Production runs `node dist/web/server.js` and is fine.

### 3. Anthropic deprecated Haiku 3.5 in 2026
Naming convention changed at the 4.x boundary:
- 4.x: `claude-haiku-4-5-20251001` (kebab-case, version-then-date)
- 3.x: `claude-3-5-haiku-20241022` (different pattern!)

Both stages of our two-stage classifier now use Haiku 4.5. Savings come from a much shorter prefilter prompt + tiny `max_tokens`, **not** from a cheaper model. See [classifier-prefilter.ts:7-12](src/classifier-prefilter.ts#L7-L12) for the comment that explains this.

**The prompt cache is not part of that, and never was.** Measured 2026-09-02:
`cache_creation_input_tokens` is **0 on every call**. The minimum cacheable
prefix is per-model and not monotonic — **4096 tokens on Haiku 4.5** against 512
on Opus 5 — and our classifier system prompt is 1216. Even the multi-search
prompt at 8 searches (~2100) stays under it, and the `claude_code` CLI sets no
`cache_control` at all. Never justify a design by caching without checking the
model's floor and reading `usage.cache_read_input_tokens` back.

### 4. RemoteOK puts a meta object at `array[0]`
Their `/api` returns `[{legal: "…", last_updated: …}, …jobs]`. **`.slice(1)` is mandatory** before zod-validating jobs. See [remoteok.ts:46-48](src/fetchers/remoteok.ts#L46-L48).

### 5. `stripHtml` had to learn numeric entities
HN comments use `&#x2F;` (`/`), `&#x27;` / `&#39;` (`'`), `&#x26;` (`&`). The first version of `stripHtml` only knew named entities (`&amp;`, `&lt;` …) and let numeric ones leak into title/location. We now decode `&#xHH;` and `&#NN;` patterns generically — see [http.ts:stripHtml](src/http.ts).

### 6. Greedy regex backtracking in HN parser
The "Company is hiring …" pattern initially captured "Sumble is the newco from the founders of Kaggle. We" because the regex backtracked across a sentence boundary to find a working `\s+(is|are)\s+hiring` anchor. Three fixes applied together:
- Length cap on capture group (`{1,30}?`)
- Pronoun blocklist on captured value (`We`, `I`, `Our`, …)
- `/\.\s/` post-check rejects captures spanning a sentence

See [hn-parser.ts:32-44](src/fetchers/hn-parser.ts#L32-L44).

### 7. Prisma migrations baseline isn't automatic
When the project switched from `db push` to real migrations in phase-3.0, we couldn't just run `prisma migrate dev --name baseline` — it would have wiped the database. The procedure was:
- Create the migration directory by hand
- `prisma migrate diff --from-empty --to-schema-datamodel … --script` to generate the SQL
- `prisma migrate resolve --applied <name>` to mark it without running

`init.applySchema()` still has a fallback to `prisma db push` if `prisma/migrations/` is missing — Phase 1 deployments without migrations still work.

### 8. `claude-haiku-4-5` is a strict role-type vs tech-stack judge — but only if you tell it
We split `Profile.stackRequired` and `Profile.roleTypes` because Claude was scoring "Senior Full-Stack Rails Engineer" at fit=92 for a PHP/Laravel candidate (because `full-stack` was in stackRequired). The fix is mostly in the prompt — a paragraph of explicit `CRITICAL — TECH STACK MATCHING` rules in [classifier.ts:buildSystemPrompt](src/classifier.ts).

The same paragraph also handles location: `Remote · Germany` / `🇩🇪 …` / `(m/w/d)` are explicit country-lock signals, NOT a US-eligible match even when the profile lists "Worldwide".

### 9. Worker and web are separate processes — read settings on every tick
A toggle in `/settings` writes to Postgres immediately. Worker reads it at the start of the next cron tick (so changes are visible within at most an hour). Don't try to short-circuit by caching settings in the worker — that defeats the live-toggle UX.

### 10. There is NO "all Greenhouse jobs" API — coverage is two-tier by design
Greenhouse / Lever / Ashby / Workable / SmartRecruiters are **HR vendors, not job boards**. Their public APIs only expose `/v1/boards/<slug>/jobs` — you have to know the company slug. There is no global "list every Greenhouse posting" endpoint, and crawling vendor customer lists is grey-zone scraping (ADR 0005 forbids it: no LinkedIn / Indeed / Workday / Wellfound / JobSpy).

Coverage is therefore **two-tier**:

1. **Direct boards** (per-company, narrow but precise) — `Company` rows with `atsType ∈ {GREENHOUSE, LEVER, ASHBY, WORKABLE, SMARTRECRUITERS, RECRUITEE, BREEZY, BAMBOOHR, PINPOINT, RIPPLING, PERSONIO, TEAMTAILOR}`. Curated by the user via `/companies` (paste a board URL → manual probe → save) or seeded in `src/seed.ts`. Catches every job at the companies you've added; misses everything else.
2. **Cross-company aggregators** (broad but noisy) — `LARAJOBS_RSS`, `REMOTEOK`, `REMOTIVE`, `JOBICY`, `WEWORKREMOTELY`, `HN_HIRING`, `HN_JOBS`, `ARBEITNOW`, `GOLANGPROJECTS`, `WORKINGNOMADS`, `HIMALAYAS`, `FOURDAYWEEK`, `SOLIDJOBS`, `DEVITJOBS`, `LANDINGJOBS`, `JOBTECH`, `ADZUNA`, `FRANCETRAVAIL` (both need the user's key). Each is a single synthetic Company row that ingests jobs from many employers we'd never seed individually (PSI CRO, ManTech, DoorDash, Lemon.io, …). Catches the long tail; lets `passesBaseFilter` + Claude cull the noise.

Common user trap: disabling all aggregators in `/settings → Job sources` because "I want only Greenhouse" produces near-zero new jobs (we have ~15 seeded Greenhouse boards, most don't post matching roles weekly). The cure is to **leave aggregators enabled** and let the profile filter narrow scope. Document this in any user-facing copy that talks about "monitoring".

When a user finds a job at a company we don't track (e.g. via LinkedIn), the right path is:
- Paste the board URL into `/companies → Add company` — the form runs `extractAtsToken` + `probeAts` and refuses to save if the slug doesn't resolve. One-click promote into the rotation.
- Or, the HN parser harvests ATS URLs from comments automatically (when `discoveryEnabled` is on) — they show up on `/discovery` as PENDING candidates.

### 11. Claude scores stack mismatches generously unless the rubric caps them — in EVERY prompt

The same failure as gotcha 8, but in the resume-match rubric: a Laravel/Vue
resume scored **82/100** against a Node.js/React posting, because "add"
credit leaked to sibling tech and the only penalty was −10 per red flag.
The fix mirrors the classifier's: `MATCH_SYSTEM` step 3 is a **primary-stack
gate** (share of the posting's core languages/frameworks "present" caps the
score — none → ≤30), "add" is forbidden for sibling technologies
(Vue ≠ React, PHP ≠ Node.js), and the summary must open with the stack
verdict ("Primary stack 0/5 …"). Verified: same resume, 10/100 vs a Node
posting and 92/100 vs a Laravel posting. Rule of thumb: any new scoring
prompt needs an explicit hard-cap rule, or Claude will average its way to a
flattering number. Guard test: `prompts.test.ts` "primary-stack gate".
Since ADR 0012 the model does no arithmetic at all: it marks `primary` /
`requirement` / `status` facts and `src/resume/score.ts` applies the caps —
the gate is now a unit-tested code path (`score.test.ts`), not a prompt rule.

Same prompt, second lesson: removal "quote" spans leaked into protected
text — one highlighted the contact line (with the email) to advise dropping
a ZIP code, another highlighted a whole skills line containing Docker and
GitLab CI/CD the posting wanted. Removals now carry two hard rules
(PROTECTED contact line; KEEP WANTED KEYWORDS with itemised drop/keep
lists) — guard test "removals rules protect the contact line".

### 13. `empty` from a fetcher is not proof the board is alive

Measured 2026-08-30 across all 71 active sources. Two failure modes hide
behind a zero count, and a naive "no jobs = healthy" rule marks both green
forever:

- **7 of 10 per-company vendors `return []` on a malformed top-level
  payload** (Workable, Recruitee, BambooHR, Pinpoint, Breezy, Rippling,
  SmartRecruiters). Only Greenhouse / Lever / Ashby throw on shape drift.
- **SmartRecruiters answers HTTP 200 with `totalFound: 0` for every
  identifier** — `Visa`, `Bosch`, `IKEA`, and a random non-existent string
  alike, under our UA and a browser UA. A dead slug there is byte-identical
  to a live board.

Hence ADR 0019 keeps two signals, not one: the failure streak (`ok` and
`empty` reset it, everything else increments) *and* `lastOkAt`, which
advances only on `ok`. A source stuck on `empty` ages into "silent" without
ever touching the streak.

Two related traps in the same area:

- **Status must come from the RAW pre-filter count.** 46 of 65 active
  companies hold zero `Job` rows — that is `passesBaseFilter` doing its job,
  not a broken board. Reading health off stored jobs makes the feature noise.
- **A timeout does not arrive as an `AbortError`.** `fetchWithRetry` rewrites
  it into a plain `Error` whose only marker is the message
  `… timed out after Nms`. And a dead BambooHR slug arrives as a *refused
  redirect* (302 → `redirect: 'error'`), not a 404.

### 14. The prompt is a CLI argument — untrusted text can become a flag

`buildClaudeCodeArgs` passes the user prompt as the **last positional
argument** of `claude --print`. When F12 fenced the prompts, the markers were
`--- BEGIN UNTRUSTED X ---`, so every prompt now *started* with `---` and the
CLI answered `error: unknown option '--- BEGIN…'`. All five `bench:resume`
fixtures failed at once.

Two fixes, both kept:

- `'--'` before `req.user` ends option parsing. This was a **pre-existing**
  hole: the prompt carries attacker-controlled text, so any description
  starting with `-` could already have become a flag — the classifier only
  escaped it by accident, because its user prompt opened with `Title: `.
- Markers moved to `=== BEGIN UNTRUSTED X ===`. Marker shape is constrained
  from two directions: `<UNTRUSTED X>` has a tag shape and `stripHtml` eats it
  (gotcha 12), `--- … ---` has a flag shape. `===` is inert to both.

`gemini_cli` passes the prompt as a flag *value* and `codex_cli` as a
positional that begins with our system text, so neither is exposed — and
neither was changed, because neither could be tested from here.

### 12. stripHtml: decode entities FIRST, and never re-run it on its own output

Three lessons paid for with one broken evening (2026-08-30):

- **Greenhouse ships job bodies HTML-escaped** (`&lt;p&gt;…`). The old
  strip-tags-then-decode order found no tags to strip, then the decode step
  rematerialised them — all 535 stored Greenhouse descriptions carried raw
  `<div class="content-intro">…` markup as visible text. Decode first,
  and decode `&amp;` LAST so `&amp;lt;` stays a literal `&lt;` instead of
  double-decoding into a phantom tag.
- **Line structure comes from block tags, not source newlines.** Raw `\n`
  in HTML is whitespace; stripHtml collapses it, then rebuilds paragraphs
  from `<p>/<div>/<h*>` boundaries, `<br>` and `<li>` (→ `• `). That is what
  makes descriptions readable — see the tests in `src/http.test.ts`.
- **stripHtml is NOT idempotent on its own plaintext output** — a second
  pass reads the newlines it just created as whitespace and flattens them.
  `backfill-descriptions.ts` therefore only strips rows that still match a
  markup regex; everything else gets entity decoding only. When structure
  is already lost, `refetch-descriptions.ts` re-pulls the boards and updates
  descriptions in place (no inserts). Never point either script at MANUAL
  rows with tag stripping — pasted prose like "salary < 100k" is not markup.

---

## ATS templates (when adding a new source)

Three reference patterns, copy whichever fits the new source:

| Shape of the new ATS | Reference file | Examples |
| --- | --- | --- |
| Single curated RSS | `src/fetchers/larajobs.ts` | RSS one feed for the whole site, no per-company config |
| RSS whose title carries the structure, one row per query | `src/fetchers/dou.ts` + `dou-title.ts` | atsToken = the feed's query string; a pure title-grammar parser; fetched with the project UA because the board blocks rss-parser's |
| RSS whose LOCATION lives in the filter, not the items | `src/fetchers/djinni.ts` | atsToken = the filter string; `djinniPlace(token)` writes the location + hints from it; rows whose category ≠ the requested keyword are the bare-feed fallback and are dropped |
| Per-category RSS, atsToken = category slug | `src/fetchers/weworkremotely.ts` | Same pattern, atsToken changes per Company row |
| Single JSON aggregator | `src/fetchers/remotive.ts` | One feed, structured JSON, all jobs under one synthetic Company |
| Per-company GET JSON | `src/fetchers/ashby.ts` | atsToken = company slug, GET endpoint, no auth |
| Per-company POST JSON (no description in list) | `src/fetchers/workable.ts` | POST with body, list-only data |
| Per-company list + per-job detail | `src/fetchers/smartrecruiters.ts` | List + N detail fetches with rate limit |

Always:
1. Add the new value to `AtsType` enum in `prisma/schema.prisma`
2. `npx prisma migrate dev --name add_<X>` to generate the migration
3. Wire into `src/fetchers/index.ts:fetchOne` switch
4. Add seed entry to `src/seed.ts` (active=false if EU-skewed or specialised)
5. Extend `src/text-utils.ts:extractAtsToken` if discoveryEnabled should pick up URLs from this ATS
6. Extend `src/ats-probe.ts:probeAts` if the new ATS is per-company (so manual /companies add validates tokens)
7. Add a unit test for the pure mapper if you have a `mapXFeed(parsed, companyId)` helper

---

## Common operational tasks (one-line answers)

| Task | Command |
| --- | --- |
| Run one fetch tick now | UI: Overview → "Fetch now" (live progress, row on `/runs`); or `docker compose exec app node dist/scripts/fetch-once.js` |
| Run discovery probe now | `docker compose exec app node dist/scripts/discovery-once.js` |
| Pull HN Who-is-hiring now | `docker compose exec app node dist/scripts/hn-once.js` |
| Send the stale-applications digest now | `docker compose exec app node dist/scripts/stale-once.js` |
| Send 4 test Telegram messages | `npm run test:telegram` (locally, .env loaded) |
| Tail the worker | `docker compose logs -f app` |
| Tail the dashboard | `docker compose logs -f web` |
| psql into the DB | `docker compose exec postgres psql -U jobhunter -d jobhunter` |
| psql / Prisma from the HOST | port **5433** (`postgresql://jobhunter:jobhunter@localhost:5433/jobhunter`) — compose publishes the DB on loopback only, on 5433 so a host Postgres on 5432 cannot shadow it |
| Back up the database | `docker compose exec -T postgres pg_dump -U jobhunter jobhunter > applypack-$(date +%F).sql` (verified: 8.7 MB, 16 tables; restore into an empty DB with `psql < dump`) |
| Re-clean stored descriptions (rows with leftover markup) | `docker compose exec app node dist/scripts/backfill-descriptions.js --dry-run`, then without the flag |
| Fingerprint existing jobs + link cross-listings | `docker compose exec app node dist/scripts/backfill-fingerprints.js --dry-run`, then without the flag |
| Flag apply links on already-stored jobs | `docker compose exec app node dist/scripts/backfill-apply-link-flags.js --dry-run`, then without the flag |
| Re-pull descriptions from the boards (structure lost) | `docker compose exec app node dist/scripts/refetch-descriptions.js --dry-run`, then without the flag |
| Migrate after a schema change | `DATABASE_URL=… npx prisma migrate dev --name <name>` |
| Re-classify everything against the active profile | UI: `/settings` → Profile → "Save & re-classify" |
| Pause all alerts temporarily | UI: `/settings` → "Telegram alerts" → Disable |
| Pause new-job fetching entirely (no docker) | UI: `/settings` → "Job fetching" → Pause |
