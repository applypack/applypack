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
- A fetcher that makes ONE request per tick sends `conditionalHeaders(id, url)`
  and calls `rememberResponse(id, url, resp, jobs.length)` after parsing
  (ADR 0035). It is a no-op for a vendor that offers no validator, so it goes
  in unconditionally; a 304 propagates as `HttpError` and `runAllFetchers`
  reads it as `not_modified`. Sources that make SEVERAL requests for one row
  (Arbeitnow's pages, Jobicy/Himalayas per place, the keyed sources) are left
  out on purpose. Never store a validator before the jobs are persisted.
- Every AI call site takes its prompt from an exported `build*Prompt`, and
  every builder wraps outside text with `fence()` from `src/prompt-fence.ts`
  (ADR 0022). `src/prompt-fence-registry.test.ts` derives both rosters, so a
  new builder or call site fails CI until it is covered. Operator input
  (`Profile.notes`, cover angles, confirmed facts) stays OUTSIDE the fence —
  that is the user's own instruction channel.
- `src/watchlist/` is the company-watchlist module (ADR 0036): `interval.ts`
  (intervals, due-ness, the ★ and the alert policy), `parse-input.ts` (the
  textarea), `scan.ts` (what a careers page publishes), `page-hash.ts` (the
  change watch: what the hash ignores, and the once-a-day rule) are pure and
  tested;
  `resolve.ts` is the ladder with its I/O injected, so the ladder itself is
  tested on recorded answers and only `liveResolveIo()` touches the network.
  Every `ats` verdict is confirmed by `probeAts` before it is offered — a URL
  match is a hypothesis, the vendor's answer is the evidence. `src/robots.ts`
  is the RFC 9309 reader it calls first: it is stricter than the protocol in
  two places, and both are deliberate (an AI-agent group binds us; a 5xx on
  robots.txt means "not allowed").
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
  `keyword-overrides.ts`, `keyword-frame.ts`, `review-score.ts` (ADR 0030),
  `change-sheet.ts`, `replacement-gate.ts` (ADR 0037),
  `docx-structure.ts`, `docx-patch.ts`, `docx-props.ts` (ADR 0038),
  `json-resume.ts`, `structure-from-text.ts`, `structure-anchor.ts`,
  `style-infer.ts`, `render/` (ADR 0039)
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
- Do not store secrets anywhere except `.env` (gitignored). Two carve-outs, both deliberate: Telegram tokens and Discord webhook URLs belong in `NotificationTarget` rows once `init.ts` has bootstrapped them (ADR 0041), and per-engine AI keys belong in `AppSettings.aiKeys` (ADR 0027) — in both cases `.env` becomes optional after first boot. A secret in the DB is read only through its own accessor, never rendered in full, never logged.
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
| A company the user watches: the interval, the ★, "alert on every posting" | `src/watchlist/interval.ts` (pure, ADR 0036) over `Company.watched / checkEvery / nextCheckAt / alertPolicy`; the due filter sits in `fetchers/index.ts:runAllFetchers` BEFORE `shuffleSources` (the Adzuna slice still comes from the full active list), and `recordFetchHealth` stamps `nextCheckAt` after every attempt |
| One pasted careers URL → a board, a feed, or an honest "nothing here" | `src/watchlist/resolve.ts:resolveCompanyUrl(input, io)` (ladder, ≤ 5 requests per company, add time only) over `scan.ts` + `text-utils.ts:extractAtsToken` + `ats-probe.ts:probeAts`; the fixture that shaped it is `docs/company-watchlist.md` |
| Whether robots.txt lets us fetch a path (and which AI-bot bans bind us) | `src/robots.ts` (pure, RFC 9309 + `Content-Signal`); the binding set follows the engines this install runs — `ai-engine.ts:PROVIDER_AI_TOKENS` / `aiCrawlerTokens`, read once per run by `watchlist/resolve.ts:installAiTokens` (ADR 0005 addendum rule 2 as amended by ADR 0036) |
| Per-source health (error→status, failure streak, quiet/silent) | `src/fetchers/source-health.ts` (pure, ADR 0019); recorded by the wrapper in `fetchers/index.ts:runAllFetchers` |
| Apply-link flags (missing / unusable / shortened / not-an-application) | `src/apply-link.ts` (pure, ADR 0023); merged into `Job.redFlags` at all three persist paths |
| Keys for the keyed sources (Adzuna, France Travail) — where they live, how a fetcher gets them, how an error is scrubbed | `src/source-keys.ts` (pure, ADR 0034: `SOURCE_KEY_FIELDS`, `resolveSourceKeys`, `redactSecrets`, `SourceKeyMissingError`) + `settings.ts:getSourceKeys/setSourceKey`; the tick puts them in `FetchContext.keys`; UI on `/settings` → Sources → "Source keys" |
| France Travail's licence as code — the daily mirror, anonymised withdrawals, the whole offer shown | `src/jobs/france-travail-sync.ts` (pure `planSync` / `planExpiry` / `anonymisedOffer` / `unverifiedSince`; the runner is called at the TOP of `fetch-job.ts`, above the pause and the no-search abort — ADR 0034 rule 5 — and an offer unverified for `LICENCE_MAX_AGE_MS` is withdrawn even with no key), `Job.sourcePayload / sourceUpdatedAt / sourceCheckedAt`, `pages/attribution.tsx:FranceTravailLine / JsonTree`, the method statement in `docs/france-travail-reuse.md` |
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
| The cron list (6 schedules) | `src/index.ts:registerCron`. `digest` and `stale-applications` beat hourly and do their work on the user's digest hours (`onDigestHour`); a beat that is not one writes no run row |
| Which minute THIS install ticks at (and why it is not :05 everywhere) | `src/schedule.ts:spreadMinute` (pure, ADR 0035) over `AppSettings.instanceId`; only `fetch` / `hn-hiring` / `discovery` move |
| When the user wants the search to run and alerts to arrive (hours, days, cadence, time zone) | `src/user-schedule.ts` (pure, TASKS §16): `isFetchDue` / `canAlertNow` / `shouldDeliverHeld` / `isDigestHour` / `nextFetchAt` / `describeSchedule`, `ScheduleSchema` over `AppSettings.schedule` (NULL = today's behaviour). NOT `src/schedule.ts` — that one is the install's cron minute. The gate sits ON TOP of the cron: the heartbeat still fires hourly, the gate decides whether it searches |
| Matches found outside the alert window (held, then sent as one message) | `Job.alertHeldAt` set in `jobs/process-jobs.ts`; delivery `jobs/alert-delivery.ts:deliverHeldAlerts` (called at the top of the fetch tick, above the pause) over the pure `jobs/held-alerts.ts:groupHeldByTarget`; count `countHeldAlerts` on `/` and `/settings`; both pages take their "next check" line from `src/web/schedule-view.ts:loadNextCheck` so they cannot drift |
| How the tick paces itself: the walk order (shuffled per tick; the Adzuna ten still come from id order first) and the gap between requests (`not_modified` → 250 ms, everything else 1 s, Lever's published `Crawl-delay` as a floor) | `src/fetchers/source-order.ts:shuffleSources` / `politeDelayMs` (pure, ADR 0035), called in `fetchers/index.ts:runAllFetchers` |
| Asking a board for its feed only when it changed (ETag / Last-Modified, and why a 304 returns no jobs) | `src/fetchers/conditional.ts` (ADR 0035) — `conditionalHeaders` + `rememberResponse` in each single-URL fetcher, `commitConditionalCache()` in `jobs/fetch-job.ts` after the jobs are stored; status `not_modified` + `advancesLastOk` in `fetchers/source-health.ts`; the live measurements are `docs/scale-plan.md` §1 |
| First-run wizard (`/welcome`: steps derived from data, `/` redirect, skip/finish) | `src/web/welcome-steps.ts` (pure: step rules + score summary) · `src/web/welcome-facts.ts` (loads the facts) · `src/web/routes/welcome.tsx` + `pages/welcome.tsx`; step 4 = `runScoreUnscored` in `src/jobs/reclassify-job.ts`, which picks its batch with `src/jobs/score-pick.ts` (pure ranking, `SCORE_BATCH`) |
| "Fetch now" (the tick from the dashboard: live progress, unscored while paused) | `src/web/fetch-now.ts:beginFetchNow` (shared by `POST /runs/fetch-now` and the wizard's `POST /welcome/search`) → `runFetchJob({ manual: true })` in `src/jobs/fetch-job.ts`; registry `src/web/fetch-runs.ts`; verdict line `src/web/fetch-summary.ts` (pure) |
| What each source cost in a tick (ms, status, count), and a walk over a subset | `SourceStat` in `src/jobs/cron-run.ts`, stamped by `fetchers/index.ts:runAllFetchers` into the `fetch` / `fetch-now` row's `bySource` (folded under the stats on `/runs`, the last board's time on the progress line); `FetchWalkOptions.only` / `.places` are how the wizard's step 2 asks the aggregators alone, where the user says they work (docs/onboarding-sources.md §6) |
| What runs on container boot | `src/init.ts` |
| A generic RSS/Atom job feed as a source (atsToken = the feed URL) | `src/fetchers/feed.ts` (ADR 0036); the URL goes through `checkPostingUrl` on every tick, and an empty feed is `empty`, not a source |
| A careers page with nothing machine-readable — "this page changed, have a look" | `src/watchlist/page-hash.ts` (pure: `normalisePageText` = stripHtml + collapse whitespace and NOTHING else — masking digits would erase "92 positions", which is the signal; `decideChange` holds the once-a-day rule) · `src/fetchers/career-page.ts` returns `[]` forever and stages through `watchlist/page-changes.ts` · `jobs/page-change-alerts.ts` sends one grouped message after the walk and only THEN advances `lastContentHash` |
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
| Why a `max_tokens` budget is the ANSWER's size (thinking headroom), and why a cut-off reply is not retried | `src/ai-provider-parse.ts:anthropicMaxTokens` (pure, gotcha 16) + the `stop_reason` branch in `ai-provider.ts`; `src/ai-json.ts:askForJson` is the one parse-and-retry loop every resume call and the ghost-job check go through, and `text-utils.ts:jsonFailure` tells "cut off" from "not JSON" |
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
| Telegram MarkdownV2 escape, Discord markdown escape, and the channel switch between them | `src/notifier.ts:escapeMarkdownV2` (the Telegram channel) · `src/notify/discord.ts:escapeDiscord` · `notifier.ts:deliverToTarget` hands a row to its channel by `kind`; the words both share are `notify/lines.ts` (ADR 0041) |
| Profile-to-prompt translation | `src/classifier.ts:buildSystemPrompt` (stack/role/location/notes lines) |
| Discovery candidate extraction | `src/discovery.ts:recordCandidatesFromText` (calls `extractAtsToken`) |
| URL → ATS recognition (greenhouse/lever/ashby/workable/SR) | `src/text-utils.ts:extractAtsToken` |
| Manual company probe before save | `src/ats-probe.ts:probeAts` |
| Curated company packs (catalog, resolve order, preview), and which packs the wizard offers | `src/starter-packs/` — `catalog.json` + `resolve.ts` (pure) + `probe.ts`; ADR 0017. `suggest.ts:packsForSearches` (pure) picks the segments for the running searches' countries, groups, stack and remote-ness; the wizard's boards step lists them and threads `next=welcome` through preview → add → enable (ADR 0040) |
| What a .docx is made of, and whether Save can write into it | `src/resume/docx-structure.ts:docxStructure` (pure, ADR 0038): `flow` / `structural` / `unsupported`, editable-line count, plain-sentence notes; never stored, recomputed from the bytes on `/resumes/:id` and the target page; `describeStructure` is the one-liner above the editor |
| Writing the editor's edits back into the user's own .docx | `src/resume/docx-patch.ts:patchDocx(original, analysedText, editedText)` (pure): `diffLines` → the paragraph behind each line (`docx-text.ts:walkDocument` / `renderLines`) → changed window rewritten run by run, tabbed headers split on ` \| `, deletes remove the `w:p`, inserts clone the paragraph above with its `numPr`; refuses table rows, text boxes, shared paragraphs and tab-layout changes; four gates before the bytes leave. Called from `routes/resumes.tsx:saveEdited` |
| The .docx reader (DOM walk + regex fallback), and why a soft break inside a table cell splits the row | `src/resume/docx-text.ts` — `walkDocument` → `Block[]` (kind, node, lines, table row/cell), `renderLines` → lines + owners, `blocksToText`; the regex reader stays as the fallback and the parity test (`docx-text.test.ts`) pins its output, quirks included, because every stored `resumeText` was rendered by it |
| A .docx's document properties (the template author's name), and the opt-in fix | `src/resume/docx-props.ts:readProps` / `withProps` / `setCoreProps` (pure); `POST /resumes/:id/props` swaps the bytes only (`store.ts:replaceResumeBytes` — no version bump, no re-scan) |
| The resume as a shape rather than a wall of text | `src/resume/json-resume.ts` (pure, ADR 0039): the JSON Resume subset ApplyPack renders, `readStructure` for the `Resume.structure` column, `structureStrings` for the guard, `structureCoverage` for the page. Caps SLICE, never reject |
| Where that shape comes from, and what stops the model rewriting the resume into it | the `structure` block of `SCAN_SYSTEM` (`prompts.ts:SCAN_STRUCTURE`, optional in `ScanSchema` so an older reply still parses) → `src/resume/structure-anchor.ts:anchorStructure` (pure: every string must be a verbatim span of `resume.text`; the drop count is the regression metric, logged on every scan) → `store.ts:saveResumeScan`; the deterministic floor when the column is NULL is `src/resume/structure-from-text.ts` |
| What typeface a resume is set in | `src/resume/style-infer.ts:inferFromDocx` / `inferFromPdf` — the DOCUMENT'S OWN RUNS weighted by the text each carries, not `styles.xml` (this corpus's style sheet says Times New Roman 12 pt and its runs say Arial 11 pt with a blue accent); a PDF's family needs `getOperatorList()` first, and reports no accent |
| The clean single-column .docx and .pdf, and why they agree | one plan (`src/resume/render/sections.ts:planRender`, pure) drawn twice — `render/clean-docx.ts` (the `docx` library, names the user's family) and `render/clean-pdf.ts` (pdfkit, embeds Liberation Sans, `Producer`/`Creator` empty). `render/knobs.ts` holds `RenderKnobs` (not stored in v1) and validates the form; `render/drawable.ts` folds what the bundled face cannot draw, its kept set checked codepoint by codepoint against both faces in `drawable.test.ts` |
| The bundled fonts and their licence | `src/resume/fonts/` — Liberation Sans 2.1.5 regular + bold (OFL 1.1, `LICENSE-liberation.txt`), metric-identical to Arial on all 95 printable ASCII codepoints and covering Cyrillic; copied into the image by the Dockerfile as `dist/resume/fonts` |
| The three .docx fixtures (a structural twin of resume 1, a paragraphs-only file, a table layout with a text box and a header) | `src/resume/fixtures/*.docx` — the twin was built from the real file with every text node replaced by neutral prose of the same length and its properties / rels scrubbed; the other two are hand-written XML through `zip-write.ts` |
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
| The wording a suggestion proposes, pulled out of its `what` sentence | `src/resume/change-sheet.ts:proposalOf` (pure) — reads `'…'` and `"…"`, guards the apostrophe, takes the span after a `to`/`with` connective, refuses a run under 12 chars; `suggestionSheet` renders the whole list as the Markdown behind "Copy all suggestions" |
| What the user changed in the editor, as Markdown ("Copy my changes") | `src/web/public/line-diff.mjs:diffLines` (LCS over normalised lines; a delete/insert pair becomes a `change` only when 30 % of the wording survives) + `public/change-sheet.mjs:formatEditSheet` |
| Whether a suggestion's wording may be applied with one press, and why a card says "not applied — …" | `src/resume/replacement-gate.ts:gateActions` (pure, ADR 0037): runs at persist time in `match.ts` and `suggestions.ts` over the model's `replacement` — `factCheck` with resume + posting + confirmed facts as sources, a replacement may not introduce a `cannot_claim` keyword, KEEP WANTED KEYWORDS blocks on a lost must/primary and warns otherwise; a block nulls `replacement` and writes the reason onto `why`. `change-sheet.ts:proposalOf` reads an explicit `null` as "judged" and never falls back to parsing `what` for it |
| The paste-ready wording itself, and where an addition goes | `MatchSchema` actions `replacement` / `insert_after` (`judgedText`: absent = v6 row, null = judged), asked for by `RULE_ACTIONS` (v7) and rendered by `OUTPUT_ACTIONS`; one `RULE_BULLET_STYLE` governs match suggestions and the review's "example" line; `text-edits.mjs:insertAfterLine` applies an addition after its anchor |
| Applying a suggestion to the resume text (replace / cut / add a term) | `src/web/public/text-edits.mjs` (pure): `applyReplacement` (keeps a bullet marker), `removeSpan` (whole line + its newline when the quote IS the line; refuses the email/phone line — gotcha 11), `insertIntoSkills` (only inside a skills section, only onto a line that is a term list, never the contact line), `inverseEdit` / `undoEdit` (Undo stores the changed sentence, not a copy of the resume) |
| What each suggestion card did, and how it survives a reload | `target-edits:<matchId>` in localStorage = `{ applied: { <card key>: inverse edit }, skipped: [key] }`; the key is `hashShortId(section\|where\|quote)` rendered into `data-card`; painted by `target-page.mjs:paintCards`, thrown away with the draft by "reset edits" / Discard |
| Copy-to-clipboard anywhere in the dashboard | `src/web/public/copy.mjs:wireCopy` — delegates `[data-copy]` (literal text) and `[data-copy-target]` (an element's value), falls back to `execCommand`, announces in one `aria-live` region it creates itself |
| The targeted-resume page (editor, tabs, score ring) | `src/web/pages/target.tsx` (`TARGET_JS` wires the DOM) |
| Each cron's once-script (manual trigger) | `src/scripts/{fetch,digest,cleanup,stale,hn,discovery}-once.ts` |

When the question is **"how does the user toggle / configure X?"**:

| What | Page |
| --- | --- |
| Pause / resume all new-job fetching | `/settings` General tab → "Job fetching" |
| Choose when the search runs and when alerts arrive | `/settings` General tab → "Schedule": time zone, cadence + hours + day pills for the search, and Right away / Only during these hours / As one digest for alerts. The digest times also drive the daily recap and the stale-application nudge. Empty schedule = every hour, around the clock, one message per match — today's behaviour. "Fetch now" ignores all of it |
| Walk through first-run setup again (AI → test search, the aggregators alone → profile → boards for your countries → first matches) | `/welcome` — `/` redirects there while `AppSettings.setupCompletedAt` is NULL; "Skip setup" or "Start the hourly watch" ends it; Overview shows "Finish setup →" while a step is open |
| Pull jobs right now instead of waiting for the hourly tick | Overview header or `/runs` → "Fetch now" (progress page; while paused the jobs land unscored — score them later with Save & re-classify) |
| See which boards stopped answering | `/companies` → "Quiet sources" card (Re-probe to repair) |
| Telegram line when a source goes quiet | `/settings` Notifications tab → "Source health alerts" |
| Pick / order AI engines + models, test them | `/settings` AI engine tab (per-engine cards: Enable, ↑ priority, model selects, Test) |
| Paste an AI key without touching `.env` | `/settings` AI engine tab → the key row on each engine card, or step 1 of `/welcome` (ADR 0027) |
| Add / remove tracked company | `/companies` (with manual probe before save) |
| Watch specific companies (paste a list of career-page URLs) | `/companies` → "Watch specific companies": one URL per line (optionally `Name — URL`), Resolve these → a progress page → a preview showing what each URL resolved to → pick the interval and the alert policy for the batch → Add. Watched rows go in switched ON |
| Watch a company whose careers page publishes no board and no feed | paste it like any other; the preview says "Change watch". The row says *Page changes* and *watching* instead of a posting count, costs no AI, and alerts at most once a day with the link |
| Change how often a watched company is checked, or what it alerts about | `/companies` → "Watchlist" → the row's two selects (Every hour / Once a day / Once a week; Every posting / Matches only). "Check now" makes it due on the next tick; "Unwatch" keeps the company and drops the star |
| See only postings from watched companies | `/jobs` → the "★ Watched" chip; ★ also sits before the company name on the list and the job page |
| Bulk-add a curated segment of companies | `/companies` → "Add a starter pack" (preview → confirm → added disabled → "Enable all") |
| Turn on a source that needs your own vendor account (and read whether you need it) | `/settings` → Sources → "Extra sources — a free account of your own": what each adds, when it is worth it, what the vendor asks, where to register. Until both fields are saved the source is hidden everywhere (`source-keys.ts:sourceUnlocked`, ADR 0034 rule 4) |
| Use Adzuna (free key) for a country a search names | register at developer.adzuna.com, paste app_id + app_key on `/settings` → Sources → "Source keys", then `/companies` → "Sources for your searches" → Add (off) the market row → Enable; polled four times a day, ten markets at most (ADR 0034) |
| Use France Travail (free client id) for a search that names France | create an app on francetravail.io, paste the client id + secret on `/settings` → Sources → "Source keys", then `/companies` → "Sources for your searches" → Add (off) the `codeROME=M1805` row → Enable. The licence's daily re-check runs whatever you switch off — pause, no search, row disabled — and offers it cannot verify for two days are removed (ADR 0034 rule 5) |
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
| Alerts on/off (every channel) | `/settings` Notifications tab → "Alerts" |
| Add a Telegram bot + chat, or a Discord webhook | `/settings` Notifications tab → "Add a Telegram target" (getMe + a test message) / "Add a Discord webhook" (a test post; only Discord's own hosts) — the row says which channel, its secret masked |
| Pipeline stage on a job | `/jobs/:id` → "Application tracking" card; on `/applications` drag the card between columns (`public/board.mjs`) or use its quick-move select — both hit the stage-only endpoint that never touches appliedAt/notes |
| Add / rename / reorder board columns | `/settings` General tab → "Board columns" (ADR 0025: Applied + Rejected/Ghosted fixed, delete needs an empty column; keys never change, labels do) |
| Review newly discovered companies | `/discovery` (sorted by jobsSeen DESC) |
| Toggle auto-discovery / HN parser | `/discovery` (card at the top; moved off `/settings` 2026-08-29) |
| Upload / scan a resume | `/resumes` (the Settings card only lists + links) |
| Ask how strong a resume is on its own (no posting) | `/resumes/:id` → "Resume strength" → Run strength review (one AI call, ~1 min; nothing runs on its own). Scores show in the `/resumes` Strength column |
| Compare a resume with a posting | `/jobs/:id` → "Resume match" card — **Compare** = quick check (keywords, gates, score), **Full analysis** = also the edit suggestions (ADR 0029) |
| Get the edit suggestions for a quick check | the comparison → "Get suggestions" (second call, reuses the stored verdicts, score unchanged) |
| Copy a suggested wording, or find it in the editor | the comparison on `/jobs/:id` or `/jobs/:id/target` → each card's **Copy** (the proposed wording alone) and **Locate** (outlines it in the editor and scrolls the editor — never the page) |
| Apply a suggestion, or your own version of it | `/jobs/:id/target` → the card's **Apply**, or **Edit & apply** to change the wording first. **Remove** on a removal, **Skip** to set one aside, **Undo** on anything done. An addition applies after the line the model anchored it to. Nothing is saved until you Save as vN — the edits live in the editor |
| Why a suggestion has no Apply and says "not applied — …" | the gate refused the wording at analysis time (an invented figure, a keyword the resume has no evidence for, a must-have the rewrite dropped); the reason is on the card's *why* line. Copy and Edit & apply still work — write your own version |
| Add a missing keyword to the skills line | `/jobs/:id/target` → the **+ add** beside a missing chip. Shown only for terms you can claim and only when the resume has a skills line that is a list; otherwise add it by hand |
| Take the whole change list into Word / Docs / a mail | the comparison → **Copy all suggestions** (the AI's list) or, on the targeted view, **Copy my changes** (a diff of your own edits, live once you type). Both are Markdown and need no Apply |
| Re-level, ignore or add a keyword by hand | the keyword table on `/jobs/:id` or `/jobs/:id/target` → the "Wants it" select, `ignore` / `reset`, and "Add a keyword" (instant re-score, no AI call; the edit sticks to the posting across re-runs) |
| Throw away a keyword list the model got wrong | the keyword table → "Rebuild keywords" (one run with the stored frame withheld; your own keyword edits survive it, the new score is not comparable with the old) |
| Paste a posting the fetchers don't see | `/jobs` → "+ Paste a job" (`/jobs/new`) |
| Compare a pasted posting with any resume in one step | menu → Compare (`/target`): paste posting, pick / upload / paste resume, Compare |
| Check whether a posting is real | `/jobs/:id` → "Is this job real?" → Verify (web search, 2-4 min) |
| Draft / edit / copy a cover letter | `/jobs/:id` → "Cover letter" card (Generate / Regenerate; edits autosave and re-check facts) |
| Standing angle inputs for letters (typed once, remembered) | `/jobs/:id` → Cover letter card → "Angle" — saved to `AppSettings.coverAngles` on every Generate |
| Write a letter for a NEW posting (searchable picker / URL / paste; match & research opt-in) | menu → Cover letter (`/letter`) |
| Download a letter as .pdf / .docx | `/jobs/:id` → Cover letter card → PDF / DOCX buttons |
| Save the edits into my own .docx | `/jobs/:id/target` → **Save as a tailored copy** (a new resume named after the company; the master untouched) or **Save as vN**. When the file is a .docx the template check allows, the file itself is patched with the edits and Download hands it back; otherwise the version is text and the flash says why. The sentence above the editor says which it will be |
| See what a Save can do with this file, and fix a downloaded template's author name | `/resumes/:id` → "Template check": Editable in place / Partly editable / Text only, the parts it cannot write into, and **Fix document properties** when the file names someone else (current values shown; bytes only, no new version) |
| Get a resume that cannot be edited in place into the loop (a PDF, a table layout) | `/resumes/:id` → **Clean version in your typeface** (`/resumes/:id/render`, also linked from the targeted view's file line): the knobs come from your own file, the preview is the rendered .docx read back, and the four buttons are Update the preview / Download .docx / Download .pdf / **Save as a new resume** — which lands a .docx the template check calls *Editable in place*. Nothing touches the original |
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

Common user trap: disabling all aggregators in `/settings → Job sources` because "I want only Greenhouse" produces near-zero new jobs (a fresh install has no employer board switched on — they arrive as starter packs, and most post a matching role rarely; ADR 0040). The cure is to **leave aggregators enabled** and let the profile filter narrow scope. Document this in any user-facing copy that talks about "monitoring".

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

### 15. Node's `fetch` sabotages conditional requests unless you set Cache-Control

Conditional requests (ADR 0035) shipped green — unit tests passing, `If-None-Match`
demonstrably on the wire — and revalidated **nothing** on two of the vendors
that `curl` got a 304 from. Lever and SmartRecruiters returned 200 with a
byte-identical ETag.

The cause is in the fetch spec, not the vendors. A request carrying
`If-None-Match` / `If-Modified-Since` has its cache mode flipped to
"no-store", and a no-store request gets `Pragma: no-cache` **and
`Cache-Control: no-cache`** appended — unless the caller already set them.
Express's `fresh()` reads that *request* directive exactly as written and
refuses to answer 304. `conditionalHeaders` therefore sends
`Cache-Control: max-age=0` with every validator: a stored copy is fine once
revalidated, which is what we actually mean. (`Pragma` makes no difference —
`fresh` ignores it — so it is left alone.)

Two lessons, both cheap:

- **Read what the server sees.** `fetch('https://postman-echo.com/get')`
  printed the two headers nobody wrote, in one call. Guessing at
  encodings and user agents took longer and found nothing.
- **A live double-tick is the only proof.** Unit tests cover the cache, not
  the vendor's answer, and this would have shipped as "conditional requests
  are on" while every feed was still downloaded in full. See
  `docs/scale-plan.md` §6 for what the run has to show.

A related measurement from the same run: **We Work Remotely's ETag is a hash
of a body that is not byte-stable** — four consecutive requests, four
different ETags. Its `Vary: Accept-Encoding, Origin` and a 304 on a lucky
pair of requests make it look like a revalidating source; it is not. A
vendor that "supports ETag" is not the same as a vendor whose feed is stable
enough for it to fire.

### 16. `max_tokens` counts the thinking, and the default resume model thinks

Found on a fresh install with four resumes (#159, 2026-09-04): every
comparison failed in both modes, and the log said *"no JSON object in
reply"* about a reply that was 96 % a JSON object. `stop_reason` was
`max_tokens` — 6 078 of the 8 000 output tokens had gone to thinking and
the JSON was cut off mid-string. Claude Opus 5 (the `CLAUDE_MODEL_RESUME`
default) thinks by default, `max_tokens` includes the thinking, and every
budget in `prompts.ts` was sized against a non-thinking answer. It surfaced
with the fourth resume because the prompt grew (122 "other resume" hints),
and the thinking grew with it.

Three rules, all in code now:
- A budget constant is the ANSWER's size. `anthropicMaxTokens` adds the
  headroom on the Anthropic path, as the OpenAI path already did for gpt-5 /
  o-series; the sum stays under the SDK's non-streaming ceiling (~21 300).
- The provider reads `stop_reason`: `max_tokens` and `refusal` are failures
  with a reason, never text handed to a parser.
- A reply that stopped inside the JSON is not retried (`ai-json.ts`) — the
  identical call stops in the identical place, so the retry was pure cost.

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
4. Add ONE reference board to `src/seed.ts`, `active: false` (the seed ships no employer board on — curated ones go to `src/starter-packs/catalog.json`, ADR 0040)
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
