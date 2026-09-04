# Company watchlist — what a careers page actually publishes

Measurement note for [TASKS §17](./TASKS.md) stage A and
[ADR 0036](./adr/0036-watchlist-reads-published-data-only.md). Twenty
JavaScript-heavy companies that hire often, resolved by hand on **2026-09-04**
with the project User-Agent, at most five requests each, in the order the
resolver uses them.

## The ladder, as implemented

| Rung | What it reads | Where |
| --- | --- | --- |
| 1 | The pasted URL is already a board | `text-utils.ts:extractAtsToken` → `ats-probe.ts:probeAts` |
| 2 | The URL redirects onto a board | the landed URL, same two calls |
| 3 | The page links to a board | `watchlist/scan.ts:boardHints` (whole document, JSON islands included) |
| 4 | A feed whose own path names jobs, carrying entries | `declaredJobFeeds` then `wellKnownFeeds` |
| 5 | Nothing machine-readable → `watchOnly` | stage B's territory |
| — | Refused, with the reason on screen | ADR 0005 host, private address, robots.txt, HTTP error, bot check |

## The twenty

| # | Company | Pasted URL | Verdict | Detail |
| --- | --- | --- | --- | --- |
| 1 | Vercel | vercel.com/careers | **ats** | `GREENHOUSE:vercel` from a link in the page · 88 postings |
| 2 | Netlify | netlify.com/careers/ | **ats** | `GREENHOUSE:netlify` · 1 posting |
| 3 | Supabase | supabase.com/careers | **ats** | `ASHBY:supabase` · 60 postings |
| 4 | Linear | linear.app/careers | **ats** | `ASHBY:linear` · 28 postings |
| 5 | Sentry | sentry.io/careers/ | **ats** | `ASHBY:sentry` · 41 postings |
| 6 | Deno | deno.com/jobs | watchOnly | redirects to `jobs.ashbyhq.com/Deno`; the posting API 404s for `Deno` and `deno` — a live board with its public API switched off |
| 7 | Grafana Labs | grafana.com/about/careers/ | refused | HTTP 404 (a 100 kB soft-404 page) |
| 8 | Contentful | contentful.com/careers/ | refused | HTTP 429 on the first request |
| 9 | Datadog | careers.datadoghq.com | watchOnly | 136 kB, nothing |
| 10 | Cloudflare | cloudflare.com/careers/ | watchOnly | 265 kB, nothing |
| 11 | Elastic | elastic.co/about/careers | watchOnly | 549 kB, nothing. Board exists: `GREENHOUSE:elastic` |
| 12 | GitLab | about.gitlab.com/jobs/ | watchOnly | `greenhouse` appears only as an internal data key. Board exists: `GREENHOUSE:gitlab`, 230 postings |
| 13 | Automattic | automattic.com/work-with-us/ | watchOnly | `/careers/feed`, `/jobs/feed` and `/work-with-us/feed/` all answer a **valid RSS with 0 items** |
| 14 | Doist | doist.com/careers | watchOnly | 120 kB, nothing |
| 15 | Remote | remote.com/careers | watchOnly | Board exists: `GREENHOUSE:remotecom`, 213 postings |
| 16 | Shopify | shopify.com/careers | watchOnly | 549 kB, nothing |
| 17 | Stripe | stripe.com/jobs | watchOnly | the listing JSON carries a `greenhouseId` per row but no board slug. Board exists: `GREENHOUSE:stripe`, 611 postings |
| 18 | Fly.io | fly.io/jobs/ | watchOnly | 106 kB, nothing |
| 19 | PostHog | posthog.com/careers | watchOnly | 1.7 MB page; `/feed` is the blog (253 items) and is never tried |
| 20 | Storyblok | storyblok.com/careers | watchOnly | 181 kB, nothing |

**5 ats · 13 watchOnly · 2 refused · 0 feed.**

## What the fixture changed in the design

1. **A board URL is not a board.** Deno's Ashby board answers 200 at
   `jobs.ashbyhq.com/Deno` and 404 at the posting API. Every `ats` verdict is
   therefore confirmed by `probeAts` first, and a URL that matches but does
   not resolve is reported as "embed-only", not as "nothing found".
2. **Guessing feed paths finds blogs and empty feeds.** WordPress answers a
   well-formed, item-less RSS at any `/<x>/feed`; PostHog's and Netlify's
   declared `<link rel="alternate">` is the blog. Rule kept: the path must
   name jobs/careers/vacancies **and** the feed must carry at least one entry.
   `/feed` and `/rss.xml` are never fetched.
3. **A vendor's name is not evidence of its interstitial.** Two false
   positives, both live: `jobs/posting-url.ts` refuses cloudflare.com's own
   careers page because `CHALLENGE_MARKERS` holds the bare word `cloudflare`;
   and a first draft of this resolver refused jobs.ashbyhq.com (a
   `.grecaptcha-badge` CSS rule) and storyblok.com (an `<!-- ReCaptcha -->`
   comment) on the bare word `captcha`. `watchlist/scan.ts:looksLikeChallenge`
   therefore strips the markup first and matches only what an interstitial
   says to a reader. `posting-url.ts` is left alone: for a posting page the
   broad set is the safer default.
4. **The big boards exist but are not linked.** GitLab, Stripe, Remote and
   Elastic all have live Greenhouse boards with 200–600 postings that no page
   scan finds. Guessing a slug is what ADR 0017 forbids, so the preview says
   so and asks for the board URL instead.
5. **robots.txt of the twenty:** Netlify, Supabase and Cloudflare name AI
   bots — all three allow them (Supabase's groups carry no rules, which RFC
   9309 reads as allow-all). None of the twenty disallows the careers path.

## Feeds used for the FEED fetcher's own smoke run

Job-shaped path, real entries, not already a source type (checked 2026-09-04):
`python.org/jobs/feed/rss/` (20), `jobs.wordpress.net/feed/` (8),
`euremotejobs.com/feed/` (15).
