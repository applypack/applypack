# Project conventions

> Pair with [SPEC.md](./SPEC.md) (current state) and
> [ARCHITECTURE.md](./ARCHITECTURE.md) (data flow + file map).

## Stack
- TypeScript strict mode, Node 20
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
- `filter.ts` is pure — no I/O.
- `classifier.ts` (and `classifier-prefilter.ts`) only call Claude — no DB.
- `jobs/process-jobs.ts` is the single source of truth for the inner
  filter → dedupe → classify → persist → alert sequence. Reused by
  `runFetchJob` and `runHnHiringJob`.
- The cron worker (`src/index.ts` + `src/jobs/*`) MUST NOT run an HTTP server.
- The dashboard lives in `src/web/` as a SEPARATE service (Hono). It shares
  Postgres with the worker but runs in its own container/process. It is
  read-mostly with limited writes (status changes, profile/settings edits,
  re-classify, candidate promote).

## DO NOT
- Do not add Express, Next.js, or any HTTP server to the worker process.
- Do not add Redis, BullMQ, or other queues — node-cron is sufficient.
- Do not expose the dashboard on a public interface by default — bind to `127.0.0.1` in compose.
- Do not store secrets anywhere except `.env` (gitignored). Telegram tokens belong in `TelegramTarget` rows once `init.ts` has bootstrapped them; `.env` becomes optional after first boot.
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
- Runtime image: `node:20-alpine`.
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
| Pure helpers (parsing, hashing, masking) | `src/text-utils.ts` |
| The cron list (5 schedules) | `src/index.ts:registerCron` |
| What runs on container boot | `src/init.ts` |
| Adding a new ATS source — single-feed template | `src/fetchers/larajobs.ts` (LARAJOBS_RSS) or `src/fetchers/golangprojects.ts` (single RSS) |
| Adding a new ATS source — per-company JSON | `src/fetchers/ashby.ts` (cleanest), `src/fetchers/greenhouse.ts` |
| Adding a new ATS source — POST endpoint | `src/fetchers/workable.ts` (POST + body) |
| Adding a new ATS source — list + detail | `src/fetchers/smartrecruiters.ts` |
| Where to register a new ATS | `src/fetchers/index.ts:fetchOne` switch + `prisma/schema.prisma:AtsType` enum |
| Where to add a new toggle | `prisma/schema.prisma:AppSettings` (column) → `src/settings.ts` (getter/setter) → `src/web/pages/settings.tsx` (UI) → `src/web/routes/settings.tsx` (POST) |
| The Claude system prompt | `src/classifier.ts:buildSystemPrompt` |
| The two-stage prefilter prompt | `src/classifier-prefilter.ts:buildPrefilterPrompt` |
| Per-job filter rules (pre-Claude) | `src/filter.ts:passesBaseFilter` |
| Telegram MarkdownV2 escape | `src/notifier.ts:escapeMarkdownV2` |
| Profile-to-prompt translation | `src/classifier.ts:buildSystemPrompt` (stack/role/location/notes lines) |
| Discovery candidate extraction | `src/discovery.ts:recordCandidatesFromText` (calls `extractAtsToken`) |
| URL → ATS recognition (greenhouse/lever/ashby/workable/SR) | `src/text-utils.ts:extractAtsToken` |
| Manual company probe before save | `src/ats-probe.ts:probeAts` |
| Each cron's once-script (manual trigger) | `src/scripts/{fetch,digest,cleanup,stale,hn,discovery}-once.ts` |

When the question is **"how does the user toggle / configure X?"**:

| What | Page |
| --- | --- |
| Add / remove tracked company | `/companies` (with manual probe before save) |
| Disable whole ATS family (e.g. all Workable) | `/settings` → "Job sources" card |
| Enable two-stage classifier (cheaper, less precise) | `/settings` → "Classifier mode" |
| Edit profile (stack, role types, regions, fit threshold) | `/settings` → "Active profile" |
| Switch between profiles | `/settings` → dropdown + Activate |
| Re-classify all jobs against new profile | `/settings` → "Re-classify all jobs" (async, watch /runs) |
| Telegram on/off | `/settings` → "Telegram alerts" |
| Add Telegram bot or chat | `/settings` → "Add target" (validates with getMe + sendMessage) |
| Pipeline stage on a job | `/jobs/:id` → "Application tracking" card |
| Review newly discovered companies | `/discovery` (sorted by jobsSeen DESC) |

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

Both stages of our two-stage classifier now use Haiku 4.5. Savings come from a much shorter prefilter prompt + prompt cache, **not** from a cheaper model. See [classifier-prefilter.ts:7-12](src/classifier-prefilter.ts#L7-L12) for the comment that explains this.

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

1. **Direct boards** (per-company, narrow but precise) — `Company` rows with `atsType ∈ {GREENHOUSE, LEVER, ASHBY, WORKABLE, SMARTRECRUITERS}`. Curated by the user via `/companies` (paste a board URL → manual probe → save) or seeded in `src/seed.ts`. Catches every job at the companies you've added; misses everything else.
2. **Cross-company aggregators** (broad but noisy) — `LARAJOBS_RSS`, `REMOTEOK`, `REMOTIVE`, `JOBICY`, `WEWORKREMOTELY`, `HN_HIRING`, `ARBEITNOW`, `GOLANGPROJECTS`. Each is a single synthetic Company row that ingests jobs from many employers we'd never seed individually (PSI CRO, ManTech, DoorDash, Lemon.io, …). Catches the long tail; lets `passesBaseFilter` + Claude cull the noise.

Common user trap: disabling all aggregators in `/settings → Job sources` because "I want only Greenhouse" produces near-zero new jobs (we have ~15 seeded Greenhouse boards, most don't post matching roles weekly). The cure is to **leave aggregators enabled** and let the profile filter narrow scope. Document this in any user-facing copy that talks about "monitoring".

When a user finds a job at a company we don't track (e.g. via LinkedIn), the right path is:
- Paste the board URL into `/companies → Add company` — the form runs `extractAtsToken` + `probeAts` and refuses to save if the slug doesn't resolve. One-click promote into the rotation.
- Or, the HN parser harvests ATS URLs from comments automatically (when `discoveryEnabled` is on) — they show up on `/discovery` as PENDING candidates.

---

## ATS templates (when adding a new source)

Three reference patterns, copy whichever fits the new source:

| Shape of the new ATS | Reference file | Examples |
| --- | --- | --- |
| Single curated RSS | `src/fetchers/larajobs.ts` | RSS one feed for the whole site, no per-company config |
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
| Run one fetch tick now | `docker compose exec app node dist/scripts/fetch-once.js` |
| Run discovery probe now | `docker compose exec app node dist/scripts/discovery-once.js` |
| Pull HN Who-is-hiring now | `docker compose exec app node dist/scripts/hn-once.js` |
| Send the stale-applications digest now | `docker compose exec app node dist/scripts/stale-once.js` |
| Send 4 test Telegram messages | `npm run test:telegram` (locally, .env loaded) |
| Tail the worker | `docker compose logs -f app` |
| Tail the dashboard | `docker compose logs -f web` |
| psql into the DB | `docker compose exec postgres psql -U jobhunter -d jobhunter` |
| Migrate after a schema change | `DATABASE_URL=… npx prisma migrate dev --name <name>` |
| Re-classify everything against the active profile | UI: `/settings` → "Re-classify all jobs" |
| Pause all alerts temporarily | UI: `/settings` → "Telegram alerts" → Disable |
