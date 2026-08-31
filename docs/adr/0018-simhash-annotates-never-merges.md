# 0018 — Cross-listing is annotated, never merged, and its constants come from our own corpus

**Status:** Accepted (2026-08-31)

## Context

Dedup is per `(companyId, externalId)`. The same posting reaching us через
RemoteOK, the company's own Greenhouse board and an aggregator is three rows
and up to three paid classifications, and — worse — an invitation to apply
twice through two channels. F3 adds a content fingerprint (SimHash over the
JD body) to spot it.

The plan (feature-expansion-plan.md §4) proposed two constants and one
behaviour: fingerprint bodies over **200 normalized chars**, match at
**Hamming ≤ 5**, and on a **same-company** match treat it as a repost and
**skip** it. All three were measured against our own 731 stored jobs before
any code was written, and two of them are wrong for our data.

**The 200-char guard sits just below our worst source.** Jobicy ships
truncated teasers — normalized length 239 median, 284 max — that contain the
company blurb and nothing role-specific:

> `Hiring company: ClickUp. Type: full time.` + "At ClickUp, we're building
> the future of work: …" (cut off at ~250 chars)

Two different ClickUp roles ("Senior Backend Engineer" and "Staff Backend
Engineer, Hierarchy") therefore have **byte-identical descriptions** and a
distance of 0. At a 200-char guard that produced 24 false pairs; at 400 it
produces none, and no real body is lost — our sources with genuine content
start around 550 normalized chars (HN_HIRING p10 = 779, Greenhouse median
6522). Raising the guard further to 500 or 800 changes nothing, so 400 sits
in the middle of a clean gap.

**Skipping same-company matches would silently drop real jobs.** At Hamming
≤ 5, 34 of the 127 same-company matches (27%) are genuinely different roles
that merely share a company's boilerplate:

- Affirm — "Senior Software Engineer, Backend (Infrastructure)" vs
  "(Authentication Experience)" vs "(PBA – Growth)"
- TaskRabbit — "Customer Support Advocate" in German vs Spanish vs Portuguese
- Square — "Manager, Field Sales – Houston" vs "– Los Angeles" vs
  "– Orange County" (distance 1–2)

For a candidate these are distinct opportunities, and the plan's own
acceptance criterion already says "no data loss is possible by
construction". The measurement resolves the contradiction against the
"skip" bullet.

**The threshold is 7, not 5.** Every cross-company match up to distance 7 is
a genuine cross-listing (9/9), including the pairs distance 5 splits apart:
Lemon.io listed simultaneously on WeWorkRemotely, Remotive and RemoteOK, and
Reddit's "Backend Software Engineer, PDP Experience" on both WeWorkRemotely
and Reddit's own Greenhouse board. The first false positive appears at
distance 10 — Proxify AB's React role against its Python role — so 7 keeps
a two-bit margin. The error costs are asymmetric in the same direction: a
wrong annotation is a confusing note, a missed one is applying twice through
two channels.

## Decision

`src/fingerprint.ts` (pure): `normalizeJdText` → `simhash64` over 3-token
shingles → `hamming64`. A body under **400 normalized characters** gets no
fingerprint, and a body under 3 tokens gets none (an unspaced CJK body
normalizes to one token, and an all-zero hash would match every other
degenerate body). No fingerprint never matches anything.

A new job is compared against fingerprints from the last 90 days **at other
companies only**, at **Hamming ≤ 7**. A match sets `Job.crossListedOfJobId`
and surfaces as "≈ also listed at X — apply through one channel only" on
`/jobs/:id` and in the Telegram alert. **Annotation only**: no row is
merged, hidden, or dropped, and the duplicate is still classified on its own
merits. Same-company matches are left alone entirely — that is F11's repost
territory, and the measurement above shows why F3 must not touch them.

Skipping the duplicate's paid classification (the plan's flagged decision
point) is **deferred**. Cross-company precision is 100% on our corpus, but
that corpus contains only nine such pairs; inheriting a verdict on a wrong
match would dismiss a real job, which is exactly the data loss this ADR
rules out. Revisit once the annotations have run long enough to measure.

Schema is additive: `Job.descriptionSimhash BIGINT?` and
`Job.crossListedOfJobId Int?` (nullable self-relation), hand-written
migration per gotcha 7.

## Consequences

- Jobicy, LaraJobs and Rippling bodies never get a fingerprint under the
  400-char guard, so cross-listings that reach us *only* through those feeds
  stay invisible. Accepted: a fingerprint built from a company blurb cannot
  distinguish roles, so the alternative is not detection but false
  detection.
- The 90-day scan is a full comparison against every fingerprint in the
  window — ~700 rows today, microseconds. The plan's banded index on hash
  quarters is deferred until a timing shows it matters.
- The constants are tuned on a corpus that is 75% Greenhouse. Starter packs
  (F14) are about to widen it; re-measure when the mix has changed.
- URL-key discipline lands in the same feature but fixes nothing observable
  today: no stored job has a tracking parameter, and the only query
  parameter in the corpus is `gh_jid`, which is functional and kept. It is
  preventive hardening for the fallback path that hashes a URL into an
  `externalId`, and it changes no existing row.
