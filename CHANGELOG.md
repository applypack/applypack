# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [1.43.0] — 2026-09-04

### Added
- **France Travail, with your own free client id** (plan §3e, ADR 0034):
  every job ad in France through the board's Offres d'emploi API. Create an
  app on francetravail.io, paste the client id and secret on Settings →
  Sources, and Companies offers the developer row (`codeROME=M1805`) to a
  search that names France; any filter the API takes works as a row.
- The board's licence as code: every offer is stored and shown whole
  ("Full offer as published"), every display names the source, the
  board's last update and the licence, and a daily mirror re-checks each
  stored offer — withdrawn ones are deleted, or kept anonymised when they
  are your own application record. `docs/france-travail-reuse.md` states
  the method. Stage 3e, and the country-aware source plan, are complete.

### Schema
- `AtsType.FRANCETRAVAIL`, `Job.sourcePayload`, `Job.sourceUpdatedAt`,
  `Job.sourceCheckedAt` (migration `20260904040000_add_france_travail`).

## [1.42.0] — 2026-09-04

### Added
- **Adzuna, with your own free key** (plan §3e, ADR 0034). Register at
  developer.adzuna.com, paste the app_id and app_key on Settings → Sources
  → "Source keys", and Companies offers one Adzuna row per country a
  running search names (nineteen markets). Rows are polled four times a
  day and capped at ten, which keeps the vendor's 2 500-calls-a-month
  limit; every listing shows the "Jobs by Adzuna" label the terms ask for,
  on the list, the job page and in Telegram; descriptions are snippets and
  say so.
- **Source keys** on the Sources tab: stored like engine keys — masked,
  never rendered in full, never logged, `.env` as the fallback — and
  scrubbed from any error a keyed source raises.
- ADR 0005 gains a fourth addendum rule: robots.txt governs crawling, a
  vendor's published licence governs keyed access.

### Schema
- `AtsType.ADZUNA` (migration `20260904030000_add_adzuna`),
  `AppSettings.sourceKeys` (migration `20260904020000_add_source_keys`).

## [1.41.0] — 2026-09-04

### Added
- **Salary in the posting's own money** (plan §5.1 / §6.7). Until now the
  classifier was asked for one USD number and converted silently, so a
  stored "60000" could be euros a year or złoty a month. It now reports
  what the posting says — the numbers, the currency, the period — and
  `src/currency.ts` does the arithmetic: jobs and Telegram show `€60k-80k`
  or `zł20k-28k/mo`, with `≈ $89k/yr` beside it, and the salary floor on a
  search compares against that converted number instead of a raw one.

### Schema
- `Job.salaryCurrency`, `Job.salaryPeriod` (migration
  `20260904010000_add_salary_currency`). Both null on existing rows, which
  reads as USD a year — what they have always meant.

## [1.40.0] — 2026-09-04

### Added
- **Where you live, and whether you would move** (plan §5, ADR 0033). A
  search now says "I live in" and picks one of three: I stay where I am,
  I would relocate, I would relocate and need visa sponsorship. The
  classifier reads both: a role open only to places you cannot work from
  matches only if the posting itself opens it — relocation, sponsorship,
  an employer of record or a contract abroad — and it flags
  `work-permit-required` or `no-visa-sponsorship` when it does not.
- **"Open to me"** on Jobs: only the roles a search of yours can actually
  take, read from the same per-search verdict the fit chips read.
- The job page says why a role is closed to you when the columns can prove
  it: "open to European Union; you live in Ukraine and this search does not
  relocate".
- Telegram alerts show the country flags and the arrangement.

### Schema
- `Profile.residence`, `Profile.relocation` (migration
  `20260904000000_add_profile_eligibility`).

## [1.39.0] — 2026-09-03

### Added
- **Teamtailor** (plan §4.2, stage 3d): the Nordic / UK / Benelux ATS as a
  per-company source — paste a `*.teamtailor.com` career URL, a slug, or
  the board's own career domain on Companies; every posting arrives with
  the board's city and country, the arrangement the posting declares
  (remote / hybrid / on-site), department and role, and the full text. Discovery recognises Teamtailor
  career URLs. Tibber seeded switched off as the reference board. Stage 3d
  is complete.

### Schema
- `AtsType.TEAMTAILOR` (migration `20260903235500_add_teamtailor`).

## [1.38.0] — 2026-09-03

### Added
- **Personio** (plan §4.2, stage 3d): the DACH mid-market ATS as a
  per-company source — paste a `*.jobs.personio.de` career URL or a slug
  on Companies, the probe checks the public XML feed, and every position
  arrives with its offices, employment type, seniority, schedule, salary
  when published, and the posting's sections. Discovery recognises Personio
  career URLs. Holidu seeded switched off as the reference board.

### Schema
- `AtsType.PERSONIO` (migration `20260903234500_add_personio`).

## [1.37.0] — 2026-09-03

### Added
- **JobTech JobSearch** (plan §4.2, stage 3c): Arbetsförmedlingen's open API
  over every job ad in Sweden as a source. The token is the search filter
  (the seeded row is the Data/IT field); each tick reads the ads published
  in the last 24 hours, newest first, with the municipality and country
  from the ad, the employer, the deadline and the plain-text description.
  Seeded switched off; "Sources for your searches" offers it to a search
  that names Sweden or the Nordics. Stage 3c is complete.

### Schema
- `AtsType.JOBTECH` (migration `20260903233000_add_jobtech`).

## [1.36.0] — 2026-09-03

### Added
- **Landing.jobs** (plan §4.2, stage 3c): the Portuguese tech board's Atom
  feed as a source — city, country and remote policy from the feed's own
  fields (Full remote → remote, Partial remote → hybrid), the company from
  the author, salary and expiry kept in the description. Seeded switched
  off; "Sources for your searches" offers it to a search that names
  Portugal.

### Schema
- `AtsType.LANDINGJOBS` (migration `20260903230000_add_landingjobs`).

## [1.35.0] — 2026-09-03

### Added
- **The DevITjobs family** (plan §4.2, stage 3c): GermanTechJobs.de,
  DevITjobs.uk and DevITjobs.nl as sources — one fetcher, one row per site
  with the host as its token. Every title carries the company and the
  salary range, the description keeps the Requirements / Responsibilities /
  Technologies lists, and the country comes from the site — the feed names
  no city and no arrangement, so those stay with the classifier. Items
  older than 90 days are skipped (the feeds keep postings for years). The
  feeds are read with ETag / Last-Modified, so an unchanged feed costs one
  304 per tick. Seeded switched off; "Sources for your searches" offers
  each site to a search that names its country.

### Fixed
- The Test button on Settings → AI engine now names the real reason a test
  failed (the HTTP status and message, key-shaped text masked, 200 chars)
  instead of pointing at the container logs — #122 by @boykoandrii.

### Schema
- `AtsType.DEVITJOBS` (migration `20260903220000_add_devitjobs`).

## [1.34.0] — 2026-09-03

### Added
- **solid.jobs** (plan §4.2, stage 3c): the Polish IT board's public offers
  API as a source — three pages of 500 per tick, Polish cities, remote /
  hybrid flags, PLN salary with the employment type and the skill list in
  the description head, the PL country hint on every row. Seeded switched
  off; "Sources for your searches" offers it to a search that names Poland
  or the CEE group.

### Schema
- `AtsType.SOLIDJOBS` (migration `20260903210000_add_solidjobs`).

## [1.33.0] — 2026-09-03

### Added
- **Sources for your searches** (plan §4.3). Companies gets a card listing
  the token-driven feeds the running searches' countries call for, built
  from each search's stack: a search that names Ukraine gets DOU and Djinni
  rows (`category=PHP&remote`, `primary_keyword=Laravel&employment=remote&region=UKR`),
  a search that names Germany or the UK gets the two Arbeitnow rows. Each
  row shows its state — Add (off), Enable, or On — and "Add" probes the feed
  first, so a category the board does not know never becomes a silent empty
  source; rows are added switched off, like a starter pack (ADR 0017).
  Saving a search that has such feeds waiting says so in the flash. The
  aggregators that already follow the searches (Jobicy, Himalayas,
  4dayweek) need no suggestion and get none.

## [1.32.0] — 2026-09-03

### Changed
- **The "UA-friendly remote" starter pack was re-probed and refreshed**
  (stage 3b, plan §4.2). Every board was hit live: Preply 104 postings,
  Solidgate 54, MacPaw 18, Gcore 13, Restream 8, Wirex 6, Skylum 4, Lemon.io
  2, Reface 1, Namecheap 0 (an empty board, kept — the board is real). Sigma
  Software's SmartRecruiters board holds one legacy posting since the company
  moved hiring to its own site, so it leaves the pack (ADR 0017: a legacy
  board is not shipped). Three Ukrainian employers join, each identified by
  the board's own name field: N-iX (Greenhouse `nix`, 121 postings, 53 in
  Ukraine), Ajax Systems (Lever `ajax`, 201, 112 in Ukraine), Genesis
  (Breezy `gen-tech`, 85, 77 in Ukraine). Thirteen entries now.

## [1.31.0] — 2026-09-03

### Added
- **Djinni as a source** (stage 3b, plan §4.2) — the Ukrainian tech job
  marketplace through its RSS. One Company row per filter string, which is
  the row's token: `primary_keyword=PHP&employment=remote&region=UKR`; the
  items carry no location and no employer, so the location is written from
  the filter ("Remote · Ukraine", "Office · Kyiv, Ukraine") and the hints
  with it. Verified live: an unknown `primary_keyword` answers the whole
  bare feed, byte-identical, not an error — so rows whose `<category>` is
  not the requested keyword are dropped and the Companies probe refuses a
  keyword that leaves nothing. Seeded off as "Djinni · PHP, remote,
  Ukraine". robots.txt allows `/jobs/rss/`; Djinni's terms cover posting
  and fees only.

## [1.30.0] — 2026-09-03

### Added
- **DOU.ua as a source** (stage 3b, plan §4.2) — the Ukrainian tech job
  board through its own RSS interface. One Company row per feed query,
  which is the row's token: `category=PHP&remote`, `search=laravel`,
  `city=Львів`, `exp=5plus`; add more on Companies, where the probe refuses
  a query DOU answers with no vacancies (an unknown category is an empty
  channel there, not an error). The title carries everything but the
  description — "Backend Engineer в BetterMe, Київ, за кордоном, віддалено"
  — so a small grammar parser splits role, employer, salary, cities and the
  two markers: the employer and salary go into the description, the cities
  and "віддалено" into the location the stage-1 parser already reads
  (Cyrillic cities included). Seeded off as "DOU · PHP, remote". DOU
  answers the default RSS User-Agent with 403, so the feed is fetched with
  the project's. Terms: fine for a self-hosted personal tool with the
  link-back kept; a hosted or commercial deployment needs DOU's consent.

## [1.29.0] — 2026-09-03

### Added
- **Arbeitnow reads three pages and has a visa-sponsorship feed.** The
  fetcher followed nothing beyond page 1 (175 rows of 650+); it now walks
  the API's own `links.next` for up to three pages, a second apart, on the
  board's host only, and keeps a posting once. A second Company row,
  "Arbeitnow · visa sponsorship" (`atsToken: visa`), reads
  `?visa_sponsorship=true` — a server-side filter the rows themselves do
  not carry, so it is a feed of its own. Both rows stay off until a search
  needs them: the board is German and British office jobs first. Plan §4.2,
  stage 3a.

## [1.28.0] — 2026-09-03

### Added
- **4dayweek follows the searches.** With searches that name places the
  three pages are scoped with `country=` — gazetteer names for countries,
  continents for groups (`Germany,Poland,Europe`) — so a European search
  reads Europe's postings instead of the newest 75 of everything. Verified
  live: the API takes names and continents, not codes, and answers an
  unknown value with its ~141 rows that have no location at all; a scoped
  fetch therefore drops rows without a location — they can never be
  evidence for a place. A search that hunts anywhere still reads the
  newest pages of everything. Plan §4.2, stage 3a.

## [1.27.0] — 2026-09-03

### Added
- **Himalayas follows the searches.** With searches that name countries the
  fetcher calls the search endpoint once per country
  (`country=PL&exclude_worldwide=true`) and once for the worldwide rows,
  merged by guid — country-locked postings for Poland or Germany instead of
  the newest 20 of everything. A search that hunts anywhere, or one that
  names only groups the API cannot express, still reads the browse feed.
  Verified live: the search endpoint answers HTTP 400 to an unknown code
  (never a silent empty feed), caps `limit` at 20, and ignores `offset`,
  so each call is the newest 20 — enough for an hourly tick. Plan §4.2,
  stage 3a.

## [1.26.0] — 2026-09-03

### Added
- **Jobicy follows the searches.** The fetcher used to read one unfiltered
  feed (~200 rows, 58 of them US-only). It now reads one `geo=` feed per
  place the running searches hunt in — a PL + DE + EU search pulls
  `poland`, `germany` and `europe` — and keeps a posting listed in several
  of them once. Jobicy's `geo` has eligibility semantics (`poland` also
  returns Europe / EMEA / Anywhere rows), so nothing a search could want is
  lost, and the US-only rows a European search never wanted stop arriving.
  A search that hunts anywhere, or a place Jobicy has no slug for, falls
  back to the whole feed. Verified live: an unknown slug returns an EMPTY
  feed, which is why only the 13 slugs the API echoed back are ever sent.
- Every fetcher now receives the searches' places (`FetchContext`, the
  union of the active non-blank profiles' countries and regions, built once
  per tick); sources without a geo filter ignore it. Plan §4.2, stage 3a.

## [1.25.0] — 2026-09-03

### Added
- **A search says where it hunts.** The profile's six region pills and two
  booleans are gone; a search now lists `countries` (ISO codes), `regions`
  (groups — 🇪🇺 European Union, Europe, DACH, Nordics, 🌍 Worldwide …, a group
  stored as a group) and the arrangements it accepts (remote / hybrid /
  on-site), next to its on-site cities. One migration maps the old pills —
  `US` and `UK` were countries wearing a region's hat and become countries —
  and drops the old columns, so no running deployment ever sees two models.
  The editor is one control: arrangement pills, a country chip input with
  gazetteer suggestions (type "Poland", "Polska", "Польща", "PL" or "Kraków",
  arrow down, Enter), region pills; without JavaScript the textarea takes any
  spelling the gazetteer knows. ADR 0032.
- **The base filter compares sets.** A posting reaches the classifier when
  its countries or regions overlap the search's, with groups expanded on both
  sides — Poland sits inside an EU search, "Europe" on a posting reaches an EU
  search, Worldwide reaches everyone. A listed on-site city still admits
  outright; an arrangement the search does not accept rejects; a posting that
  names no place goes to the model as before. Hybrid postings no longer reach
  a remote-only search (0 of 65 had ever matched).
- **The classifier prompt no longer assumes a US search.** Its location rules
  speak codes and groups, distinguish EU (law) from Europe (geography),
  require the office's city or country for hybrid and on-site roles, and never
  infer remote eligibility from an office address. The reply gains a shared
  `location` block — the posting's own place, read once like salary — which
  may only narrow what the parser found (an arrangement where the parser had
  none, a country list the description made stricter); rows it changed carry
  `locationSource = ai`, and the backfill leaves them alone.
- **The job page says why.** Next to "location mismatch" a search's verdict
  now reads "open to Poland; this search hunts in United States, Americas" or
  "hybrid role; this search accepts remote" — built from the columns, no AI
  call; nothing is added when only the summary can explain it.
- `GET /countries.json` serves the gazetteer to the browser.

### Changed
- Every profile construction site (`blankProfileInput`, the first-boot
  bootstrap, the wizard, "create a search from a resume") now starts from
  `countries: []`, `regions: []`, `workplace: [REMOTE]` — anywhere, remote.

## [1.24.0] — 2026-09-03

### Added
- **Jobs know where they are.** Every job row now carries `workplace`
  (remote / hybrid / on-site / unknown), `countries` (ISO codes) and
  `regions` (the markers a source names: EU, Europe, EMEA, Worldwide, …),
  next to the location string, which is never rewritten. A pure parser over
  a hand-written gazetteer of 86 countries fills them (`src/location.ts`,
  `src/countries.json`), and fourteen fetchers now pass what their feeds
  already said in structured fields — WWR's `<country>` allow-list and
  `<region>`, Lever's ISO `country`, Workable's `locations[]` (the full list
  of countries a remote post accepts, which nobody had read before),
  Recruitee, Breezy, Ashby, Himalayas, 4dayweek and the arrangement flags of
  the rest. The parser is a hint layer with its traps as tests: "Atlanta,
  Georgia" is the US and "Tbilisi, Georgia" is Georgia, "Portland, OR" is a
  state and "Remote · DE" a country, "US" never fires inside "Russia", "UK"
  is not the EU, and a bare "Remote" is remote with no country — never
  worldwide. Every one of the 250 distinct location strings the database
  held is pinned in `src/location-corpus.json`. ADR 0031 records the
  semantics: for remote rows the countries are where you may live, for
  hybrid and on-site rows where the office is; geography (`EUROPE`) and law
  (`EU`) are different codes.
- **Country, workplace and date facets on `/jobs`.** A "Where" row of chips
  with counts — 🇺🇸 United States 601, 🇨🇦 Canada 135, 🇬🇧 United Kingdom
  52, 🇵🇱 Poland 30 … and "Unknown" for the rows nothing places — OR'ed
  within the row, "More…" for the rest; "Work" chips (Remote / Hybrid /
  On-site / Unknown); "Posted" chips (24h / 7 days / 30 days). Each facet's
  counts respect the other filters, so a chip's number is what clicking it
  shows. The search box now matches the location string too. The job page
  shows the arrangement and one flag chip per country or region under the
  raw location, each a link into the facet.
- **`backfill-locations.js --dry-run`** fills the columns on jobs stored
  before this release from the string alone — no AI call — and prints the
  distribution to check before the real run. On the live database: 1 021 of
  1 038 rows filled in under a second; the checksums of every verdict and of
  every `location` and `description` were identical before and after.

### Changed
- The three arrangement regexes moved from `filter.ts` into `location.ts`
  and learned the non-English spellings ("Homeoffice", "praca zdalna",
  "віддалено", "home based"); the base filter reads them from there and
  keeps its behaviour.
- golangprojects: the flag emoji its titles used to carry are gone, so the
  region is read from the URL slug ("Remote · Europe") instead of a stale
  regex that returned "Remote" for everything.

## [1.23.4] — 2026-09-02

### Fixed
- **Deleting a resume said nothing about the searches hunting with it.** The
  confirm dialog counted the three Cascade children — comparisons, cover
  letters, strength reviews — and stopped there. Two `SetNull` consequences
  stayed invisible: a search linked to the resume silently lost the link and
  went back to guessing by skill overlap (`resume/pick.ts`), and applications
  recorded as sent with it kept their text snapshot but lost the name,
  degrading to "a deleted resume v4". The first is the one that bites — you
  do not find out until job pages start preselecting the wrong resume.
  Both are now counted and named. They get their own clause rather than
  joining the list of deletions, because they are the opposite of deleted:
  saying "and 1 search" would read as though the search went too. Same class
  as the v1.23.0 company fix, where "Delete Reddit and all its 73 jobs?" hid
  six applications and a cover letter; the resume half of that audit left the
  search link behind.

## [1.23.3] — 2026-09-02

### Fixed
- **The board read the whole ledger to date a handful of cards.**
  `/applications` loaded every `job_stage_event` row ever written, grouped
  them all by job, then used only the ones belonging to a card on screen.
  The ledger is append-only by ADR 0024 — it grows with every stage move
  forever — while the board is bounded by how many applications are open, so
  the read got steadily more wasteful with no ceiling. Measured on the live
  database: 26 rows loaded, 24 used, 2 discarded. Same class as the v1.11.0
  fix on this route, which pulled whole `Job` rows; that query at least had a
  `where`, this one had none. The query is now scoped to the jobs the board
  draws, and an empty board skips it entirely. The grouping moved out of the
  route into `stage-time.ts:groupEventsByJob`, where it is unit-tested.

## [1.23.2] — 2026-09-02

### Fixed
- **Three cards had a button on a line of its own.** A layout pass over every
  dashboard page, prompted by "on some pages the buttons are scattered — one
  sits higher than another".
  - `/jobs/:id` — v1.11.0 wrapped the "Applied with" select and **Mark
    applied** in one form so the select's value would post with the button,
    which pushed the primary action onto its own line above Save / Dismiss /
    Re-classify. The two want opposite layouts: a full-width labelled field
    and a button on the shared row. They are now bound by the HTML `form`
    attribute instead of by nesting, so the select still posts and the button
    sits with its peers.
  - `/discovery` — `ToggleRow`'s action column was `flex-col`, so a card with
    an `extra` action drew **Run now** underneath **Disable**. It is a row now,
    wrapping only when the card is genuinely too narrow; the fix is in the
    shared primitive, so every future `extra` inherits it.
  - `/settings` → Notifications — its two toggles were bare siblings inside the
    card, touching, so the second row's button looked like it belonged to the
    first. Same `space-y-5` wrapper and rule the General tab already used.

## [1.23.1] — 2026-09-02

### Fixed
- **The cross-origin guard reads the two headers it was given in v1.20.0.**
  Merging the two CSRF implementations (#93 and #87) taught the check to
  consult `Referer` when a browser sends no `Origin`, and `X-Forwarded-Host`
  when a reverse proxy rewrites `Host` — but the middleware went on passing
  three headers to it, so the running dashboard kept the old behaviour: a
  foreign `Referer` was not refused, and a dashboard behind a proxy refused
  its own forms. Every unit test stayed green because they call the pure
  function directly. The wiring now lives in `src/web/origin-guard.ts` with
  tests that drive a real Hono app — the shape PR #87 used, and the one that
  catches this class of bug. Caught by the live smoke run, not by the suite.

## [1.23.0] — 2026-09-02

The pre-public audit: six checks nobody had run against this project as an
outsider would (TASKS §14). Two of them found something.

### Security
- **The database is no longer published to your whole network.** `docker
  compose up` published Postgres on **every interface** with the password that
  sits in the compose file, so anyone on the same Wi-Fi could read the entire
  database — jobs, resumes, cover letters, applications, and any AI key pasted
  into the dashboard (`AppSettings.aiKeys`, stored in plaintext by design).
  Demonstrated from another address before the fix. It is now published on
  **`127.0.0.1:5433`**: loopback only, and on 5433 so it cannot be shadowed by
  a Postgres already running on 5432. The app never used this port — it reaches
  Postgres over the compose network — so only host tools are affected: use
  `localhost:5433`.

### Added
- **Backup and restore, documented and verified.** A project whose whole pitch
  is "your data in your own Postgres" had no instructions for keeping it. The
  README now carries both commands; the dump they produce was checked (8.7 MB,
  all 16 tables) and reloaded into an empty database with no errors.

### Fixed
- **The setup wizard no longer runs a scoring pass with no AI connected.** Step
  1 can be skipped, and step 4 would then spend a minute failing ten calls one
  by one before admitting nothing could be scored. It now says so before
  starting and sends you back to step 1 — the jobs already found stay put.
- **Deleting a company says what goes with it.** The confirm counted the jobs
  only; on real data "Delete "Reddit" and all its 73 jobs?" was hiding six
  tracked applications and a cover letter. It names them now, the way the
  resume delete has since v1.19.0.

## [1.22.0] — 2026-09-02

### Added
- **The review's questions can be answered, and the answer changes the next
  one** ([ADR 0030](docs/adr/0030-resume-strength-review.md) phase 3, TASKS
  §12). The strength review refuses to invent a number: where a stronger line
  needs one your resume doesn't carry, it asks instead. That was a dead end —
  nothing could be answered, so the next run asked again. Now each question
  has a box: the answer is stored on the resume and read into the next review,
  which writes the figure into the rewritten line and stops asking. Measured
  on a real resume: 4 questions, 2 answered, re-run asked **2** and both
  figures appeared verbatim in the rewrites.
- **What moved since the last review.** A second run of the same resume now
  says whether the edits worked — the score before and after, and every
  dimension whose grade changed. When the two runs used different rubric
  versions it says so instead of subtracting them, because that difference is
  not a measurement.
- **Facts can be added and flipped from `/resumes`.** The "do you have this?"
  answers fed every future comparison but could only be created by a
  comparison that happened to ask. Add a skill nothing asked about, or turn a
  wrong answer around, from the resumes page. No AI call either way.
- **Rename a resume.** The name is what every picker, flash and "applied with"
  line says, and it used to be whatever the uploaded file was called.
- **Comparisons group per job.** Re-checking one posting used to produce
  unrelated rows; they now read as one progression — *5 runs · 62 → 70 → 64 →
  66 → 68*, each score still its own link, with the change since the previous
  run beside the latest score.

### Changed
- `REVIEW_PROMPT_VERSION` 1 → 2: the rubric now receives the candidate's
  supplied metrics and is told to write them in rather than ask again — and
  told, just as explicitly, that a metric the document does not carry is a
  reason for advice, never for a better grade. The resume is graded as
  written.

### Schema
- `resume.answers` (JSONB, default `[]`) — hand-written migration
  `20260902200000_add_resume_answers`. On the resume rather than the review
  row: an answer is a fact about the document and has to outlive the run that
  asked for it.

## [1.21.0] — 2026-09-02

### Added
- **"Applied with" on the Application tracking card** (#75). Until now only
  the "Mark applied" button ever recorded which resume went out; dragging a
  card into Applied on the board, or filling in the application form, left it
  blank with no way to say afterwards. In the live database that was **eight
  applications and not one recorded resume**. The form now carries the
  question, and a job that is in the funnel with no answer says so — with the
  resume the page would have guessed, named in the hint rather than
  preselected. Moving a card cannot ask, and the app does not answer for you.
- **"The text that went out"** (#74). The resume snapshot stored with every
  application has been written since v1.11.0 and read by nothing. It is now a
  disclosure on the job page: the words as they were on the day, which is the
  point of storing them — a resume version is edited in place, so the name and
  the number stop being an answer the moment you upload a new one.

### Fixed
- **A profile saved against a deleted resume or Telegram target says so**
  (#73). Both ids come from dropdowns rendered when the page loaded; deleting
  either row in another tab used to answer the save with a raw foreign-key
  error — a 500 page with a constraint name on it, and the whole edit lost.
  The save now checks first and flashes "That resume no longer exists —
  reload the page and pick another one. Nothing was saved."

## [1.20.0] — 2026-09-02

### Fixed
- **Two tabs no longer lose an AI key** (#72). Saving a key read the whole
  `aiKeys` map, merged one engine in and wrote the map back, so two saves in
  flight kept only the later snapshot — the other engine's key was gone. The
  merge is now a single `jsonb_set` statement: the database merges, and there
  is no window to lose. Measured on a scratch database: two saves in flight,
  before → one key stored, after → both.
- **The eight-search ceiling is no longer advisory** (#70). Counting the
  running searches and then flipping the row is check-then-act: two
  activations both read seven, both passed, nine searches ran. The count and
  the write now happen under one row lock. Measured: seven running, two
  activations in flight, before → 9 running, after → 8.
- **A second submit joins the run in flight instead of starting a second one**
  (#76). `SUBMIT_ONCE` disables buttons in the browser, which cannot help a
  second tab, a re-POSTed reload or a client with scripting off. Every POST
  that starts an AI run — compare, full analysis, suggestions, cover letter,
  scan, strength review, the wizard's steps, `/target` and `/letter` — now
  names the work it is doing, and a request for work already running is
  redirected to it. Repeating a *finished* run still starts a fresh one.
- **A confirmed fact no longer drops your keyword overrides out of the score.**
  The `/facts` re-score skipped `effectiveKeywords`, so answering a question on
  a comparison you had re-levelled recomputed the number as if you never had.
  Both re-score paths now share one locked function.

### Security
- **Cross-origin writes are refused** (#69). A page open in the same browser
  could POST to the dashboard on `localhost:4747` — change a setting, delete a
  resume, overwrite an AI key — because a form POST needs no permission from
  the target site. Every state-changing request is now checked against the
  headers a browser attaches itself (`Origin`, `Sec-Fetch-Site`). No tokens, no
  session store, and `curl` still works: a request with no browser origin
  headers at all is not the attack this stops. `Sec-Fetch-Site` decides
  whenever the browser sends it — a dashboard rendered in a sandboxed frame
  posts to itself with an opaque `Origin` *and* `Sec-Fetch-Site: same-origin`
  (measured, not assumed), and no cross-site page can produce that pair.

## [1.19.0] — 2026-09-02

### Added
- **"Is this resume strong?"** ([docs/resumes-plan.md](docs/resumes-plan.md)
  §B, [ADR 0030](docs/adr/0030-resume-strength-review.md)). A new card on
  `/resumes/:id` answers the question the app could not: not "does this fit
  that job", but does this document read like a strong professional at the
  level it claims. **Six dimensions** — first impression, impact & outcomes,
  seniority signal, clarity & structure, skill evidence, wording & polish —
  each graded with quotes from your own text.
- **The model grades; the code scores.** The prompt is forbidden to output a
  number: weights (impact 30, first impression 20, seniority 20, clarity 15,
  evidence 10, polish 5) and two hard caps live in `review-score.ts`. A resume
  whose bullets list duties instead of outcomes cannot pass **55** however
  polished the rest is, and two weak dimensions cap it at **45**. Live on a
  real resume the caps turned a raw 70 into a 45 — the weights alone would
  have called it above average.
- **Advice that asks instead of inventing.** Every item points at a verbatim
  line and either rewrites it using facts already in your resume, or asks you
  for the number a stronger line would need ("which services were consolidated
  for the six-figure saving?"). Across 23 items in the first live runs, not one
  invented a fact — several rewrites *removed* unsupportable percentages.
- **Strength column on `/resumes`**, with a badge when a review has aged behind
  the resume it read, and a "Keep these" list so you don't edit away what works.
- Progress is the usual run page: the rubric is walked step by step, no spinner.

### Changed
- The review never runs on its own — not on upload, not on a version save. One
  button, one AI call, about a minute; the card explains what it checks before
  you press it.
- Once a review has read the current version, the scan's "Issues to fix" list
  folds into a disclosure behind it. One advice surface, never two.

## [1.18.0] — 2026-09-02

### Added
- **Rebuild keywords** ([docs/target-plan.md](docs/target-plan.md) §4 F7,
  TASKS §13). Every comparison of the same posting has been reusing the first
  run's keyword list on purpose, so scores stay comparable between resume
  versions — but a word the model missed on run 1 stayed missed on every run
  after it. The keyword table now carries a way out: one run with the stored
  list withheld, so the model reads the terms out of the posting again.
  Measured on a real posting: the carried list had been repeating the same 26
  terms through five analyses; the rebuild found 30, including **BullMQ** and
  **GCP PubSub** — both named in the job description, neither ever listed.
- **A prompt bump no longer inherits the old prompt's keywords.** When the
  analysis prompt changes, the stored list was written under rules the new one
  does not follow, so it is not offered to the model at all.
- **A rebuilt analysis says the score is not comparable** instead of showing a
  delta against the previous one: the two count different terms, and a −3 that
  means "different list" reads exactly like a −3 that means "worse resume".

### Changed
- A rebuild skips the reuse memo. Without that it would answer with the very
  analysis whose keyword list the user asked to replace.
- **Your keyword edits survive a rebuild.** Re-levelled, ignored and
  hand-added terms are re-applied to whatever the fresh run returns — a
  rebuild resets the model's guess, never your decision.
- `resume: matched` logs which frame the run used (`carried`, `first-run`,
  `rebuild`, `prompt-bump`) next to the keyword counts.

### Closed without building
- `match-split-frame` (a cached per-job keyword frame + a statuses-only call),
  the one block of the compare-speed plan left open. The gate was "only if the
  measurements demand it": the quick check now runs at a p50 of 15 s on the
  bench fixtures and 40-42 s on one of the longest postings we store, against
  a 30-40 s target — so the block is closed by the numbers rather than built.
  Details in TASKS §13.

## [1.17.0] — 2026-09-02

### Added
- **Your say over every keyword** ([docs/target-plan.md](docs/target-plan.md)
  §5, TASKS §13 block 5). Each row of the keyword table now carries three
  edits: **re-level** what the posting demands (must ↔ preferred ↔ nice ↔
  context), **ignore** a term as noise, or **add** a word the model missed.
  All three are arithmetic over the stored analysis — the score is recomputed
  by `score.ts` on the spot, the same free path a confirmed ask_user fact
  takes. No AI call is made, and the flash says so: *"system scalability" is
  now nice — score 66 → 67, no AI call.*
- An added term's status is **read from your resume, never guessed**: written
  in → matched; not written → a confirm question the existing ask_user flow
  answers. A term the posting does not literally contain is flagged *not in
  posting*, exactly as a paraphrase from the model would be.
- **Overrides stick to the posting.** They ride in the comparison's own
  `keywords` JSON, go into the next run's keyword frame, and are re-applied to
  the fresh reply afterwards — including a hand-added term the model did not
  repeat, whose status is re-read against the current resume text. An override
  is kept even when the model comes to agree, because the point of it is that
  the level stops depending on the next reply.
- **Visual weight in the panes.** A missing must-have no longer looks like a
  missing nice-to-have: every mark and chip is graded `kw-w0` (context) to
  `kw-w4` (a primary-stack must) from one shared function, with the legend
  showing the three tiers.
- **Frequency as a tiebreaker.** Equal-weight keywords are ordered by how
  often the posting repeats the term, the count shows in the keyword table
  (*×4*) and in every pane tooltip (*×4 in the posting*). It costs nothing:
  the panes already had every occurrence in hand.

### Changed
- The keyword table orders through the matcher — hardest requirement first,
  then frequency, then priority — instead of sorting by requirement alone, and
  gained a third group for ignored rows so they can be brought back.
- `PROMPT_VERSION` is untouched: this is post-processing, not a prompt change.

## [1.16.0] — 2026-09-02

### Added
- **A comparison is a quick check by default; the edit suggestions are a
  second call** ([docs/target-plan.md](docs/target-plan.md) §3.2 items 6-7,
  TASKS §13 block 4, [ADR 0029](docs/adr/0029-quick-check-and-lazy-suggestions.md)).
  **Compare** on `/jobs/:id`, **Re-check with AI** on the targeted view and
  the **Compare** button on `/target` now run one shorter call that returns
  exactly what the score is computed from — every keyword with its
  requirement level, primary flag and status, the alignment grades, the
  hard-requirement gates and the red flags. The number is identical to
  before, because `score.ts` never read the suggestions.
- **Get suggestions** fills a quick check in afterwards: a second call that
  reads the stored verdicts and writes only what to change, what to remove,
  what already sells you and the soft concerns. The verdicts and the score
  are not re-judged, so a filled-in analysis equals one that was full from
  the start, and asking for a full analysis of text already quick-checked
  costs the suggestions call alone.
- **Full analysis** stays one click away everywhere the quick check runs, and
  is what the cover-letter flow asks for (a letter leads with strengths).
- **The tiered keyword budget** ([docs/target-plan.md](docs/target-plan.md)
  §4 F1): every `must` and `preferred` term the posting names is always
  listed; the soft cap of ~25 keywords now applies only to `nice` and
  `context` terms, so an important word can no longer fall off the end of a
  long list.

### Changed
- `PROMPT_VERSION` 5 → 6, once, for all three prompt changes. Analyses stored
  under v5 are no longer reused for a new run, which is what a bump means.
- The two match prompts are assembled from the same rule constants, so the
  quick check carries the primary-stack gate, the verbatim rule, the
  consistency rule and the red-flag rules verbatim — the guard tests assert
  every one of them against **both** variants.
- Progress pages name what is running: *Quick AI check*, *Full AI analysis*,
  *Edit suggestions*, each with its measured duration.

### Measured (2026-09-02, `claude_code` CLI engine, 5 gold fixtures per run)
- Opus, quick check vs full report, prompt v6: **p50 15 s vs 24 s**, 77 s vs
  116 s for the whole suite, **2591 vs 4373 reply characters**; all checks
  green in both, keyword statuses agreeing 98%.
- Sonnet was measured for the resume role and **is not the faster option
  here**: p50 52 s full and 26 s quick against Opus's 24 s and 15 s, at 95%
  and 93% status agreement and 77% term overlap (a less stable keyword frame
  than Opus's 88%). The default `CLAUDE_MODEL_RESUME` stays `claude-opus-5`;
  the per-engine "Resume model" select on `/settings` remains the speed dial.
- Live on job #1393 (Docker, Opus, a 4 988-character posting): the quick
  check took **40 s and scored 66 — the same number the v5 full analysis
  gave**; "Get suggestions" then took 35 s and wrote 10 edits and 8 removals
  onto the same row. A full analysis of the same pair took 77 s.
- All four bench runs (both models × both modes) passed every gold check.

### Notes
- No schema change: the mode marker rides inside the `breakdown` JSON next to
  the prompt version, and rows written before it read as full analyses,
  which is what they are.

## [1.15.0] — 2026-09-02

### Added
- **Instant check: a re-uploaded resume is scored in the editor before the
  AI is asked** ([docs/target-plan.md](docs/target-plan.md) §3.2 item 5,
  TASKS §13 block 3). "Re-upload resume" on the targeted view now defaults
  to **Upload & check**: the file (.pdf / .docx / .md / .txt) is parsed and
  opens in the editor as an unsaved draft over the analysis the page showed
  — live estimate, missing-keyword chips and highlights, the same formula as
  the AI score. Nothing is written: no new version, no scan, no match row;
  the draft lives in the browser tab (a reload keeps it) until **Re-analyze
  with AI** makes it official or **Save as vN** keeps the text. The page
  says what the number is — *"Estimate vs the analysis from 40m ago"*: the
  text confirms what is present, while add / confirm / can't-claim keep the
  AI's verdict on the analysed version until the re-analysis. **Upload as
  vN & analyze with AI** keeps the previous behaviour (new version with the
  file, AI match, scan in the background) one click away. `/target` answers
  the same way when the pasted posting dedupes to a job this resume was
  analysed against before and its text changed since.
- Measured on the stored originals: parsing takes 0–2 ms (.docx) and
  10–15 ms (.pdf, 64 ms cold); a re-upload lands on the rendered page in
  ~30 ms server-side (POST + redirect + GET) and ~155 ms to `load` in the
  browser, against the 95 s of the full run measured in 1.13.0. The
  `resume: upload parsed` and `resume: instant check` log lines carry the
  `ms`.

### Notes
- Known cost, stated on the page: after an instant check **Save as vN**
  stores the text as a text version — the uploaded file itself does not
  become the version's original. *Upload as vN & analyze with AI* (or
  "Upload a new version" on `/resumes/:id`) is the path when the file must
  be kept.
- The draft waits between the POST and the page in web-process memory
  (`src/web/draft-stash.ts`: 10-minute TTL, taken once) and is copied into
  `localStorage` on first render. No schema change, no migration.

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

[1.23.4]: https://github.com/applypack/applypack/compare/v1.23.3...v1.23.4
[1.23.3]: https://github.com/applypack/applypack/compare/v1.23.2...v1.23.3
[1.23.2]: https://github.com/applypack/applypack/compare/v1.23.1...v1.23.2
[1.23.1]: https://github.com/applypack/applypack/compare/v1.23.0...v1.23.1
[1.23.0]: https://github.com/applypack/applypack/compare/v1.22.0...v1.23.0
[1.22.0]: https://github.com/applypack/applypack/compare/v1.21.0...v1.22.0
[1.21.0]: https://github.com/applypack/applypack/compare/v1.20.0...v1.21.0
[1.20.0]: https://github.com/applypack/applypack/compare/v1.19.0...v1.20.0
[1.19.0]: https://github.com/applypack/applypack/compare/v1.18.0...v1.19.0
[1.18.0]: https://github.com/applypack/applypack/compare/v1.17.0...v1.18.0
[1.17.0]: https://github.com/applypack/applypack/compare/v1.16.0...v1.17.0
[1.16.0]: https://github.com/applypack/applypack/compare/v1.15.0...v1.16.0
[1.15.0]: https://github.com/applypack/applypack/compare/v1.14.0...v1.15.0
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
