# Architecture

> This is the document I'd point a new contributor (or future-me) at
> to answer "what's actually happening in this codebase?". Pair with
> [SPEC.md](./SPEC.md) (the *what*) and [docs/adr/](./docs/adr/) (the *why*).

## Two-process layout

The whole system is two Node 24 processes plus a Postgres container,
all in the same `docker-compose.yml`:

```mermaid
flowchart LR
  subgraph docker["docker compose"]
    pg[(postgres:16<br/>volume: pgdata)]
    app["app — worker<br/>node dist/index.js"]
    web["web — dashboard<br/>node dist/web/server.js<br/>127.0.0.1:4747"]
  end
  app -->|prisma| pg
  web -->|prisma| pg
  user((user)) -->|browser| web
  app -->|fetch| ats[("ATS APIs<br/>greenhouse, lever, ashby,<br/>workable, smartrecruiters,<br/>WWR, RemoteOK, …")]
  app -->|sendMessage| tg([Telegram Bot API])
  app -->|ai-provider| anthropic([Anthropic API<br/>or claude -p])
  web -.->|reclassify, probe| anthropic
  web -.->|target test| tg
```

The worker never opens an HTTP port. The dashboard never registers a
cron job. The two processes share state only through Postgres
([ADR 0002](./docs/adr/0002-worker-and-web-as-separate-processes.md)).

## Per-tick fetch pipeline

This is what runs once an hour, at the minute this install picked for
itself (ADR 0035) — and, since v1.6.0, whenever
"Fetch now" is pressed on the dashboard (same `runFetchJob`, in the web
process; while the pipeline is paused it stores the new jobs unscored):

```mermaid
sequenceDiagram
  participant Cron as node-cron (hourly)
  participant Job as runFetchJob<br/>jobs/fetch-job.ts
  participant Profile as getActiveProfile<br/>profiles.ts
  participant Settings as getSettings<br/>settings.ts
  participant Fetchers as runAllFetchers<br/>fetchers/index.ts
  participant Process as processNormalizedJobs<br/>jobs/process-jobs.ts
  participant Filter as passesBaseFilter<br/>filter.ts
  participant Claude as classifyJob<br/>classifier.ts
  participant DB as Prisma → Postgres
  participant TG as sendTelegramAlert<br/>notifier.ts

  Cron->>Job: tick
  Job->>Profile: read active Profile
  Job->>Settings: read classifierMode, disabledSources
  Job->>Fetchers: enumerate active Companies, skip disabledSources
  loop per Company
    Fetchers->>Fetchers: fetchOne(c) → NormalizedJob[]
  end
  Fetchers-->>Job: FetcherResult[]
  Job->>Process: process(items, profile, mode, stats)
  loop per job
    Process->>Filter: passesBaseFilter(job, profile)
    alt rejected
      Filter-->>Process: false → stats.filterRejected++
    else admitted
      Process->>DB: findUnique (companyId, externalId)
      alt seen
        DB-->>Process: row → stats.duplicate++
      else new
        Process->>Claude: classifyJob(input, profile, mode)
        alt prefiltered (two-stage stage1=no)
          Claude-->>Process: {result: null, preFiltered: true}
          Process-->>Process: stats.preFiltered++
        else classified
          Claude-->>Process: ClaudeClassification
          Process->>Process: decideDismissReason()
          alt dismiss
            Process->>DB: create Job(status=DISMISSED)
          else keep
            Process->>DB: create Job(status=NEW)
            Process->>TG: sendTelegramAlert(profile-routed)
            TG-->>Process: ok
            Process->>DB: update Job(status=ALERTED)
          end
        end
      end
    end
  end
  Job->>DB: CronRun.update(status=OK, stats=…)
```

Two things to remember while reading this:

1. **`processNormalizedJobs` is the single source of truth for the
   filter → dedupe → classify → persist → alert sequence.** It's
   shared by `runFetchJob` and `runHnHiringJob`. Filter and dedupe run
   first; classification then runs `AI_CONCURRENCY` jobs at a time
   (`src/concurrency.ts`), while persist + alert consume the results in
   the original order — so the DB and Telegram see the same sequence a
   serial loop would produce. `runReclassifyAll` does the same per batch
   of 50.
2. **All toggles read from the DB at the start of the tick.** Flipping
   a toggle in the UI takes effect on the next cron tick — no restart.

## Discovery loop

Discovery is a two-step pipeline that runs in the worker (harvest) and
the web (review):

```mermaid
flowchart TD
  hn["HN Who-is-Hiring cron<br/>jobs/hn-hiring-job.ts"]
  hn -- "comment text" --> rec["recordCandidatesFromText<br/>discovery.ts"]
  rec -- "extractAtsToken matches<br/>greenhouse/lever/ashby/workable/SR" --> cc[(CompanyCandidate<br/>status=PENDING)]

  weekly["Weekly probe cron<br/>jobs/discovery-job.ts<br/>Sun 04:00"]
  weekly --> probe["probeAts (atsType, atsToken)<br/>ats-probe.ts"]
  probe -- "200 + jobs count" --> cc
  probe -- "4xx" --> dead["status=DEAD"]

  user((user)) -->|review at /discovery| pg["promoteCandidate"]
  pg -- "transactional<br/>upsert + status=PROMOTED" --> co[(Company<br/>active=true)]
  co --> next["next fetch tick<br/>pulls jobs"]
```

ADR: [0006-discovery-via-hn-parser.md](./docs/adr/0006-discovery-via-hn-parser.md).

## Profile & classifier mode

```mermaid
flowchart LR
  subgraph settings["AppSettings (singleton)"]
    apId["activeProfileId (primary)"]
    cm[classifierMode]
    dsr[disabledSources]
  end
  subgraph profile["Profile (each running search)"]
    sr[stackRequired]
    rt[roleTypes]
    snth[stackNiceToHave]
    sex[stackExclude]
    rg[countries / regions / workplace]
    notes
  end
  apId --> profile
  profile --> filter["filter.ts<br/>passesBaseFilter"]
  profile --> classifier["classifier.ts<br/>buildSystemPrompt"]
  cm --> classifyJob["classifyJob wrapper"]
  classifyJob -- "single" --> haiku45["Haiku 4.5 only"]
  classifyJob -- "two_stage" --> haiku45p["Haiku 4.5 prefilter<br/>(short prompt)"] --> haiku45full["Haiku 4.5 full<br/>(only on yes)"]
```

The classifier prompt is **dynamic per profile** — every field above
becomes a line in the system prompt. Prompt cache hit is per-profile,
so editing the profile invalidates the cache (next ~5 jobs pay full
input tokens, then it stabilises).

## File map (where each thing lives)

```
src/
  index.ts                     ← cron registration (6 jobs) + graceful shutdown
  schedule.ts                  ← pure: this install's cron minute, from instanceId (ADR 0035)
  init.ts                      ← prisma migrate deploy + seed + bootstrap profile/Telegram
  config.ts                    ← zod-validated env (worker + web)
  logger.ts                    ← pino instance
  db.ts                        ← PrismaClient singleton
  http.ts                      ← fetchWithRetry, stripHtml, AbortController timeout
  types.ts                     ← NormalizedJob, ClaudeClassification, AlertJob
  text-utils.ts                ← pure helpers: parseTagList, extractJson, extractAtsToken,
                                 daysSince, hashShortId, maskToken, decideStageStrategy
  filter.ts                    ← passesBaseFilter (pure, profile-aware)
  countries.json / countries.ts ← the gazetteer: 86 countries, cities, region groups; lookups (pure, ADR 0031)
  location.ts                  ← parseLocation: string + fetcher hints → workplace/countries/regions (pure, ADR 0031)
  location-corpus.json         ← every stored location string on 2026-09-03 with its pinned reading (a test)
  jobs/location-merge.ts       ← the classifier's place may only narrow the parser's (pure, ADR 0032)
  jobs/location-reason.ts      ← "open to Poland; this search hunts in …" for the job page (pure, ADR 0032)
  web/job-facets.ts            ← /jobs place / workplace / posted facets: params, where, chip counts (pure)
  web/public/countries.mjs     ← country picker: search over /countries.json + the suggestion list (tested via import())
  ai-provider.ts               ← AiProvider seam: AnthropicApiProvider | ClaudeCodeProvider
  ai-provider-parse.ts         ← pure parser for `claude -p` JSON output (tested)
  prompt-fence.ts              ← untrusted-text markers + directive (pure, tested, ADR 0022)
  concurrency.ts               ← createLimiter(max), pure
  fingerprint.ts               ← SimHash of a JD body + cross-listing search, pure (ADR 0018)
  classifier.ts                ← classifyJob wrapper + classifyWithClaude (full prompt)
  classifier-prefilter.ts      ← preClassify (short prompt)
  notifier.ts                  ← Telegram MarkdownV2 send, multi-target broadcast
  ats-probe.ts                 ← liveness probe for manual /companies add
  profiles.ts                  ← Profile CRUD + getActiveProfile + setActiveProfile
  settings.ts                  ← AppSettings + TelegramTarget CRUD + maskToken re-export
  discovery.ts                 ← CompanyCandidate CRUD + recordCandidatesFromText + promote
  seed.ts                      ← SEED_COMPANIES list + OBSOLETE_TOKENS cleanup

  starter-packs/               ← web-only curated company packs (ADR 0017)
    catalog.json               ← segments + hand-verified (atsType, atsToken) per company
    catalog.ts                 ← zod-validated load + segment lookups (pure)
    resolve.ts                 ← RESOLVE_ORDER, buildResolvePlan, buildPreview, boardUrl (pure)
    probe.ts                   ← runs the plans through probeAts, bounded concurrency + budget

  resume/                      ← web-only resume module (ADR 0008)
    zip.ts                     ← read one entry from a zip (node:zlib), pure
    docx-text.ts               ← word/document.xml → plain text, pure
    pdf-text.ts                ← PDF → plain text via unpdf (ADR 0011), tested
    resume-text.ts             ← upload dispatch by extension, pure
    prompts.ts                 ← scan + match (two variants) + suggestions + cover prompts, zod schemas, Json readers, pure
    match-mode.ts              ← quick check vs full report: the marker inside breakdown JSON (ADR 0029), pure
    match-reuse.ts             ← is a stored row the answer? reuse / suggestions-only / new run, pure
    bench-report.ts            ← saved bench runs → latency + status-agreement table, pure
    profile-draft.ts           ← resume scan → profile-editor draft (ADR 0015), pure
    score.ts                   ← deterministic match score + breakdown (ADR 0012), pure
    facts.ts                   ← apply CandidateFacts / cross-resume hints to keywords, pure
    fact-check.ts              ← deterministic fabrication gate for generated prose (ADR 0020), pure
    diff.ts                    ← version delta from two matches (gained/lost, components), pure
    parse-warnings.ts          ← ATS parseability checks over extracted text, pure
    pick.ts                    ← preselect: profile link first, then skill-tag overlap, pure
    store.ts                   ← Resume / ResumeMatch / CandidateFact / CoverLetter CRUD (Prisma)
    zip-write.ts               ← minimal STORED zip writer (docx container), pure
    docx-write.ts              ← letter → .docx, round-trip-tested against zip.ts + docx-text.ts, pure
    pdf-write.ts               ← letter → minimal Helvetica PDF, pure
    scan.ts                    ← one AI call → Resume scan fields
    match.ts                   ← one AI call (fast | full) → facts context in, statuses out, score.ts computes → ResumeMatch row
    suggestions.ts             ← the lazy second call: stored verdicts in, actions/removals out → same row (ADR 0029)
    cover-letter.ts            ← one gated AI call → CoverLetter row; gate block → regen once → refuse (ADR 0021)

  verification/                ← ghost-job check (ADR 0009) + liveness ladder (ADR 0016)
    prompts.ts                 ← checklist prompt, zod schema, evidence reader, pure
    liveness.ts                ← free rungs 1-2: ATS-API probe + page classifier (pure + fetch, no AI)
    verify.ts                  ← checkLiveness → Job.liveness*; AI call with webTools → JobVerification row (Prisma)

  fetchers/
    index.ts                   ← runAllFetchers + fetchOne switch
    conditional.ts             ← ETag / Last-Modified per source; a 304 returns no jobs (ADR 0035)
    source-order.ts            ← pure seeded shuffle of the walk order (ADR 0035)
    {greenhouse,lever,ashby}.ts          per-company JSON fetchers
    {workable,smartrecruiters}.ts        per-company JSON fetchers
    {recruitee,breezy,bamboohr,pinpoint}.ts  per-company JSON fetchers (F2)
    rippling.ts                          per-company list + detail (F2)
    larajobs.ts                          single RSS feed
    {remoteok,remotive,arbeitnow}.ts     aggregator JSON
    fourdayweek.ts                       aggregator JSON, paginated v2 API (F2)
    weworkremotely.ts                    per-category RSS (atsToken = category slug)
    golangprojects.ts                    single RSS feed
    hn-hiring.ts                         Algolia API + comment fetch
    hn-parser.ts                         pure heuristic parser

  jobs/
    fetch-job.ts                ← runFetchJob (cron entry; {manual:true} from "Fetch now")
    digest-job.ts               ← runDigestJob (daily 09:00)
    cleanup-job.ts              ← runCleanupJob (Sunday 03:00)
    stale-applications-job.ts   ← runStaleApplicationsJob (daily 08:00)
    stale-applications-format.ts  pure formatStaleMessage
    applied-with.ts             ← pure "Senior Backend v3" label for the applied resume
    hn-hiring-job.ts            ← runHnHiringJob (monthly 1st 06:00)
    discovery-job.ts            ← runDiscoveryJob (Sunday 04:00, validation probe)
    process-jobs.ts             ← shared inner loop used by fetch + HN
    reclassify-job.ts           ← runReclassifyAll + runScoreUnscored (web-triggered, async)
    score-pick.ts               ← pure ranking of unscored jobs by profile mentions (wizard step 4)
    classify-existing.ts        ← classify one stored job (Re-classify button, manual entry)
    posting-url.ts              ← one user-requested posting-page GET → plain text (ADR 0005 blocklist, honest bot-check failure)
    manual-job.ts               ← pasted posting → MANUAL company + Job + classify (used by /jobs/new and /target)
    cron-run.ts                 ← recordCronRun(name, fn) wrapper

  scripts/
    {fetch,digest,cleanup,stale,hn,discovery}-once.ts  ← npm run X:once
    test-telegram.ts            ← validate token + send 4 sample messages

  web/
    server.ts                   ← Hono app, middleware, basicAuth, listen
    layout.tsx                  ← HTML shell, light design tokens, sidebar nav, Tailwind CDN
    ui.tsx                      ← shared <Card>, <StatusBadge>, <FitBadge>, <Tag>, <Stat>
    format.ts                   ← formatSalary, formatRelative, statusTone, fitTone
    flash.ts                  ← POST → redirect → GET flash cookie
    upload.ts                 ← multipart resume upload helper + 5 MB limit
    target-runs.ts            ← in-memory compare-run registry (async classify/scan/match)
    fetch-runs.ts             ← in-memory "Fetch now" registry (live source progress; the 'fetch-now' CronRun is the record)
    fetch-summary.ts          ← pure one-line verdict of a finished fetch-now run
    welcome-steps.ts          ← pure first-run wizard rules (steps from data, score-run summary)
    welcome-facts.ts          ← loads what the wizard and the Overview chip derive from
    ai-test.ts                ← one live engine call — Settings Test button + wizard step 1
    profile-from-resume.ts    ← "create a search from this resume": blank-base draft + inactive create
    public/target.mjs         ← browser keyword matcher (pure ES module, node-tested)
    public/score.mjs          ← browser mirror of resume/score.ts (parity-tested, ADR 0012)
    public/cover-letter.mjs   ← copy-to-clipboard for the letter card (import-smoke-tested)
    public/board.mjs          ← /applications drag-and-drop over POST /jobs/:id/stage (planMove tested)
    public/fetch-run.mjs      ← activity lines for the fetch-now progress page (pure; target-run.mjs polls)

    pages/
      overview.tsx              ← /
      jobs-list.tsx             ← /jobs
      job-detail.tsx            ← /jobs/:id
      applications.tsx          ← /applications (board + quick-move + closed panel)
      companies.tsx             ← /companies
      starter-pack.tsx          ← pack picker card + preview + import result
      discovery.tsx             ← /discovery
      runs.tsx                  ← /runs (+ Fetch now button)
      welcome.tsx               ← /welcome first-run wizard (4 steps, one card at a time)
      fetch-run.tsx             ← /runs/fetch-now/:id progress page + FetchNowButton
      run-steps.tsx             ← step list shared by the two progress pages
      settings.tsx              ← /settings (9 cards)
      resumes.tsx               ← /resumes (list + upload form component)
      resume-detail.tsx         ← /resumes/:id
      resume-match-card.tsx     ← "Resume match" card on /jobs/:id
      cover-letter-card.tsx     ← "Cover letter" card on /jobs/:id (F8, ADR 0021)
      verification-card.tsx     ← "Is this job real?" card on /jobs/:id
      job-new.tsx               ← /jobs/new (paste a posting)
      target-start.tsx          ← /target (paste posting + pick/upload/paste resume → one run)
      letter-start.tsx          ← /letter (job by pick/URL/paste + resume + optional match/verify → letter)
      target-run.tsx            ← /target/runs/:id (progress steps, polled by target-run.mjs)
      target.tsx                ← /jobs/:id/target (side-by-side editor, live score)

    routes/
      overview.tsx
      jobs.tsx                  ← list + new (manual) + detail + status + reclassify + verify + resume match + cover letters
      target.tsx                ← /target launcher: resume resolve + manual job + match in one POST
      letter.tsx                ← /letter launcher: job + resume resolve → [extract→classify→match→verify]→letter run
      resumes.tsx               ← upload (5 MB limit) + scan + default + delete + download
      applications.tsx          ← board + stage-only quick-move + per-job application form
      companies.tsx              ← list + new (probe-validated) + delete + toggle + starter packs
      discovery.tsx             ← list + promote + ignore + delete + manual probe
      runs.tsx                  ← /runs + POST /runs/fetch-now (the tick in the web process) + progress/state
      welcome.tsx               ← /welcome + skip / finish / ai test / resume → scan run / profile apply / score run
      settings.tsx              ← profile editor + 8 toggles + telegram targets
      health.ts                 ← JSON liveness for external monitoring

prisma/
  schema.prisma                 ← Company, Job, CronRun, AppSettings, Profile,
                                  TelegramTarget, CompanyCandidate, Resume,
                                  ResumeMatch, JobVerification, CoverLetter, 4 enums
  migrations/                   ← real Prisma migrations from phase-3.0 baseline
```

## What runs when

| Trigger                          | Process | Entry point                              |
| -------------------------------- | ------- | ---------------------------------------- |
| hourly, at this install's minute  | app     | `runFetchJob`                            |
| `09:00` daily (Chicago)          | app     | `runDigestJob`                           |
| `08:00` daily (Chicago)          | app     | `runStaleApplicationsJob`                |
| `03:00` Sunday                   | app     | `runCleanupJob`                          |
| Sunday `04:xx` (own minute)       | app     | `runDiscoveryJob`                        |
| 1st of the month `06:xx`          | app     | `runHnHiringJob`                         |
| any HTTP request                 | web     | Hono routing                             |
| `POST /settings/reclassify`      | web     | spawns `runReclassifyAll` async (lock)   |
| `POST /settings/hn-run`          | web     | spawns `runHnHiringJob` async (lock)     |
| `POST /jobs/:id/reclassify`      | web     | sync `classifyJob` → auto-demote on fail |
| `POST /jobs/:id/status`          | web     | status change; on APPLIED also seeds the funnel and snapshots the picked resume (id + version + text) |
| `POST /companies/new`            | web     | sync `probeAts` → upsert                 |
| `POST /companies/starter-pack`   | web     | resolve a pack live (`probeAts`, ≥1 job wins) → preview; `/import` inserts inactive, `/enable` activates |
| `POST /resumes`                  | web     | extract text → `scanResume` (sync, ~1 min) |
| `POST /jobs/:id/match`           | web     | async run: (scratch cleanup) → `matchResumeToJob` (`mode` = fast \| full); a stored quick check + `mode=full` starts the suggestions run instead; redirects to `/target/runs/:id` |
| `POST /jobs/:id/matches/:matchId/suggestions` | web | async run: `suggestForMatch` — actions/removals/strengths/cautions onto the stored row, score untouched |
| `POST /jobs/:id/verify`          | web     | `checkLiveness` (free rungs, seconds) → stop on a verdict; else / `deep=1` sync `verifyJob` with web tools (2-4 min) → `JobVerification` |
| `POST /jobs/new`                 | web     | MANUAL company upsert + Job + `classifyExistingJob` |
| `POST /target`                   | web     | resolve resume inline (upload/paste → hidden scratch row), then async: `createManualJob` → scratch-match cleanup → `matchResumeToJob` (`mode` from the pressed button); redirects to `/target/runs/:id` |
| `GET /target/runs/:id`           | web     | progress page (meta-refresh 2s); done → flash + redirect into the targeted view |
| `POST /resumes/:id/replace`      | web     | new file → `version`+1 → `scanResume`    |
| `POST /jobs/:id/target/reupload` | web     | async run: replace (+scan for real resumes; scratch skips it) → match |
| `POST /jobs/:id/cover`           | web     | async run: `generateCoverLetter` (fact-gated; blocked twice → error, no row); redirects to `/target/runs/:id`. The card form also saves the angle prefills; a Regenerate POST reuses them |
| `POST /jobs/:id/cover/:letterId` | web     | save a manual edit; re-runs the gate warn-only, updates `gateVerdict`/`gateNotes` |
| `GET /jobs/:id/cover/:letterId/file/:fmt` | web | letter (edited text wins) → .docx or .pdf attachment, built in-process |
| `POST /letter`                   | web     | job by picker / URL / paste + resume resolve → async run [fetch? → extract? → classify? → match? → verify?] → gated letter. Everything slow is a run step; the POST only shape-checks (§6.2) |
| `POST /resumes/:id/draft`        | web     | edited text → `.md` version → scan (+ match when `jobId`) |
| `GET /static/*`                  | web     | `src/web/public` (keyword matcher)       |
| `POST /discovery/:id/promote`    | web     | transactional Company upsert             |
| `POST /discovery/probe-now`      | web     | spawns `runDiscoveryJob` async (lock)    |

## Database (entity overview)

```mermaid
erDiagram
  AppSettings ||--o| Profile : "activeProfileId (primary)"
  Profile ||--o| TelegramTarget : "telegramTargetId"
  Profile ||--o{ AppSettings : "back-relation"
  Profile ||--o{ JobScore : "1..N onDelete:Cascade"
  Job ||--o{ JobScore : "1..N onDelete:Cascade"
  Company ||--o{ Job : "1..N onDelete:Cascade"
  CompanyCandidate }o--|| AtsType : "PROMOTED → Company"
  Resume ||--o| Profile : "resumeId — onDelete:SetNull"
  Resume ||--o{ Job : "appliedResumeId — onDelete:SetNull"
  Resume ||--o{ ResumeMatch : "1..N onDelete:Cascade"
  Job ||--o{ ResumeMatch : "1..N onDelete:Cascade"
  Job ||--o{ JobVerification : "1..N onDelete:Cascade"
  Resume ||--o{ CoverLetter : "1..N onDelete:Cascade"
  Job ||--o{ CoverLetter : "1..N onDelete:Cascade"

  AppSettings {
    int id PK
    bool telegramEnabled
    int activeProfileId FK "the primary search"
    string classifierMode "single|two_stage"
    bool applicationTrackingEnabled
    bool staleApplicationsDigestEnabled
    bool hnParserEnabled
    bool discoveryEnabled
    string_array disabledSources
    json aiKeys "per-engine API keys, DB-first (ADR 0027)"
    datetime setupCompletedAt "NULL = / redirects to /welcome"
    json pipelineStages "user-named funnel columns (ADR 0025)"
  }

  Profile {
    int id PK
    string name
    string_array stackRequired
    string_array roleTypes
    string_array stackNiceToHave
    string_array stackExclude
    text notes
    string_array seniority
    string_array countries "ISO-2 — where the search hunts (ADR 0032)"
    string_array regions "group codes, stored as groups"
    enum_array workplace "REMOTE|HYBRID|ONSITE accepted; empty = any"
    string_array onsiteCities
    int minSalaryUsd
    int minFitScore
    int telegramTargetId FK
    bool active "runs in the pipeline (ADR 0028)"
    int resumeId FK "the resume this search hunts with"
  }

  Company {
    int id PK
    string name
    enum atsType
    string atsToken
    bool active
    string careerUrl
  }

  Job {
    int id PK
    int companyId FK
    string externalId
    string title
    string url
    string location "as fetched, never rewritten"
    enum workplace "REMOTE|HYBRID|ONSITE|UNKNOWN (ADR 0031)"
    string_array countries "ISO-2: where to live (remote) or the office"
    string_array regions "named markers only: EU, EUROPE, WORLDWIDE …"
    string locationSource "structured|parsed|null"
    text description
    int fitScore
    int salaryMin
    int salaryMax
    string_array techMatch
    string_array redFlags
    text summary
    enum status
    datetime alertedAt
    datetime appliedAt
    string pipelineStage
    string recruiterContact
    text applicationNotes
    int appliedResumeId FK "onDelete:SetNull"
    int appliedResumeVersion
    text appliedResumeText "snapshot — resume bytes are replaced in place"
  }

  TelegramTarget {
    int id PK
    string name
    string botToken
    string chatId
    bool active
    datetime lastUsed
  }

  CompanyCandidate {
    int id PK
    string name
    enum atsType
    string atsToken
    string source
    string sourceUrl
    int jobsSeen
    enum status "PENDING|PROMOTED|IGNORED|DEAD"
  }

  Resume {
    int id PK
    string name
    string sourceFilename
    bytes original
    text text
    int version
    bool isDefault
    datetime scannedAt
    string title
    string seniority
    int yearsExperience
    string_array skills
    string_array primarySkills "the 2-5 core technologies"
    string_array roleTypes
    text summary
    json issues
  }

  ResumeMatch {
    int id PK
    int jobId FK
    int resumeId FK
    int resumeVersion
    text resumeText
    bool draft
    string model
    int matchScore
    text summary
    string_array strengths
    string_array redFlags
    json keywords
    json actions
    json removals
  }

  JobVerification {
    int id PK
    int jobId FK
    string model
    string verdict
    string recommendation
    int confidence
    text summary
    json evidence
    string_array redFlags
    text companySnapshot
  }

  CronRun {
    int id PK
    string name
    enum status "RUNNING|OK|FAILED"
    datetime startedAt
    datetime finishedAt
    json stats
    text errorMessage
  }
```

## Things that surprised me while building this

These are codified as ADRs — go there for the full reasoning:

- [0001 — Hono not Express](./docs/adr/0001-hono-not-express.md)
- [0002 — Worker and web as separate processes](./docs/adr/0002-worker-and-web-as-separate-processes.md)
- [0003 — No queue, just node-cron](./docs/adr/0003-no-queue-just-node-cron.md)
- [0004 — One active profile, not multi-tenant](./docs/adr/0004-single-active-profile.md) *(superseded by 0028)*
- [0005 — No LinkedIn / Indeed / Workday](./docs/adr/0005-no-linkedin-indeed-workday.md)
- [0006 — Discovery via HN parser](./docs/adr/0006-discovery-via-hn-parser.md)

Also see [CLAUDE.md](./CLAUDE.md) for "where to look" + gotchas.
