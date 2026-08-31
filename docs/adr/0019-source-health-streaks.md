# 0019 — Source health is a per-company streak; `empty` resets it but does not prove health

**Status:** Accepted (2026-08-30)

## Context

`runAllFetchers` catches every per-company error, logs it, and moves on.
Nothing is persisted, so a rotated board slug is invisible forever — the
row just stops contributing jobs. A read-only sweep of all 71 active
sources on 2026-08-30 (`fetchOne` per company, raw pre-filter counts)
found this already true in our own database:

| Result | Count | Detail |
|---|---|---|
| jobs returned | 67 | healthy |
| **HTTP 404** | **2** | `GREENHOUSE:pleo`, `LEVER:plaid` — deterministic, re-checked twice |
| 0 postings, HTTP 200 | 2 | `ASHBY:niantic`, `SMARTRECRUITERS:Visa` |

Two dead slugs had been failing silently. The error shapes that actually
reach a caller of `fetchOne` were measured, not assumed:

| Cause | Thrown value | Discriminator |
|---|---|---|
| dead slug (9 of 10 vendors) | `HttpError` | `.status` 404/410 |
| gated board | `HttpError` | `.status` 401/403 |
| Cloudflare rate limit (observed live on Workable) | `HttpError` | `.status` 429 |
| vendor outage, after 2 retries | `HttpError` | `.status` >= 500 |
| dead BambooHR slug (302 → `redirect: 'error'`) | `TypeError` | `cause.message = 'unexpected redirect'` |
| dead host / DNS | `TypeError` | `cause.code = ENOTFOUND` |
| refused connection | `TypeError` | `cause.code = ECONNREFUSED` |
| timeout | plain `Error` | message `… timed out after Nms` — `fetchWithRetry` rewrites `AbortError`, so `err.name` is useless here |
| payload shape change (Greenhouse/Lever/Ashby) | plain `Error` | message `… schema invalid …` |
| payload shape change (7 other vendors) | **nothing — returns `[]`** | **invisible** |

The last row is the reason `empty` cannot mean healthy. Confirmed live:
`api.smartrecruiters.com/v1/companies/<id>/postings` answers HTTP 200 with
`totalFound: 0` for *every* identifier tried — `Visa`, `Bosch`, `Ubisoft`,
`IKEA`, and a random non-existent string alike, under both our UA and a
browser UA. For SmartRecruiters a dead slug, a live board and a typo are
byte-identical, and 7 of 10 vendors turn a malformed payload into the same
`[]`. A single "failures" counter would mark all of that permanently
healthy.

## Decision

Three additive columns on `Company`, written by a thin wrapper around
`fetchOne` in `src/fetchers/index.ts`:

```prisma
lastFetchStatus     String?    // ok | empty | slug_gone | auth | rate_limit | server | network | bad_payload | unknown
consecutiveFailures Int  @default(0)
lastOkAt            DateTime?  // advances ONLY on ok
```

Two pure, unit-tested functions carry all the logic
(`src/fetchers/source-health.ts`): `classifyFetchError(err)` implements the
table above, and `nextStreak(status, current)` implements the streak.

**The streak rule is inverted on purpose:** `ok` and `empty` reset to 0,
**everything else increments** — including `unknown`. A new error kind added
later cannot fall outside the streak by omission; the worst it can do is
land in `unknown` and still be counted.

**`lastOkAt` advances only on `ok`** (≥1 posting returned, pre-filter). That
makes it a second, independent signal: a source stuck on `empty` — a
SmartRecruiters slug that will never resolve, a vendor that quietly started
returning `[]` — shows an ageing `lastOkAt` while its streak stays 0. The
`/companies` "quiet sources" card therefore lists two kinds of row:
**failing** (`consecutiveFailures >= 3`) and **silent** (`ok`/`empty` but no
posting for 14 days). Both offer one-click re-probe via the existing
`probeAts`.

Status is recorded from the fetcher's **raw** return, before
`passesBaseFilter`. 46 of 65 active companies currently hold zero `Job`
rows — that is the profile filter, not source health, and conflating the
two would make the whole feature noise.

Thresholds are hypotheses measured where measurement was possible. `>= 3`
is kept: fetch is hourly, so three ticks is three hours and nine HTTP
attempts (`fetchWithRetry` already absorbs blips with two retries), and the
observed transient-failure base rate across 71 sources is zero. The 14-day
silence threshold could **not** be measured — `lastOkAt` has no history yet
— so it is deliberately conservative and stated as unmeasured.

Only the Telegram digest line is behind a toggle
(`AppSettings.sourceHealthAlerts`, default on). The columns and the card
are always-on: they add a signal, never suppress a job.

## Consequences

✅ a rotated slug surfaces on `/companies` within three hours instead of never
✅ `unknown` is inside the streak, so an unmapped future error still escalates
✅ `rate_limit` is labelled distinctly — a 429 never reads as "your slug is dead"
✅ the two dead slugs above become visible on the first tick after deploy
❌ SmartRecruiters can never report `slug_gone`; it degrades to the 14-day
silence signal, which is the honest limit of what that API tells us
❌ 7 vendors still swallow shape drift into `[]`; only the silence signal
catches it, and only after 14 days
❌ the silence threshold is a guess until `lastOkAt` accumulates history

## Deferred (from ADR 0016), with the gate written down

ADR 0016 deferred "marking jobs expired when they vanish from a polled board
feed" to be designed together with this feature. Designed, and **deferred
again** — the missing piece is not the health signal, which now exists, but
**list completeness**: no fetcher can assert that a 200 response contained
the whole board. Several cap pages by constant, and the SmartRecruiters
observation above is a live example of a 200 that is silently empty. Under
ADR 0016's asymmetry doctrine ("a false `expired` hides a live job forever")
inferring death from absence in a possibly-truncated list is exactly the
trade we refuse.

Gate to land it: a fetcher-level completeness assertion (vendor `total`
cross-checked against rows received) plus a `status = ok` guard, so
truncation can never masquerade as vanishing.

## When to revisit

`lastOkAt` accumulates a few weeks of history — re-measure the 14-day
silence threshold on the real distribution the way F3's constants were
re-measured. Or SmartRecruiters' Posting API starts answering again, which
would also un-break ADR 0016's rung-1 check for that vendor.
