# Scale: many installs, one set of job boards

> Analysis written 2026-09-04, before the code. Companion to
> [ADR 0034](./adr/0034-keyed-sources.md), which closed the *keyed* half of
> the sourcing plan. This is the *unkeyed* half — the 32 default sources
> every install shares.

## 0. The problem

The keyed sources scale on their own: Adzuna and France Travail credentials
belong to the user, so each install is a separate API consumer with its own
quota and its own agreement. Nothing breaks there when the install count
grows.

What breaks is the **old** part, the part nobody looked at because it has
worked since phase 1:

- Every install ticks at **:05 past the hour**, in its own `TZ`. Self-hosters
  cluster in a handful of time zones, so ":05 in Europe/Warsaw" is one
  instant shared by everyone in that zone.
- Every install walks the company list in **`id ASC`** — and the ids come
  from `seed.ts`, which is byte-identical everywhere. So install #1 and
  install #500 both ask Greenhouse/pantheon first, one second later
  Greenhouse/acquia, and so on in lockstep.
- Every install re-downloads **every feed, in full, every hour**, whether or
  not anything changed. Lever alone is 697 KB per company per tick.

One user is invisible. A hundred users are a synchronised burst against a
free API that owes us nothing, from a client that identifies itself by name
in its User-Agent. The fix is cheap, and it is the kind of thing that is
much easier to do before it matters than after a vendor blocks the UA.

## 1. What was measured

Every claim below is a live probe from 2026-09-04, not a guess: fetch the
endpoint, read the validators off the response, send them back, record the
status. Script: `scratchpad/probe-etag.sh` (`curl -D -`, our own UA).

**Honours a conditional request (measured 304):**

| Source | Validator that works | Seeded rows | Bytes skipped per tick |
| --- | --- | --- | --- |
| Greenhouse | `ETag` | 23 | full board × 23 |
| Lever | `ETag` | 6 | 697 KB × 6 |
| Ashby | `ETag` | 3 | full board × 3 |
| DevITjobs family | `ETag` + `Last-Modified` | 3 | 1.6–12.6 MB × 3 |
| We Work Remotely | `ETag`, but see below | 2 | 23 KB × 2 |
| Pinpoint | `ETag` | 2 | 85 KB × 2 |
| Personio | `ETag` (strong) | 1 | |
| Teamtailor | `ETag` + `Last-Modified` | 1 | 55 KB |
| Golang Projects | `ETag` + `Last-Modified` | 1 | |
| Breezy | `ETag` | 1 | |
| Remotive | `Last-Modified` | 1 | |
| SmartRecruiters | `ETag` (list call) | user-added | |

**Offers no validator, or ignores the one it sends:**

RemoteOK (none), Working Nomads (none), 4 Day Week (none), LaraJobs (none),
JobTech (none), Recruitee (none), Rippling (`no-store`), BambooHR (none),
Workable (POST), Himalayas (sends `Last-Modified`, answers 200),
Landing.jobs (sends a weak `ETag`, answers 200), DOU (sends
`Last-Modified`, answers 200), Djinni (sends `Last-Modified`, answers 200).

That is **42 of the 62 seeded rows** on sources that will answer 304 (44
minus We Work Remotely's two, for the reason below) — and the three heaviest
families (Greenhouse, Lever, Ashby: 32 rows) are all in the first group.

Three details worth writing down because they shaped the design:

- **Remotive sends `Cache-Control: no-store` and still honours
  `If-Modified-Since`.** We must not keep its payload. The design below
  keeps no payload at all, which settles this without a special case.
- **Breezy answered a 304 for an empty board** (`content-length: 2`, i.e.
  `[]`, with a stable ETag). A design that treats "304" as "healthy" would
  let a permanently empty board look alive forever — exactly the failure
  [ADR 0019](./adr/0019-source-health-streaks.md) and gotcha 13 exist to
  catch. See §4.
- **We Work Remotely's ETag is a hash of a body that is not byte-stable.**
  It answers 304 when two requests happen to land on the same edge copy and
  200 with a brand-new ETag otherwise — four consecutive probes produced four
  different ETags for the same feed. The mechanism handles it correctly (a
  200 is just a normal fetch) and the feed is 23 KB, so it stays wired; it is
  simply not one of the sources that will actually save anything.

**And one that only appeared in the live run.** Node's `fetch` appends
`Cache-Control: no-cache` to any request carrying a validator — the fetch
spec flips the cache mode to "no-store" when a conditional header is
present, and that appends the directive unless the caller sets its own.
Express reads that *request* directive literally (`fresh()` returns false)
and answers 200 with the identical ETag. Measured 2026-09-04: Lever and
SmartRecruiters revalidated fine under `curl` and never under ours, until
`conditionalHeaders` began sending `Cache-Control: max-age=0` — which is
what we actually mean. This is the kind of thing that would have shipped as
"conditional requests are on" while nothing was ever revalidated, so §6's
live double-tick is not optional.

## 2. Tick jitter

**Now:** `registerCron('5 * * * *', 'fetch', …)` in `src/index.ts`.

**Change:** the minute comes from the install, not from the source file.
`AppSettings.instanceId` (a uuid written once, at first boot) is hashed with
the job's name into a minute 0–59, and the cron expression is built from it.

Why a stored uuid and not `os.hostname()`: in Docker the hostname is the
container id, which changes on every `--force-recreate`. The schedule a user
observes should survive an update. Why not an env var to pin it: nothing
needs pinning yet, and the chosen minute is already logged at boot and
visible on `/runs`.

Why the job name is in the hash: `fetch` runs every hour and `discovery`
runs Sunday at 04:00. One minute per install would make those two collide
every Sunday on every install — today they are :05 and :00 and never do.

**Which crons get it:** the three that talk to somebody else's server —
`fetch` (hourly, every source), `hn-hiring` (monthly, HN's API),
`discovery` (weekly, re-probes ATS boards). `digest`, `stale-applications`
and `cleanup` touch only the user's own Telegram and database; 09:00 means
09:00 because a human chose it.

Pure and testable: `fetchMinute(instanceId, jobName)` → 0–59, spread checked
over a few thousand ids.

## 3. Source order

**Now:** `orderBy: { id: 'asc' }`, plus a 1 s polite delay between sources.
Identical ids on every install ⇒ identical order ⇒ the burst in §0.

**Change:** shuffle the walk order per tick (seeded Fisher–Yates, so the
shuffle itself is a pure function with a seed argument and unit-testable;
production seeds it randomly per tick).

Two things must NOT move with the shuffle:

1. **The Adzuna overflow set.** `companies.filter(ADZUNA).slice(MAX_ADZUNA_ROWS)`
   currently picks "the ten oldest Adzuna rows" and refuses the rest — a
   binding monthly limit (ADR 0034). If the shuffle ran first, a different
   ten would be fetched every tick: still ten calls, but the user could no
   longer tell which markets are live. So the overflow set is computed from
   the id-ordered list first, and the shuffle only reorders the walk.
2. **Nothing else depends on order.** Discovery is idempotent on
   `(atsType, atsToken)`. The fingerprint dedupe links a new row to the
   already-stored one, so within a tick "whichever of two cross-listings is
   inserted first becomes the original" — that was already arbitrary (lowest
   company id), it is now arbitrary in a different way. Worth stating; not
   worth defending.

## 4. Conditional requests

**Now:** one source does this — `devitjobs.ts` keeps `{etag, lastModified,
jobs}` per host in a module-level `Map`, catches the `HttpError(304)` that
`fetchWithRetry` throws, and replays the parsed jobs.

**Change:** one mechanism, `src/fetchers/conditional.ts`, used by every
single-URL-per-tick source, and DevITjobs moved onto it.

### What a 304 means for us

The decision that shapes everything else: **on 304 the fetcher returns no
jobs**, rather than replaying a cached copy. The rows are already in the
database — replaying them would run the whole filter → dedupe → upsert path
every hour to reach the same state. Returning nothing also means we store no
payload, which is what Remotive's `no-store` asks of us, and it keeps the
cache at two short strings and an integer per source instead of every parsed
description in memory.

Three consequences have to be handled, or this design quietly loses jobs:

**(a) A 304 is not `empty`.** `classifyFetchCount(0)` says `empty`, which
resets the failure streak but never advances `lastOkAt` — so a source that
legitimately answers 304 for two weeks would be reported as *silent*. A new
status `not_modified` carries the truth: healthy, streak reset, count 0,
displayed as "Unchanged".

**(b) A 304 must not resurrect a dead board.** Breezy's empty board (§1)
answers 304 forever. So `not_modified` advances `lastOkAt` **only if the
last real response had rows** — the cache remembers that count. Pure helper,
`advancesLastOk(status, cachedCount)`; the ADR 0019 invariant ("`lastOkAt`
moves only when the source actually produced postings") survives intact.

**(c) A validator must never be stored for jobs we did not persist.** This
is the sharp edge, and it is on a *normal* path, not a crash path: pausing
fetching mid-tick aborts `runFetchJob` before `processNormalizedJobs`, and
everything fetched so far is discarded. Store the ETag eagerly and the next
tick answers 304 — those postings are gone until the feed happens to change
again.

So the cache is two layers. A fetcher writes to a **staged** map; the live
map is only updated by `commitConditionalCache()`, which `runFetchJob` calls
after a processing pass that completed without aborting. Anything else —
pause, error, forced shutdown — leaves the live map untouched and costs one
full refetch next tick. Staging is cleared at the start of each tick, which
is also correct under two overlapping ticks: the worst interleaving commits
a validator for jobs the *other* tick already persisted.

### Which sources

Only sources that make **one request per tick for a company row**. A 304 on
one of several URLs does not mean "this source is unchanged", and the
remembered count would be a fraction of the truth. That rules out Arbeitnow
(up to 3 pages), Jobicy and Himalayas (one feed per place the searches
hunt), Adzuna and France Travail (paginated), and the HN feeds. Of those,
only Arbeitnow and Jobicy would have benefited — 3 rows.

For the rest the two lines are **self-configuring**: `conditionalHeaders()`
returns `{}` until the vendor has actually sent a validator, so adding them
to a source that offers none is a no-op, and a vendor that turns validators
on later is picked up for free. No per-source allow-list to keep in sync
with a measurement that will go stale.

The entry records the URL it came from, and a URL that differs from the
stored one skips the cache — the geo-filtered sources build their URL from
the running searches, and an ETag from last week's countries must not be
sent for this week's.

## 5. Hosting this for other people

A README section, not code. Three things a host needs to know and cannot
infer:

- **The vendor terms are yours, not ours.** Adzuna's permitted use is
  personal research and publishing listings; an organisation is on a 14-day
  trial and must arrange its own licence. France Travail's licence, Art. 3,
  forbids passing the content to third parties, and Art. 5.1 forbids
  charging job seekers for access to it. A hosted multi-user ApplyPack is
  exactly the case both clauses are about.
- **The daily obligation does not pause.** France Travail Art. 5.2 asks for
  a re-read every 24 hours; if fetching is paused longer than that, the
  mirror stops and the stored offers are out of compliance.
- **Be a good guest on the shared sources.** The unkeyed sources are free
  RSS and public APIs with no contract at all, which is a reason to be more
  careful, not less. §2–§4 are the code side of that; a host running many
  instances should keep them on separate `instanceId`s (i.e. separate
  databases), which is the default.

## 6. Verification

- `fetchMinute` / `shuffleCompanies` / `advancesLastOk` / the conditional
  cache: unit tests (pure).
- `not_modified` through the health surfaces: `/companies` shows "Unchanged"
  and the source is neither failing nor silent.
- Live: run a tick twice against a real board and confirm the second one
  reports `not_modified` and zero rows, with the job count unchanged.

**Result (2026-09-04, twelve boards, two ticks):** eleven answered
`not_modified` on the second tick — Greenhouse (88 rows → 0, 435 ms → 198 ms),
Lever (73 → 0, 776 → 333), Ashby (102 → 0), Personio (54 → 0), Teamtailor
(8 → 0), Golang Projects (5 → 0), Remotive (17 → 0), Pinpoint (7 → 0),
DevITjobs.nl (224 → 0, 320 → 126), plus the two empty boards. We Work
Remotely refetched, for the reason in §1. Both empty boards — Breezy and
SmartRecruiters — reported `not_modified` with `lastOkAt advances: false`,
which is the ADR 0019 invariant holding under the new status.

**And end-to-end on a live install (73 active sources, two "Fetch now" runs
in the same web process):** 5 500 rows on the cold tick, **1 607 on the
second, with 52 of 73 sources unchanged**. `/companies` shows those 52 as
"Unchanged"; the Quiet sources card still lists only the four genuinely
broken rows, and the SmartRecruiters board that answers 304 over an empty
list is still called Silent — which is the whole point of §4's rule 2.

One honest number: **the tick is not faster** (160.9 s vs 163.9 s). The
one-second politeness delay between sources dominates the wall clock, so
what a 304 saves is the vendor's bandwidth and our own parsing and database
work, not time. Shortening the delay after a 304 would change that; it is
deliberately not in this change, because the delay is politeness and a 304
is still a request.
