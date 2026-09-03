# Country-aware search plan (Europe + Ukraine)

> Analysis 2026-09-03, nothing built yet. Answers three questions the owner
> asked: can ApplyPack search and filter by country the way LinkedIn does,
> which European and Ukrainian sources can be fetched legally, and how to
> filter the jobs already in the database. Backlog ticks live in
> [TASKS.md §15](./TASKS.md). Pairs with [CLAUDE.md](../CLAUDE.md),
> [ADR 0005](./adr/0005-no-linkedin-indeed-workday.md) (sources policy, its
> addendum now carries every source evaluated here), the testing-gate and
> commit-discipline skills, and the delivery process in
> [feature-expansion-plan.md §0](./feature-expansion-plan.md).
> The published report this plan condenses: «Атлас пошуку»
> (claude.ai artifact 6d1ce11d-2189-4971-9091-1b2029ebd2a5).

**Ground rules for everything below**

- **Analyse before every stage, in writing.** Each stage opens with a
  "Pre-work analysis" checklist. It is done before the branch exists, and its
  result is a short *analysis note* (10–20 lines) at the top of the PR body:
  what the plan assumed, what is different today, which design choice was
  taken and which simpler alternative was rejected and why. A stage whose
  note says "nothing changed" is fine; a stage without a note is not ready.
- **Simple and powerful, in that order.** One model for location (three
  columns), one pure parser, one gazetteer file, one place per concern. Power
  comes from the structure (countries + regions + workplace on every row)
  and from the classifier reading the whole description — not from more
  toggles. When two designs work, the one with fewer moving parts wins.
- **Readable over clever.** Names say what a thing is (`countries`, not
  `geo`), constants sit at the top of the file with a one-line reason, and a
  reviewer who has never seen the branch should follow the diff without the
  PR description. No regex that needs a comment longer than itself: split it.
- **Convenient in use.** Every user-facing step is judged by what a person
  does on the page: pick countries in one control, see counts before
  clicking, understand *why* a job was dropped, never edit a hidden setting.
  Copy is plain language (DESIGN.md), keyboard-reachable
  (`accessible-interactions`), and works in light and dark.
- **Facts expire.** Every endpoint, vocabulary and number in this document
  was observed on 2026-09-03. Re-verify at implementation time (curl,
  fixtures); a source that grew a bot check or changed shape is dropped or
  re-evaluated, never worked around (ADR 0005 addendum rules 1 and 2).
- **Nothing here supersedes ADR 0005.** No LinkedIn / Indeed / Glassdoor /
  Workday / Wellfound, no scraping, no headless browsers. Two open policy
  questions (§6) are the owner's to decide before the stages that need them.

---

## 0. What the analysis found (facts — don't re-derive)

### 0.1 The product is US-centric through the profile and the prompt, not the sources

Greenhouse, Lever and Ashby boards are global. On 2026-09-03 the live
database already held European rows — London 25, Remote Poland 27, Remote
Spain 17, Berlin 10, Paris 5, Sofia 5, Remote UK 5 — and they were all
rejected by the running profile, not by any fetcher.

| Live database, 2026-09-03 | Rows |
|---|---|
| Jobs | 1 038 (Greenhouse 772, Jobicy 48, HN hiring 44, WWR 31, Rippling 27, Manual 25, Ashby 20, Himalayas 20, 4dayweek 17, LaraJobs 13, Lever 6, RemoteOK 5, Working Nomads 3, Remotive 3, HN jobs 2, Recruitee 2) |
| `location` with US markers | 596 |
| `location` with European markers | 151 |
| Bare `Remote`, no country | 51 |
| Explicit worldwide / anywhere | 2 |
| Empty `location` | 11 |
| `job_score.locationMatch = false` | **949 of 1 035** — both profiles are US / Americas |
| Red flags | `onsite-required-wrong-city` 227, `uk-only` 31, `eu-only` 18, `location-mismatch-us-candidate` 22, `canada-location-not-us` 13 |
| Profiles | #1 running, regions `US, Americas`; #4 paused, `US`; no on-site cities, hybrid off |

### 0.2 Where the code loses the structure

- `Job.location` (`prisma/schema.prisma`) and `NormalizedJob.location`
  (`src/types.ts`) are a single free-text `String`. There is no country
  column and no workplace column.
- `Profile` knows exactly six regions — `US, Americas, EU, UK, APAC,
  Worldwide` (`REGION_OPTIONS`, `src/web/pages/settings.tsx`) — as pill
  checkboxes, plus `remoteOk`, `hybridOk`, `onsiteCities`. A country, a
  residence or a relocation preference cannot be expressed. Two accidental
  workarounds exist: `onsiteCities` does a substring match on the whole
  location string (so "Poland" catches "Remote Poland", but the prompt then
  calls it an on-site city), and `priorityRules.regionsAny` phrases.
- `src/filter.ts` `REGION_PATTERNS` is six regexes; `EU` only knows
  "eu / europe / emea / european union". "Remote Poland" and "Berlin,
  Germany" carry no marker, so the base filter passes them to the AI. The
  real gate is the classifier's `location_match`.
- `src/classifier.ts` `CRITICAL — LOCATION MATCHING` is written for a
  "US-based search" (its words), `describeLocation` can only say
  `remote OK (regions: EU)`, and the red-flag examples are `eu-only`,
  `uk-only`.
- `/jobs` filters are `status, minFit, q, sort, verified, profile`
  (`src/web/routes/jobs.tsx`); `q` searches title and description but not
  `location`; the Location column shows the raw string.
- Fetchers flatten structured fields into the string and drop some outright:

| Source | Structured location it already sends | Today |
|---|---|---|
| WeWorkRemotely | `<region>` ("Anywhere in the World", "USA Only") **and `<country>`** — a comma list of flag + ISO name ("🇵🇱 Poland, 🇷🇴 Romania, … 🇺🇦 Ukraine") | both ignored; `location: 'Remote'` (`src/fetchers/weworkremotely.ts`) |
| Lever | `categories.location`, `country` (ISO-2), `workplaceType` (`onsite` / `remote` / `hybrid` — verified 2026-09-03, not "on-site") | string; `country` unread |
| Ashby | `location`, `isRemote`, `workplaceType`, `secondaryLocations[]`, `address.postalAddress.addressCountry` (name; present on 4 of 61 supabase rows) — most rows say `Remote, Global` / `Remote, AMER` / `Remote, EMEA` in the string | joined with " / " + "(Remote)" |
| Workable (v3) | `location.countryCode`, `city`, `remote`, `workplace` (`remote` / `hybrid` / `on_site`) — **and `locations[]`**, the full list of countries a remote post accepts (`countryCode` each, `hidden: true`; 5–6 per row on 2026-09-03). The richest eligibility list of any per-company vendor; the plan had missed it | string |
| Recruitee | `country_code`, booleans `remote / hybrid / on_site` | string |
| SmartRecruiters | `location.country` (ISO-2 lowercase), `remote`, `hybrid` | string |
| Greenhouse | `location.name`, `offices[].{name,location}` — free text only | first office |
| Pinpoint | `location.{city, province}`, `workplace_type` — **no country field at all**; `location.name` is a country name ("UK", "Germany") on the seeded board | string |
| Breezy | `location.country.id` is ISO-2, `is_remote` | string |
| Himalayas | `locationRestrictions[]` (ISO names as strings; docs say objects) | "Remote · Germany, Netherlands" |
| Remotive | `candidate_required_location` (free text) | "Remote · Europe" |
| 4dayweek | `locations[].{city,country,continent}`, `work_arrangement`, `timezones[]` | "Remote · Berlin, Germany" |
| Arbeitnow | `location` (free, DE/EN mixed), `remote` | string; **source seeded inactive** |
| Jobicy | `job_listing:location` (fixed vocabulary, comma-joined) | string |
| HN hiring | first-line pipe segment, e.g. "REMOTE (US only)", "Berlin, Germany \| ONSITE" | picked by position, qualifier unparsed |
| golangprojects | flag emoji in titles — **gone**; region now lives in the URL slug and a "Remote - " description prefix | `deriveLocation` is stale |
| RemoteOK | `location` = "City, " with an empty country, mojibake | unusable for countries |

### 0.3 The LinkedIn reference model (product behaviour, no automation involved)

- One location entity with a hierarchy: postal code → city/metro → state →
  country → "country cluster" (European Union, EMEA, NAMER, Nordics, MENA,
  UK and Associated Territories). Remote posts are tagged with a country or
  a cluster; on-site and hybrid posts need a city.
- A separate workplace-type facet: On-site / Hybrid / Remote (multi-select).
- Other facets: date posted, experience level, job type, salary, company,
  industry, function, title, Easy Apply, under 10 applicants.
- Known weakness: Remote and Location are independent fields. A role tagged
  "European Union" shows in all 27 countries while payroll exists in two;
  "worldwide" often means US-only in the fine print; there is no visa
  sponsorship facet.
- What ApplyPack can do that LinkedIn cannot: answer *"can I apply from the
  country I live in"* — the full description plus the classifier already
  produce a per-search `location_match`; it only lacks the inputs.

### 0.4 What the existing aggregators can already filter (verified 2026-09-03)

| Source | Request-side geo filter | Response value vocabulary | UA / PL / DE / UK / EU |
|---|---|---|---|
| Jobicy | `geo=` — 55 slugs: regions `anywhere, apac, emea, europe, latam`; countries incl. `ukraine, poland, germany, uk, usa` (no `eu`). Eligibility semantics: `geo=germany` also returns Europe / EMEA / Anywhere rows. Works on the API and the RSS (`jobs/feed?geo=germany&industry=engineering`; `job_categories=dev` ≡ `industry=engineering`). Credit + link-back required | fixed, comma-joined ("Germany", "Europe", "EMEA", "Argentina, …, Ukraine, USA") | yes / yes / yes / yes ("UK") / no — "Europe" + "EMEA" |
| Himalayas | `/jobs/api/search?country=DE&exclude_worldwide=true`, `worldwide=`, `timezone=UTC+1`; accepts ISO code, name or slug; data refreshed every 24 h; attribution required | fixed ISO names ("United States" 94/160, "Poland" 3, "Ukraine" 1) | yes (2 813 rows) / yes / yes (5 018 strict) / yes / no — a code list |
| 4dayweek | `country=Germany,Poland` (names or continents, OR), `work_arrangement=remote`, `posted_after=`; an unknown value returns the 141 rows with no location | fixed, geocoded | 160 / 337 / 599 / 2 675 / "Europe" 5 482 — but the board is mostly office jobs |
| WeWorkRemotely | none in RSS (HTML search has `country[]=DE` behind Cloudflare) | region: "Anywhere in the World" 192/203, "X Only"; country: ISO names with flags | via `<country>` |
| Arbeitnow | `visa_sponsorship=true|false`; `page=` via `links.next` (the fetcher reads page 1 of 650+); a UK twin at arbeitnow.co.uk answers 403 | free text: London 39/175, Berlin 22, "Deutschlandweit", "Remote (Deutschland)", "Homeoffice" | implicit |
| Remotive | none; the whole feed was 17 rows and ignored `category` / `limit` on 2026-09-03 (degraded, unverified whether temporary); 4 requests/day | free text | in lists |
| Working Nomads / LaraJobs / golangprojects | none | free text ("Time zone: CET (+/- 3 hours)", "Remote (UK)", "Remote Europe") | parser |
| HN Who is hiring | — | 207/216 first lines use " \| "; REMOTE 115, ONSITE 58, HYBRID 41; qualifiers "(US)" 23, "(EU)", "(Europe)", "(Poland or Romanian residents only)", "NO VISA (EU work authorisation required)", "DUTCH REQUIRED" | parser |

"EU" is a value nowhere; the nearest labels are "Europe", "EMEA", "EU
timezones". An EU filter is therefore a set of ISO codes **plus** a region
match — the reason the model has both `countries` and `regions`.

### 0.5 Sources verified for Europe and Ukraine (2026-09-03, docs + live request + robots.txt)

**Usable without a key**

| Source | Endpoint | Location data | Terms / robots | Notes |
|---|---|---|---|---|
| **DOU.ua** | `https://jobs.dou.ua/vacancies/feeds/?category=PHP&remote` (25 items; bare = 50 newest). Params: `category=` (59 names), `city=` (25 Ukrainian cities), `remote`, `search=`, `exp=0-1\|1-3\|3-5\|5plus`, `page=`; combinable | no location element — title suffix: `<Title> в <Company>[, $salary][, City…][, за кордоном][, віддалено]`; full HTML description | legal §2.5 forbids automated collection without consent, §3.2 CC BY-NC-SA 3.0; the feed is DOU's own interface (`utm_source=jobsrss`); `/vacancies/feeds/` allowed, no AI-bot rules | fine for a self-hosted personal tool with link-back; a hosted or commercial deployment needs written consent |
| **Djinni** | `https://djinni.co/jobs/rss/?primary_keyword=PHP&employment=remote&region=UKR` (29; bare = 100). Filters: `primary_keyword`, `region=UKR\|eu\|other\|worldwide`, `employment=office\|parttime\|remote`, `location=kyiv\|lviv\|…`, `country` (ISO-3), `exp_level`, `english_level`, `salary`, keyword includes/excludes, `page` | only title, link, description, pubDate, guid, category — location exists solely as the feed filter; company only in prose | terms cover posting and fees only; `/jobs/rss/` allowed; no AI rules | one Company row per filter combination |
| **solid.jobs** (PL) | `GET https://solid.jobs/public-api/offers/IT?campaign=applypack&pageSize=500&pageIndex=0` + `X-Api-Version: 1.0` — 1 442 offers, 3 pages | `locations[]`, `isRemote`, `isHybrid`, `salary{from,to,currency,period,employmentType}` (PLN, "UoP" / B2B), `skills[{name,level}]`, `experienceLevel`, HTML description | 300 req/min per IP; robots `Allow: /` — explicitly also for GPTBot, ClaudeBot, anthropic-ai, CCBot | cleanest fit with our rules; `campaign` slug mandatory |
| **GermanTechJobs.de / DevITjobs.uk / DevITjobs.nl** | `/rss` (827 / 1 141 / 242 items, 5–8 MB, ETag + Last-Modified) | title "Role @ Company [45.000 - 75.000 €]"; `content:encoded` with salary, requirements, technology list; **no city** (country = site) | no relevant disallow; `/api/jobs` deprecated | one fetcher, three Company rows (`atsToken` = host); use conditional GET. swissdevjobs.ch: Cloudflare even on robots → no |
| **Landing.jobs** (PT) | Atom `https://landing.jobs/feed` (54 entries, full HTML) | `lj:city`, `lj:country`, `lj:remote_policy` ("Full remote" / "Partial remote"), `lj:salary`, `lj:expires_at` | `/feed` allowed; **`/api/` disallowed** — the JSON API works but is off-limits | feed only |
| **JobTech JobSearch** (Arbetsförmedlingen, SE) | `GET https://jobsearch.api.jobtechdev.se/search?q=javascript&limit=100&published-after=…&remote=true` (swagger at `/swagger.json`) | `workplace_address{municipality, region, country, country_code, city, coordinates}`, `workplace_model`; filters `country, region, remote, abroad` | ads licensed CC0; no robots served | richest location model; Swedish text |
| **Arbeitnow** (already seeded, inactive) | `?page=N` via `links.next`; `visa_sponsorship=true` | `location`, `remote` | "please do not abuse", link-back appreciated | enable + paginate |
| euremotejobs.com | `?feed=job_feed&posts_per_page=50` | `job_listing:location` ("UK", "EMEA", "Worldwide", "Europe, Netherlands") | no AI rules | ~50 items, a third engineering — supplement |
| berlinstartupjobs.com | `/engineering/feed/` (12 items) | title "Role // Company", tags; description = company + "Read more" | only `/wp-admin/` | too thin for the classifier |

**Per-company ATS with a token-less public feed (new `AtsType` candidates)**

| Vendor · region | Feed pattern | Verified | Fields | robots | Verdict |
|---|---|---|---|---|---|
| **Personio** · DACH | `https://{slug}.jobs.personio.de/xml?language=en` (also `.personio.com`) | `holidu` 55 positions; `ottonova`, `everphone`, `personio` | XML `<position>`: `office` free text ("Munich, Germany", "Remote Italy"), `additionalOffices`, `employmentType`, `seniority`, `salaryInformation`, `jobDescriptions` (CDATA HTML). No country, no remote flag, no URL — build `/job/{id}?language=en` | none on per-company hosts | first. Documented (developer.personio.de `get_xml`, support 207576365). Without `?language=` the descriptions are empty; a 307 to personio.com means "no feed", not an error |
| **Teamtailor** · Nordics, UK, NL, DACH | `https://{slug}.teamtailor.com/jobs.rss` and `/jobs.json` (`per_page`, `offset`) | `tibber` (9); custom domain `jobs.tibber.com/jobs.rss` also 200 | RSS: full HTML, `remoteStatus`, `tt:locations/tt:location{name, city, country}`. JSON Feed: `_jobposting.jobLocation[].address.addressCountry` **ISO-2** | `Content-Signal: ai-train=no, ai-input=yes`; no ClaudeBot / GPTBot rules | second. RSS documented ("all of the data is publicly available"). Many customers are on custom domains (mentimeter, einride, voi, northvolt 404 on `*.teamtailor.com`) → `atsToken` must accept a host |
| **Homerun** · NL, BE, DE SMB | `https://feed.homerun.co/{subdomain}` (linked from every career page as `rel="alternate"`) | `dopper`; unknown → 404 "Company not found" | Atom: full HTML, job link, `department`, `location/name` free text, `type`, `salary_indication`. No country, no remote | www.homerun.co `Allow: /` for GPTBot, ClaudeBot, CCBot | third; keyed by subdomain even when the career page runs on a custom domain |
| **d.vinci** · DE mid-market, public sector | `https://{customer}.dvinci-hr.com/jobPublication/list.json?fields=small` | `smag-karriere` 32 rows | `jobPublicationURL`, `jobOpening.locations[].{name, country (ISO-2 per docs, null in sample), lat, lng}`, `salaryRange`, HTML sections | `Allow: /` | docs: "since 2022.11 the job publication api is always public"; admin may disable (403) |
| Bullhorn public REST · UK/NL/DE agencies | `https://public-rest{cls}.bullhornstaffing.com/rest-services/{corpToken}/search/JobOrder?query=(isOpen:1)` | `public-rest31 … /1BTV61` | `publicDescription` in list, `address.countryID` **numeric**, `willSponsor`, `willRelocate`, `salary` | none | documented but the identifier is a cluster + corp token pair from the customer's portal JS; country needs a lookup table — later, if ever |
| TalentLyft · Zoho Recruit · Jobsoid · Manatal | public list endpoints exist | weak (no description, or no structured location) or outside Europe | — | skip |

What the ten supported ATS already send is in §0.2; for Lever, Workable,
Recruitee, SmartRecruiters and Ashby "structured hints" means *stop
discarding a field the zod schema already parses*.

**Keyed, pending the robots-vs-licence ruling (§6.1)**

| Source | Countries | Endpoint | Data | Terms | robots |
|---|---|---|---|---|---|
| **Adzuna** | European: gb, at, be, ch, de, es, fr, it, nl, pl (no UA, IE, PT, SE, CZ) | `GET https://api.adzuna.com/v1/api/jobs/{cc}/search/1?app_id=…&app_key=…&what=…&where=berlin&distance=50&max_days_old=1&results_per_page=50` | `location.display_name`, `location.area[]` (["UK","London"]), lat/lon, `redirect_url`; **description is a snippet only** | free key; 25/min, **250/day**, 1 000/week; "Personal research" permitted; "Jobs by Adzuna" logo when listings are shown | `api.adzuna.com`: `Disallow: /` for all |
| **France Travail** Offres d'emploi v2 | France | OAuth2 client credentials (`api_offresdemploiv2 o2dsoffre`), `GET https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?motsCles=developpeur&range=0-149` | `lieuTravail{libelle, codePostal, commune, lat, lon}` (unverified without a token) | Open Licence 2.0 on data.gouv.fr, 10 calls/s | `api.francetravail.io`: `Disallow: /` |
| NAV pam-stilling-feed (NO) | Norway | JSON Feed, public token rotates, private by email | `workLocations[]`, HTML | free; deep-link to the source; remove inactive ads | none |

**Rejected or deferred** — reasons recorded in the ADR 0005 addendum
(2026-09-03 rows): Jooble (500 requests per key for its lifetime), Reed
(robots names AnthropicBot), Bundesagentur für Arbeit (leaked client id,
ToS 2a(3)), EURES (no official API, stub descriptions), Work.ua and
Robota.ua (Cloudflare), Happy Monday (AI-bot ban), GRC.ua (undocumented,
thin), JOIN (undocumented endpoint with the best location data — policy
call), Softgarden / HiBob / Jobvite / Factorial / Jobylon / Freshteam
(gated), SAP SuccessFactors / Oracle HCM / iCIMS / Cornerstone, eurotechjobs,
europeremotely, swissdevjobs, bulldogjob, theprotocol.it, pracuj.pl,
rocketjobs.pl, relocate.me, iamexpat, remote-europe.com, Lobby X, jobs.ua,
Talent.com, Welcome to the Jungle, Otta, XING, StepStone, Honeypot,
PeopleForce (per-employer key only).

**Ukrainian employers already on supported ATS** (boards hit live):
N-iX → Greenhouse `nix` (122 jobs; Ukraine 45, European Union 11, LATAM 10,
Poland 9), Ajax Systems → Lever `ajax` (200; `country` UA 109, Ukrainian
descriptions), Genesis → Breezy `gen-tech` (85; "Kyiv, UA" / "Київ, UA",
`is_remote`) — candidates for the "UA-friendly remote" starter pack, next to
Preply (Ashby, 105), Solidgate (Ashby, 54) and MacPaw (Recruitee, 18,
`country_code: "UA"`) that are in it. The pack's SmartRecruiters
`sigmasoftware` board holds exactly one legacy posting (Sigma Software moved
to its own site) — re-probe the pack. Workable answers 200 + name + 0 jobs
for EPAM, SoftServe, GlobalLogic, Grammarly, Intellias, Luxoft, wix, snap:
not board identity (gotcha 13, ADR 0017).

---

## 1. Target model

### 1.1 Job: three columns, one source-of-truth string

```prisma
enum Workplace { REMOTE HYBRID ONSITE UNKNOWN }

model Job {
  location        String                  // as fetched — display + prompt, never rewritten
  workplace       Workplace @default(UNKNOWN)
  countries       String[]  @default([])  // ISO 3166-1 alpha-2, e.g. ["PL","DE"]
  regions         String[]  @default([])  // EU EEA UK US AMERICAS LATAM EMEA APAC WORLDWIDE
  locationSource  String?                 // structured | parsed | ai — who decided
  @@index([countries], type: Gin)
  @@index([workplace])
}
```

Semantics to write into ADR 0031:

- `REMOTE` → `countries` = where the candidate may live (eligibility);
  `ONSITE` / `HYBRID` → where the office is. Several offices → all countries,
  `workplace` = the softest arrangement named.
- `regions` is either an explicit marker ("EU only", "EMEA", "Worldwide",
  "US time zones") or derived from countries (PL → EU, EEA). Geography
  ("Europe") and law ("EU") are different codes: `EUROPE` includes GB, CH,
  NO, UA; `EU` does not.
- Bare "Remote" is `UNKNOWN` with empty countries — never worldwide.
- The raw `location` is never modified (same principle as
  `apply-link.ts`: flags are added, the row's own text stays).

### 1.2 Profile: countries and groups, one workplace list, where you live

```prisma
model Profile {
  countries    String[] @default([])        // ["PL","DE","NL"] — remote or on-site
  regions      String[] @default([])        // ["EU","WORLDWIDE"] — groups, stored as groups
  workplace    Workplace[] @default([REMOTE])  // the Job enum, one vocabulary (amended 2026-09-03)
  onsiteCities String[]                     // unchanged — city-level precision
  residence    String?                      // stage 4: "UA" — where the candidate lives now
  relocation   String   @default("no")      // stage 4: no | yes | sponsorship
  // remoteOk, hybridOk, remoteRegions — removed after the data migration (§3.2)
}
```

Migration of existing rows (SQL, hand-written):

| Was | Becomes |
|---|---|
| `remoteRegions ⊇ {Americas}` / `{EU}` / `{APAC}` / `{Worldwide}` | `regions` gets `AMERICAS` / `EU` / `APAC` / `WORLDWIDE` |
| `remoteRegions ⊇ {US}` / `{UK}` | `countries` gets `US` / `GB` — both were countries wearing a region's hat (amended 2026-09-03, stage 2; the gazetteer has no `US` group) |
| `remoteOk = true` | `workplace` gets `remote` |
| `hybridOk = true` | `workplace` gets `hybrid` |
| `onsiteCities` non-empty | `workplace` gets `onsite` |
| empty everything | empty everything = "anywhere", exactly as today |

### 1.3 The three layers that fill the columns

```
fetchers ──locationHints──▶ parseLocation() ──▶ Job.{workplace,countries,regions}
   (structured fields)        (pure, gazetteer)         ▲
                                                        │ overrides when confident
                                  classifier ── location block (workplace, countries, regions)
```

- **Layer 1 — fetchers.** `NormalizedJob.locationHints?: LocationHints`
  (`{ countries?: string[]; regions?: RegionCode[]; workplace?: Workplace }`)
  filled only where the source sends structure. Fetchers keep returning
  `NormalizedJob[]` and never touch the database.
- **Layer 2 — `src/location.ts`** (pure): `parseLocation(text, hints?) →
  ParsedLocation`. Hints win over parsed text; the text fills what hints
  leave empty. Backed by `src/countries.json` + `src/countries.ts`.
- **Layer 3 — the classifier.** One shared `location` block in the existing
  output (next to `salary_min_usd`, which is also shared across searches):
  `{ workplace, countries[], regions[], note }`. Written by
  `jobs/score-store.ts` with `locationSource = 'ai'` when it is more specific
  than what the parser found. The per-search `location_match` stays — it is
  the eligibility verdict against one profile.

Why not "everything through AI": 1 038 rows × ~50 s per call on the CLI
(measured 2026-09-02) is a day of work; the parser handles the structured
80 % in seconds and the AI is spent on the 51 bare-"Remote" rows and the
ambiguous ones.

---

## 2. Stage 1 — `location-model`: structured location + backfill + facets (no prompt change)

**Goal.** Every job row carries `workplace`, `countries`, `regions`; the 1 038
existing rows are backfilled without an AI call; `/jobs` gets country,
workplace and date facets. No classifier change, no profile change — no
verdict moves.

**Why first.** It is the only stage that pays back on day one (151 European
rows become filterable immediately) and it carries no risk to scoring.

### 2.1 Pre-work analysis (before the branch)

- [ ] Re-run the §0.1 queries against the live database; record the new
      numbers in the analysis note (they are the acceptance baseline).
- [ ] Read `src/filter.ts`, `src/apply-link.ts`, `src/fingerprint.ts` and the
      three persist paths (`jobs/process-jobs.ts`, `jobs/manual-job.ts`, the
      `/target` route) — `parseLocation` is called at every site that stores
      a Job, exactly like `withApplyLinkFlags`.
- [ ] Dump 300 distinct `location` strings from the database (`SELECT
      location, count(*) … GROUP BY 1`) into a fixture; they are the parser's
      first test corpus and the dry-run's expected output.
- [ ] Decide the gazetteer scope by listing what the corpus needs: countries
      seen + the EU27, EEA, UK, CH, UA, US, CA, plus top cities for those.
      Anything beyond that is scope creep — the AI layer covers rarities.
- [ ] Check `tsconfig` `resolveJsonModule` (the starter-pack catalog already
      imports JSON) so `src/countries.json` can be the single data file for
      the server and, via a tiny route, for the browser.
- [ ] Re-verify WWR `<region>` / `<country>` element names on a live feed,
      and the vendor fields in §0.2 for the ten supported ATS (one curl each,
      recorded as fixtures next to the existing mapper tests).
- [ ] Write the analysis note: corpus size, gazetteer scope, which persist
      paths exist today, anything in §0.2 that changed.

### 2.2 Design

- `src/countries.json` — data only: `{ code, name, names[] (EN, local,
  Ukrainian), demonyms[], flag, currency, cities[], groups[] }` per country,
  and `groups: { EU: [...], EEA: [...], DACH, NORDICS, BENELUX, CEE, UK_IE,
  NORTH_AMERICA, LATAM, APAC }`. Roughly 70 countries. Hand-curated, sorted,
  no generated blobs.
- `src/countries.ts` — pure accessors: `findCountry(query)` (code, name in
  any language, flag, demonym, city), `countriesOf(group)`, `groupsOf(code)`.
- `src/location.ts` — pure. `parseLocation(text, hints?)`. Recognises, in
  order of confidence: hints → flag emoji → ISO codes in explicit positions
  (after "Remote ·", in comma lists) → country names / demonyms → cities →
  regional phrases ("EU only", "EMEA", "European time zones", "CET ±2h",
  "US time zones", "Americas", "Worldwide / anywhere") → language markers
  ("(m/w/d)" → DE/AT/CH low confidence, "praca zdalna", "télétravail",
  "віддалено", "за кордоном"). Workplace from the existing
  `REMOTE_RE / HYBRID_RE / ONSITE_RE` (moved here from `filter.ts`).
- `NormalizedJob.locationHints` + per-fetcher hint filling (§2.3 step 5).
- `src/scripts/backfill-locations.ts --dry-run` in the shape of
  `backfill-apply-link-flags.ts`: parse, write three columns, never touch
  `location` or `description`, print a distribution (countries, workplace,
  UNKNOWN count) so the run is checkable.
- `/jobs`: query params `country=PL,DE` (OR within the facet),
  `workplace=remote,hybrid`, `posted=24h|7d|30d`; facets are chips with
  counts (top 8 + "more…"), `aria-current` like the Verified chip; `q` also
  matches `location`. `where.countries = { hasSome }`; counts from one
  `unnest(countries)` group-by (raw SQL, as other summaries do).
- Job page: flag chips + workplace pill next to the raw location; the raw
  string stays in the tooltip and on the row.
- Deliberately **not** built here: geocoding, a country library dependency,
  city radius, timezone math, any prompt change.

### 2.3 Steps (one commit each, in this order)

1. `add countries gazetteer` — `src/countries.json`, `src/countries.ts`,
   `countries.test.ts` (lookup by code / name / Ukrainian name / flag /
   city / demonym; group membership; "Georgia" resolves only with context).
2. `add location parser` — `src/location.ts`, `location.test.ts` built from
   the 300-row corpus plus the trap table in §5.1. Move the three workplace
   regexes out of `filter.ts` (filter behaviour unchanged, its tests still
   green).
3. `add job location columns` — schema (`npx prisma format`), hand-written
   migration `add_job_location_fields`, `NormalizedJob.locationHints`.
4. `store parsed location` — call `parseLocation` at the three persist
   sites; `locationSource = 'structured'` when hints decided, `'parsed'`
   otherwise, `null` when nothing was found.
5. `pass location hints from fetchers` — one commit per vendor family:
   WWR (`region` + `country` via `customFields`), Lever / Ashby / Workable /
   Recruitee / SmartRecruiters / Pinpoint, Himalayas / Remotive / 4dayweek /
   Arbeitnow / Jobicy, HN (`REMOTE (…)` qualifier in `hn-parser.ts`),
   golangprojects (slug instead of the vanished flags). Each with a fixture
   test on the mapper.
6. `add backfill-locations script` — dry-run on the live database, then the
   real run; the distribution goes into the analysis note.
7. `add country facets to jobs list` — route params, where-clause, counts,
   chips, `q` on location.
8. `show location on job page` — chips + pill.
9. `document location model` — ADR 0031, CLAUDE.md "Where to look" rows
   (`src/location.ts`, `src/countries.json`, the backfill script), SPEC.md
   and ARCHITECTURE.md lines, CHANGELOG entry + version bump.

### 2.4 Verification matrix

| Change | Check |
|---|---|
| `countries.ts`, `location.ts` (pure) | unit tests next to the file; the corpus fixture; every §5.1 trap has a test |
| schema | hand-written migration; `npx prisma format --check`; migration applied on a scratch database from empty |
| fetchers | mapper tests on recorded fixtures; `npm run fetch:once` smoke against the live boards; source health unchanged |
| backfill | `--dry-run` distribution reviewed by hand (spot-check 20 rows incl. "Remote Poland", "Denver, CO - Hybrid; New York", "Remote · EU only", bare "Remote") before the real run |
| dashboard | rebuild web; screenshots light + dark of `/jobs` with two country chips active; keyboard-only walk through the chips; `title` tooltip still shows the raw string |
| performance | `/jobs` with `country=` uses the GIN index (`EXPLAIN` once, noted) |

### 2.5 Definition of done

- A user opens `/jobs`, clicks 🇵🇱 PL and 🇩🇪 DE, and sees the rows whose
  `countries` contain either, with counts on the chips that match the list.
- Bare "Remote" rows show as "Unknown", never as worldwide.
- No `Job.location` or `description` byte changed by the backfill.
- No verdict changed (compare `job_score` before/after: identical).
- `npm run lint:types && npm test` green; ADR 0031 merged with the code.
- Release: minor tag, notes name the facet and the backfill command.

---

## 3. Stage 2 — `profile-countries`: countries in the profile, a prompt without "US"

**Goal.** A search says which countries and groups it hunts in and which
workplace types it accepts; the base filter and the classifier read that;
the six pill regions are migrated away.

### 3.1 Pre-work analysis (before the branch)

- [ ] Read `src/profiles.ts` (`ProfileInput`, `blankProfileInput`),
      `src/profile-guards.ts`, `routes/settings.tsx` (`ProfileFormSchema`,
      `parseBody({ all: true })` — gotcha 1), `pages/settings.tsx`
      (`REGION_OPTIONS` and the Advanced block), `web/profile-from-resume.ts`,
      `routes/welcome.tsx` — every place a profile is built or edited. The
      compiler will list them once `ProfileInput` changes; list them first.
- [ ] Read `src/classifier.ts` `describeProfile`, `describeLocation`, the
      CRITICAL blocks and `MultiClassificationSchema`; count prompt tokens for
      1 and 8 searches before the change (the guard test in
      `prompts.test.ts` style).
- [ ] Pull 30 recent verdicts with `locationMatch = false` and their
      summaries: which of them would a country-aware prompt flip, and is that
      correct? This is the before/after fixture for the prompt rewrite.
- [ ] Decide the browser side of the country picker: dependency-free ES
      module in `src/web/public/countries.mjs` (pure search over the JSON the
      web process serves at `/countries.json`), tested via `import()` from a
      `src/web/*.test.ts` — same discipline as `score.mjs`.
- [ ] Confirm `MAX_ACTIVE_PROFILES` and the blank-profile guards keep their
      meaning: empty countries + empty regions = "anywhere", as empty regions
      are today.
- [ ] Write the analysis note: the persist/edit sites found, the token
      counts, the 30-verdict expectation, the migration SQL dry-run result.

### 3.2 Design

- Schema §1.2 (without `residence` / `relocation` — stage 4). Data migration
  as one hand-written SQL migration: add columns, `UPDATE` per the mapping
  table, drop the three old columns in the same migration, so there is never
  a moment with two models.
- Editor: one control. A typeahead input ("Poland, Polska, Польща, PL …")
  that adds flag chips; a row of group chips (🇪🇺 European Union, EEA, DACH,
  Nordics, Benelux, CEE, UK + IE, North America, LATAM, APAC, 🌍 Anywhere)
  that toggle a group as a group; three workplace pills (Remote / Hybrid /
  On-site); `onsiteCities` unchanged. The same control in `/welcome` and in
  "Fill from a resume".
- `filter.ts`: `FilterProfile` gains `countries`, `regions`, `workplace`;
  `FilterableJob` gains the three Job columns. Rule: job `UNKNOWN` or no
  countries → pass to the AI (as today); otherwise a set intersection that
  understands groups (PL ⊂ EU). `passesBaseFilter` stays single-profile,
  `passesAnyBaseFilter` the union (ADR 0028).
- Prompt: `describeLocation` → `remote from: EU, PL, DE, NL; hybrid/on-site
  in: Warsaw, Berlin` (codes, not names — keeps 8 searches short). The
  CRITICAL block becomes generic rules: country-locked remote, region-locked
  remote, worldwide, on-site/hybrid by city, "never infer eligibility from
  the office alone", "when in doubt → false". Output gains the shared
  `location` block (§1.3).
- `score-store.ts` writes the AI location when present and more specific
  (`locationSource = 'ai'`). "Save & re-classify" therefore fills the
  `UNKNOWN` rows; nothing else needs a special run.
- Job page: the "location mismatch" label gets a reason built from
  `Job.countries` / `regions` and the profile — no new AI call.
- `priorityRules.regionsAny` keeps matching the location string; it may
  additionally accept ISO codes and group codes (small, optional).

### 3.3 Steps

1. `add profile country fields` — schema, data migration, `ProfileInput`,
   `blankProfileInput`, every construction site the compiler names.
2. `serve countries json` — `GET /countries.json` from `src/countries.json`.
3. `add country picker` — `public/countries.mjs` + test; editor markup in
   `pages/settings.tsx`; save route + `ProfileFormSchema`.
4. `reuse country picker in welcome and fill-from-resume`.
5. `filter on countries` — `filter.ts` + tests (groups, unknown passes,
   on-site city still wins).
6. `describe countries in the prompt` — `describeLocation`, the CRITICAL
   block rewrite, guard tests for the new rules and for prompt length.
7. `parse location block from the classifier` — schema, `score-store.ts`,
   `locationSource = 'ai'`.
8. `explain location mismatch on job page`.
9. `document profile countries` — ADR 0031 amendment or 0032, CLAUDE.md
   rows, SPEC.md profile fields, README sentence, CHANGELOG + bump.

### 3.4 Verification matrix

| Change | Check |
|---|---|
| migration | dry-run on a copy of the live database: the two profiles map to `regions ["US","AMERICAS"]` / `["US"]`, `workplace ["remote"]`; then on a scratch database from empty |
| `filter.ts` | unit tests: PL job vs EU search (pass), "EU only" vs US search (reject), UNKNOWN (pass), on-site city wins |
| prompt | guard tests (rules present, no "US-based" wording, length cap); `npm run bench`-style spot run over the 30-verdict fixture, expected flips reviewed by hand |
| picker | `import()` tests for search (code, names in three languages, flag, city); keyboard: type, arrow, enter, backspace removes the last chip; light + dark screenshots |
| end-to-end | create a search "PL + DE, remote + hybrid", run "Save & re-classify" on 10 European rows, read the verdicts and the mismatch reasons |

### 3.5 Definition of done

- A search can say "remote from PL, DE, NL or anywhere in the EU; hybrid in
  Warsaw" in one control, and the prompt repeats exactly that back.
- The six pills are gone; nobody's existing search lost a preference.
- "Remote · Germany" is a match for a DE search and a mismatch for a US
  search, both with a one-line reason on the job page.
- The `UNKNOWN` count from stage 1 drops after one re-classify pass.

---

## 4. Stage 3 — sources: Europe and Ukraine (several small PRs, one tag each)

**Goal.** More European and Ukrainian postings enter the funnel, each
carrying country data from the source where it exists. The classifier keeps
deciding eligibility per search; sources only change what arrives.

Every fetcher follows the seven-step template in CLAUDE.md ("ATS templates")
and the new-fetcher acceptance checklist in
[feature-expansion-plan.md §0.3](./feature-expansion-plan.md). One source =
one PR = one tag; the ADR 0005 addendum register gets a row when a source is
adopted or rejected.

### 4.1 Pre-work analysis (before EACH source)

- [ ] `curl` the endpoint again with the project User-Agent: status,
      content type, item count, one full record saved as a fixture.
- [ ] Read `robots.txt` on the exact host again (AI-bot rules included).
- [ ] Re-read the terms line in §0.5; if the source needs attribution or a
      link-back, decide where it is shown (`/companies` source card).
- [ ] Decide the `atsToken` shape (slug, host, or country/category
      parameter) and write it in the fetcher's header comment.
- [ ] Map the record to `NormalizedJob` + `locationHints` on paper: which
      field is the id (never `''` — `feedItemKey`), the URL, the posted date,
      the description (HTML → `stripHtml` once, never twice — gotcha 12).
- [ ] Estimate volume per tick and check it against the source's limits.
- [ ] Analysis note: the four facts above plus anything that differs from
      §0.5.

### 4.2 Sub-stages in order of payback

**3a — use the geodata we already receive** (no new source)
- WWR: register `region` and `country` in `customFields`; `country` is the
  allow-list, `region` the coarse label. *(done in stage 1)*
- Jobicy: ~~one Company row per `geo` slug~~ — amended 2026-09-03: the one
  Jobicy row follows the running searches. `runAllFetchers` builds a
  `FetchContext` (union of the active searches' countries + regions) and the
  fetcher reads one `geo=` feed per slug it maps to, merged by guid. One row
  per slug would have stored the same posting under several company ids
  (the `(companyId, externalId)` key), and a hand-edited token is a hidden
  setting the plan's own ground rules forbid. *(done: v1.26.0)*
- Himalayas: switch to `/jobs/api/search?country=…&exclude_worldwide=true`
  per profile country, plus one `worldwide=true` row. *(done: v1.27.0 —
  one call per context country + one worldwide call, merged by guid; the
  API caps `limit` at 20 and ignores `offset`; groups cannot be expressed,
  so a groups-only search keeps the browse feed)*
- 4dayweek: `country=` from profile countries, `work_arrangement` hint.
- Arbeitnow: enable, paginate via `links.next`, map `remote`, expose
  `visa_sponsorship=true` as a second row.
- golangprojects: read the region from the URL slug.

**3b — Ukraine**
- `DOU` fetcher: RSS, `atsToken` = the query string (`category=PHP&remote`);
  title grammar parser `<Title> в <Company>[, $salary][, City…][, за
  кордоном][, віддалено]` as a pure function with tests; entities decoded
  after XML parsing; salary USD ranges kept in the description.
- `DJINNI` fetcher: RSS, `atsToken` = the filter string
  (`primary_keyword=PHP&employment=remote&region=UKR`); company from prose
  or blank; region hint from the filter itself.
- Starter pack "UA-friendly remote": add N-iX, Ajax Systems, Genesis;
  re-probe the eleven existing entries; drop or replace `sigmasoftware`.
- Docs line on DOU terms (self-hosted personal use, link-back kept).

**3c — European boards without a key**
- `SOLIDJOBS` (PL): JSON, `campaign=applypack`, `X-Api-Version: 1.0`,
  `pageSize=500`, salary in PLN with employment type, `isRemote/isHybrid`
  hints, `locations[]` → PL cities.
- `DEVITJOBS` family: one fetcher, `atsToken` = host
  (germantechjobs.de, devitjobs.uk, devitjobs.nl); conditional GET
  (ETag / Last-Modified) because the feeds are 5–8 MB; country hint = site.
- `LANDINGJOBS`: Atom feed only; `lj:country`, `lj:remote_policy` hints.
- `JOBTECH` (SE): JSON search with `published-after` = last tick;
  `workplace_address.country_code`, `workplace_model` hints; Swedish text is
  fine for the classifier, note it for resume matching.

**3d — European ATS types**
- `PERSONIO`: XML with `?language=en`; URL built from id; `office` → parser;
  probe = feed answers 200 with `<workzag-jobs>`; 307/429 = no feed.
- `TEAMTAILOR`: `jobs.json` (ISO country) with `jobs.rss` as fallback;
  `atsToken` accepts a bare slug or a host; `extractAtsToken` learns
  `*.teamtailor.com`.
- Later, same pattern: `HOMERUN` (Atom by subdomain), `DVINCI` (list.json).
- `probeAts`, `extractAtsToken`, seed entries (inactive unless the profile
  targets that market), mapper tests.

**3e — keyed sources, only after §6.1 is decided**
- Source keys in `AppSettings` following ADR 0027's shape (own accessor,
  masked, never logged, never in a URL that `fetchWithRetry` might put into
  an error message).
- `FRANCETRAVAIL`: OAuth client credentials, token cached per process,
  `range` pagination, `lieuTravail` hints.
- `ADZUNA`: one row per country code, `max_days_old=1`, a budget guard so
  the hourly tick never exceeds 250 calls/day, attribution shown wherever a
  listing is displayed; snippet-only descriptions flagged so the classifier
  and the match know the text is partial.

### 4.3 "Enable sources for your countries"

After stage 2, picking countries in a profile shows one suggestion card:
"Enable sources for 🇵🇱 🇩🇪 🇺🇦" → preview (which Company rows would be
created, with their tokens) → confirm → rows added disabled → "Enable all".
This is the starter-pack flow (ADR 0017) reused, driven by a pure
`suggestSources(countries) → CompanyDraft[]` in a module next to
`src/starter-packs/`. Small countries on an hourly tick will often report
`empty`; ADR 0019's two signals already handle that.

### 4.4 Definition of done (per source)

- Smoke run stores real rows with correct `countries` / `workplace` from
  hints; mapper test on a recorded fixture; source appears on `/companies`
  with its health; attribution shown where required; row in the ADR 0005
  register; CHANGELOG + tag.

---

## 5. Stage 4 — `eligibility`: where you live, relocation, currencies

**Goal.** The product answers "can I apply from where I live", which is the
question a Ukrainian or any non-US candidate actually has.

### 5.0 Pre-work analysis

- [ ] Read the stage-2 prompt and its guard tests; list the rules that
      change when `residence` and `relocation` exist.
- [ ] Collect 20 postings with "must have the right to work in …",
      "no visa sponsorship", "relocation package", "EOR", "B2B contract",
      "remote from Ukraine" — the fixture for the new red flags.
- [ ] Check how `salary_min_usd` is produced today for EUR / PLN / GBP
      postings (the model converts?) and how `minSalaryUsd` compares; decide
      between a conversion table with a monthly constant and a per-profile
      currency. Prefer the smaller change; write the alternative down.
- [ ] Analysis note.

### 5.1 Design

- `Profile.residence` (ISO-2, one select "I live in") and
  `Profile.relocation` (`no | yes | sponsorship`, three radios).
- Prompt rules: region-locked remote matches if the candidate lives in the
  region or holds the right to work there or the search lists it; on-site
  matches if the city is listed *or* the posting offers relocation and the
  search allows it; "no visa sponsorship" + `relocation = sponsorship` →
  mismatch with red flag `no-visa-sponsorship`; "right to work in X
  required" → `work-permit-required`.
- `/jobs` "Open to me" reads eligibility (per-search `locationMatch`
  already stored; residence makes it honest for EU-only rows).
- Telegram line: flags + workplace ("🇵🇱🇩🇪 · remote"); escape unchanged,
  verified with `npm run test:telegram`.
- Salary: separate small PR — either `salary_min_usd` conversion constants
  reviewed monthly, or `minSalary` + `salaryCurrency` on the profile. Decide
  in the pre-work note; do not bundle with the eligibility PR.
- Bench: three gold fixtures with European postings added to
  `bench:resume`-style guard runs for the classifier rules.

### 5.2 Definition of done

- A UA-resident search sees "Remote · EU only" as a mismatch with the
  reason "EU only; you live in UA without an EU work permit", and
  "Remote · Worldwide" as a match.
- An on-site Berlin role with "relocation package" matches a search with
  `relocation = sponsorship`; the same role with "no visa sponsorship" does
  not, and the red flag says why.

---

## 6. Open decisions (the owner's)

1. **Countries + groups, or countries only.** Recommendation: both, with a
   group stored as a group (`regions: ["EU"]`), because "European Union" as
   one chip is what people expect and 27 codes make the chips unreadable.
2. **Migrate and delete `remoteRegions`, or keep it beside the new fields.**
   Recommendation: migrate and delete in one migration (§1.2 table); two
   location models would drift.
3. **`residence` already in stage 2, or in stage 4.** Recommendation: stage
   4 as planned, unless stage 2's 30-verdict fixture shows most European
   false negatives are EU-only rows — then pull it forward.
4. **robots.txt versus a published licence for keyed APIs (§0.5).**
   `api.adzuna.com` and `api.francetravail.io` answer `Disallow: /` while
   their published terms allow programmatic use with a key. ADR 0005
   addendum rule 1 read literally rejects them; read as "robots governs
   crawling, the licence governs keyed access" it admits them. Reed is out
   under either reading (its robots names AnthropicBot). Needs one sentence
   added to ADR 0005 before stage 3e.
5. **Source keys in the database.** First non-AI key in `AppSettings`;
   ADR 0027's pattern fits, but it is a separate decision and a separate
   accessor.
6. **JOIN's undocumented endpoint.** Best structured location data of any
   EU ATS, served token-less for its own pages, robots welcomes AI bots —
   but undocumented and 5 rows per page. Default: no, per "explicitly
   public".
7. **Salary in EUR / PLN / GBP.** Own PR after stage 4; which of the two
   designs in §5.1.

---

## 7. Traps to encode as tests before the first backfill

### 7.1 Gazetteer and codes

- **Georgia**: "Atlanta, Georgia" → US; "Tbilisi, Georgia" → GE; bare
  "Georgia" → low confidence, no country.
- **CA, IN, DE, ME, OR, US, ID, MT**: US state abbreviations collide with
  ISO codes. A two-letter code counts as a country only in an explicit
  position (after "Remote ·", inside a comma list of codes, from a hint);
  "City, CA" is always a state.
- **"US" inside words**: Russia, Australia, campus, bonus — word boundaries
  only (`priority-rules.ts` already paid for this).
- **Jersey / Guernsey / Isle of Man / Kosovo / Northern Cyprus** — own codes
  or nothing; never guessed.
- **UK ≠ EU** after Brexit, but employers' "Europe" usually includes it:
  `EUROPE` (geography) and `EU` (law) are different region codes.
- **"Remote" alone is not worldwide** — `UNKNOWN`, empty countries.
- **Several offices** ("Denver, CO - Hybrid; New York; San Francisco") →
  all countries, softest workplace.
- **Time zones as geography**: "EU time zones" is a soft region (no
  residence required); "must be located in the EU" is hard. The parser sets
  the region, the AI decides hardness.
- **"(m/w/d)" is not part of the title** — strip for display, keep as a DE
  signal.
- **Cyrillic and transliteration**: Київ / Kyiv / kyiv / "Kyiv, UA" /
  "Київ, UA" / ISO UA / "Europe; LATAM; Ukraine" all occur across DOU, GRC,
  Djinni, Breezy, Lever, Recruitee and Greenhouse.
- **DOU title entities inside XML** ("від&amp;nbsp;$950") — decode after XML
  parsing, in gotcha-12 order.

### 7.2 Semantics and prompt

- Prompt length grows with every running search (up to 8): codes and group
  codes only, plus a guard test on length.
- Re-classification is a cost (~50 s per row on the CLI): fill `UNKNOWN`
  rows only, in batches of 10 like the wizard's step 4 (`score-pick.ts`).
- MANUAL rows are touched by the parser only, never by anything that
  rewrites text (gotcha 12).
- Descriptions arrive in German, Polish, French, Swedish, Ukrainian:
  `passesBaseFilter` on the title still works (technology names are
  shared); the classifier reads any language; resume match and cover
  letters assume English — add a guard that says so instead of silently
  producing nonsense.
- German postings rarely list salary: `no-salary-listed` must not penalise
  them harder than today.
- "Remote Poland / Spain" rows in the database are mostly US employers
  hiring through an EOR — for a UA resident they are "almost": a signal for
  the AI, never for the parser.

---

## 8. Sequence and effort (estimates from earlier stages of this repo)

| Stage | Branch | ADR | Effort | Tag |
|---|---|---|---|---|
| 1 location-model | `location-model` | 0031 | ~2 sessions | minor |
| 2 profile-countries | `profile-countries` | 0031 amend / 0032 | ~2 sessions | minor |
| 3a–3d sources | one branch per source | 0005 register rows; new ATS types noted in 0017's spirit | ~½ session per source | minor each |
| 3e keyed sources | after §6.4 | 0005 sentence + 0027-style keys | ~1 session | minor |
| 4 eligibility | `eligibility` | 0033 | ~1–2 sessions | minor |

Stages 1 and 2 could share a branch; keep them apart — stage 1 changes no
verdict and is safe to ship alone, stage 2 rewrites the prompt and deserves
its own review.
