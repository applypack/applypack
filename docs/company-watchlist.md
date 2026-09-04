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


---

# Stage B analysis — do career sites publish `JobPosting`? (2026-09-04)

The §17 stage B plan rests on one sentence: *"each job page carries
`<script type="application/ld+json">` with a schema.org `JobPosting` … the
format Google for Jobs requires, so custom career sites ship it."* Everything
else in the stage — the sitemap reader, the JSON-LD parser, the
`CAREER_PAGE` type, the per-tick page budget — exists to act on that.

It was measured before any of it was built. **It is false for company career
sites.**

## 1. Sitemaps: 12 of 13 declare one, and they are large

Every site is one of the thirteen stage A left as `watchOnly`. The bytes are
the root sitemap plus up to three children of an index.

| Site | Root | Children | Bytes read | "job-ish" URLs |
|---|---|---|---|---|
| Stripe | index | 9 | **15.8 MB** | 1 144 |
| Elastic | urlset | — | **7.0 MB** | 26 |
| Remote | urlset | — | **4.9 MB** | 767 |
| GitLab | index | 2 | 3.9 MB | 9 |
| PostHog | index | 1 | 1.8 MB | 29 |
| Cloudflare | urlset | — | 1.4 MB | 2 |
| Storyblok | index | 9 | 603 kB | 1 |
| Fly.io | index | 2 | 86 kB | 5 |
| Shopify | index | **568** | 75 kB | 114 |
| Datadog | urlset | — | 64 kB | 476 |
| Automattic | index | 1 | 40 kB | 1 |
| Doist | urlset | — | 1 kB | 0 |
| Deno | — | — | — | no sitemap declared |

None was gzipped; all were served as plain XML. (A `.gz` sitemap still has to
be decided for — `zlib.gunzipSync` on a body starting `1f 8b` is three lines,
and no vendor here forced the question.)

## 2. The URL heuristic is mostly noise

A path containing `job` / `career` / `vacancy` does not mean a posting:

- **Remote's 767** are marketing templates —
  `/en-nz/resources/job-descriptions/it-specialist-job-description`. They look
  more like postings than the real ones do.
- **Datadog's 476** are `/benefits/`, `/candidate-experience/`, `/all-jobs/`.
- **PostHog's 29** are handbook pages (`/handbook/people/career-progression`).
- **Cloudflare's 2**, **Storyblok's 1**, **Automattic's 1** are the listing page.

Only **Shopify (114)** and **Fly.io (5)** list URLs that are one-per-posting.
So the sitemap cannot classify a URL; only fetching it can.

## 3. `JobPosting` structured data: not there

Checked on the listing page and, where one exists, a real posting page.
"Usable" means a `JobPosting` in JSON-LD, or microdata with actual `itemprop`
fields.

| Sample | n | Carrying usable `JobPosting` |
|---|---|---|
| The owner's 13 (listing and/or posting page) | 13 | **0** |
| Other custom career sites, listing page (Basecamp, Ghost, JetBrains, Mozilla, Proton, Nextcloud, DuckDuckGo, Wikimedia, Kagi, python.org, jobs.wordpress.net, euremotejobs.com) | 12 | **0** |
| Detail pages reached from those listings | 6 | **1** |

The one hit is `euremotejobs.com` — a WordPress **job board**, not a company
career site, whose plugin emits the JSON-LD. It already publishes an RSS feed
with 15 entries, so the `FEED` rung from stage A serves it without any of this.

Two near-misses are worth recording because they look like hits:

- **Shopify** has `itemscope itemType="https://schema.org/JobPosting"` on a
  `<div>` with **zero `itemprop` attributes** — an empty shell. The real
  fields (`"@type","JobPosting","description","datePosted",
  "hiringOrganization","jobLocation"`) exist only inside a dehydrated
  framework payload with numeric back-references
  (`\"_637\":662,\"_93\":469`). Reading that means reconstructing a
  private hydration format that changes with every deploy — the parsing
  [ADR 0036](./adr/0036-watchlist-reads-published-data-only.md) exists to
  refuse.
- **A first pass that looked only at `<script type="application/ld+json">`
  reported Shopify as having nothing at all.** Microdata is the other half of
  schema.org and has to be read too, or the measurement is wrong in the
  optimistic direction.

## 4. What follows

Built as specified, the stage would add a sitemap reader, a JSON-LD parser, a
new `AtsType`, a per-tick page budget and a crawl surface — to serve **0 of
the 13 sites it exists for**. The premise holds for job *boards*, which we
already reach through feeds and APIs, and not for company career sites.

What the measurement does support is a different rung, made of the two facts
that did hold:

1. A sitemap bounded to the careers path lists **one URL per posting** on the
   sites that have real posting pages (Shopify 114, Fly.io 5), with `lastmod`.
2. A posting page's prose is readable without any structured data —
   `jobs/posting-url.ts` already turns one into text, and that is exactly what
   a user pasting a URL into `/jobs/new` gets today.

So: **new URL under the careers prefix → fetch that one page → `stripHtml` for
the description, `<title>` / `og:title` for the title.** No JSON-LD, no layout
parsing, and it degrades to stage C's "the page changed, have a look" for
sites like Datadog and Stripe whose sitemap cannot separate a posting from a
benefits page.

That is a different feature from the one §17 specifies, so it is the owner's
call, not an implementation detail.


## 5. The second sample: what the owner's users will actually add

The thirteen above are US/global giants. The owner's point, fairly made: his
users will add mid-size companies in the countries they hunt in. So the
**shipped stage A resolver** was run against sixteen European companies
(UA / PL / DE / NL / PT / SE) on 2026-09-04.

| Verdict | n | Who |
|---|---|---|
| **ats** | 2 | Ajax Systems `LEVER:ajax` · Netguru `WORKABLE:netguru` |
| **watchOnly** | 8 | MacPaw, Preply, Readdle, DocPlanner, Tidio, sipgate, Mollie, Tink |
| **refused** | 6 | Brainly, STX Next, Software Mansion (all three: robots) · Ecosia (403) · Channable (429) · Unbabel (no answer) |

None of the sixteen emits `JobPosting` in any form.

And the number that decides stage B — **URLs listed under the careers path in
each site's own sitemap**, which is what a "new URL = new posting" rung needs:

| MacPaw | Preply | Readdle | DocPlanner | Tidio | sipgate | Mollie | Tink |
|---|---|---|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 | 0 | 70 (the whole site, incl. `/404`) | sitemap 404 |

So across **21 sites** measured on two continents, the sitemap + JSON-LD rung
would produce postings for **two** — Shopify (114) and Fly.io (5) — and the
JSON-LD half for none at all. Stage B does not earn its surface. Stage C's
"the careers page changed, have a look" is the honest offer for the rest, and
it costs a hash.

## 6. The robots rule refuses three EU companies it should not

`src/robots.ts` takes the strictest verdict across every token in
`AI_TOKENS`, on the ADR 0005 addendum's reasoning that a site banning AI
agents has refused what we do. Measured against the sixteen, that rule fires
three times, and each time it reads the site wrong:

| Site | What its robots.txt actually says | Our verdict |
|---|---|---|
| **Software Mansion** | `User-agent: *` `Allow: /` **`Content-Signal: search=yes, ai-input=yes, ai-train=yes`**, then `User-agent: Bytespider` `Disallow: /` with a comment explaining Bytespider gives nothing back | refused |
| **STX Next** | `bytespider: Disallow /` and `ccbot: Disallow /`. Nothing about `*`, nothing about Anthropic | refused |
| **Brainly** | `GPTBot: Disallow /`. `*` is allowed for the careers path | refused |

Software Mansion is the clearest: the site **explicitly permits AI input and
AI training**, allows every agent, and blocks one scraper by name — and we
refuse it. Blocking ByteDance's scraper or Common Crawl's dataset builder is
not the same act as refusing a person's own job-search tool that reads one
page they asked for and hands it to Claude.

The addendum's reasoning — *"every fetched description is fed into a Claude
classifier, so fetching under a different User-Agent would do exactly what the
ban refuses"* — binds us squarely to **Anthropic's own tokens**
(`claudebot`, `claude-web`, `anthropic-ai`) and to `*`. It does not stretch to
a training-corpus crawler or a scraper. Narrowing `BINDING_TOKENS` to those,
and honouring Cloudflare's `Content-Signal: ai-input=no` where a site
publishes one, recovers 3 of 16 European companies without touching a single
site that asked us to stay away.

That is a change to a standing rule (ADR 0005 addendum rule 2), so it is the
owner's call.


---

# Stage C analysis — what a page hash must ignore, and what it must not (2026-09-04)

The §17 stage C plan says: *"hash the page's plain text (`stripHtml`,
whitespace and digits normalised)"*. The digits half is wrong, and the
measurement says so.

## 1. Raw HTML is unusable; `stripHtml` is enough

Ten careers pages — the ones stage A leaves as `watchOnly`, which is who this
rung is for — were each fetched **three times over ninety seconds**, so the
content was certainly identical. Anything that changed is noise the
normalisation has to absorb.

| Normalisation | Pages whose hash changed anyway |
|---|---|
| raw HTML | **4 of 10** — Storyblok, Shopify, MacPaw, Preply |
| `stripHtml` | **0 of 10** |
| + collapse whitespace | 0 of 10 |
| + mask digits | 0 of 10 |
| + lowercase | 0 of 10 |

Raw HTML carries a nonce, a build id or a session token on nearly half of
them. `stripHtml` removes every one of those for free, because they live in
attributes and script blocks and never in the prose. Nothing beyond it earns
its place on this evidence — whitespace collapsing is kept anyway, because it
costs nothing and a reflow that only moves text is not a change worth waking
someone for.

## 2. Masking digits would delete the signal, not the noise

The reason the plan proposes it is to absorb dates and "posted 3 days ago"
counters. Scanned across all ten pages' text for anything time-dependent —
relative times, absolute dates, ISO dates, countdowns:

**None of the ten carries any.** The only digits in the prose are these:

| Page | The digits it publishes |
|---|---|
| Datadog | `92 positions`, `37 positions`, `18 positions` … (11 per-department counts) |
| PostHog | `0 Job` |
| Doist | `2024 Open roles` |

Every one of them **is the signal**. "92 positions" becoming "93 positions" is
exactly the event this rung exists to report, and masking digits would hash
both to the same string. So: **`stripHtml` + collapse whitespace, and nothing
else.** No digit masking, no lowercasing — a page that changes `Senior` to
`Staff` has changed.

## 3. What the rung therefore is

- Hash = `sha256(stripHtml(html).replace(/\s+/g, ' ').trim())`.
- **The first fetch never alerts.** There is no previous hash to differ from;
  it is stored and that is all.
- **A change alerts at most once a day per company**, whatever the check
  interval says, and the hash is only advanced when the alert is actually
  sent — so a change seen inside the quiet window is not lost, it waits.
- The alert says what it knows and no more: *"the careers page changed, have
  a look"*, with the link. It never claims to know the jobs.
- `/companies` says **"watching for changes"** for these rows rather than a
  posting count, because a posting count would be a lie.
