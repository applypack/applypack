# 0035 — Many installs, one set of boards: spread the tick, shuffle the walk, revalidate instead of re-downloading

**Status:** Accepted (2026-09-04)

## Context

[ADR 0034](./0034-keyed-sources.md) closed the keyed half of the sourcing
plan and, in doing so, made the unkeyed half's problem obvious. Adzuna and
France Travail scale by construction: the credential is the user's, so every
install is its own API consumer with its own quota and its own agreement.
The 32 default sources have none of that. They are free RSS feeds and public
JSON endpoints with no contract at all, and ApplyPack names itself in its
User-Agent while asking for them.

Three properties of the code made every install behave identically:

- `registerCron('5 * * * *', 'fetch', …)` — the same minute everywhere, and
  self-hosters cluster in a handful of time zones.
- `orderBy: { id: 'asc' }` over a `seed.ts` that is byte-identical on every
  install — so every install asks the same board first, and with the polite
  one-second delay, the same board second, in step.
- Full downloads every hour regardless of whether anything changed. Lever
  alone is 697 KB per company per tick.

One install is invisible. A hundred are a synchronised burst. Nothing was
broken yet, which is exactly when this is cheap to fix.

What the vendors actually support was measured on 2026-09-04 rather than
assumed (probe: GET, read the validators, send them back, record the
status). 42 of the 62 seeded rows are on sources that answer **304**:
Greenhouse, Lever, Ashby, DevITjobs, Pinpoint, Personio, Teamtailor, Golang
Projects, Breezy and SmartRecruiters honour `If-None-Match`; Remotive and
Arbeitnow honour `If-Modified-Since`. We Work Remotely sends an ETag over a
body that changes between requests, so it answers 200 more often than not.
RemoteOK,
Working Nomads, 4 Day Week, LaraJobs, JobTech, Recruitee, Rippling, BambooHR
and Workable offer no validator; Himalayas, Landing.jobs, DOU and Djinni
send one and answer 200 to it anyway. The full table is in
[docs/scale-plan.md](../scale-plan.md) §1.

Three measurements shaped the design more than the rest:

- **Remotive sends `Cache-Control: no-store` and still honours
  `If-Modified-Since`.** Whatever we keep, it must not be the payload.
- **Breezy answered 304 over an empty body** (`[]`, stable ETag). A design
  that reads "304" as "healthy" would let a permanently empty board look
  alive forever — the failure ADR 0019 exists to catch.
- **Node's `fetch` appends `Cache-Control: no-cache` to any request carrying
  a validator**, and Express reads that request directive literally and
  answers 200. Found only in the live double-tick, after the unit tests were
  green: Lever and SmartRecruiters revalidated under `curl` and never under
  ours. Gotcha 15 in CLAUDE.md.

## Decision

**The minute belongs to the install, not to the source file.**
`AppSettings.instanceId` (a uuid written once at first boot) is hashed with
the job's name into a minute 0–59, and `src/schedule.ts:spreadMinute` builds
the expression from it. A stored uuid, not `os.hostname()`, because in
Docker the hostname is the container id and changes on every recreate — the
schedule a user observes should survive an update. The job name is in the
hash because `fetch` runs hourly and `discovery` on Sunday at 04:00: one
minute per install would collide those two weekly, on every install.

Only the three crons that talk to somebody else's server move — `fetch`,
`hn-hiring`, `discovery`. `digest`, `stale-applications` and `cleanup` touch
the user's own Telegram and database, and 09:00 means 09:00 because a human
picked it.

**The walk order is shuffled per tick** (`src/fetchers/source-order.ts`,
seeded Fisher–Yates so the shuffle itself is a pure, tested function). The
Adzuna overflow set is still decided from the id-ordered list *before* the
shuffle: which ten markets fall inside the monthly limit has to be the same
answer every tick, or the user cannot tell which ten they get.

**A conditional request is the default, and a 304 returns no jobs.**
`src/fetchers/conditional.ts` holds `{url, etag, lastModified, count}` per
company; `conditionalHeaders()` sends whatever the vendor last gave us and
`{}` otherwise, so wiring it into a source that offers no validator is a
no-op and a vendor that turns validators on later is picked up for free —
there is no allow-list to keep in sync with a measurement that will go
stale. The entry remembers the URL it came from, because the geo-filtered
sources build theirs from the running searches and last week's ETag must not
be sent for this week's countries.

Three rules keep that safe rather than merely cheap:

1. **A 304 returns nothing, and nothing of the response is kept.** Those
   rows are already stored; replaying them would run the whole filter →
   dedupe → upsert path every hour to reach the state we are in. It also
   settles Remotive's `no-store` without a special case, and keeps the cache
   at two strings and an integer per source.
2. **A 304 repeats the previous verdict, not a blanket "healthy".** A new
   `not_modified` status is healthy for the streak and displays as
   "Unchanged", but `advancesLastOk(status, cachedCount)` moves `lastOkAt`
   only when the last full response actually carried rows. Breezy's empty
   board still ages into "silent"; ADR 0019's second signal survives intact.
3. **A validator is committed only once its jobs are stored.** Fetchers write
   to a staged map; `runFetchJob` calls `commitConditionalCache()` only after
   a processing pass that neither aborted nor skipped the persist loop.
   Pausing fetching mid-tick is a normal, frequent path that discards
   everything fetched so far — an eagerly stored ETag would answer 304 next
   tick over postings nobody saved, and they would stay lost until the feed
   happened to change.

The cache is per-process and dies with it. A restart costs one full read per
source, which at an hourly tick is a rounding error against keeping it out
of the schema.

Sources that make **several** requests per tick for one row are left out —
Arbeitnow (up to 3 pages), Jobicy and Himalayas (one feed per place the
searches hunt), Adzuna and France Travail (paginated), the HN feeds. A 304
on one of several URLs does not mean the source is unchanged, and the
remembered count would be a fraction of the truth.

## Alternatives considered

**Replay the cached jobs on a 304**, as `devitjobs.ts` did for three feeds.
Simple and safe against the abort path for free, and it needs no health
change at all. Rejected because it keeps every parsed description in memory
for every source, keeps Remotive's payload against its `no-store`, and saves
the vendor's bandwidth while leaving our own hourly database churn exactly
as it was. DevITjobs was moved onto the shared mechanism instead.

**Store the validators on the `Company` row.** Survives restarts and is
shared between the worker and the dashboard's "Fetch now". Rejected for now:
it needs a migration and a second write pass to carry validators out of the
fetch loop and commit them after persistence, and the in-process cache
already captures the great majority of the saving between restarts.

**Randomise the tick minute at boot** instead of hashing a stored id. Same
spread, no column — but a restart loop reshuffles the schedule, and "your
install fetches at :41" stops being a true sentence.

## Consequences

✅ 42 of 62 seeded rows revalidate instead of re-downloading; the three
heaviest families (Greenhouse, Lever, Ashby — 32 rows) are all in that set.
Verified live over two ticks on twelve boards: eleven came back
`not_modified` with zero rows, and both empty boards (Breezy,
SmartRecruiters) reported it without advancing `lastOkAt`.
✅ Installs no longer share a minute or an order, so a popular hour stops
being a burst against one board.
✅ A tick where nothing changed does almost no work: no parsing, no
dedupe, no upserts, and "Fetch now" says so ("42 of 62 sources unchanged
since the last tick") instead of warning about the network.
✅ Golang Projects and We Work Remotely now go through `fetchWithRetry`
rather than `rss-parser`'s own fetch, so they carry our User-Agent and our
retry policy like every other source.
❌ A new `FetchStatus`. Anything that switches on the vocabulary has to know
about it; `describeStatus` and `isFailureStatus` are the only two places
that do, and both are guard-tested against `FETCH_STATUSES`.
❌ An aborted tick throws away its validators, so the tick after a pause is a
full refetch. That is the price of never losing a posting, and it is paid
once per pause.
❌ The cache is per-process: the worker and the dashboard's "Fetch now" keep
separate ones, and both start empty after a restart.
❌ Two sources that do honour validators (Arbeitnow, Jobicy) are left out by
the one-request-per-tick rule, and We Work Remotely is wired but will rarely
fire: its ETag hashes a body that changes between requests, so it answers
200 with a new ETag most of the time.

## When to revisit

When a source that makes several requests per tick becomes heavy enough to
be worth a per-URL cache — Arbeitnow's three pages are the candidate. When
`instanceId` gains a second reader, which would be the argument for
surfacing the chosen minute in the dashboard rather than only in the boot
log. And if a restart ever stops being rare — a crash loop, or a host that
recycles the container hourly — because that is the point at which moving
the validators into the `Company` row starts paying for its migration.
