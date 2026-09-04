# 0036 — Watched companies are checked by reading what a site publishes for machines, never by rendering it

**Status:** Accepted (2026-09-04)

## Context

The owner's ask (TASKS §17) is ordinary: paste a list of companies, have them
checked on a chosen interval, see their postings apart from the rest. The
question the ask carries — "maybe Playwright?" — is the one that needed
deciding before any code, because it decides what the feature can promise.

A headless browser does not remove parsing. It renders JavaScript and then you
still read a DOM whose class names change with the next redesign. It adds
Chromium to a `node:24-alpine` image, CPU and memory to every tick, and it is
the exact tool the project's ground rules refuse: career sites behind
Cloudflare Turnstile block headless clients, and "getting past that" is the
bot-protection bypass [ADR 0005](./0005-no-linkedin-indeed-workday.md) exists
to forbid. The owner confirmed the policy on 2026-09-04.

What is stable is data a site publishes for machines **on purpose**. Twenty
JavaScript-heavy, frequently-hiring companies were resolved by hand on
2026-09-04 to find out how much of that there is
([docs/company-watchlist.md](../company-watchlist.md)). The answer:

- **5 of 20** link a job board that the vendor's public API actually serves.
- **0 of 20** publish a job feed.
- **13 of 20** publish nothing machine-readable at the URL a user would paste,
  including three — GitLab, Stripe, Remote — whose Greenhouse boards hold
  200–600 postings that no page scan finds, because their career pages call
  their own backend.
- **2 of 20** answered an HTTP error (Grafana a 404, Contentful a 429).

Three measurements shaped the rules more than the totals:

- **A board URL is not a board.** `jobs.ashbyhq.com/Deno` answers 200 while
  `api.ashbyhq.com/posting-api/job-board/Deno` answers 404 — Ashby's public
  posting API is per-org opt-in. Accepting the URL match would have created a
  source that can never return a posting.
- **Guessing feed paths finds blogs and empty feeds.** WordPress answers a
  well-formed, item-less RSS at any `/<anything>/feed` (measured on
  automattic.com), and the `<link rel="alternate">` a careers page declares is
  the blog on both netlify.com and posthog.com.
- **A vendor's name is not evidence of its interstitial.**
  `jobs/posting-url.ts` matches the bare word `cloudflare`, so
  cloudflare.com's own careers page is reported as a bot check.

## Decision

**A watch check reads only published machine-readable data, in this order,
and stops at the first rung that answers:** the ATS behind the page (the
vendor's own documented API), then an RSS/Atom feed whose own path names jobs.
Stage B adds sitemap + JSON-LD `JobPosting`; stage C adds a page-text hash
that says "this page changed" and never claims to know the jobs. Anything
below that is `watchOnly` — labelled honestly on screen, not half-added.

**No headless browser, ever** — not Playwright, not Puppeteer, not a
rendering service. A page that needs JavaScript to list its jobs is a page
this project does not read.

Four rules make the ladder honest rather than merely cheap:

1. **Every `ats` verdict is confirmed by `probeAts` before it is offered.**
   A URL match is a hypothesis; the vendor's answer is the evidence.
2. **A feed must name jobs in its path AND carry at least one entry.**
   `/feed` and `/rss.xml` are never fetched.
3. **`robots.txt` is read in code, not by hand.** `src/robots.ts` implements
   RFC 9309 (groups, longest match, ties to Allow, missing file = allowed)
   with two deliberate departures, both stricter than the protocol: a group
   naming any AI agent binds us, because every description fetched here is fed
   to an AI classifier (ADR 0005 addendum rule 2); and a 5xx on robots.txt
   means "not allowed", because a failing server has told us nothing.
4. **At most 5 requests per company, at add time only.** Afterwards the
   company is one source in the ordinary tick.

**The watchlist is `Company`, not a new table** — four columns: `watched`,
`checkEvery` (`hour | day | week`), `nextCheckAt`, `alertPolicy`
(`matches | all`) — and **it rides on the existing tick, with no cron of its
own** (ADR 0003). `runAllFetchers` selects `active AND (nextCheckAt IS NULL OR
nextCheckAt <= now)`, then shuffles the survivors (ADR 0035's order is
unchanged; the Adzuna monthly slice is still computed from the full
id-ordered list, so a market that merely was not due cannot promote the
eleventh into the ten). `nextCheckAt` is stamped after **every** attempt,
failures included.

Riding the tick has a consequence the §17 plan did not foresee, and it is
accepted deliberately: since v1.47.0 the tick is gated by the user's own
schedule, so **watched companies are not checked during the hours the user
told the search to sleep.** That is the correct reading of one intent — "when
I want the search to run" — rather than two, and the UI says so.

`alertPolicy = 'all'` bypasses the base filter and the fit threshold, and the
alert reads `★ New posting` rather than a match: the posting is still
classified, so it carries a score, but the message never claims the score
means anything. The same exception covers issue #50's `no-profile-stack`
guard, which is a statement about a score this alert is not making.

## Consequences

✅ Nothing in the image changes: no Chromium, no HTML parser, no new
dependency. The `FEED` fetcher is 100 lines over `rss-parser`, which was
already there.
✅ Every check is a request a vendor documents or a file a site publishes, so
the honest User-Agent stays honest and ADR 0005 needs no exception.
✅ `robots.txt` stops being a hand-checked register entry. The addendum's
rule 2 is now a unit-tested code path that runs on every host.
✅ The interval costs a board fewer requests than before: a company set to
"once a day" is asked once a day instead of hourly.
❌ **13 of the owner's 20 companies get nothing in this stage.** That is the
measurement, not a bug — and it is the whole argument for stage B.
❌ A user who knows a company's board must paste that URL; we will not guess a
slug, because a probe hit is not proof of identity (ADR 0017).
❌ Watched companies inherit the search's quiet hours. A user who wants a
company polled at 03:00 cannot have it without widening the schedule.
❌ `alertPolicy = 'all'` spends an AI call per posting at a company that may
post roles far outside the search. That is what the user asked for, and the
interval is the lever if it costs too much.

## When to revisit

When stage B ships and the sitemap + JSON-LD rung changes the 5/20 number —
that is the measurement that says whether this ladder is enough. When a
vendor we already support starts serving its public API only to rendered
clients, which would be the first case where "no headless browser" costs a
source rather than a nuisance. And when `nextCheckAt` gains a second writer:
today only the tick stamps it, and "Check now" clears it, which is what keeps
the column readable.
