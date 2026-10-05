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
  (ADR 0032) and everything unknown goes to the classifier. Title keywords
  match whole words through `titleHasKeyword`, never a run inside one.
  `baseFilterReason` / `anyBaseFilterReason` are the same gates naming the
  one that turned a posting away — the search funnel counts them.
- `employer.ts` is pure — who hires (ADR 0056): `employerKey` is the one
  normaliser (accents, case, punctuation, trailing legal forms; never fuzzy),
  `hiringKey` reads `NormalizedJob.employer` — set by every aggregator's
  mapper from its own field, null when the feed does not say, ABSENT on a
  source that is the employer — and `employerGate` is the tick's mute /
  re-apply decision. `Job.employerKey` is written at every insert;
  `jobs/employer-store.ts` is the only file that touches `company_mute`, and
  its `fillEmployerKeys` is the one-time fill `init.ts` runs. A page or a
  prompt that names a posting's company reads `employer ?? company.name`.
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
- `AiProvider.complete()` returns an attempt `{ text, outcome, spend }`, and
  `ai-runtime.ts` writes every chain attempt to the `ai_call` ledger, the
  failed ones too (ADR 0055). A call site's `label` is its ledger feature and
  must be one of `ai-usage.ts`'s set; a count the vendor did not report is
  NULL, never 0; billed, plan and local money are three totals, never one.
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
  change watch: what the hash ignores, and the once-a-day rule), `paste.ts`
  (a page drawn in the browser, pasted by the user: its lines, what is new,
  the lines a search would take — TASKS N8) are pure and tested;
  `resolve.ts` is the ladder with its I/O injected, so the ladder itself is
  tested on recorded answers and only `liveResolveIo()` touches the network.
  Every `ats` verdict is confirmed by `probeAts` before it is offered — a URL
  match is a hypothesis, the vendor's answer is the evidence. `src/robots.ts`
  is the RFC 9309 reader it calls first: it is stricter than the protocol in
  two places, and both are deliberate (an AI-agent group binds us; a 5xx on
  robots.txt means "not allowed").
- `src/screening/` is employer mode (TASKS §19, ADR 0047–0052): `rubric.ts`,
  `redact.ts`, `dates.ts`, `prompts.ts`, `anchor.ts`, `score.ts`,
  `trajectory.ts`, `comparison.ts`, `calibration.ts`, `bench.ts`,
  `intake.ts`, `export.ts`, `notice.ts`, `sectors.ts` are pure (tested); `store.ts` is
  the only file in the module that touches Prisma (the worker's
  `cleanup-job.ts` deletes expired screenings with its own query, because
  the worker may not import this module); `batch.ts` and `compare.ts` run the
  calls; `scripts/screen-bench-once.ts` runs a gold folder through the
  same path and writes no verdict (it still needs `DATABASE_URL`: the engine
  is read from `AppSettings`, with the `.env` fallback). Web-only behind
  `AppSettings.employerMode` — the worker never imports it, and nothing in
  `src/resume/` reads an `Applicant`. Redaction (`redactApplicant`) runs at
  intake and cannot be switched off; the model sees "Applicant №N" only.
- `src/local/` is `npm start` without Docker (ADR 0054): `data-dir.ts`,
  `db-state.ts`, `postgres-setup.ts`, `supervise.ts` are pure (tested);
  `postgres.ts` runs the built-in Postgres 16 through `pg_ctl` (own session,
  UTF-8 + `C.UTF-8`, UTC, loopback, no socket); `launcher.ts` takes the data
  folder's lock, starts the database, then the worker, then the dashboard,
  and stops them in reverse. The launcher never imports `config.ts` or
  `db.ts` — the URL does not exist until it has started the database. The
  worker and the dashboard only call `child.ts` (`announceReady`,
  `onLauncherStop`, `underLauncher`), a no-op without a launcher; the
  dashboard's login entry (`web/login-item-io.ts` over the pure
  `src/login-item.ts`) also reads the pure `data-dir.ts`. `snapshots.ts`
  (pure) plans the daily copy the launcher takes before Postgres starts. `config.ts` fills an empty
  `DATABASE_URL` from `db.json`, so dev watchers and once-scripts find it.
- `src/starter-packs/` is the curated-pack module: `catalog.json` (data),
  `catalog.ts` and `resolve.ts` are pure (tested), `probe.ts` calls
  `probeAts`. Web-only — the worker never imports it. Every catalog entry
  pins a hand-verified board; a probe hit is not proof of identity (ADR 0017).
- `src/web/public/tailwind.css` is generated: `npm run css` (Tailwind CLI over
  `tailwind.config.js` + `src/web/tailwind.css`) and committed, so the runtime
  has no build step and no page fetches from a third party
  (`self-contained.test.ts`). A new utility class = rerun it.
- `src/web/public/` holds browser code served as-is (no build step). Keep it
  dependency-free ES modules with pure functions, tested through `import()`
  from `src/web/*.test.ts`. The Dockerfile copies the directory into the image.
  The one exception is `public/vendor/` (ADR 0059): docx-preview and JSZip as
  npm built them, pinned by hash in `vendor/README.md` and `vendor.test.ts`,
  loaded only by the document pane.
- `data-ui` attributes in `src/web/` are the redesign's measuring hooks:
  `data-ui="hint"` marks helper prose (the `Hint` primitive, the header's
  intro and meta, a radio's body, and any raw faint paragraph or label span),
  `mode-card` / `mode-body` mark a launcher's input modes, and `alert-modes` /
  `alert-window` the Schedule form's alert window — two `:has()` rules in
  `layout.tsx` fold what belongs to a mode that is not the chosen one.
  `docs/ui-redesign/measure.js` counts them and `shoot.js` runs it over the
  pages (docs/ui-redesign-plan.md §4.2). Helper prose written outside `Hint`
  takes the hook, or the number a UI change reports reads low.
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
  `style-infer.ts`, `render/` (ADR 0039), `posting-orientation.ts`,
  `coverage.ts`, `duplicate.ts`, `review-gate.ts`, `usage.ts`,
  `draft-document.ts`, `pdf-geometry.ts`, `pdf-layout.ts` (ADR 0059), `summary-guide.ts` are pure (tested);
  `scan.ts` / `match.ts` / `suggestions.ts` / `review.ts` / `cover-letter.ts`
  call the AI provider (the letter is gated by `fact-check.ts` and generates from stored
  inputs only — ADR 0021); `store.ts` is the only file that touches Prisma.
  Web-only — the worker never imports it (ADR 0008).
- A comparison has two shapes (ADR 0029): `matchResumeToJob(..., {mode})`
  runs the quick check (`fast`, the function's default: keywords + alignment
  + gates + red flags — everything `score.ts` reads) or the full report
  (`full`, which also writes actions/removals/strengths/cautions). Every
  Compare button in the dashboard posts `full` (since v1.70.0); `fast` is
  left for rows stored before that (Rebuild keywords re-runs such a row as
  `fast`), for Save as vN with a posting (it re-scores the saved text as a
  quick check) and for the bench. Both variants are built
  from the SAME rule constants in `prompts.ts` and parsed by the same
  `MatchSchema`; `suggestions.ts` fills a fast row in later from its stored
  verdicts. The mode marker rides in the `breakdown` JSON, never in the schema.
  The verifier's `companySnapshot` reaches `full` and the suggestions call
  ONLY, as a fenced COMPANY CONTEXT block — context for emphasis and `why`,
  never evidence for a status, a gate or a replacement (ADR 0042); the
  fourth `breakdown` marker, `verificationId`, is the memo key that makes a
  full row stale after a new verification. The fifth, `evidence` (`own` /
  `text`, `match-mode.ts:readMatchEvidence`), says whether the owner's
  confirmed facts and other resumes joined the judgment: a file or a paste on
  a launcher is judged on its text alone unless the person ticks "my own
  resume" or it reads exactly like one of theirs (TASKS R1), and a memo never
  answers across the two.
- `src/web/public/score.mjs` mirrors `src/resume/score.ts` line for line —
  change one, change the other; `src/web/score.test.ts` enforces parity.
  `src/web/public/evidence.mjs` mirrors `src/resume/evidence.ts` the same
  way (`src/web/evidence.test.ts`): since score v6 the live ring reads the
  evidence grade too (ADR 0058).
- The cron worker (`src/index.ts` + `src/jobs/*`) MUST NOT run an HTTP server.
- The dashboard lives in `src/web/` as a SEPARATE service (Hono). It shares
  Postgres with the worker but runs in its own container/process. It is
  read-mostly with limited writes (status changes, profile/settings edits,
  re-classify, candidate promote, resume upload / scan / match).

## DO NOT
- Do not add Express, Next.js, or any HTTP server to the worker process.
- Do not add Redis, BullMQ, or other queues — node-cron is sufficient.
- Do not expose the dashboard on a public interface by default — bind to `127.0.0.1` in compose.
- Do not store secrets anywhere except `.env` (gitignored). Three carve-outs, all deliberate: Telegram tokens and Discord webhook URLs belong in `NotificationTarget` rows once `init.ts` has bootstrapped them (ADR 0041), per-engine AI keys belong in `AppSettings.aiKeys` (ADR 0027) — in both cases `.env` becomes optional after first boot — and the built-in database's password lives in `db.json` (mode 0600) beside the database it guards (ADR 0054). A secret in the DB is read only through its own accessor, never rendered in full, never logged.
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
  push and PR, around three gates: `npm audit --omit=dev
  --audit-level=high` (a fix the parent package has not shipped goes in
  `overrides` — deepmerge-ts 8 under prisma 6 today, GHSA-ggr8-5vv4-36mx;
  drop it once prisma releases the fix), `npm run exports:audit` (a dead or
  over-exported export fails) and `src/env-example.test.ts` (`.env.example`
  against `config.ts` and every `process.env` read). It then migrates a
  Postgres service, fails when `prisma migrate diff` finds the schema and
  the migrations apart, and runs the **route
  smoke** (`npm run smoke:routes` after `npm run build` —
  `src/scripts/route-smoke.ts`): fixtures in, every GET route one
  in-process request through `app.request()`, the first run's POSTs, a
  cross-origin POST refused, one clean PDF render. A 500 anywhere fails the
  build. Run it locally on a throwaway database only — it inserts rows and
  switches employer mode on (see `.github/workflows/test.yml`).
- The `local-start` job runs the default install on Linux (Node 22 and 24),
  macOS and Windows: `npm start` with a temporary `APPLYPACK_DATA_DIR`, the
  route smoke against the built-in database, `npm run stop`, nothing left.
  The `docker` job builds the image (never pushed), so the server option
  cannot rot between releases. `.github/dependabot.yml` opens the weekly
  update PRs: minor and patch together, each major on its own.

## Running
- `npm start` is the default install (ADR 0054): `npm run build` (tsc + the
  PDF fonts into `dist/`), then `dist/local/launcher.js`. Data lives in the OS
  app-data folder (`APPLYPACK_DATA_DIR` moves it). `npm run db` runs the
  database alone; `npm run stop` stops a running launcher.
- Docker is the server option and does not use the launcher: compose sets
  `DATABASE_URL` and runs `node dist/index.js` / `node dist/web/server.js`.
  `NODE_ENV=production` there makes the logs JSON (`logger.ts`); both
  services carry a healthcheck, `node dist/scripts/health-check.js web|worker`
  (`/health` with the Basic Auth credentials, or the age of the worker's
  `HEARTBEAT_FILE` — `src/heartbeat.ts`).
- Multi-stage Dockerfile: `deps → build → runtime`; `npm ci` from the
  lockfile, the build stage prunes the dev dependencies and deletes the
  built-in database's binaries, and the three CLI engines are pinned
  (`ARG CLAUDE_CODE_VERSION` …) — bump them together.
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
| HTTP retry, timeout, default User-Agent | `src/http.ts` — a 5xx and a network failure are retried twice; a 429 whose `Retry-After` (`retryAfterMs`) is at most 10 s is waited out once, a longer one fails as the `rate_limit` source-health reads |
| A URL from outside (a feed's link, the verifier's finding, a typed career page) as a link | `src/web/format.ts:safeHref` — http(s) or no link at all: a `javascript:` link from a feed would run in the dashboard's origin on a click |
| HTML → plaintext (entities, paragraphs, bullets) | `src/http.ts:stripHtml` + `decodeHtmlEntities` (gotcha 12) |
| Pure helpers (parsing, hashing, masking) | `src/text-utils.ts` |
| Near-duplicate detection across sources (SimHash, Hamming) | `src/fingerprint.ts` (ADR 0018); wired in `jobs/process-jobs.ts` |
| Where the running searches hunt, handed to every fetcher (`FetchContext`: union of countries + regions; anywhere = empty) | `src/fetchers/fetch-context.ts:searchPlaces` (pure) built once per tick in `fetchers/index.ts:runAllFetchers`; a source with a geo filter maps it (`jobicy.ts:jobicySlugsFor`, `himalayas.ts:himalayasUrls`, `fourdayweek.ts:fourDayWeekPlaces`), the rest ignore it |
| A company the user watches: the interval, the ★, "alert on every posting" | `src/watchlist/interval.ts` (pure, ADR 0036) over `Company.watched / checkEvery / nextCheckAt / alertPolicy`; the due filter sits in `fetchers/index.ts:runAllFetchers` BEFORE `shuffleSources` and compares against `dueCutoff(now)` — a row is stamped an interval after the TICK STARTED, so without that slack an hourly source is read every other hour (measured, v2.17.1); the Adzuna ten come from `adzuna.ts:adzunaOverflowIds` over their own query of the full active list, never this tick's due rows |
| One pasted careers URL → a board, a feed, or an honest "nothing here" | `src/watchlist/resolve.ts:resolveCompanyUrl(input, io)` (ladder, ≤ 5 requests per company, add time only) over `scan.ts` + `text-utils.ts:extractAtsToken` + `ats-probe.ts:probeAts`; the fixture that shaped it is `docs/company-watchlist.md` |
| Whether robots.txt lets us fetch a path (and which AI-bot bans bind us) | `src/robots.ts` (pure, RFC 9309 + `Content-Signal`); the binding set follows the engines this install runs, the last resort included — `ai-engine.ts:bindingProviders` → `PROVIDER_AI_TOKENS` / `aiCrawlerTokens`, read once per run by `watchlist/resolve.ts:installAiTokens` (ADR 0005 addendum rule 2 as amended by ADR 0036). A local OpenAI-compatible server and the local engine bind nothing, and a local-only install answers to our own group alone (ADR 0036 addendum 2026-09-28) |
| The OpenAI-compatible engine's server (Ollama, LM Studio, OpenRouter), the models it runs, and why a local one takes no key | `AppSettings.openAiBaseUrl` (`OPENAI_BASE_URL` the fallback) → `ai-runtime.ts:openAiBase`, passed per call as `AiRequest.baseUrl`; `ai-usage.ts:checkOpenAiBaseUrl` (https off this machine, no key in the address) and `isLocalUrl`, which `ai-engine.ts:providerUnusable` and the provider read to drop the key; `src/server-models.ts` — `listServerModels` (`GET {base}/models`) and `listOllamaModels` (`GET {root}/api/tags`), remembered for the model fields' `<datalist>`, asked by Test and by the probe for a local server; `findLocalServers` + `preferredModel` for the wizard (Ollama → the local engine, LM Studio → this one); `ai-engine.ts:withEngineFirst` is the wizard's **Use it** |
| A model on this machine as an engine of its own: the context window per call, JSON mode, one call at a time, the prompt that does not fit refused before it is sent | `local_api` (ADR 0057): `ai-provider.ts:LocalApiProvider` over Ollama's native chat route (`/api/chat`) — `ai-provider-parse.ts:buildOllamaChatBody` (streamed, `num_ctx`, `format: "json"` when `AiRequest.json`), `parseOllamaStream`, `localBudgetTokens` / `estimateTokens` (the budget guard); `AppSettings.localAiUrl` (`OLLAMA_URL` the fallback, local addresses only — `ai-usage.ts:checkLocalAiUrl`) and `localContextTokens` (`LOCAL_CONTEXT_CHOICES`, 16k default) → `ai-runtime.ts:localAiBase`; `ai-failover.ts:ENGINE_TIME_FACTOR` gives it three times the clock; one call at a time per server (`LOCAL_CALLS_AT_ONCE`); the card on `/settings` → AI engine, `POST /settings/ai/local` |
| Per-source health (error→status, failure streak, quiet/silent) | `src/fetchers/source-health.ts` (pure, ADR 0019); recorded by the wrapper in `fetchers/index.ts:runAllFetchers` |
| Apply-link flags (missing / unusable / shortened / not-an-application) | `src/apply-link.ts` (pure, ADR 0023); merged into `Job.redFlags` at all three persist paths |
| Keys for the keyed sources (Adzuna, France Travail) — where they live, how a fetcher gets them, how an error is scrubbed | `src/source-keys.ts` (pure, ADR 0034: `SOURCE_KEY_FIELDS`, `resolveSourceKeys`, `redactSecrets`, `SourceKeyMissingError`) + `settings.ts:getSourceKeys/setSourceKey`; the tick puts them in `FetchContext.keys`; UI on `/settings` → Sources → "Extra sources — a free account of your own" |
| France Travail's licence as code — the daily mirror, anonymised withdrawals, the whole offer shown | `src/jobs/france-travail-sync.ts` (pure `planSync` / `planExpiry` / `anonymisedOffer` / `unverifiedSince`; the runner is called at the TOP of `fetch-job.ts`, above the pause and the no-search abort — ADR 0034 rule 5 — and an offer unverified for `LICENCE_MAX_AGE_MS` is withdrawn even with no key), `Job.sourcePayload / sourceUpdatedAt / sourceCheckedAt`, `pages/attribution.tsx:FranceTravailLine / JsonTree`, the method statement in `docs/france-travail-reuse.md` |
| What a vendor's terms make a page say next to a listing ("Jobs by Adzuna") | `src/web/pages/attribution.tsx` (`AdzunaLabel`, `attributionLine`) — the terms' wording rendered; `fetchers/adzuna.ts:adzunaAttribution` says which domain and logo |
| Which token-driven feeds a search's countries call for (DOU / Djinni for UA, Arbeitnow for DE / GB), and their state | `src/starter-packs/suggest.ts:suggestSources(searches, tracked)` (pure) → the "Sources for your searches" card on `/companies` (`POST /companies/suggested` probes, then adds off); the profile save flash counts what is waiting |
| Salary in the posting's own money (currency, period, the USD it compares to) | `src/currency.ts` (pure: dated rate table, `toUsdPerYear`, `formatSalaryRange`, `formatUsdPerYear`) — the model reports `salary_min/max/currency/period`, `Job.salaryCurrency` + `salaryPeriod` store them, `verdict-merge.ts` converts before the `low-salary` dismissal |
| Where the candidate LIVES and whether they would move (ADR 0033) | `prisma/schema.prisma:Profile.residence / .relocation` → `src/eligibility.ts` (pure: the three relocation choices, `residenceCovered`) → the prompt's ELIGIBILITY block in `classifier.ts:describeEligibility` → the sentence in `jobs/location-reason.ts:livingReason`; editor on `/settings` → Searches → Location |
| Where a SEARCH hunts (countries / regions / workplace on the profile), the set filter with group expansion | `prisma/schema.prisma:Profile` (ADR 0032) → `src/profiles.ts:ProfileInput` → `src/filter.ts:locationReason` / `placesOverlap` (pure; `baseFilterReason` names the gate that turned a posting away); the prompt line `classifier.ts:describeLocation` (codes only); the editor control `pages/settings.tsx` Location fieldset + `public/countries.mjs` over `GET /countries.json` |
| The classifier's own reading of a posting's place, and how it meets the parser's | reply block `location` in `classifier.ts:LocationBlockSchema` → `src/jobs/location-merge.ts:mergeAiLocation` (pure: fill or narrow, never blank; `locationSource = 'ai'`) at all three write paths |
| Why a verdict says "location mismatch" | `src/jobs/location-reason.ts:locationMismatchReason` (pure, columns only) → the Classifier card on `/jobs/:id` |
| Location string → workplace + countries + regions (ADR 0031) | `src/location.ts:parseLocation` (pure; the §7.1 traps are its tests) over the gazetteer `src/countries.json` + `src/countries.ts` (`findCountry`, `countriesOf`, `groupsOf`); hints from fetchers in `NormalizedJob.locationHints`; backfill `src/scripts/backfill-locations.ts --dry-run` |
| The /jobs place / workplace / posted facets (query params, where-clause, chip counts) | `src/web/job-facets.ts` (pure) — `country=PL,DE,EUROPE,unknown`, `workplace=remote,hybrid`, `posted=24h\|7d\|30d`; rendered in `pages/jobs-list.tsx`, chips on `/jobs/:id` |
| The job page's tabs (`?tab=posting\|match\|letter\|verify`), and why an old link still lands right | `src/web/job-tabs.ts` (pure): `resolveJobTab({ tab, match, letter })` — an explicit tab wins, else `match=` means the comparison and `letter=` the letter, so `?match=12#resume-match` needs no edit; anything unknown is the posting. `jobHref(id, tab, params, anchor)` writes every link that aims inside the page (the default tab stays out of the URL); `jobTabLabels` puts what exists on the label ("Resume match · 72", "Is it real? · legit"). The rail (status, details, application tracking) rides on every tab, its forms post a hidden `tab`, and `POST /jobs/:id/status`, `/reclassify` and `/application` read it back through the resolver — nothing unvalidated reaches a redirect. One solid button a tab: the header's "Open posting" steps back where a tab brings its own. `format.ts:fitWord` says the fit floors in a word for the header |
| A run on `/runs` as a sentence instead of its stats JSON | `src/web/runs-summary.ts:summarizeRun(name, stats)` (pure): a `reason` code becomes a sentence, a raised 0/1 flag too, known counts follow in a fixed order ("0 new" always, the rest only when they happened, "0 alerted" whenever something new was stored), a count it has never heard of is humanised, and the routine ones (`filterRejected`, `preFiltered`, `dismissed` and the funnel's reason counters) plus everything that is not a number stay in the raw block. `pages/runs.tsx` draws the dots, folds the JSON and the per-source list behind **Details**, and folds runs past the latest fifty (`RECENT_RUNS`) behind a button that names and opens on a failure. A new job's stat shows up humanised without an edit; a new `reason` code wants a line in `REASON` |
| Why a search finds little: the search funnel (read → past the filter → new → scored → matches → alerted), the filter's reasons, what each source brought | `src/funnel.ts` (pure: `FUNNEL_KEYS`, `funnelView`, the reasons in words, `FILTER_KEY` / `DISMISS_KEY` — the counters `process-jobs.ts` and `reclassify-job.ts` add to) over `filter.ts:anyBaseFilterReason` (with several searches, the furthest gate any of them reached) and the winner's `dismissReason`; `jobs/funnel-store.ts:addToFunnel` sums each fetch / HN run into `funnel_day` (one row per UTC day, never pruned; the migration backfilled it from `cron_run`, totals only, and `funnel.test.ts` holds its key list to `FUNNEL_KEYS`), `loadFunnel` / `loadSourceYield` read it for `pages/funnel-card.tsx` on `/runs`; the Overview's chart and the funnel row under it read the same rows through `web/overview-stats.ts`. Zero AI |
| What the compared postings keep asking for and the resume lacks ("Missing across postings") | `src/resume/coverage.ts` (pure, `MIN_POSTINGS` = 5) over `store.ts:listLatestKeywordTables` (the latest saved comparison per posting, one SQL `DISTINCT ON`): the user's overrides and the confirmed facts applied, presence re-read off the resume's current text (`anchorStatuses`, ADR 0045), a met "any of" group and `context` rows skipped; the card on `/resumes/:id`. Zero AI |
| Who hires an aggregator's posting, and the key two spellings of a company share | `src/employer.ts` (pure, ADR 0056): `cleanEmployer`, `employerKey`, `hiringKey`, `hiringName`, `sourceIsEmployer` (MANUAL counts as the employer, unlike `web/source-groups.ts:isAggregator`); each aggregator's mapper sets `NormalizedJob.employer` (`weworkremotely.ts:wwrEmployer` and `hn-jobs.ts:hnJobEmployer` read it off the title); `Job.employer` / `employerKey`, filled once for older rows by `jobs/employer-store.ts:fillEmployerKeys` from the "Hiring company: …" line (`employerFromDescription`) |
| A muted company, and the re-apply window | `company_mute` + `AppSettings.reapplyDays` → `jobs/employer-store.ts:loadEmployerRules`, read once per tick in `jobs/process-jobs.ts` right after the base filter; `employer.ts:employerGate` turns a posting away before any AI (a watched company on "every posting" is exempt from the window, never from a mute) and the funnel counts `rejectedMuted` / `rejectedApplied`. `/jobs` hides the stored rows (`routes/jobs.tsx`, the `muted=1` panel option; `employerKey IS NULL OR NOT IN`, since NOT IN alone drops the NULLs); the rail's `pages/job-detail.tsx:MuteCard`, `pages/muted-companies.tsx`, routes `POST /companies/mutes` and `/companies/mutes/delete` |
| The Overview's "Next: three things" (open the best match → Compare → Tailor) | `src/web/next-things.ts` (pure): shown while a posting clears the primary search's floor and no comparison exists yet, gone with the first one; loaded by `routes/overview.tsx:loadNextThings` (one count in the steady state — the page refreshes every 30 s) |
| The cost sentence under a button that spends AI, before anything is on record | `src/web/cost-hint.ts:spendHint(feature)`: the ledger's median (`ai-spend.ts:costHintText`) when there is one, else `ai-spend.ts:billingHint` for the engine the chain tries first — never a guessed figure; on the wizard's resume and scoring steps and the next-three card |
| The Overview's four status cards (New / Alerted / Applied / Saved) | `ui.tsx:StatCard` — an icon tile, the label, the value at the KPI step as a link to `/jobs?status=…`, "+14 in the last 24h" and the last fortnight as bars; the one-surface metric strip of 2.14 is gone. The movement is `src/web/overview-numbers.ts:kpiTrends` (pure): a row counts on the day it TOOK its status — the alert for an alerted job, the application for an applied one (`statusMoment`), the day it was found for the rest — so "+1" on Applied is an application sent today |
| The Overview's statistics: the matches chart, the funnel under it, recent activity, jobs by stack — and why anything by technology stops at 30 days | `src/web/overview-stats.ts:loadOverviewStats` (the only reader; zero AI). Two sources, each for what it is good at: `funnel_day` (never pruned) carries every day's matches, so the chart reaches back 180 days; the jobs carry `techMatch`, but a dismissed job is deleted after 30 days (`cleanup-job.ts`), so the `?stack=` filter and the "by stack" list read 30 days only and the filter is off on 90D / 180D. A match there is `WAS_MATCH`: scored and kept, or alerted / held before the user dismissed it. Pure shaping: `src/web/stats-series.ts` (UTC days — the rollup's key — `rangePoints` in steps of 1 / 3 / 6 days, thirty points at most; `trend` gives a percentage only when the period before holds `PERCENT_FLOOR`; `niceTicks`), `overview-numbers.ts` (`topTerms`, `overviewHref`, `readStackParam`). The comparison is withheld (`trend: null`) when the install, or the jobs kept, do not reach back a whole earlier range |
| A chart in the dashboard: who draws it, and its hover | `src/web/chart-svg.ts` (pure: `plotPoints`, `linePath` — a monotone cubic, so the line never dips under zero between two days — `areaPath`, `tickOffset`, `barHeights`); the server renders inline SVG stretched to its card (`preserveAspectRatio="none"`, strokes held by `vector-effect`) with ticks and dates as HTML beside it — `pages/matches-chart.tsx`. No chart library. `public/chart.mjs` adds the hover (guide, dot, card; arrow keys once the plot has focus) off `data-points` on the plot; `nearestIndex` / `describePoint` / `placeTip` are pure, tested from `src/web/chart.test.ts`. The range and the technology are links and a plain form (`?range=`, `?stack=`), so the page's 30-second refresh keeps them |
| An icon | `src/web/icons.tsx:Icon` — one family (Lucide's paths, ISC), `name` from the `PATHS` table, 14 / 16 / 18 / 20 px; decorative by default, the words beside it name it. A new icon is a new row there. `ui.tsx:IconTile` puts one on a tone's tint; `ui.tsx:Avatar` is the letter tile for a company (no logo is ever fetched) |
| A place or a technology in a list row | `src/web/place-line.ts:placeLine(job, prefer)` (pure) — "Remote · USA, Canada +3" off the structured columns (ADR 0031), the places the running searches hunt in first (`preferredPlaces`), every country in the tooltip, the posting's own words when the columns are empty; never a row of flags. `src/web/tech-label.ts:techLabel` writes a `tech_match` tag the way people write it (TypeScript, Node.js, AWS) |
| A card's title row, its (i) and its "View all →" | `ui.tsx:CardHeader` (`title`, `info` — one sentence shown on hover and on focus with no script — and `action`), `ui.tsx:CardLink`. "Pipeline health" on the Overview says a healthy run's "OK" to a screen reader only and shows a badge for a failed or running one |
| An empty list, table or card | `ui.tsx:Empty` — `title` (what is missing, required: the compiler names every use), the children (why it matters, one sentence), `action` (one way forward, or the sentence names the control already on the page); `bare` inside a `Card`, so the card stays the one surface. The jobs table, the Comparisons card on `/resumes/:id` and the empty applications board use it since TASKS U5; `pages/screen-compare.tsx` still hand-rolls one |
| A standing message in a tone (the posting changed, a run failed, every search is empty) | `ui.tsx:Notice` (`tone` ok / warn / danger, optional `role`) — the flash's shape and the same tone map (`MESSAGE_TONE`), for what a page says on every render rather than after one action (TASKS U4). A date that reads "3 hours ago" is `ui.tsx:When` — a `<time>` with the absolute date and time on hover; a criterion's weight is `ui.tsx:Stars` (the number for a screen reader); a tone as text or fill is `ui.tsx:TONE_TEXT` / `TONE_FILL`, a gate bucket's `web/screen-view.ts:BUCKET_TONE` (TASKS U12, U18, R20) |
| A delete, a removal or a spend behind a second press | `ui.tsx:ConfirmAction` — a native popover (`popovertarget`): the sentence, Cancel and the real button, with no JavaScript and never clipped by a table's scroll box. `ActionForm` takes no `confirm` any more: `confirm()` asked nothing without a script (TASKS U8) |
| A wide table on a phone | `ui.tsx:Table`'s `hideBelow` (`table-hide.ts`): Jobs keeps the title and the fit, Runs the job, its status and what happened, Companies the name, its health and the actions; the `min-w` wrapper starts at `md` or `lg` (TASKS U7) |
| Why a browser module is never reused across an upgrade | `src/web/app.ts`: `/static/*` answers `Cache-Control: no-cache` (serveStatic sends only Last-Modified and never a 304, so a browser kept last release's `.mjs` by heuristic, #318); the bundled fonts keep a week. The stylesheet also carries `?v=APP_VERSION` from `layout.tsx` |
| An error the user reads: a flash, a failed run | the rule is three parts — what failed, what is safe, the way forward. `flash.ts:firstIssue` names the field a schema refused (no more "Invalid form values"); `run-failure.ts:runFailure(what, reason, next)` makes the caller say the last two, and `runs-summary.ts:failedRunLine` says it for a failed run on `/runs` (the raw error folds under Details — TASKS U6), and points at the web log only when the engine gave no reason; `UNEXPECTED_FAILURE` / `LETTER_FAILED` / `fetch-runs.ts:FETCH_FAILED` are the sentences for a chain that threw. The field a schema refused is marked on the page too: `flash.ts:refusedField(c.req.path, issues)` puts the form's path and the field's name on the flash, and `ui.tsx:Flash` marks that field `aria-invalid`, describes it by the message and focuses it (TASKS U15) |
| Helper prose under a control: what stays in sight and what folds | `ui.tsx`: `Field` / `ToggleRow` / `TagListInput` take `hint` (one sentence) and `more` (the rest, rendered by `More` as a quiet `Disclosure` OUTSIDE the `<label>`, so it is never the control's accessible name); the settings `Section` takes `desc` + `more`. What may never fold is docs/ui-redesign-plan.md §8 (caps, costs, gates, privacy, destructive acts). The launchers' one-mode-at-a-time is one `@supports selector(:has(*))` rule in `layout.tsx` over `data-ui="mode-card"` / `"mode-body"`; a disabled mode's reason is rendered outside the body on purpose |
| A colour, a surface, a type size, a corner or a shadow in the dashboard | `src/web/tokens.ts` (pure): the RGB triplets behind the token names, `rootBlock()` for `layout.tsx`, `contrast` / `blend`; `tokens.test.ts` fails body or helper text (ink, muted, faint) under 5:1 on any surface or the row hover, and a status tone under 4.5:1 on white, on its 12 % pill, its 5 % flash or the canvas. `tailwind.config.js` maps the names and carries the type ladder as one class per step (`text-title` 30, `text-kpi` 32, `text-section` 18, `text-entity` 15, `text-label` 13/550, `text-note` 13/400, `text-meta` 12 — size, line, tracking and weight together; body is `text-sm`), the two radii under Tailwind's own names (`rounded-md` 8px for a control, `rounded-lg` 12px for a card) and the three shadows (`shadow-sm` a control, `shadow-card` a raised surface, `shadow-pop` what floats); `src/web/type-ladder.test.ts` fails a raw size or a `text-sm font-semibold` heading anywhere in `src/web`, with no exception left (TASKS U3). A toned pill's ground (white under the 12 % tint) is a `pill-*` component class in `src/web/tailwind.css`, not an arbitrary value: repeated on every tag it cost 8 KB a page. One control height: a field is 36px and a `Button` beside it is the default size (`sm` is 30px, for a table row). Rules and roles: DESIGN.md. A new class = `npm run css` |
| The /jobs links, the **Filters** panel and the row of filters in force | `src/web/job-facets.ts` (pure): `JobsFilters`, `jobsHref(filters, { page, panel })` is the one URL builder, `activeFilters` = one removable entry per panel value, `filterCount` = the number on the button, `clearFiltersHref`. Status, sort, `q` and the fit floor are not "filters" — their controls are in plain sight. A `<details>` closes on every navigation, so the links INSIDE the panel carry `panel=1` and the route renders it open; tabs, the chip row, pagination and the form never carry it. The status tabs' counts are one `groupBy` over the final where minus `status` (`routes/jobs.tsx`), and the list's own total is read off them — no separate count query |
| Stable id for a feed row with no id of its own | `src/text-utils.ts:feedItemKey` (URL key → text key → null, never `''`) |
| The cron list (6 schedules) | `src/index.ts:registerCron` (node-cron 4, `noOverlap`, its own notes routed to pino). `digest` and `stale-applications` beat hourly and do their work on the user's digest hours (`onSchedule` over `user-schedule.ts:isDigestHour` / `isFirstDigestHour`); a beat that is not one writes no run row |
| One fetch at a time: the worker's tick, "Fetch now", `fetch-once.js`, the monthly HN pull | `src/jobs/fetch-lock.ts:tryFetchLock` — a Postgres advisory lock on a client of its own with one connection (`db-url.ts:singleConnectionUrl`), because a session lock belongs to its connection and the shared client pools them; a crash closes the connection and frees it. `runFetchJob` / `runHnHiringJob` that cannot take it return `reason: 'overlap'` before reading, sending or classifying anything (ADR 0003 addendum 2026-09-28); the route smoke holds it and checks "Fetch now" stands down |
| Which minute THIS install ticks at (and why it is not :05 everywhere) | `src/schedule.ts:spreadMinute` (pure, ADR 0035) over `AppSettings.instanceId`; only `fetch` / `hn-hiring` / `discovery` move |
| When the user wants the search to run and alerts to arrive (hours, days, cadence, time zone) | `src/user-schedule.ts` (pure, TASKS §16): `isFetchDue` / `canAlertNow` / `shouldDeliverHeld` / `isDigestHour` / `nextFetchAt` / `describeSchedule`, `ScheduleSchema` over `AppSettings.schedule` (NULL = today's behaviour). NOT `src/schedule.ts` — that one is the install's cron minute. The gate sits ON TOP of the cron: the heartbeat still fires hourly, the gate decides whether it searches |
| The time zone a dashboard date is written in | `src/web/display-zone.ts`: the request middleware in `app.ts` sets the schedule's zone (`getSchedule().timezone`, `TZ` until the user picks one) and `format.ts:formatDate` writes the date in it with the zone named (`GMT+3`); a table cell uses `format.ts:formatStamp` (day and 24-hour time) and names the zone once in its header (`display-zone.ts:displayZoneLabel`, e.g. `/runs`); outside a request it is UTC |
| Matches found outside the alert window, while Alerts are off, or refused by every chat (held, then sent as one message) | `Job.alertHeldAt` set in `jobs/process-jobs.ts` — `notifier.ts:broadcast` returns a `Delivery` (`skipped` = `alerts-off` / `no-targets`) and throws `AlertDeliveryError` when nothing reached anyone; with no active chat nothing is held (`notifier.ts:channelFor`). Delivery `jobs/alert-delivery.ts:deliverHeldAlerts` (called at the top of the fetch tick, above the pause) over the pure `jobs/held-alerts.ts:groupHeldByTarget`, which lists the best `HELD_LIST_MAX` per chat and counts the rest; the waiting line on `/` and `/settings` is `src/web/schedule-view.ts:loadHeldLine` (words in `web/held-line.ts`, reason `held-alerts.ts:heldReason`), next to its "next check" line `loadNextCheck`, so they cannot drift |
| How the tick paces itself: the walk order (shuffled per tick; the Adzuna ten still come from id order first) and the gap between requests (`not_modified` → 250 ms, everything else 1 s, Lever's published `Crawl-delay` as a floor, and a user-added site's own — `Company.crawlDelayMs`, read by `robots.ts:crawlDelayMs` when the watchlist adds the row) | `src/fetchers/source-order.ts:shuffleSources` / `politeDelayMs` (pure, ADR 0035), called in `fetchers/index.ts:runAllFetchers` |
| Why a posting reads "Closed" though nobody verified it | a whole board listing no longer carries it (TASKS S13, the gate ADR 0019 wrote down): a fetcher that can prove its list is whole calls `fetchers/listing.ts:listedInFull` (Greenhouse's `meta.total`, Lever and Ashby by contract, Workable's pages running out, SmartRecruiters' `totalFound` within its page); the walk (`fetchers/index.ts:reconcileListing`) compares after an `ok` read — never on `empty` — and `fetchers/delisted.ts:delistPlan` (pure) marks `liveness = expired` / `api_delisted`, and marks back `active` / `api_ok` the rows it took down when they return |
| Asking a board for its feed only when it changed (ETag / Last-Modified, and why a 304 returns no jobs) | `src/fetchers/conditional.ts` (ADR 0035) — `conditionalHeaders` + `rememberResponse` in each single-URL fetcher, `commitConditionalCache()` in `jobs/fetch-job.ts` after the jobs are stored, which also writes what it promoted to `Company.validator` — a process's first tick takes them back (`hydrateConditionalCache`), so a restart is not a full read (TASKS S31); status `not_modified` + `advancesLastOk` in `fetchers/source-health.ts`; the live measurements are `docs/scale-plan.md` §1 |
| First-run wizard (`/welcome`: steps derived from data, `/` redirect, skip/finish) | `src/web/welcome-steps.ts` (pure: step rules + score summary) · `src/web/welcome-facts.ts` (loads the facts) · `src/web/routes/welcome.tsx` + `pages/welcome.tsx`; step 5 (first matches) = `runScoreUnscored` in `src/jobs/reclassify-job.ts`, which picks its batch with `src/jobs/score-pick.ts` (pure ranking, `SCORE_BATCH`) |
| "Fetch now" (the tick from the dashboard: live progress, unscored while paused) | `src/web/fetch-now.ts:beginFetchNow` (shared by `POST /runs/fetch-now` and the wizard's `POST /welcome/search`) → `runFetchJob({ manual: true })` in `src/jobs/fetch-job.ts`; registry `src/web/fetch-runs.ts`; verdict line `src/web/fetch-summary.ts` (pure) |
| What each source cost in a tick (ms, status, count), and a walk over a subset | `SourceStat` in `src/jobs/cron-run.ts`, stamped by `fetchers/index.ts:runAllFetchers` into the `fetch` / `fetch-now` row's `bySource` (under **Details** on `/runs`, the last board's time on the progress line); `FetchWalkOptions.only` / `.places` are how the wizard's step 2 asks the aggregators alone, where the user says they work (docs/onboarding-sources.md §6) |
| What runs on container boot | `src/init.ts` |
| What `npm start` does (the built-in Postgres, the lock, start order, restarts, stop) | `src/local/launcher.ts` over `postgres.ts` (I/O) and the pure `data-dir.ts`, `db-state.ts`, `postgres-setup.ts`, `supervise.ts` (ADR 0054) |
| Start ApplyPack when the user logs in (opt-in, the undo beside it) | `src/login-item.ts` (pure: the launchd agent, the `systemctl --user` unit, the Startup script — this checkout, this Node by its PATH name, the PATH now) → `web/login-item-io.ts` writes / removes it, only under the launcher (`local/child.ts:underLauncher`); Settings → General → **Start with this computer**, `POST /settings/login-item` (ADR 0054 addendum) |
| The daily copy of the database a local install keeps | the launcher's `takeSnapshot` before Postgres starts, planned by `local/snapshots.ts` (one a day, `APPLYPACK_SNAPSHOTS` kept, 3 by default, 0 = none; `postmaster.pid` left out) into `snapshots/<date>/postgres` in the data folder |
| Moving a Docker install into `npm start` | `npm run db:import -- dump.sql --yes` → `src/scripts/db-import.ts` over the pure `src/sql-dump.ts` (`splitSql` — strings, E-strings, dollar quotes, comments, psql's `\restrict` lines; `importPlan` — inserts and `setval` kept, `_prisma_migrations` never, COPY and schema refused); one transaction, `session_replication_role = replica`, refused while a worker runs; fixture `src/fixtures/pg-dump-data-only.sql` (pg_dump 16.15) |
| How a CLI engine is started on Windows | `src/cli-command.ts:cliCommand` — an npm `.cmd` shim is read for its script (`shimScript`) and run as Node + script, a native `.exe` as itself; never `shell: true`, which would hand the prompt to cmd.exe. Used by the CLI provider and the engine probe |
| Where a local install keeps its data, and how scripts find its database | `src/local/data-dir.ts:dataDirFor` → `db.json`, read by `config.ts:useBuiltInDatabaseWhenUnset` |
| A generic RSS/Atom job feed as a source (atsToken = the feed URL) | `src/fetchers/feed.ts` (ADR 0036); the URL goes through `checkPostingUrl` on every tick, and an empty feed is `empty`, not a source |
| A careers page with nothing machine-readable — "this page changed, have a look" | `src/watchlist/page-hash.ts` (pure: `normalisePageText` = stripHtml + collapse whitespace and NOTHING else — masking digits would erase "92 positions", which is the signal; `decideChange` holds the once-a-day rule) · `src/fetchers/career-page.ts` returns `[]` forever and stages through `watchlist/page-changes.ts` · after the walk `jobs/page-change-alerts.ts:recordPageChanges` writes a change as `Company.pendingContentHash`, and `deliverPageChanges` (top of the tick and after the walk, the held matches' rules) sends one grouped message and only THEN advances `lastContentHash`; a held change keeps no validator (`career-page.ts`), so a 304 cannot hide it |
| Adding a new ATS source — single-feed template | `src/fetchers/larajobs.ts` (LARAJOBS_RSS) or `src/fetchers/golangprojects.ts` (single RSS) |
| Adding a new ATS source — per-company JSON | `src/fetchers/ashby.ts` (cleanest), `src/fetchers/greenhouse.ts` |
| Adding a new ATS source — POST endpoint | `src/fetchers/workable.ts` (POST + body) |
| Adding a new ATS source — list + detail | `src/fetchers/smartrecruiters.ts` |
| Where to register a new ATS | `src/fetchers/index.ts:fetchOne` switch + `prisma/schema.prisma:AtsType` enum |
| Where to add a new toggle | `prisma/schema.prisma:AppSettings` (column) → `src/settings.ts` (getter/setter) → `src/web/pages/settings.tsx` (UI) → `src/web/routes/settings.tsx` (POST) |
| Where to add a new profile field | `prisma/schema.prisma:Profile` → `ProfileInput` + `blankProfileInput()` in `src/profiles.ts` (the compiler then names every construction site) → `ProfileFormSchema` + the save route in `src/web/routes/settings.tsx` → the editor in `src/web/pages/settings.tsx` |
| The Claude system prompt | `src/classifier.ts:buildSystemPrompt` |
| Fence markers, the untrusted directive, the forged-marker sanitiser | `src/prompt-fence.ts` (pure, ADR 0022); guard `src/prompt-fence-registry.test.ts` |
| Which AI engines run (priority chain + per-engine models, auto-failover) | `src/ai-runtime.ts:getAiRuntime().complete({role})` → the loop `src/ai-failover.ts:runChain` (its backends, ledger, cooldowns and clock injected, so it is tested) + pure chain merge in `src/ai-engine.ts` (ADR 0013/0014); UI on `/settings` → "AI engine" tab. A card reads `aiEngineCard`: enabled means in `aiEngineOrder` (stored, or `AI_PROVIDER` alone), not in `chain`, which drops a skipped engine and holds the `lastResort` nobody enabled; `toggleAiEngine` is what Enable / Disable store |
| Which engine answers which task (a local model for scoring, a subscription for the letters) | `src/ai-tasks.ts` (pure: the six tasks, `taskOf(feature)` — a new ledger feature does not compile until it names its task) → `AppSettings.aiEngine.tasks` (`{ <engine>: [...] }`; no entry = every task) → `ai-engine.ts`: `ResolvedAiEngine.chainFor(task)` is the usable engines that take it, in priority order, and the whole chain when none does; `withEngineTasks` stores a full set of boxes as no list; `offeredTasks` keeps the web check from an engine with no web search; `taskPlans` is the AI tab's table. An engine never takes a task it is not offered, so the web check does not fall to a tool-less engine with no list, and a task is `unclaimed` only when an engine that could take it stands in the chain. Screening has a box only while employer mode is on: until then an engine's first list sends it where Resume analysis goes and a later save keeps the choice (`web/ai-plan.ts:pickedTasks`); the flash names only tasks the page shows (`tasksSaved`). `ai-spend.ts:billingNotes` reads the same rows per task. `ai-failover.ts:runChain` runs `chainFor(taskOf(req.label))`, and `viaFallback` is read against the first engine the call would ask (for a call that searches the web, the first that can). A page that names "the engine that answers" asks for its task: `chainFor('analysis')` on the run page, `'screening'` in employer mode, `taskOf(feature)` under a cost hint (ADR 0060) |
| Adding a new AI backend | `src/ai-provider.ts` (`CliProvider` spec or fetch class) + `AI_PROVIDER_IDS`/labels/options in `src/ai-engine.ts` + probe in `src/ai-runtime.ts` + `AI_KEY_ENV_VARS` in `src/ai-keys.ts` if it takes a key; its parser reports `spend` (usage, resolved model, the vendor's own figure) from a recorded output, its models get dated rows in `src/ai-prices.ts` (`ai-prices.test.ts` fails a picker model with no price), and `ai-usage.ts:billingOf` says whose money it spends (ADR 0055) |
| Why the Antigravity engine has no web tools and a folder of its own | `agy_cli` — headless `agy -p`, `ai-provider-parse.ts:buildAgyCliArgs` / `parseAgyCliOutput` (the test holds a recorded reply). Headless `agy` allows file reads and writes inside its workspace and has no per-run allow list: the one way to let it fetch a page is `--dangerously-skip-permissions`, which also opens shell commands to whatever a posting says. So `PROVIDER_WEB_TOOLS.agy_cli` is false (the chain sends "Is it real?" to the next engine that can search), the child runs in an empty `applypack-agy-*` temp folder made once per process, and its env allowlist is empty: the login lives in the OS keyring, and a Gemini key would bill per token under a plan label. Local installs only (the image carries no `agy`). Never pass that flag |
| Why a failed AI call is retried, failed over at once, or its engine left alone for ten minutes | `src/ai-provider-parse.ts:failureKind` reads a status and a message the same way on every path — `auth` (a refused key or sign-in: never retried, outcome `unauthorized`, the engine skipped until the credential changes — `refused` in `ai-cooldown.ts:createCooldownTracker`, keyed by a fingerprint), `quota` (a spent plan or allowance: not retried), `transient` (a rate limit, an overloaded server: ONE more try after `retryWait` — the server's `retry-after-ms` / `Retry-After` up to 10 s, else 2 s, only with budget left). The Anthropic SDK's own retries are off (`maxRetries: 0`): they waited any Retry-After, uncapped, under the chain's deadline. A CLI that exits non-zero on a rate limit is judged by what it printed (`cliRetryable`) |
| What happens to a CLI call when the worker or the dashboard stops | `src/ai-provider.ts:stopCliChildren` — both shutdowns call it first: every CLI child in flight is killed (its pipes closed, so the call ends now) and new ones are refused; orphaned, a CLI ran on to its timeout on the user's plan |
| Why a `max_tokens` budget is the ANSWER's size (thinking headroom), and why a cut-off reply is not retried | `src/ai-provider-parse.ts:anthropicMaxTokens` (pure, gotcha 16) + the `stop_reason` branch in `ai-provider.ts`; `src/ai-json.ts:askForJson` is the one parse-and-retry loop every resume call and the ghost-job check go through, and `text-utils.ts:jsonFailure` tells "cut off" from "not JSON" |
| Per-engine API keys (DB-first, `.env` fallback, masking) | `src/ai-keys.ts` (pure, ADR 0027) + `settings.ts:getAiKeys/setAiKey`; resolved in `ai-runtime.ts`, spent as `AiRequest.apiKey` |
| How users set up each engine (local + Docker) | `docs/ai-engines.md` |
| What every AI call spent — tokens, money, and whose money — and why a total never adds a bill to a plan | `src/ai-ledger.ts:recordAiCall` (one `ai_call` row per attempt, failed ones too; written by `ai-runtime.ts` for every chain attempt and by `web/ai-test.ts`) over the pure `src/ai-spend.ts` (`ledgerRow`, `spendView`, `periodRange`, `budgetAlert`, `billingNotes`, `costHintText`, `jobSpendText`, `spendReportLines`), `src/ai-prices.ts` (the dated price table, `PRICES_AS_OF`; a model it does not know is "not priced", never $0) and `src/ai-usage.ts` (`AiUsage`, `billingOf` = billed / plan / local, the closed feature set the call sites' labels must belong to). Each parser in `ai-provider-parse.ts` reports the usage, the resolved model and the vendor's own figure, on a failure too; the page is `/ai` (AI usage), the per-posting row and the estimates under Compare / Verify / Generate read the same rows; `npm run spend:report` prints it per UTC day for a comparison with the vendor's own report; `cleanup-job.ts` keeps 400 days (ADR 0055). `AppSettings.aiUsage` is retired |
| Which model did what, in how long, for how much — and what the ledger suggests changing | `/ai` — `src/web/routes/ai-usage.tsx` → `pages/ai-usage.tsx`: `ai-ledger.ts:loadSpendGroups` (a feature on a model on one kind of money, with `medianMs` / `p90Ms` of the calls that answered, `rateLimited`, and the attempts and money that went through a fallback — `viaFallback`, `fallbackMicro`) → `ai-spend.ts:spendView` + `usageByModel`; **Worth a look** is `src/web/usage-hints.ts:usageHints` (pure): the budget's pace, the task most of the bill went to while a plan or local engine stands ready, billed fallbacks, an engine that keeps failing or hitting its rate limit (counted per feature and engine, never per model: a call that failed with no reply has no resolved model), scoring billed on a model `PRICE_RATIO` times the cheapest its engine offers, the volume on a plan beside an idle local model. Every sentence is arithmetic on recorded calls, the engines set up (where each stands and which tasks it has ticked — the advice names the step that is missing) and `ai-prices.ts`; none says a model is good enough, a model on this computer is offered `LOCAL_TASK` (scoring) only, and `NO_PLAN_TASK` (screening) is never steered onto a personal plan. The who-does-what table is `web/ai-plan.ts:aiPlanRows` + `pages/ai-plan.tsx`, shared with the AI tab. Zero AI |
| What a CLI child process may see in env | `ai-provider-parse.ts:CLI_PROVIDER_ENV_KEYS` (allowlist; ANTHROPIC_API_KEY never reaches claude_code) |
| How many jobs are classified at once | `AI_CONCURRENCY` in `.env` (default 3); limiter in `src/concurrency.ts`, used by `jobs/process-jobs.ts` and `jobs/reclassify-job.ts` |
| The two-stage prefilter prompt | `src/classifier-prefilter.ts:buildPrefilterPrompt` |
| Per-job filter rules (pre-Claude) | `src/filter.ts:passesBaseFilter`; union across running searches = `passesAnyBaseFilter` |
| Why an exclude of "java" does not drop "JavaScript" | `src/filter.ts:titleHasKeyword` (pure) — whole-word matching for all three keyword lists, a boundary demanded only where the keyword's own edge is a letter or a digit (so `c++`, `c#`, `.net`, `node.js` still match), plus `KEYWORD_SUFFIXES`, six tolerances measured on 941 stored titles (`go` → Golang, `team lead` → Team Leader, `engineer` → Engineering) |
| One posting → a verdict per running search (winner, score line, thresholds) | `src/jobs/verdict-merge.ts` (pure, ADR 0028); parser `classifier.ts:parseClassifications`; write path `src/jobs/score-store.ts` |
| Which searches are running, and the ceiling on them | `src/profiles.ts:listActiveProfiles` / `setProfileActive`; `MAX_ACTIVE_PROFILES` in `src/profile-guards.ts` |
| Blank-profile guards (skip tick, fit ≤ 50 cap, activation gate) | `src/profile-guards.ts` (pure, issue #50) — wired in `process-jobs.ts`, `classifier.ts`, `routes/settings.tsx` |
| Telegram MarkdownV2 escape, Discord markdown escape, and the channel switch between them | `src/notifier.ts:escapeMarkdownV2` (the Telegram channel) · `src/notify/discord.ts:escapeDiscord` · `notifier.ts:deliverToTarget` hands a row to its channel by `kind`; the words both share are `notify/lines.ts` (ADR 0041) |
| Profile-to-prompt translation | `src/classifier.ts:buildSystemPrompt` (stack/role/location/notes lines) |
| Discovery candidate extraction | `src/discovery.ts:recordCandidatesFromText` (calls `extractAtsToken`) |
| URL → ATS recognition (the twelve per-company vendors) | `src/text-utils.ts:extractAtsToken` |
| Manual company probe before save | `src/ats-probe.ts:probeAts` |
| Curated company packs (catalog, resolve order, preview), and which packs the wizard offers | `src/starter-packs/` — `catalog.json` + `resolve.ts` (pure) + `probe.ts`; ADR 0017. `suggest.ts:packsForSearches` (pure) picks the segments for the running searches' countries, groups, stack and remote-ness; the wizard's boards step lists them and threads `next=welcome` through preview → add → enable (ADR 0040) |
| What a .docx is made of, and whether Save can write into it | `src/resume/docx-structure.ts:docxStructure` (pure, ADR 0038): `flow` / `structural` / `unsupported`, editable-line count, plain-sentence notes; never stored, recomputed from the bytes on `/resumes/:id` and the target page; `describeStructure` is the one-liner above the editor |
| Writing the editor's edits back into the user's own .docx | `src/resume/docx-patch.ts:patchDocx(original, analysedText, editedText)` (pure): `diffLines` → the paragraph behind each line (`docx-text.ts:walkDocument` / `renderLines`) → changed window rewritten run by run, tabbed headers split on ` \| `, deletes remove the `w:p`, inserts clone the paragraph above with its `numPr`; refuses table rows, text boxes, shared paragraphs and tab-layout changes; four gates before the bytes leave. Called from `routes/resumes.tsx:saveEdited` |
| The resume on the Tailor page as a document: what it is drawn as, the note beside it, the two downloads | `POST /resumes/:id/document` (`routes/resume-document.ts`, nothing stored) over `src/resume/draft-document.ts` (pure, ADR 0059): `draftDocx` — the user's own `.docx` with the draft patched in (`patchDocx`), else the clean version and `noticeFor(basis)` (pdf / text / unsupported / stale / refused); `draftPdf` for the clean PDF; `cleanDocx` is what Save stores when the patcher cannot write the draft, refused only when `missingLines` finds a line the clean file would drop. The typography (and a PDF's layout) is `web/resume-style.ts:resumeStyle`, cached per resume version |
| The document pane: drawing, marking what changed, editing a paragraph, printing the user's own `.docx` | `src/web/public/doc-pane.mjs` — docx-preview (`public/vendor/`, loaded when the pane opens) draws off-screen until its tab stops settle, then swaps in; `changedKeys` marks the lines the draft changed (a row's changed cells only), `locateParagraph` / `rewriteSpan` put a paragraph edit back into the text, `pageBreaks` draws the "≈ page 2" guides, `printCss` + a `srcdoc` frame print the sheet at the file's own page size. Wired in `target-page.mjs` (Document / Plain text, Locate, the downloads) |
| Apply all, and why each card still has its own Undo after it | `src/web/public/apply-all.mjs:applyAll` — every open card's own operation in page order, then `addKeywords` — every keyword the resume backs, on the skills line its hint names, or on a line of its own (`text-edits.mjs:appendSkills`); each keeps its exact `change` (every `text-edits.mjs` op reports one) plus context (`withContext`), so `undoEdit` finds it after other edits moved it; Undo all walks `edits.order` backwards. The order and the edits live in `target-edits:<matchId>` |
| How a PDF looked on its page: colours, weights, the skills table, a place flush right, the rules | `src/resume/pdf-geometry.ts:readPdfGeometry` (fill colours laid onto the text items by walking pdf.js's operator list in step with them; rules from path bounding boxes; bold from the font's real name) → `src/resume/pdf-layout.ts:readLayout` (pure: `columns`, `pairs`, `looks` — a look per kind of line, header / heading rules, justified body, the label column). `style-infer.ts:inferFromPdf` stores it as `InferredStyle.layout`; `structureFromText(text, layout)` pairs the table and splits company from place only where the page and the text agree; `knobs.looks` + `lookFor` put each run of the clean version in its kind's look (`Run.role`) |
| The .docx reader (DOM walk + regex fallback), and why a soft break inside a table cell splits the row | `src/resume/docx-text.ts` — `walkDocument` → `Block[]` (kind, node, lines, table row/cell), `renderLines` → lines + owners, `blocksToText`; the regex reader stays as the fallback and the parity test (`docx-text.test.ts`) pins its output, quirks included, because every stored `resumeText` was rendered by it |
| A .docx's document properties (the template author's name), and the opt-in fix | `src/resume/docx-props.ts:readProps` / `withProps` / `setCoreProps` (pure); `POST /resumes/:id/props` swaps the bytes only (`store.ts:replaceResumeBytes` — no version bump, no re-scan) |
| The resume as a shape rather than a wall of text | `src/resume/json-resume.ts` (pure, ADR 0039): the JSON Resume subset ApplyPack renders, `readStructure` for the `Resume.structure` column, `structureCoverage` for the page (the guard is `structure-anchor.ts:anchorStructure`). Caps SLICE, never reject |
| Where that shape comes from, and what stops the model rewriting the resume into it | its own call, `src/resume/structure.ts:structureResume` over `prompts.ts:buildStructurePrompt` (since v1.66.0 — the scan no longer carries it; `ScanSchema.structure` stays optional so an old reply parses), started by the "Read the shape with AI" button on `/resumes/:id/render` and never by the visit itself (a GET spends no model call — audit SEC-7) → `src/resume/structure-anchor.ts:anchorStructure` (pure: every string must be a verbatim span of `resume.text`; the drop count is the regression metric, logged on every reading) → `store.ts:saveResumeStructure`; the deterministic floor when the column is NULL is `src/resume/structure-from-text.ts` |
| What typeface a resume is set in | `src/resume/style-infer.ts:inferFromDocx` / `inferFromPdf` — the DOCUMENT'S OWN RUNS weighted by the text each carries, not `styles.xml` (this corpus's style sheet says Times New Roman 12 pt and its runs say Arial 11 pt with a blue accent); a PDF's family needs `getOperatorList()` first, and reports no accent |
| The clean single-column .docx and .pdf, and why they agree | one plan (`src/resume/render/sections.ts:planRender`, pure) drawn twice — `render/clean-docx.ts` (the `docx` library, names the user's family) and `render/clean-pdf.ts` (pdfkit, embeds Liberation Sans, `Producer`/`Creator` empty). `render/knobs.ts` holds `RenderKnobs` (not stored in v1) and validates the form; `render/drawable.ts` folds what the bundled face cannot draw, its kept set checked codepoint by codepoint against both faces in `drawable.test.ts` |
| The bundled fonts and their licence | `src/resume/fonts/` — Liberation Sans 2.1.5 regular + bold (OFL 1.1, `LICENSE-liberation.txt`), metric-identical to Arial on all 95 printable ASCII codepoints and covering Cyrillic; copied into the image by the Dockerfile as `dist/resume/fonts` |
| The three .docx fixtures (a structural twin of resume 1, a paragraphs-only file, a table layout with a text box and a header) | `src/resume/fixtures/*.docx` — the twin was built from the real file with every text node replaced by neutral prose of the same length and its properties / rels scrubbed; the other two are hand-written XML through `zip-write.ts` |
| Resume upload → text (.pdf/.docx/.md/.txt) | `src/resume/resume-text.ts:extractResumeText` (docx via `zip.ts` + `docx-text.ts`, pdf via `pdf-text.ts` / unpdf — ADR 0011) |
| Posting (one of your jobs, or pasted) + resume → one-shot targeted analysis | `/target` — `src/web/routes/target.tsx`: a stored job goes straight to `comparison-run.ts:startComparison`; a pasted one is detected and stored (`jobs/manual-job.ts`) inside its run, then handed to `comparison-run.ts:runComparison`. The picker is `pages/job-picker.tsx` over `job-pick.ts:listPickableJobs` (shared with `/letter`; `/screen/new` uses the component with its own list), `?job=` preselects. The resume half is `resume-source.ts:resolveResumeSource` (shared with `/letter`): upload/paste land on the hidden scratch resume, whose comparisons keep their text snapshot and whose letters retire when the text changes (`store.ts:upsertScratchResume`) |
| Resume scan + resume-vs-job prompts and their zod schemas | `src/resume/prompts.ts` (`PROMPT_VERSION` bump on material change) |
| The posting read on its own — role, seniority, industry, who screens it, what impresses them, the requirement groups and the keyword frame | `src/resume/brief.ts:briefForPosting` over `prompts.ts:buildBriefPrompt` / `BriefSchema` (ADR 0044); stored in `posting_brief` keyed by `jobId + postingHash + BRIEF_PROMPT_VERSION`, so editing a resume never pays for it twice. `briefLine` is the one-liner the progress page shows. A null brief degrades to the old behaviour everywhere |
| Why a keyword the model returned is not in the table at all | `src/resume/keyword-shape.ts:dropMalformedKeywords` (pure, ADR 0044 addendum) — a years-of-experience or degree requirement is a gate, a bare quantity ("0 to 1", "10x") is not a thing to search for, and nothing over five words is a term. Runs first in `match.ts`, before anchoring; a keyword the user added themselves is never dropped |
| How strongly the resume shows a keyword (a skills line, a sentence, a sentence with a number) | `src/resume/evidence.ts:annotateEvidence` (pure) — measured off the text, never asked of the model; stamped in `match.ts`, by `keyword-overrides.ts:addKeyword` on a term the user types, and by `store.ts:rescoreMatchKeywords` on a row graded before v6 (`withEvidence`); shown as the "skills line only" / "with a number" badge, handed to the suggestions call so REQUIRED COVERAGE reads a fact instead of guessing, and since score v6 counted: a present term only listed earns `SCORING.listedCredit` 0.85 (ADR 0058). The live ring grades with `src/web/public/evidence.mjs` (its mirror, parity test `src/web/evidence.test.ts`; `site/public/demo/` vendors it) |
| How long and how lately the resume shows a term at work ("3.8 yrs at work · 6 yrs ago") | `src/resume/usage.ts:termUsage` (pure, TASKS R8) — the dated roles (`structure-from-text.ts`) whose own lines name the term, merged by `screening/dates.ts`; computed on every view in `routes/jobs.tsx:orderedKeywords` off the comparison's text, rendered in the keyword table, amber past `STALE_MONTHS` (36). Never stored, never scored (ADR 0058) |
| Whether a posting said enough to be trusted as a checklist | `src/resume/brief-depth.ts:postingDepth` (pure) over the stored brief — six signals, `high\|medium\|low`, and the sentence the target page shows when the posting is thin. Read-only: `brief.ts:storedBriefFor` never spends a call to render a page |
| Why "matched" always agrees with the missing-keyword chips, and why a typed word counts | `src/resume/keyword-anchor.ts:anchorStatuses` (pure, ADR 0045) — whether the word is in the TEXT is one question, so the matcher settles the status for every verdict: a term it can find is `present` whatever the model said (a `cannot_claim` on the resume's own title line held one pair at 41 for a 52), an unwritten `present` becomes `add`, an unwritten `ask_user` / `cannot_claim` stays. `score.mjs:entriesFromLive` is the same rule per keystroke, and `src/web/score.test.ts` holds the two equal on every text. "Named, but nothing behind it" is the `evidence` grade, never the status. Stored rows from before the rule: `node dist/scripts/reanchor-matches.js --dry-run` |
| Whether a keyword's group label is one the brief actually wrote | `src/resume/keyword-group.ts:reconcileGroups` (pure, ADR 0044) — runs at persist time in `match.ts` between `annotateElsewhere` and the score; an unbacked label is dropped (an invented one would charge one weight for two requirements), and no brief means no groups at all |
| Why "React, Next.js, or Vue.js" costs one must-weight and not three | `src/resume/score.ts:foldGroups` (pure, ADR 0044) over the `group` label the brief put on each keyword — mirrored in `score.mjs`, parity fixture in `src/web/score.test.ts` |
| Why a red flag sometimes costs nothing | `src/resume/red-flags.ts:countableFlags` (pure) — a flag that names a keyword the resume does not have restates something the keyword pool already charged for, so it is dropped before the formula sees it. What still costs: location, work authorization, a minimum missed, an excluded seniority, an injection attempt. Measured cause: one such sentence, written in three runs of five, was 80% of a ten-point spread on one pair (`npm run variance:compare`) |
| Measuring how much the same pair moves between runs, and which part of the formula moved it | `npm run variance:compare -- <resumeId>:<jobId> [--runs N] [--rebuild] [--stored]` → `src/scripts/match-variance-once.ts` over the pure `src/resume/variance.ts`; `--rebuild` withholds the keyword frame (raw judgment), `--stored` re-reads the last N rows and spends nothing. Attribution holds one part at its modal value and reports the spread that survives |
| Why a file on the Tailor resume page scores lower than the same text saved in Resumes | TASKS R1: a one-off (the hidden scratch row) is judged on its own text — `matchResumeToJob(..., { evidence: 'text' })` loads no confirmed facts and no other resumes, and a letter from it checks claims against the resume and the posting only (`cover-letter.ts`). The launchers' **A file or pasted text here is my own resume** box (`pages/target-start.tsx:MineCheckbox`, field `mine` in `resume-source.ts`) or a file that reads exactly like a saved resume (`resume/duplicate.ts:sameTextAs` via `store.ts:findResumeWithText`) gets the owner's evidence; the marker rides in the `breakdown` and the card says "Judged on this file's text alone" |
| Why a skill another resume has counts half and does not lift the primary-stack cap | TASKS R2, score v5: `facts.ts:annotateElsewhere` points an `add` at the resume that backs it (a user-confirmed fact excepted), and `score.ts:entriesFromKeywords` / `score.mjs:entriesFromLive` keep its half credit but not its primary cover — the screener reads this resume. Writing the word in lifts it; the ceiling already counts it |
| Why an "add" primary does not cap the score | `SCORING.primaryCovered` in `src/resume/score.ts` — the cap asks whether the candidate HAS the core stack, and `add` means the resume's facts evidence it (sibling tech is forbidden from `add`, gotcha 11). Docking half the keyword credit is the penalty for an unwritten word; before this, one word-choice on a folded one-item primary stack was worth 49 points |
| The match-score formula (weights, alignment points, primary-stack cap) | `src/resume/score.ts` (ADR 0012) — mirrored in `src/web/public/score.mjs`, parity test `src/web/score.test.ts` |
| Quick check vs full analysis (which prompt variant runs, what a stored row holds) | `src/resume/match-mode.ts` (pure) + the `MATCH_STEPS` / `MATCH_OUTPUT` tables in `src/resume/prompts.ts` (ADR 0029) |
| "Get suggestions" on a quick check (the lazy second call) | `src/resume/suggestions.ts` + `buildSuggestionsPrompt`; run wiring `src/web/suggestions-run.ts`, route `POST /jobs/:id/matches/:matchId/suggestions` — `rewrite=1` on the same route is "Rewrite all", which lifts the already-has-them guard |
| Writing ONE suggestion again (the card's Rewrite) | `src/resume/rewrite.ts:rewriteAction` over `prompts.ts:buildRewritePrompt` / `RewriteSchema`; the target (section, where, quote/anchor) is the comparison's and is copied, not re-asked, and the new wording goes through `gateActions` exactly as the first one did. Route `POST /jobs/:id/matches/:matchId/actions/:index/rewrite`, writer `store.ts:updateMatchActions` (actions only — the score never moves) |
| Running the comparison over a matrix of real resumes × real postings, with every invariant checked | `npm run matrix:compare` (or `-- 2:2111 3:2108 …`) → `src/scripts/match-matrix-once.ts`; checks keyword shape, both anchors, evidence, group labels, the cap arithmetic, every quote the editor has to locate, the removal gate and the suggestion floor. Spends AI and writes rows — hand-run, never CI |
| Why a full report sometimes costs a second, cheaper call | `src/resume/suggestion-floor.ts:floorGaps` (pure) — REQUIRED COVERAGE checked instead of hoped for. When a grade below `strong` got no high-priority action (or a must-level term named only on a skills line got none, or a must-level `add` term sits in no rewrite — `unwrittenMusts`, prompt v15), and the candidate has part of the core and a ceiling worth chasing, `match.ts` spends one `suggestForMatch` with `floorDemand` naming what was owed. The verdicts are already stored, so the score cannot move |
| Why a German or Ukrainian posting carries a line about English | `src/text-language.ts` (pure: `textLanguage` counts each language's function words, Ukrainian and Russian told apart by the alphabet; `notEnglishNotice`) — shown on the job page's Resume match and Cover letter tabs and on the targeted view: the comparison and the letter are written for English (TASKS S20) |
| The same resume uploaded twice | `src/resume/duplicate.ts` (pure: `resumeTextKey`, `sameTextAs` — the text, not the bytes, which change with every save) → `POST /resumes` sends the user to the resume that already reads so, and `POST /resumes/:id/replace` makes no version from a file that reads like the one in place; neither pays for a scan (TASKS R16) |
| The five sentences under the score, the one move to make next, and why "send it" waits | `src/web/score-lines.ts` (pure, docs/score-lines-plan.md) — the lines that made the number (Requirements, Core stack, First glance, and since score v6 Shown at work — an older row keeps it among the rest) and the ones it does not count (To confirm), rendered by `ScoreBreakdownChips` on the job page. `mainAdvice` is the ladder over the SAME stored verdicts that returns ONE sentence — failed gate → core stack and its cap → unanswered gate → an unwritten must → a must named only on a skills line → a weak glance → the report's first high action — rendered by `MainAdviceLine` on `/jobs/:id/target` ONLY, where the five lines are not shown; null when nothing is open, because `readyToApply` speaks there instead. `readyToApply` gates "stop polishing, send it" on the open edits, the gates and any must-have named only on a skills line, not on the number alone |
| What a summary should say for this posting, and why a refused summary is written again | `src/resume/summary-guide.ts:summaryGuide` (pure, no AI): the brief's first reader and what they scan for, then the role, years, core stack, two must-haves, one number, 2–4 sentences, no "I" or filler, and the terms the resume cannot back (the other half of an "X and/or Y" it already meets) — on the summary itself and on the suggested one; rendered by `pages/summary-guide.tsx` at the head of the summary section on `/jobs/:id` and `/jobs/:id/target`. The model writes to the same list (`prompts.ts:RULE_SUMMARY_STYLE`, v16, `SUMMARY_FILLER` shared); a title or summary wording the gate refuses is written again once with the refusal in sight (`rewrite.ts:rewriteRefusedLeads`, `replacement-gate.ts:splitRefusal`). Research and sources: docs/resume-summary.md |
| What the posting IS, before how well the resume answers it (sector, product, first reader) | `src/resume/posting-orientation.ts:postingOrientation(brief)` (pure) — up to three rows off the stored brief (ADR 0044), rendered as the "about this posting" block on `/jobs/:id/target`. A field the brief left null renders no row, and nothing is inferred: what a sector "usually expects" would be our guess in the employer's voice |
| Why an empty suggestion list is not just "No edits suggested" | `src/web/no-edits.ts:noEditsLine` (pure) — the ceiling tells the three cases apart: nothing editing can reach (say what the gap is), plenty it could reach (the list is short for its own sake, offer Rewrite all), or already there |
| Why a re-run stops rewording the bullet you just took from it, and the churn number in the log | `src/resume/applied.ts` (pure): `appliedWording` = the last report's replacements the text now carries (located as the editor locates a quote), handed to the full analysis and the suggestions call as the fenced APPLIED FROM THE LAST RUN block (prompt v13); `rewritesOfApplied` = the new report's actions that quote one of them, and `freshActions` drops such a rework unless it names a keyword the text lacks (the prompt rule alone halved the count and no more) — `applied` / `rewritesOfApplied` / `reworksDropped` on the `resume: matched` log line. `npm run churn:compare -- <resumeId>:<jobId>` runs the loop (analyse → apply everything → analyse) and prints both; spends AI, deletes its draft rows unless `--keep` |
| Whether the posting's sector is one the resume shows, and what that changes | `src/resume/domain.ts` (pure, ADR 0046): `domainMismatch(resume.industries, brief)` → `match` / `different` / `unknown` (an agency or consultancy serves every sector; unknown says nothing), `domainNotice` = the sentence on `/jobs/:id/target`, the CANDIDATE'S DOMAINS block in both prompts (v14); `domainLean` is the measurement `variance:compare` prints — asking the model for the lean moved nothing, so there is no rule for it. `Resume.industries` comes from the scan; `node dist/scripts/rescan-resumes.js [--only id]` fills older resumes |
| Running the whole compare pipeline against a real stored row (brief, frame, every action's wording, every removal's quote) | `npm run verify:compare -- <jobId> <resumeId> [fast\|full]` → `src/scripts/verify-brief-once.ts`; spends AI and writes rows, so it is a hand-run check, never CI |
| Comparing models / modes on the gold fixtures | `npm run bench:resume -- --model <id> --mode fast\|full --out f.json`, then `--table a.json b.json` (pure renderer `src/resume/bench-report.ts`) |
| What counts as primary stack / sibling-tech rules (prompt side) | `src/resume/prompts.ts:MATCH_SYSTEM` steps 3-4 — guard-tested in `prompts.test.ts` |
| ask_user confirmations (CandidateFact rows, instant re-score) | `src/resume/facts.ts` (pure) + `src/web/routes/facts.ts` (POST /facts), managed on `/resumes`. Three answers (`FACT_ANSWERS`): confirmed → `add`, denied → `cannot_claim` with `DENIED_NOTE`, not sure → `cannot_claim` with `UNSURE_NOTE` — the question stops, nothing is claimed, and the prompts never hear a "no" (they read confirmed and denied only); `keyword-overrides.ts:confirmable` skips both notes |
| Which release this is, and the optional "a newer one is out" | `src/app-version.ts:APP_VERSION` (package.json, read once) → the sidebar line in `web/layout.tsx`; `AppSettings.updateCheck` (off by default) → `src/update-check.ts:checkForUpdate` (one GitHub request, weekly in `cleanup-job.ts` and once when turned on) → `latestVersion` → `web/update-notice.ts` (an hour's cache) → the sidebar link and Settings → General → Updates; `src/versions.ts:isNewer` (pure) compares |
| Per-keyword overrides (re-level / ignore / add your own term) | `src/resume/keyword-overrides.ts` (pure): `effectiveKeywords` feeds the score, `carryOverrides` re-applies them to the next reply; route `src/web/routes/keywords.ts` |
| Whether a run inherits the posting's keyword frame (rebuild, prompt bump) | `src/resume/keyword-frame.ts:planKeywordFrame` (pure, issue #79) — the reason is stored in the `breakdown` JSON and read back by `freshFrame` |
| Keyword display order + mark intensity (weight, then posting frequency) | `src/web/public/target.mjs:keywordRank` / `orderKeywords` — one implementation for the panes, the chips and the server-rendered table |
| Anti-hallucination gate for generated prose (pass/warn/block) | `src/resume/fact-check.ts:factCheck` (pure, ADR 0020) — sources arrive as arguments, `store.ts` loads them |
| Cover letter generation (gated, stored-inputs-only) | `src/resume/cover-letter.ts` + `COVER_SYSTEM` in `prompts.ts` (ADR 0021); card `src/web/pages/cover-letter-card.tsx` |
| Letter → .pdf / .docx bytes | `src/resume/pdf-write.ts`, `docx-write.ts` (over `zip-write.ts`) — all pure, no dependencies |
| Fetch one posting page by URL (user-requested, not a crawler) | `src/jobs/posting-url.ts` — ADR 0005 blocklist + private-host SSRF guard; bot checks fail honestly; an Ashby job page (drawn in the browser, no text in the HTML) is read from the board API instead — by id, or by the posting's title on a board root (`parseAshbyUrl` / `pickAshbyJob`, pure) |
| "In another resume" evidence hints | `src/resume/store.ts:listOtherResumeSkills` → `facts.ts:annotateElsewhere` |
| ATS parse warnings ("What the ATS sees") | `src/resume/parse-warnings.ts`, rendered on `/resumes/:id`; the parsed view above them (name, contacts, sections, roles with dates) is `src/web/parsed-view.ts:parsedView` over `structure-from-text.ts`, drawn by `pages/parsed-view-block.tsx` (TASKS R12) |
| The same resume as another file (the PDF of a .docx), read beside the saved one | `src/web/format-compare.ts:compareFormats` (pure: the parsed view and the warnings of each, the verdict — email and phone, dated roles, roles, sections, link and location, warnings, the first that differs decides — and the lines only one file carries, moved or read differently, diffed from `resume/line-diff.ts` with our own readers' heading and bullet marks, blank lines and case set aside) → `POST /resumes/:id/compare-format` → `pages/format-compare.tsx`; rendered from the upload, never stored, no AI (TASKS R14) |
| Resume strength review (job-agnostic rubric) | `src/resume/review.ts` (the call) + `REVIEW_SYSTEM` in `prompts.ts`; card `src/web/pages/resume-review-card.tsx`, route `POST /resumes/:id/review` (ADR 0030). Each example bullet passes `src/resume/review-gate.ts:gateReviewAdvice` (pure, TASKS R3): `factCheck` against the resume and the candidate's answers, and a blocked one loses its example and asks about the claim instead |
| Why a present keyword says "as Postgres" | `src/resume/keyword-anchor.ts:annotateAliasOnly` (pure, TASKS R4): the text has the term only under an alias, and an ATS searches the posting's own spelling; stamped in `match.ts` after `anchorStatuses`, the badge in `pages/resume-match-card.tsx:KeywordTable` |
| The strength formula (six dimensions, weights, the duties-only cap) | `src/resume/review-score.ts` (pure) — the model grades, the code scores, exactly as ADR 0012 does for the match |
| Version delta (gained/lost keywords, component moves) | `src/resume/diff.ts:diffMatches`, rendered in `resume-match-card.tsx` |
| Live smoke bench of the match prompt (6 gold fixtures) | `npm run bench:resume` — `src/scripts/resume-bench-once.ts`; the hedged-stack fixture ("React or Vue.js, either is fine", TASKS R5) reads the brief first, as the product does, and every score goes through `reconcileGroups` as `match.ts` does |
| Compare-run progress pages (async classify/scan/match) | `src/web/target-runs.ts` (in-memory registry) + `src/web/pages/target-run.tsx`; started by `/target`, and by `src/web/comparison-run.ts` — `startComparison` (memo answered by a redirect, then a run) is the path `/jobs/:id/match`, `/jobs/:id/target/reupload` and `/target`'s "One of your jobs" go through; `runComparison` is the same comparison inside a run the caller already claimed (a pasted posting), with the memo answered on the progress page. Compare, "Analyse my resume again", a fresh file, a file against a stored job and a pasted posting behave identically |
| Why a one-off comparison keeps the name of its file, and why its re-run judges that file | `ResumeMatch.resumeName` (stored by `match.ts` from the request) → `src/resume/match-name.ts` (pure): `comparedResumeName` (a real resume shows its live name, the scratch row the snapshot, an older row "An earlier one-off file"), `previousFor` (a one-off's delta pairs only with the same file), `earlierLabel` ("vs the last check of this file" instead of the scratch row's upload counter), `oneOffDraft` (a re-run is a draft only if the base was one or the text changed; a fresh file on the scratch row never is). Applied in `store.ts:listMatchesForJob`. `POST /jobs/:id/match` takes `matchId` from the editor and Rebuild keywords: on the scratch row that comparison's text and name are judged, not whatever the row holds now |
| Which resume a job page preselects | `src/web/routes/jobs.tsx` picks the linked resume (the best-scoring search's, else the primary's) and `src/resume/pick.ts:preselectResume` takes it, or falls back to `pickResumeForJob` (skill-tag overlap); the option's wording (file kind, version, why) is `src/web/resume-label.ts` |
| Creating a search profile from a resume (both entry points) | `src/web/profile-from-resume.ts` → `POST /resumes/:id/profile` and `POST /welcome/profile/create`; born inactive |
| Prefill the profile from a resume scan | `src/resume/profile-draft.ts:buildProfileDraft` (pure) + `POST /settings/profiles/:id/fill-from-resume` (renders a draft, saves nothing — ADR 0015) |
| Model for cover letters (empty = the engine's own letter default, Opus 5 on both Claude engines; it never follows the resume slot) | `/settings` → AI engine → "Cover letter model" (role `cover` in `ai-engine.ts`; pickers save on change) |
| Model for resume calls, and for cover letters | per-engine "Resume model" / "Cover letter model" on `/settings` → AI engine; an empty slot takes `ai-engine.ts:defaultModelFor` — Sonnet 5 on the Claude CLI, Haiku 4.5 on the API, Opus 5 for the letter (measured 2026-09-05, docs/target-plan.md §2.3); `CLAUDE_MODEL_RESUME` / `CLAUDE_MODEL_COVER` in `.env` override. The budgets per call are `resume/prompts.ts:RESUME_TIMEOUT_MS`, the run page's band per lane `web/lane.ts` |
| Ghost-job checklist prompt + verdict schema | `src/verification/prompts.ts` |
| Replacing a truncated description with the company's own listing (the verifier's `postingUrl`, the diff, the kept original, what gets re-judged) | `src/jobs/description-diff.ts` (pure: `planRefresh`, `foldOps`, the flashes) · `src/jobs/description-refresh.ts` (the swap + `classifyExistingJob`, status kept) · `pages/description-refresh.tsx` · routes `POST /jobs/:id/description/refresh` → `/description` → `/description/restore`; the keyword frame reads `Job.descriptionRefreshedAt` through `keyword-frame.ts:planKeywordFrame` (`posting-changed`) and so does the memo (ADR 0043) |
| What the resume side reads out of "Is this job real?" (the snapshot as context, the hint line, the letter's greeting) | `store.ts:getLatestVerificationContext` → `prompts.ts:companyContextLines` (full analysis + suggestions only, ADR 0042) · `src/resume/verification-hint.ts` (the line on the match card) · `src/resume/addressee.ts` (the Addressed-to prefill) |
| Liveness ladder (free ATS-API + page checks before AI verify) | `src/verification/liveness.ts` (ADR 0016), run by `verify.ts:checkLiveness` |
| Letting a call use web search (API server tools / CLI WebSearch) | `AiRequest.webTools` in `src/ai-provider.ts`, args in `ai-provider-parse.ts:buildClaudeCodeArgs` |
| Classify one stored job (Re-classify button, pasted jobs) | `src/jobs/classify-existing.ts` |
| Live keyword score + highlights in the browser | `src/web/public/target.mjs` (served at `/static/`, tested from `src/web/target.test.ts`) |
| The wording a suggestion proposes, pulled out of its `what` sentence | `src/resume/change-sheet.ts:proposalOf` (pure) — reads `'…'` and `"…"`, guards the apostrophe, takes the span after a `to`/`with` connective, refuses a run under 12 chars; `suggestionSheet` renders the whole list as the Markdown behind "Copy all suggestions" |
| What the user changed in the editor, as Markdown ("Copy my changes") | `src/web/public/line-diff.mjs:diffLines` (LCS over normalised lines; a delete/insert pair becomes a `change` only when 30 % of the wording survives) + `public/change-sheet.mjs:formatEditSheet` |
| Whether a suggestion's wording may be applied with one press, and why a card says "not applied — …" | `src/resume/replacement-gate.ts:gateActions` (pure, ADR 0037): runs at persist time in `match.ts`, `suggestions.ts` and `rewrite.ts` over the model's `replacement` — `factCheck` with resume + posting + confirmed facts as sources, a replacement may not introduce a `cannot_claim` keyword (one exemption: the posted job title on a `title` or `summary` action, ADR 0044), KEEP WANTED KEYWORDS blocks on a lost must/primary and warns otherwise; a block nulls `replacement` and writes the reason onto `why`. `change-sheet.ts:proposalOf` reads an explicit `null` as "judged" and never falls back to parsing `what` for it |
| Why a removal is shown without a struck-through span | `src/resume/replacement-gate.ts:gateRemovals` (pure, ADR 0044), called in `match.ts` and `suggestions.ts`: a `quote` covering contact details or a keyword marked present/add loses the quote and keeps the advice — gotcha 11's prompt rule as a code path |
| The paste-ready wording itself, and where an addition goes | `MatchSchema` actions `replacement` / `insert_after` (`judgedText`: absent = v6 row, null = judged), asked for by `RULE_ACTIONS` (v7) and rendered by `OUTPUT_ACTIONS`; one `RULE_BULLET_STYLE` governs match suggestions and the review's "example" line; `text-edits.mjs:insertAfterLine` applies an addition after its anchor |
| Applying a suggestion to the resume text (replace / cut / add a term) | `src/web/public/text-edits.mjs` (pure): `applyReplacement` (keeps a bullet marker), `removeSpan` (whole line + its newline when the quote IS the line; refuses the email/phone line — gotcha 11), `insertIntoSkills` (only inside a skills section, only onto a line that is a term list, never the contact line), `inverseEdit` / `undoEdit` (Undo stores the changed sentence, not a copy of the resume) |
| What each suggestion card did, and how it survives a reload | `target-edits:<matchId>` in localStorage = `{ applied: { <card key>: inverse edit }, skipped: [key] }`; the key is `hashShortId(section\|where\|quote)` rendered into `data-card`; painted by `target-page.mjs:paintCards`, thrown away with the draft by "reset edits" / Discard |
| Copy-to-clipboard anywhere in the dashboard | `src/web/public/copy.mjs:wireCopy` — delegates `[data-copy]` (literal text) and `[data-copy-target]` (an element's value), falls back to `execCommand`, announces in one `aria-live` region it creates itself |
| The targeted-resume page (editor, tabs, score ring) | `src/web/pages/target.tsx` (`public/target-page.mjs` wires the DOM) |
| Employer mode — the switch, the menu item, the redirect when off | `AppSettings.employerMode` → `src/web/employer-mode.ts` (`isEmployerMode` for the sidebar, `requireEmployerMode` on every `/screen` route); toggle on `/settings` → Screening (ADR 0049) |
| What a screening checks — the criteria the person chose (kind, gate / scored / note, stars, a text grammar per kind, presets, the refusal of protected characteristics) and where the draft comes from | `src/screening/rubric.ts` (pure, ADR 0050): `draftRubric(brief, previous)` reads the posting brief (ADR 0044) and keeps the person's own rows, `applyPreset`, `parseCriterionText` / `criterionText` are the editor's grammar, `rubricFromForm` reads the table, `protectedCharacteristic` refuses; a changed rubric bumps `Screening.rubricVersion` and every verdict reads as stale; a v1 rubric converts on read |
| What is removed from an applicant's resume before a model reads it, and the leak check | `src/screening/redact.ts:redactApplicant` / `findLeaks` (pure, ADR 0048) — name and its parts, contacts, links, date of birth, age, family, gender, citizenship, religion and health (as personal-data fields only — TASKS E5), street, graduation years; the city stays |
| The screening prompt, one answer per criterion, the reply shape | `src/screening/prompts.ts:buildScreenPrompt` / `ScreenReplySchema` (prompt v5, `SCREEN_PROMPT_VERSION`; v5 picks a role's sector from `sectors.ts`): `answerShape(criterion)` says whether a criterion is answered as a rung (`EVIDENCE_RUNGS`: absent · listed · project · role · production), a status (pass / partial / unknown / fail), a level, an impact grade, the overall read, or read off the roles; `standout` is up to `MAX_STANDOUT` facts no criterion asked for, each with its line; in the fence registry |
| What stands out beyond the criteria, and why a fact is missing | `ScreenReply.standout` — written by the model, kept by `anchor.ts` only with a located quote (`standoutDropped` on the log line), never scored; the scorecard's "Stands out" card, the row's expandable line on `/screen/:id`, the "Stands out" column of the CSV. A verdict from prompt v2 has none until the next Score |
| Two to five ticked applicants side by side, and the shortlist read head to head by the model | `src/web/screen-compare.ts:sideBySide` (pure: the stored scorecards as columns, one row per criterion) → `GET /screen/:id/compare?ids=`; **Compare with AI** = `src/screening/compare.ts:compareApplicants` over `prompts.ts:buildComparePrompt` (ADR 0051): two calls at once, the second with the resumes reversed (`comparison.ts:secondOrder`), each reply anchored so a quote stays only in the resume it came from (`anchorCompareReply`), both stored as one `ScreeningComparison`; `comparisonView` marks where the readings differ, `comparisonMarkdown` is the Copy button. A ceiling of `MAX_COMPARE` (5); never a score |
| Whether the criteria rank the way the person does — their decisions against the table's order | `src/screening/calibration.ts:calibrate` (pure, ADR 0052) over `web/screen-view.ts:calibrationRows`: concordant / discordant pairs (with the ones the ±30 adjustments turned), the person's top k, the surprises with the criteria behind them, per-criterion gaps interviewed − declined; `calibrationLine` is the sentence on card 5 of `/screen/:id` and in the Markdown. Never re-weights; `MIN_DECISIONS` = 3 with both sides present |
| The gold set: a ranked folder through the screening's own path, τ / precision@5 / stability / leaks / gate confusion | `npm run bench:screen [-- --set <name> --runs 2 --compare --out f.json]` → `src/scripts/screen-bench-once.ts` over the pure `src/screening/bench.ts` (`kendallTau`, `precisionAtK`, `stability`, `gateConfusion`, `parseRanking`); `--compare` reads the first run's top three head to head twice and prints `comparison.ts:readingsAgreement` (TASKS E10 — the same line every real comparison logs); sets live in `src/screening/fixtures/gold/<set>/` (README there: a `.tailored.` file makes the tailoring pair, `expected.json` the gate line); spends AI, writes nothing, hand-run |
| The career as the dated roles give it — years in total, employers, average stay, in a role now, sectors in order | `src/screening/trajectory.ts:trajectoryOf` / `trajectoryLine` (pure, plan §5), computed on read from `reply.roles` — never stored, never a point (ADR 0047: a gap or an employer count is never a criterion); under the roles on the scorecard, the Years cell's tooltip, the "Career" export column |
| Why "banking" counts for a "payments / fintech" criterion, and why three runs name one career the same way | `src/screening/sectors.ts` (pure, TASKS E6, issue #217): `SECTORS`, groups of names for ONE sector (payments and banking are fintech, never a neighbour); `sectorMatches` (the industry criterion in `score.ts`: a known item by meaning, an unknown one by a shared word with the generic ones set aside) and `sectorLabels` (the career line). Prompt v5 asks for the closest label; `node dist/scripts/rescore-screenings.js --write` applies the vocabulary to stored verdicts without a call |
| A cover letter in an upload | `src/screening/intake.ts:coverLetterSignal` (`name`: the file name says so; `text`: a salutation and a valediction and no resume heading at all; two resume headings make any file a resume) and `letterOwners` (the only resume in its folder, else the same email or phone — this upload's, then the stored ones — else the same file-name stem), both pure (TASKS E3, Q9); stored in `applicant_letter` beside its applicant (`store.ts:createLetters`, an exact repeat skipped), never scored, never sent to a model, gone with the applicant; the scorecard's "Cover letter" card and `GET /screen/:id/applicants/:aid/letters/:lid/file`, "+ cover letter" on the table row. A letter by its name that nobody's resume came with is left out, and the flash says so; one only its words call a letter is added as a resume instead — a lost applicant costs more than a scored letter |
| Why an answer on a scorecard is lower than the model wrote | `src/screening/anchor.ts:anchorScreenReply` (pure): every quote must be a span of the redacted text; an unquoted rung falls to `textEvidence` (and rises when the text shows a work sentence); a quote that is a LIST of terms supports at most `listed`, or `role` on a job's own "Technology Stack:" line (`listCap` — gotcha 18); a term the text never spells is `absent` whatever the model quoted; an unquoted pass / partial / fail is unknown, an unquoted strong impact is ok, unanchored roles are dropped, an answer for an unknown id is dropped, a skipped skill is read off the text. `node dist/scripts/rescore-screenings.js [--write]` re-applies the rules to stored verdicts without a call |
| Why a .docx skills table no longer counts as work done | `src/resume/evidence.ts:segmentAt` — the .docx reader flattens a table row to one line (label cell ` \| ` values cell), so a term is judged inside its own cell; `isTermList` tolerates a few glued pairs on a long list and refuses grammar. Both sides read it: the candidate's evidence grade and the screening anchor |
| The employer score, its caps, the bucket, the confidence | `src/screening/score.ts:scoreScreening` (pure, ADR 0050) — one `ScoreRow` per criterion (credit × stars), gates bucket, caps 30 / 50 / 60 (`coreNone` / `twoLevelsUnder` / `impactWeak`), years / industry years / company type from the dated roles, `levelCredit` by tolerance, unknown leaves the denominator; `orderVerdicts` is the table's order |
| Dates as resumes write them → years covered, months since | `src/screening/dates.ts` (pure): five languages of month names and "present" words; overlaps merged |
| Bulk intake: zip, a folder with subfolders, what repeats, the caps | `src/screening/intake.ts` (pure) over `resume/zip.ts:readZipEntries`; `findDuplicate` tells `same-text` (a repeat of a file — never added) from `same-person` (same email, phone or SimHash within `MAX_HAMMING_DISTANCE` — scored, labelled "also №N", `Applicant.sameAsId`); non-resume types in a folder are `notResumes`, not rows; the folder path rides on the file name (`public/screen.mjs:pathedFiles`). The route reads every file first, `planIntake` decides the whole upload (a later file is compared with the earlier ones of the same upload too), and `store.ts:createApplicants` writes it in ONE transaction — the screening locked once, numbers in upload order, a text another upload stored meanwhile skipped (TASKS H23/H25) |
| Why an applicant says "Held for a look" | TASKS E4 (Q6): the leak check (`redact.ts:findLeaks`) found something identifying after redaction, so the row is stored `parseStatus = 'held'` with the kinds only in its note (`leakKinds` / `heldNote`, never the value) — no model reads it: every queue reads `parseStatus = 'ok'`. The scorecard's **Score it anyway** (`POST /screen/:id/applicants/:aid/release` → `store.ts:releaseApplicant`, a `held` row only) queues it as it reads; the table groups it apart and the exports list it with its note |
| The batch: one call per applicant, resumable, a live queue | `src/screening/batch.ts:startScreeningRun` — `AI_CONCURRENCY` workers pull from one queue that `listPending` refills (an upload starts it, a second upload lengthens it, `{ again: ids }` joins at the back even mid-run); every verdict is written as it arrives; the in-memory state is what the page shows — `queued` / `inFlight` / `finished` applicant numbers, painted per row by `public/screen.mjs:rowRunState` off `GET /screen/:id/state` |
| The person's correction to a computed score, and why the table orders by it | `Applicant.scoreAdjustment` + `adjustmentNote` (±`export.ts:MAX_ADJUSTMENT`, a reason required) → `web/screen-view.ts:adjustedScore`; the computed score stays on the row's tooltip, the scorecard header and both exports (ADR 0047 addendum) |
| Ticked rows → one action (decision, score again, delete) | `POST /screen/:id/applicants/bulk` (`ids[]` + `do`), the header checkbox and the count in `public/screen.mjs:wireSelection`; per-row decision selects post through their own hidden forms via the `form` attribute, so they never ride inside the bulk form |
| CSV / Markdown of a screening | `src/screening/export.ts` (pure) over `src/web/screen-view.ts:exportRows` |
| CSV / Markdown of the applications board | `src/web/applications-export.ts` (pure: `applicationsCsv`, `applicationsMarkdown`, `dayIn` — dates are days in the dashboard's zone) over `routes/applications.tsx:loadBoard`, the same loader the board renders from; `GET /applications/export.csv` / `.md` |
| A CSV any export writes (BOM, CRLF, a cell that opens like a formula made text) | `src/csv.ts` (pure: `csvCell`, `csvTable`) |
| Retention of applicant data | `Screening.retainUntil` from `AppSettings.screeningRetentionDays`; deleted by `jobs/cleanup-job.ts`; "Delete screening" / "Keep N more days" on `/screen/:id` |
| The posting a screening reads (a snapshot, editable, never the Job's live text) | `Screening.postingText` + `postingUpdatedAt`; `store.ts:postingOf` is what the brief and every call read; `POST /screen/:id/posting` saves, `POST /screen/:id/run-all` scores everyone again; `web/screen-view.ts:scoredBeforePosting` counts the verdicts older than the edit |
| The notice an employer owes applicants, and the legal note | `src/screening/notice.ts` — shown with a Copy button on `/settings` → Screening |
| Each cron's once-script (manual trigger) | `src/scripts/{fetch,digest,cleanup,stale,hn,discovery}-once.ts` |

When the question is **"how does the user toggle / configure X?"**:

| What | Page |
| --- | --- |
| Pause / resume all new-job fetching | `/settings` General tab → "Job fetching" |
| Be told when a newer ApplyPack is out | `/settings` General tab → **Updates** → Check weekly (off by default: it is one request a week to GitHub); the sidebar then says "vX.Y.Z is out". The version you run is always in the sidebar |
| Answer "do you have X?" with "I don't know" | the comparison's confirm card → **Not sure**: the question stops coming back and nothing is claimed; `/resumes` → Confirmed facts lists it as "Not sure", with "I do have it" for later |
| Choose when the search runs and when alerts arrive | `/settings` General tab → "Schedule": time zone, cadence + hours + day pills for the search, and Right away / Only during these hours / As one digest for alerts. The **Alert window** (its hours and days) shows only under "Only during these hours". **Scheduled messages** is its own block: the hours the daily recap goes out — and, under "As one digest", the matches — with the stale-application reminder once a day at the first of them, every day, whatever the window says. Empty schedule = every hour, around the clock, one message per match — today's behaviour. "Fetch now" ignores all of it |
| See how many jobs match over time, and what the matches ask for | Overview → **Jobs matching your searches**: 7D / 30D / 90D / 180D, hover a point for its day; **All stack** narrows the chart to one technology (7D and 30D — a dismissed job is kept 30 days), and so does a bar of **Jobs by stack**. Under the chart: the search funnel for the same range |
| Walk through first-run setup again (AI → test search, the aggregators alone → profile → boards for your countries → first matches) | `/welcome` — `/` redirects there while `AppSettings.setupCompletedAt` is NULL; "Skip setup" or "Start the hourly watch" ends it; Overview shows "Finish setup →" while a step is open |
| Pull jobs right now instead of waiting for the hourly tick | Overview header or `/runs` → "Fetch now" (progress page; while paused the jobs land unscored — score them later with Save & re-classify) |
| See why the search finds little, and which source brings the matches | `/runs` → **Search funnel** (7 and 30 days; the filter's and the scoring's reasons; **By source, last 30 days**); its four stages for the chart's range stand under the Overview's chart, "Where the rest went →" |
| See which keywords the compared postings keep asking for | `/resumes/:id` → **Missing across postings** (from five compared postings on; no AI) |
| Stop seeing a company | `/jobs/:id` → the rail's **Mute …** (a reason is optional), or `/companies` → **Muted companies** → type the name. Its new postings are turned away before any AI, from every source; `/jobs` hides the stored ones ("N hidden · Show them", or **Filters** → Show → Muted companies). Unmute on either page undoes both; statuses never change (ADR 0056) |
| Rest a company you applied to | `/settings` General tab → Application tracking → **Re-apply window** (Off / 30 / 60 / 90 / 180 days): new postings at a company you marked Applied inside it are turned away before any AI. Off by default |
| See which boards stopped answering | `/companies` → "Quiet sources" card (Re-probe to repair) |
| Telegram line when a source goes quiet | `/settings` Notifications tab → "Source health alerts" |
| Pick / order AI engines + models, test them | `/settings` AI engine tab (per-engine cards: Enable, ↑ priority, model selects, Test; each card says whether it is billed per token, covered by your plan or local) |
| Give an engine only some tasks (a local model scores, a stronger one writes) | `/settings` AI engine tab → the engine's card → **Tasks it takes**: untick what it should not do; it is then neither asked first nor used as a fallback for that task. The table at the top of the tab shows who answers each task and who stands behind. Put the narrowed engine above the general one |
| See which model did what, how long it took and what it cost — billed apart from plan-covered — and what could be changed | menu → **AI usage** (`/ai`): last 7 days / this month / last month / this year (UTC days), the calls by model with their typical time, **Worth a look** above them, who answers each task now. The **Monthly budget** for billed calls (a warning at 80 % and 100 %, nothing stopped) is on `/settings` AI engine tab; `/jobs/:id` → Details → "AI spent"; the estimate under Compare, Verify and Generate letter; `npm run spend:report` for the vendor comparison (docs/ai-engines.md) |
| Use a model on this computer (Ollama, LM Studio) | `/welcome` step 1 → "A model on this computer" → pick a model → **Use it** (found at the default addresses; Ollama goes in the **Local model (Ollama)** engine, LM Studio in the OpenAI-compatible one; the engine goes first with that model in every slot), or `/settings` → AI engine → the engine's address + the model fields (and, for Ollama, the **Context window**); **Test** lists what the server runs. No key. LM Studio's context and `AI_CONCURRENCY`: docs/ai-engines.md |
| Paste an AI key without touching `.env` | `/settings` AI engine tab → the key row on each engine card, or step 1 of `/welcome` (ADR 0027) |
| Add / remove tracked company | `/companies` → **Add sources** → **Add one company** (probed before save); Delete sits on the company's row. The table is the first thing on the page |
| Watch specific companies (paste a list of career-page URLs) | `/companies` → **Add sources** → "Watch specific companies": one URL per line (optionally `Name — URL`), Resolve these → a progress page → a preview showing what each URL resolved to → pick the interval and the alert policy for the batch → Add. Watched rows go in switched ON |
| Watch a company whose careers page draws its jobs in the browser (a loading shell) | paste it like any other; the preview says "Needs a browser" and adds it to the watchlist unchecked (`BROWSER_PAGE`, never active). Open the page, select all, copy, and paste it into the row's box under **Pages drawn in the browser**: the flash and the box say what is new since the last paste and which lines look like roles your searches want. No AI; nothing is stored as a job (ADR 0036 addendum 2026-09-28) |
| Watch a company whose careers page publishes no board and no feed | paste it like any other; the preview says "Change watch". The row says *Page changes* and *watching* instead of a posting count, costs no AI, and alerts at most once a day with the link |
| Change how often a watched company is checked, or what it alerts about | `/companies` → "Watchlist" → the row's two selects (Every hour / Once a day / Once a week; Every posting / Matches only). "Check now" reads that company now, on the Fetch now progress page (`web/fetch-now.ts` with a company scope; while another fetch runs it makes the row due on the next tick instead); "Unwatch" keeps the company and drops the star |
| See only postings from watched companies | `/jobs` → **Filters** → Show → "★ Watched"; ★ also sits before the company name on the list and the job page |
| Bulk-add a curated segment of companies | `/companies` → **Add sources** → "Add a starter pack" (preview → confirm → added disabled → "Enable all") |
| Turn on a source that needs your own vendor account (and read whether you need it) | `/settings` → Sources → "Extra sources — a free account of your own": what each adds, when it is worth it, what the vendor asks, where to register. Until both fields are saved the source is hidden everywhere (`source-keys.ts:sourceUnlocked`, ADR 0034 rule 4) |
| Use Adzuna (free key) for a country a search names | register at developer.adzuna.com, paste app_id + app_key on `/settings` → Sources → "Extra sources — a free account of your own", then `/companies` → "Sources for your searches" → Add (off) the market row → Enable; polled four times a day, ten markets at most (ADR 0034) |
| Use France Travail (free client id) for a search that names France | create an app on francetravail.io, paste the client id + secret on `/settings` → Sources → "Extra sources — a free account of your own", then `/companies` → "Sources for your searches" → Add (off) the `codeROME=M1805` row → Enable. The licence's daily re-check runs whatever you switch off — pause, no search, row disabled — and offers it cannot verify for two days are removed (ADR 0034 rule 5) |
| Get the DOU / Djinni / Arbeitnow feeds a search's countries call for | `/companies` → **Add sources** → "Sources for your searches" — the button carries how many are waiting (shown when a running search names UA, DE, AT, CH or GB; Add (off) probes first, then the row's toggle enables it). The same card lists the starter packs that fit the searches (`web/pack-offers.ts`, shared with the wizard) with one **Preview these packs** |
| Disable whole ATS family (e.g. all Workable) | `/settings` Sources tab |
| Enable two-stage classifier (cheaper, less precise) | `/settings` AI engine tab → "Classifier" |
| Edit profile (stack, role types, regions, fit threshold) | `/settings` Searches tab (excludes, notes, priority rules, thresholds live in its "Advanced" block) |
| Say where you live and whether you would relocate | `/settings` Searches tab → "Location" → "I live in" + the three relocation choices (ADR 0033); both stay empty-ish by default, and then nothing changes |
| Say where a search hunts (countries, groups, remote / hybrid / on-site) | `/settings` Searches tab → "Location": arrangement pills, the Countries chip input (type "Poland", "Polska", "PL" or a city, pick from the list; any spelling works without JS), region pills (🇪🇺 European Union, Europe, DACH, 🌍 Worldwide …). Empty countries + regions = anywhere |
| Fill the profile from a resume (AI draft, review before save) | `/settings` Searches tab → "Fill from a resume" |
| Create a second search from another resume | `/resumes/:id` → "Search profile" card, or `/welcome?step=profile` → "Another resume for a different kind of role?" |
| Which resume a search hunts with | `/settings` Searches tab → "Resume for this search" (empty = pick by skill overlap) |
| Run / pause a search, or make one primary | `/settings` Searches tab → "Searches" list (up to 8 running; the primary always runs) |
| See only one search's matches | `/jobs` → **Filters** → Search (the row appears with more than one running search; the Fit column then shows that search's score) |
| See only roles you could actually take from where you live | `/jobs` → **Filters** → Show → "Open to me" (reads each search's own location verdict; set "I live in" on `/settings` → Searches → Location first) |
| See jobs in one country, region or arrangement, or posted this week | `/jobs` → **Filters** → the "Where" options (🇵🇱 Poland, 🇪🇺 European Union, Unknown … — OR within the row, "More…" opens the rest), "Work" (Remote / Hybrid / On-site / Unknown) and "Posted"; the button shows how many are set, each one in force sits above the table with a ✕, and "Clear all" lifts them; the search box also matches the location string |
| See how many jobs sit in each status under the filters in force | `/jobs` → the status tabs (All / New / Alerted / Applied / Saved / Dismissed) — a tab's number is what it would show |
| Fill the country columns on jobs stored before v1.24 | `docker compose exec app node dist/scripts/backfill-locations.js --dry-run`, read the distribution, then without the flag (no AI call; `location` and `description` untouched) |
| What each search made of one posting | `/jobs/:id` (the **Posting** tab) → Classifier → "By search" |
| Re-classify all jobs against new profile | `/settings` Searches tab → "Save & re-classify" in the editor (async, watch /runs) |
| Alerts on/off (every channel) | `/settings` Notifications tab → "Alerts" — off holds new matches and page-change notices; they arrive in one message per chat when it is back on |
| Add a Telegram bot + chat, or a Discord webhook | `/settings` Notifications tab → "Add a Telegram target" (getMe + a test message) / "Add a Discord webhook" (a test post; only Discord's own hosts) — the row says which channel, its secret masked |
| Take the applications board into a spreadsheet | `/applications` → **CSV** or **Markdown** in the header: every application with its column, company, dates, fit, the resume it went out with, the recruiter, the notes and the link |
| Pipeline stage on a job | `/jobs/:id` → "Application tracking" in the rail (it rides on every tab); on `/applications` drag the card between columns (`public/board.mjs`) or use its quick-move select — both hit the stage-only endpoint that never touches appliedAt/notes |
| Add / rename / reorder board columns | `/settings` General tab → "Board columns" (ADR 0025: Applied + Rejected/Ghosted fixed, delete needs an empty column; keys never change, labels do) |
| Review newly discovered companies | `/discovery` (sorted by jobsSeen DESC) |
| Toggle auto-discovery / HN parser | `/discovery` (card at the top; moved off `/settings` 2026-08-29). The HN thread is also a pill on Settings → Sources; off in either place stops the monthly pull and the hourly read (`settings.ts:pausedFamilies`) |
| Upload / scan a resume | `/resumes` → **Upload a resume** (a disclosure above the table; it stands open while there is no resume yet). The Resumes section on Settings only lists + links |
| Record a skill no comparison asked about | `/resumes` → Confirmed facts → **Add a fact** (what you have is listed first; "I don't, actually" / "I do have it" flips one, "Forget" drops it; no AI call) |
| Read what a setting does beyond its one sentence | the quiet **How this works** under it (a native `<details>`); on Settings → Sources each extra source folds "when it is worth it, and what the vendor asks" the same way |
| Ask how strong a resume is on its own (no posting) | `/resumes/:id` → "Resume strength" → Run strength review (one AI call, ~1 min; nothing runs on its own). Scores show in the `/resumes` Strength column |
| Compare a resume with a posting | `/jobs/:id` → **Resume match** tab → **Compare**: one full report (keywords, gates, score and the edit suggestions). The quick check of ADR 0029 is no longer a button |
| Get the edit suggestions for an older quick check | the comparison → "Get suggestions" (second call, reuses the stored verdicts, score unchanged); shown only on a row stored in `fast` mode |
| Copy a suggested wording, or find it in the editor | the comparison on `/jobs/:id` or `/jobs/:id/target` → each card's **Copy** (the proposed wording alone) and **Locate** (outlines it in the editor and scrolls the editor — never the page) |
| Apply a suggestion, or your own version of it | `/jobs/:id/target` → the card's **Apply**, or **Edit & apply** to change the wording first. **Remove** on a removal, **Skip** to set one aside, **Undo** on anything done. An addition applies after the line the model anchored it to. Nothing is saved until you Save as vN — the edits live in the editor |
| Apply every suggestion at once | `/jobs/:id/target` → **Apply all suggestions (N)** under the score, or **Apply all** above the cards (the removals only while their box is ticked; every keyword the resume backs goes in too); **Undo all** takes them all back, and each card keeps its own Undo. Nothing is saved |
| Add every missing keyword without clicking chips one by one | `/jobs/:id/target` → the resume card's **Add missing keywords to your skills**: every keyword the text does not spell, ticked where the resume backs it (an unticked one only if true), one press; a term no skills line takes gets a line of its own (`apply-all.mjs:addKeywords`, `text-edits.mjs:appendSkills`) |
| See and edit the resume as the document it is | `/jobs/:id/target` → the resume card's **Document** view (the default; **Plain text** is the editor as before): your own `.docx` with the edits in it, or for a PDF the same text re-set in the look read off its page. Click a paragraph to change it, Enter keeps, Escape puts back; a line in columns keeps its columns, and only a formula is edited in Plain text |
| Download the tailored resume without saving a version | the Document view → **Download .docx** / **Download .pdf** (a PDF of your own `.docx` opens the print dialog — choose Save as PDF) |
| Why a suggestion has no Apply and says "not applied — …" | the gate refused the wording at analysis time (an invented figure, a keyword the resume has no evidence for, a must-have the rewrite dropped); the reason is on the card's *why* line. Copy and Edit & apply still work — write your own version |
| Add a missing keyword to the skills line | `/jobs/:id/target` → the **+ add** beside a missing chip. Shown only for terms you can claim and only when the resume has a skills line that is a list; otherwise add it by hand |
| Take the whole change list into Word / Docs / a mail | the comparison → **Copy all suggestions** (the AI's list) or, on the targeted view, **Copy my changes** (a diff of your own edits, live once you type). Both are Markdown and need no Apply |
| Re-level, ignore or add a keyword by hand | the keyword table on `/jobs/:id` or `/jobs/:id/target` → the "Wants it" select, `ignore` / `reset`, and "Add a keyword" (instant re-score, no AI call; the edit sticks to the posting across re-runs) |
| Throw away a keyword list the model got wrong | the keyword table → "Rebuild keywords" (one run with the stored frame withheld; your own keyword edits survive it, the new score is not comparable with the old) |
| Paste a posting the fetchers don't see | `/jobs` → "+ Paste a job" (`/jobs/new`) |
| Compare a pasted posting with any resume in one step | menu → Tailor resume (`/target`): paste posting, pick / upload / paste resume, Compare |
| Compare a found job with a file that is not in Resumes, or with pasted text | `/jobs/:id` → **Resume match** tab → **Compare a file or pasted text →** (opens `/target?job=:id` with the job picked), or menu → Tailor resume → "One of your jobs". Nothing is added to Resumes |
| Check whether a posting is real | `/jobs/:id` → **Is it real?** tab → Verify (web search, 2-4 min); the tab's label carries the last verdict |
| Replace a truncated or pasted description with the company's own listing | `/jobs/:id` → **Is it real?** tab → after a deep check that found the company's page: **Refresh the description from it** → a line-by-line preview → **Replace the description and re-classify**; the original stays (**Restore the original** above the description), the next comparison rebuilds its keywords (ADR 0043) |
| Draft / edit / copy a cover letter | `/jobs/:id` → **Cover letter** tab (Generate / Regenerate; edits autosave and re-check facts); **Addressed to** greets a person by name — prefilled from the verification's `named_humans` finding (`resume/addressee.ts`, pure), editable, the finding shown beside it |
| Standing angle inputs for letters (typed once, remembered) | `/jobs/:id` → **Cover letter** tab → "Angle" — saved to `AppSettings.coverAngles` on every Generate |
| Write a letter for a NEW posting (searchable picker / URL / paste; match & research opt-in) | menu → Cover letter (`/letter`) |
| Download a letter as .pdf / .docx | `/jobs/:id` → **Cover letter** tab → PDF / DOCX buttons |
| Save the edits into my own .docx | `/jobs/:id/target` → **Save as vN** — the only save the page has. When the file is a .docx the template check allows, the file itself is patched with the edits and Download hands it back; otherwise the version is the clean `.docx` the Document view showed (ADR 0059) and the flash says why. The sentence above the editor says which it will be. A one-off check from the Tailor resume page saves nothing: the comparison holds its own text snapshot, and `POST /resumes/:id/draft` refuses a hidden resume |
| See what a Save can do with this file, and fix a downloaded template's author name | `/resumes/:id` → "Template check": Editable in place / Partly editable / Text only, the parts it cannot write into, and **Fix document properties** when the file names someone else (current values shown; bytes only, no new version) |
| Get a resume that cannot be edited in place into the loop (a PDF, a table layout) | `/resumes/:id` → **Clean version in your typeface** (`/resumes/:id/render`, also linked from the targeted view's file line): the knobs come from your own file, the preview is the rendered .docx read back, and the four buttons are Update the preview / Download .docx / Download .pdf / **Save as a new resume** — which lands a .docx the template check calls *Editable in place*. Nothing touches the original |
| Re-check an edited resume | `/resumes/:id` → "Upload a new version", then Compare again |
| Find out whether to send the PDF or the .docx | `/resumes/:id` → What the ATS sees → "The same resume in another format" → **Compare the two files**: what a parser reads from each, which one reads better and why, the lines only one of them carries. No AI; the file is not kept |
| Turn on employer mode (screen a folder of resumes against a position) | `/settings` → Screening → "Employer mode" → Turn on. Read the legal note on that tab first; copy the applicant notice from it. Off by default, and the Screening item leaves the menu when it is off |
| Start a screening | menu → Screening → New screening: pick one of your jobs, or paste / upload the posting → the posting is read into a rubric (about a minute; instant if it was compared with a resume before) |
| Edit what the screen checks | `/screen/:id` → "What this screen checks": one row per criterion — kind, the words ("Playwright / Cypress !", "0–2 years", "fintech: 3+", "has led a team of three or more"; a skill's "within 36 months" halves the credit for older use and is off unless typed), Gate / Scored / Note, the stars, Remove — and the last row adds your own (pick the kind, type it, choose yes/no or how-much). "Start over from a shape of hiring" re-reads the posting as Standard / Junior / Senior / Regulated / Agency. Save bumps the rubric version; a row naming age, gender, family, origin or health is refused |
| Add applicants | `/screen/:id` → Applicants → pick files, a .zip, or "…or a whole folder" (subfolders included; other file types are left out) — the pick uploads at once and the scoring starts (`public/screen.mjs:wireUpload`; "Add and score" is the no-JS button). A folder pick meets the browser's own "upload N files?" question, which no page can remove. Files added during a run join it. A second document of someone already listed is scored and carries "also №N"; the same file twice is skipped; an unreadable file stays in the list |
| Score them, see the order | automatic after an upload; the Score button reads whoever is still pending (one call each, `AI_CONCURRENCY` at a time; the page updates itself, a restart resumes from what is missing). Buckets: Priority to talk to / Ask first / Did not pass a gate; then the score (with your adjustment), then confidence. `*` after a score = capped, the scorecard says why |
| Act on many at once | tick the rows (the header box ticks all) → the bar above the table: To interview / On hold / Declined / Clear decision / Score again / Delete |
| Move a known person up or down, with the reason on record | the scorecard → "Your adjustment": ±30 points and why; the table shows 85 → 95 with a small +10, the tooltip and the export keep the computed number |
| Read one applicant's reasoning | the row's name → the scorecard: who / did / verdict, every gate and term with its quote, the score table, the questions (Copy), the facts to discuss, what was removed before the model read it, the redacted and the full text |
| Record a decision | the Decision select on the row, or the scorecard's "Your decision" — the one write the tool never makes |
| Hand the table to a hiring manager | `/screen/:id` → CSV / Markdown |
| Read or edit the posting a screening uses, then re-score | `/screen/:id` → Position → "Read the posting" / "Edit the posting for this screening" → Save; the card then offers "Re-read the rubric" or "Score everyone again" and says how many scores predate the edit. The job page's text is untouched |
| Delete a screening, or keep it longer | `/screen/:id` → "Delete screening" (the uploaded copies and verdicts go from the database; files on disk stay) / "Keep N more days"; the default is `/settings` → Screening → Retention |
| Edit in place with a live score | comparison → "Open targeted view →" (`/jobs/:id/target`); **Analyse my resume again** is the one AI action there (always the full report), **Compare this file** runs the same thing on a freshly uploaded file, "Save as vN" keeps the draft |

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
Their `/api` returns `[{legal: "…", last_updated: …}, …jobs]`. **`.slice(1)` is mandatory** before zod-validating jobs. See [remoteok.ts:52-53](src/fetchers/remoteok.ts#L52-L53).

### 5. `stripHtml` had to learn numeric entities
HN comments use `&#x2F;` (`/`), `&#x27;` / `&#39;` (`'`), `&#x26;` (`&`). The first version of `stripHtml` only knew named entities (`&amp;`, `&lt;` …) and let numeric ones leak into title/location. We now decode `&#xHH;` and `&#NN;` patterns generically — see [http.ts:stripHtml](src/http.ts).

### 6. Greedy regex backtracking in HN parser
The "Company is hiring …" pattern initially captured "Sumble is the newco from the founders of Kaggle. We" because the regex backtracked across a sentence boundary to find a working `\s+(is|are)\s+hiring` anchor. Three fixes applied together:
- Length cap on capture group (`{1,30}?`)
- Pronoun blocklist on captured value (`We`, `I`, `Our`, …)
- `/\.\s/` post-check rejects captures spanning a sentence

See [hn-parser.ts:27-40](src/fetchers/hn-parser.ts#L27-L40) and the sentence check at [hn-parser.ts:78](src/fetchers/hn-parser.ts#L78).

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
2. **Cross-company aggregators** (broad but noisy) — `LARAJOBS_RSS`, `REMOTEOK`, `REMOTIVE`, `JOBICY`, `WEWORKREMOTELY`, `HN_HIRING`, `HN_JOBS`, `ARBEITNOW`, `GOLANGPROJECTS`, `WORKINGNOMADS`, `HIMALAYAS`, `FOURDAYWEEK`, `SOLIDJOBS`, `DEVITJOBS`, `LANDINGJOBS`, `JOBTECH`, `DOU`, `DJINNI`, `ADZUNA`, `FRANCETRAVAIL` (the last two need the user's key). Each is a single synthetic Company row that ingests jobs from many employers we'd never seed individually (PSI CRO, ManTech, DoorDash, Lemon.io, …). Catches the long tail; lets `passesBaseFilter` + Claude cull the noise.

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
GitLab CI/CD the posting wanted. Removals carry two hard rules (PROTECTED
contact line; KEEP WANTED KEYWORDS with itemised drop/keep lists) — guard
test "removals rules protect the contact line".

Third lesson, 2026-09-06: **the prompt rule alone did not hold.** The same
model quoted `"Symfony, React, Vue, Laravel, Lumen, Phalcon"` whole to
advise dropping three of the six, with React (must, primary) and Vue.js
(must) inside the span the editor strikes through and deletes in one press.
Both rules are `replacement-gate.ts:gateRemovals` now (ADR 0044) — a quote
covering contact details or a wanted keyword loses its `quote` and keeps its
advice. Rule of thumb, third time: a rule the user can lose data to belongs
in code, and the prompt keeps it only as an explanation.

### 13. `empty` from a fetcher is not proof the board is alive

Measured 2026-08-30 across all 71 active sources. Two failure modes hide
behind a zero count, and a naive "no jobs = healthy" rule marks both green
forever:

- **7 of 10 per-company vendors `return []` on a malformed top-level
  payload** (Workable, Recruitee, BambooHR, Pinpoint, Breezy, Rippling,
  SmartRecruiters). Only Greenhouse / Lever / Ashby throw on shape drift.
  *(2026-09-24: six of twelve now. SmartRecruiters throws since v2.6.2,
  and Personio and Teamtailor, added later, throw on a body that is not
  their feed.)*
- **SmartRecruiters answers HTTP 200 with `totalFound: 0` for every
  identifier** — `Visa`, `Bosch`, `IKEA`, and a random non-existent string
  alike, under our UA and a browser UA. A dead slug there is byte-identical
  to a live board.

Hence ADR 0019 keeps two signals, not one: the failure streak (`ok`,
`empty` and, since ADR 0035, `not_modified` reset it, everything else
increments) *and* `lastOkAt`, which advances on `ok`, and on
`not_modified` only when the last full read carried rows
(`source-health.ts:advancesLastOk`). A source stuck on `empty` ages into
"silent" without ever touching the streak.

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
positional that begins with our system text, so neither was exposed. Both
were closed anyway on 2026-09-28 (H46): on gemini 0.46.0, `--prompt "--- x"`
exits *"Not enough arguments following: prompt"* — yargs reads a separate
value that opens with `-` as the next flag — so the value rides as
`--prompt=…`, which keeps any text one argument; Codex's `PROMPT` is a plain
clap positional (no `allow_hyphen_values`), so `--` goes before it as it does
for Claude. Every CLI child also gets its stdin closed at spawn: Codex and the
Gemini CLI read stdin when it is not a terminal, and an open pipe would hold
them until the timeout.

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

### 17. A status is the model's verdict on the analysed text — the text outranks it

Found 2026-09-08 on the targeted view: typing `Ajax` moved the ring +3,
typing `WordPress` or `BEM` moved nothing — and that WordPress already sat on
the resume's own title line while the stored row called it `cannot_claim`
("no WordPress work anywhere in resume") and capped the score at 70 as a
missing primary. `entriesFromLive` gave a typed `cannot_claim` zero "for
claim safety" and `anchorStatuses` never revisited one, so the number under
the editor and the number the next analysis stored disagreed about the same
text; the first fix that morning (a confirm tier, "I have it") asked the
candidate to restate what their resume already said. ADR 0045: presence is
read off the text on both sides, for every status, and the model's "named,
nothing behind it" is the `evidence` grade, never the status. Measured before
deciding: 29 of 1 215 stored `cannot_claim` rows were written, and the 8
homonyms among them (GCP = Good Clinical Practice) all sat on comparisons
scoring 0.

### 18. A located quote proves the line exists, not what it says about the term

Found 2026-09-09 on the first real screening: the same resume uploaded as
.docx and as .pdf scored 78 and 69. Every difference sat on a LIST line.
The model called the same "Technology Stack: Node, TypeScript, AWS…" line
"production" in one run and "role" in the next; it quoted the stack line
of one job for "Sentry / New Relic" because Datadog was on it; and the
.docx skills table came out of the reader as one line — label cell,
` | `, values cell — which `isTermList` read as prose, so CSS3 on it was
"production" 3/3 in the .docx and "listed" 0.9/3 in the .pdf, where the
same table is eight short lines. The anchor accepted all of it because the
quote was in the text.

Three rules, all in code (`anchor.ts:listCap`, `evidence.ts:segmentAt`):
a quote that is a list of terms carries at most `listed`, or `role` when
the list is a job's own stack line — `production` is a work bullet with an
outcome; a flattened table row is judged around the term's own cell; and a
term the matcher cannot find anywhere in the text is `absent` whatever the
model quoted (ADR 0045, applied to the employer side). Rule of thumb: the
anchor must check what the quote SAYS about the term, not only that the
quote exists — and any evidence rule that reads "the line" has to survive a
table row rendered as one line.

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

Reference patterns, one per feed shape — copy whichever fits the new source:

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
8. An aggregator (one row, many employers) sets `employer` from the feed's own field through `cleanEmployer` — `null` when the feed does not say, never the aggregator's name (ADR 0056); a per-company source leaves it out

---

## Common operational tasks (one-line answers)

| Task | Command |
| --- | --- |
| Run ApplyPack without Docker | `npm start` (Ctrl+C or `npm run stop` to stop); for watchers `npm run db` + `npm run dev` + `npm run dev:web` |
| Back up a local install | automatic: `snapshots/<date>` in the data folder, the newest three; for a copy elsewhere stop it and copy the data folder (`~/Library/Application Support/ApplyPack`, `%APPDATA%\ApplyPack`, `~/.local/share/applypack`) |
| Move a Docker install into `npm start` | on Docker: `docker compose exec -T postgres pg_dump -U jobhunter --data-only --inserts --column-inserts jobhunter > data.sql`; here, with only `npm run db` running: `npm run db:import -- data.sql --yes` |
| Test the launcher on a scratch folder | `APPLYPACK_DATA_DIR=/tmp/ap WEB_PORT=4848 APPLYPACK_NO_OPEN=1 npm start` — never the live data folder |
| Run one fetch tick now | UI: Overview → "Fetch now" (live progress, row on `/runs`; runs outside the schedule, and while paused stores the jobs unscored); or `docker compose exec app node dist/scripts/fetch-once.js`, which does the same without the dashboard and is recorded as a `fetch-now` run |
| Run discovery probe now | `docker compose exec app node dist/scripts/discovery-once.js` |
| Pull HN Who-is-hiring now | `docker compose exec app node dist/scripts/hn-once.js` |
| Send the stale-applications digest now | `docker compose exec app node dist/scripts/stale-once.js` |
| Send 4 test Telegram messages | `npm run test:telegram` (locally, .env loaded) |
| Tail the worker | `docker compose logs -f app` (JSON; add `--no-log-prefix … \| npx pino-pretty` for lines) |
| Tail the dashboard | `docker compose logs -f web` |
| psql into the DB | `docker compose exec postgres psql -U jobhunter -d jobhunter` |
| psql / Prisma from the HOST | port **5433** (`postgresql://jobhunter:jobhunter@localhost:5433/jobhunter`) — compose publishes the DB on loopback only, on 5433 so a host Postgres on 5432 cannot shadow it |
| Back up the database | `docker compose exec -T postgres pg_dump -U jobhunter jobhunter > applypack-$(date +%F).sql` (verified: 8.7 MB, 16 tables; restore into an empty DB with `psql < dump`) |
| Re-clean stored descriptions (rows with leftover markup) | `docker compose exec app node dist/scripts/backfill-descriptions.js --dry-run`, then without the flag |
| Fingerprint existing jobs + link cross-listings | `docker compose exec app node dist/scripts/backfill-fingerprints.js --dry-run`, then without the flag |
| Flag apply links on already-stored jobs | `docker compose exec app node dist/scripts/backfill-apply-link-flags.js --dry-run`, then without the flag |
| Re-pull descriptions from the boards (structure lost) | `docker compose exec app node dist/scripts/refetch-descriptions.js --dry-run`, then without the flag |
| Migrate after a schema change | `DATABASE_URL=… npx prisma migrate dev --name <name>` |
| Re-classify everything against the active profile | UI: `/settings` → Searches → "Save & re-classify" |
| Pause all alerts temporarily | UI: `/settings` → Notifications → "Alerts" → Disable (what is found meanwhile waits, then arrives in one message per chat) |
| Pause new-job fetching entirely (no docker) | UI: `/settings` → General → "Job fetching" → Pause, or the Pause button in the Overview header |
