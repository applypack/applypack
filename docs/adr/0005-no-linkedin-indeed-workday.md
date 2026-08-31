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
✅ The project's `User-Agent` is honest — `applypack/0.1
(+https://github.com/nazboyko/applypack)` — and we explicitly probe
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
| Jooble / TrueUp / Remote Rocketship / DevRelX / Tecnoempleo / JobFluent | rejected for now | no structured public feed found |

Counter-example that shapes the rule: 4dayweek.io disallows `/api/` but
explicitly allows `/api/v1` and `/api/v2` — so the F2 fetcher uses the
allowed `/api/v2/jobs`, not the unversioned path.
