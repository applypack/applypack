# 0005 — Never scrape LinkedIn / Indeed / Workday

**Status:** Accepted (re-confirmed every phase)

## Context

Three sources keep coming up as "but if you just added them you'd
double your coverage":

- **LinkedIn Jobs** — biggest dataset, anti-bot is Cloudflare + Akamai
  + custom JS. Logged-in scraping = account-ban risk. Logged-out
  scraping breaks every 2-3 weeks. There's no public partner API for
  individual users.
- **Indeed** — used to have a partner API, deprecated. RSS for some
  searches exists but is unreliable. Heavy anti-bot.
- **Workday** (`*.myworkdayjobs.com`) — uses POST with dynamic
  `facetCriteria` that varies per company. No standard public endpoint.
  Very fragile per-company integration.
- **Wellfound, YC Work-at-a-Startup** — both have anti-bot or require
  login. Same concerns.

Tools like **JobSpy** wrap a headless-browser scraper of LinkedIn /
Indeed / Glassdoor / ZipRecruiter into one Python library. Tempting,
but it's grey-zone scraping at scale.

## Decision

**Never add any of these.** No LinkedIn / Indeed / Glassdoor / Workday
/ Wellfound / JobSpy / scrapers of any kind. This rule is in `CLAUDE.md
:: DO NOT` and `SPEC.md :: Hard exclusions`.

## Consequences

✅ The whole project is OK to share publicly on GitHub. Every source
we use exposes an explicitly-public API (Greenhouse, Lever, Ashby,
Workable, SmartRecruiters) or a public RSS feed (LaraJobs, WeWorkRemotely,
golangprojects, HN's Algolia).
✅ Zero risk of LinkedIn account bans, Indeed IP blocks, or
"this person scrapes our jobs" flags in HR systems.
✅ Sources don't break weekly when their anti-bot rules update.
✅ The project's `User-Agent` is honest — `applypack/0.11
(+https://github.com/applypack/applypack)` — and we explicitly probe
endpoints that ATSes intend us to call.

❌ We miss roles posted only on LinkedIn / Indeed / Glassdoor. The
mitigation is twofold:
1. Many such roles ALSO appear on Greenhouse / Lever / Ashby (what we
   already cover) or get linked from HN's Who-Is-Hiring (which we parse).
2. Once a target company is identified by any means, the user can add
   it manually via `/companies` if it's on a supported ATS.

❌ We pass on roles posted exclusively on Workday. Big employers
(Salesforce, Adobe, Coinbase) live there. Acceptable cost.

## When to revisit

Never, for the listed sources, while their TOS forbids automated
access. If LinkedIn ever offers a free public API for individual users
(unlikely), this ADR gets updated with a new "Status: Superseded" note.

## Addendum (2026-08-31) — Evaluated, not supported

Register of every source we investigated and decided NOT to fetch, so the
same investigation never gets redone. Two standing rules extend the
original decision (from the feature-expansion-plan ground rules):

1. A `robots.txt` that disallows the API path we would call is a stated
   refusal — binding, not a technicality to route around.
2. A robots.txt that bans AI agents (ClaudeBot-class rules or
   `ai-train=no` content signals with AI bots disallowed) is equally
   binding for this project: every fetched description is fed into a
   Claude/AI classifier, so fetching under a different User-Agent would
   do exactly what the ban refuses.

| Source | Verdict | Reason (verified date) |
|---|---|---|
| Workday | never | this ADR |
| LinkedIn / Indeed / Glassdoor / Wellfound | never | this ADR; Glassdoor and Dice additionally sit behind anti-bot protection |
| JustJoin.it | rejected | `robots.txt` `Disallow: /api/`; the only structured feed is `/api/candidate-api/offers` (2026-08-31) |
| NoFluffJobs | rejected | `robots.txt` `Disallow: /api/`; the only structured feed is `/api/search/posting` (2026-08-31) |
| NoDesk | rejected | `robots.txt` bans AI bots site-wide (ClaudeBot, GPTBot, CCBot, Google-Extended `Disallow: /`) + `ai-train=no` content signal; our pipeline feeds every description into Claude (2026-08-31) |
| echojobs.io | rejected | API behind a bot-protection checkpoint; `robots.txt` disallows `/api` |
| Torre | rejected | public API caps responses at ~20 rows with no working pagination |
| Comeet | rejected | requires a per-tenant token not derivable from a public board page |
| The Muse | deferred | very high volume, low match density — re-decide at F10 |
| WelcomeToTheJungle | deferred | search backend keys rotate per-run and are referer-locked — fragile |
| TrueUp / Remote Rocketship / DevRelX / Tecnoempleo / JobFluent | rejected for now | no structured public feed found |
| DOU.ua | adopted (v1.30.0) | RSS at `/vacancies/feeds/` is DOU's own interface (`utm_source=jobsrss`); `robots.txt` names no AI bots and allows the path; legal §2.5 forbids automated collection without consent and §3.2 licenses content CC BY-NC-SA — fine for a self-hosted personal tool with the link-back kept, a hosted or commercial deployment needs written consent. Fetched with the project User-Agent (the default RSS UA gets 403) (2026-09-03) |
| Djinni | adopted (v1.31.0) | RSS at `/jobs/rss/` with the site's filters; `robots.txt` disallows only `/jobs2`, `/q`, `/developers`, `/free-jobs`, `/set_lang`, names no AI bots; terms cover posting and fees only. Items carry no location — it lives in the filter — and an unknown `primary_keyword` answers the whole feed, so the fetcher keeps only rows whose category is the requested keyword (2026-09-03) |
| Jooble | rejected | documented API, but "a total lifetime limit of 500 requests per key", snippets only, API terms unpublished (2026-09-03) |
| Reed.co.uk | rejected | `robots.txt` `Disallow: /api/` in the group that names AnthropicBot (2026-09-03) |
| Bundesagentur für Arbeit Jobsuche | rejected | an app backend behind a leaked client id, not a published API; Nutzungsbedingungen 2a(3) forbid reading content through interfaces for data collection (2026-09-03) |
| EURES | rejected | no official API; only a reverse-engineered frontend backend with stub descriptions (2026-09-03) |
| Work.ua / Robota.ua | rejected | every listing path (Work.ua) or every path incl. robots.txt (Robota.ua) answers a Cloudflare challenge; no feed, partner API is employer-only (2026-09-03) |
| Happy Monday | rejected | `robots.txt` `Disallow: /` for ClaudeBot, GPTBot, CCBot + `ai-train=no` (2026-09-03) |
| GRC.ua | deferred | undocumented frontend JSON (`/api/job/listing`), tiny IT slice (2026-09-03) |
| JOIN (join.com) | deferred — policy call | undocumented `api/public/companies/{id}/jobs` served token-less for its own pages, best structured location data of any EU ATS, 5 rows per page; robots welcomes AI bots (2026-09-03) |
| Softgarden / HiBob / Jobvite / Factorial / Jobylon / Freshteam | rejected | token-only (Softgarden also `Disallow: /api/`); Jobylon's feed hash comes from support; Freshteam is discontinued (2026-09-03) |
| SAP SuccessFactors / Oracle Cloud HCM / iCIMS / Cornerstone | rejected | `career4.successfactors.com` `Disallow: /`; Oracle's `recruitingCEJobRequisitions` is documented "for Oracle internal use"; iCIMS and Cornerstone are gated (2026-09-03) |
| eurotechjobs.com / europeremotely.com | rejected | ClaudeBot + GPTBot `Disallow: /`; `Disallow: /` + HTTP 403 (2026-09-03) |
| swissdevjobs.ch / bulldogjob.pl / theprotocol.it / it.pracuj.pl / rocketjobs.pl | rejected | Cloudflare challenges (swissdevjobs even on robots.txt); bulldogjob `Disallow: /feeds`; rocketjobs `Disallow: /api/` like JustJoin (2026-09-03) |
| relocate.me / iamexpat / remote-europe.com / Lobby X / jobs.ua | rejected | no feed; no feed; dead TLS; `Disallow: /feed/`; HTML only (2026-09-03) |
| Landing.jobs JSON API | rejected (Atom feed usable) | `Disallow: /api/`; `/feed` is allowed (2026-09-03) |
| Talent.com / Welcome to the Jungle / Otta / XING / StepStone / Honeypot | rejected | no public API (2026-09-03) |
| Adzuna / France Travail | deferred — decision pending | keyed APIs whose published terms permit programmatic use (Adzuna "Personal research", Open Licence 2.0) while `api.adzuna.com` and `api.francetravail.io` answer `Disallow: /`; needs a ruling on rule 1 vs a published licence — see [country-search-plan.md §6](../country-search-plan.md) (2026-09-03) |

Sources verified usable on 2026-09-03 (DOU.ua, Djinni, solid.jobs, the
GermanTechJobs / DevITjobs feeds, Landing.jobs Atom, JobTech Sweden,
Personio, Teamtailor, Homerun, d.vinci) are specified in
[country-search-plan.md §0.5](../country-search-plan.md); a row lands here
when one is adopted or dropped at implementation time.

Counter-example that shapes the rule: 4dayweek.io disallows `/api/` but
explicitly allows `/api/v1` and `/api/v2` — so the F2 fetcher uses the
allowed `/api/v2/jobs`, not the unversioned path.
