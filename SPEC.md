# Job Hunter — Spec

## Goal
Local Docker-based worker that monitors Greenhouse, Lever, and LaraJobs for
PHP/Laravel + full-stack (PHP/JS) **senior remote US** roles. Filters with
keyword rules, scores fit with Claude API, alerts via Telegram.

## Filter criteria
- **Include keywords (title):** php, laravel, symfony, full-stack, fullstack, full stack, backend
- **Exclude keywords (title):** junior, intern, entry-level, apprentice, wordpress (unless paired with laravel/php)
- **Seniority:** senior, staff, lead, principal, sr.
- **Location must match:** remote AND (united states|usa|us|americas|north america|worldwide|global)
- **Location must NOT match:** EU only, UK only, EMEA only, APAC, Canada only, India only
- **Salary (if present):** min ≥ $120k USD/year; if not specified, don't filter out
- **Min fit_score from Claude:** 70

## Architecture
Single Docker Compose stack:
- `postgres` — Postgres 16, persistent volume
- `app` — Node.js 20 worker with embedded `node-cron`

No web server, no dashboard. Output: stdout logs (pino-pretty) + Telegram alerts.

## Cron schedule
- Every hour at :05 — fetch + filter + classify + alert new jobs
- Every day at 09:00 local — digest of all unread jobs from last 24h
- Every Sunday at 03:00 — cleanup jobs older than 30 days marked dismissed

## Tech stack
- TypeScript, Node.js 20
- Prisma + Postgres 16
- node-cron for scheduling
- @anthropic-ai/sdk (Claude Haiku 4.5 for classification — cheap)
- rss-parser for LaraJobs
- pino + pino-pretty for logs
- Native fetch for HTTP (no axios)
- zod for validation of API responses

## Data sources

### Greenhouse Job Board API
GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
Response: { jobs: [{ id, title, location: { name }, content (HTML), absolute_url, updated_at, departments: [{ name }], offices: [{ name, location }], metadata: [...] }] }
No auth. Rate limit polite ~1 req/sec.

### Lever Postings API
GET https://api.lever.co/v0/postings/{company}?mode=json
Response: [{ id, text (title), categories: { commitment, department, location, team, allLocations: [] }, descriptionPlain, hostedUrl, createdAt }]
No auth.

### LaraJobs RSS
https://larajobs.com/feed
Standard RSS 2.0. Item fields: title, link, pubDate, contentSnippet, content.

## Database schema (Prisma)

model Company {
  id          Int      @id @default(autoincrement())
  name        String
  atsType     AtsType
  atsToken    String   // greenhouse board token, lever company slug, or 'larajobs'
  active      Boolean  @default(true)
  careerUrl   String?
  createdAt   DateTime @default(now())
  jobs        Job[]
  @@unique([atsType, atsToken])
}

enum AtsType {
  GREENHOUSE
  LEVER
  LARAJOBS_RSS
}

model Job {
  id           Int       @id @default(autoincrement())
  companyId    Int
  company      Company   @relation(fields: [companyId], references: [id])
  externalId   String    // ATS-specific id, or hash for RSS
  title        String
  url          String
  location     String
  description  String    @db.Text
  postedAt     DateTime
  fetchedAt    DateTime  @default(now())
  fitScore     Int?
  salaryMin    Int?
  salaryMax    Int?
  techMatch    String[]
  redFlags     String[]
  summary      String?   @db.Text
  status       JobStatus @default(NEW)
  alertedAt    DateTime?
  @@unique([companyId, externalId])
  @@index([status, fetchedAt])
}

enum JobStatus {
  NEW
  ALERTED
  APPLIED
  DISMISSED
  SAVED
}

## Project structure
src/
  index.ts                  # entry: registers cron, runs init
  init.ts                   # migrate + seed on startup
  config.ts                 # env vars via zod
  logger.ts                 # pino instance
  db.ts                     # prisma client singleton
  types.ts                  # NormalizedJob etc.
  fetchers/
    index.ts                # runAllFetchers()
    greenhouse.ts           # fetchGreenhouse(company): NormalizedJob[]
    lever.ts                # fetchLever(company): NormalizedJob[]
    larajobs.ts             # fetchLarajobs(): NormalizedJob[]
  filter.ts                 # passesBaseFilter(job): boolean — keyword/location rules BEFORE Claude
  classifier.ts             # classifyWithClaude(job): { fit_score, salary_*, tech_match, red_flags, summary }
  notifier.ts               # sendTelegramAlert(job), sendDigest(jobs[])
  seed.ts                   # seed initial companies
  jobs/
    fetch-job.ts            # fetch + filter + classify + persist + alert
    digest-job.ts           # daily digest

## Env vars (zod-validated)
DATABASE_URL          required
ANTHROPIC_API_KEY     required
TELEGRAM_BOT_TOKEN    required
TELEGRAM_CHAT_ID      required
LOG_LEVEL             default 'info'
TZ                    default 'America/Chicago' (Minnesota/Texas range)
MIN_FIT_SCORE         default 70
MIN_SALARY_USD        default 120000

## Claude classifier prompt outline
- Model: claude-haiku-4-5-20251001
- Max tokens: 600
- Force JSON output via system prompt + json_object response (or ask for raw JSON, parse, retry once if invalid)
- Truncate description to 4000 chars
- Schema:
  {
    "fit_score": 0-100,
    "is_remote_us_eligible": boolean,
    "salary_min_usd": number | null,
    "salary_max_usd": number | null,
    "tech_match": ["php","laravel",...],
    "red_flags": ["wordpress-only","onsite-required",...],
    "summary": "1-sentence why this fits or doesn't"
  }

## Telegram message format
*New role match — fit X/100*
*Title* @ Company
📍 Location | 💰 $X-$Yk
✅ Tech: php, laravel, react
⚠️ Flags: ...
_Summary_
[Apply →](url)

Use parse_mode=MarkdownV2, escape special chars properly.

## Seed companies (Phase 1)
Greenhouse:
- vimeo, etsy, pantheon, acquia, wpengine, taskrabbit, wikimediafoundation,
  buffer, doximity, niantic, getlattice, gusto, square (block), affirm,
  procore, betterment, reddit, mongodb

Lever:
- pleo, toggl, scribd, attentivemobile

LaraJobs RSS: single feed, no token

User can add more in src/seed.ts and re-run `npm run seed`.

## Resilience
- Each fetcher in try/catch — one failing source doesn't stop the run
- HTTP retries: 2 retries with exponential backoff (1s, 3s) on 5xx and network errors
- Claude API: 1 retry on rate limit, then skip job (will retry next cycle)
- Idempotency: dedup via @@unique([companyId, externalId])
- Graceful shutdown: SIGTERM closes Prisma, finishes in-flight cron job

## Out of scope (Phase 1)
- Web dashboard
- Auto-apply
- Discovery service (auto-finding new companies)
- Workable/Ashby/Workday fetchers (Phase 2)