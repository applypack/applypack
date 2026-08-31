# 0016 — Job liveness is checked by a free three-rung ladder before any AI verify

**Status:** Accepted (2026-08-30)

## Context

"Is this job real?" went straight to the most expensive rung: AI + web
search, 2–4 minutes, on every click — including postings that are simply
closed. All five tracked ATS vendors expose a public, unauthenticated
endpoint that answers "is this posting still open" in one request
(re-verified by curl 2026-08-30; payload shapes recorded in the F1 test
plan). Stored Greenhouse URLs are often custom domains (`block.xyz/…?gh_jid=`),
so a URL-only resolver would miss most of them — but `Company.atsToken` +
`Job.externalId` are exactly the board slug and posting id for every
tracked ATS row.

## Decision

`src/verification/liveness.ts`: rung 1 (fixed-host ATS API check, resolved
from Company/externalId first, URL patterns as fallback for MANUAL and
aggregator jobs) → rung 2 (plain fetch of the posting URL + a pure,
rule-ordered `classifyLiveness`) → rung 3 = the existing AI verify, only
when the ladder ends `uncertain`. A resolved verdict (`active` or
`expired`) stops the ladder at $0; a "Deep check (AI)" button keeps the
full ghost-job analysis reachable on explicit request. Verdicts persist as
nullable `Job.liveness` / `livenessCode` / `livenessCheckedAt` (additive
migration) and render as a chip on `/jobs/:id`.

The asymmetry doctrine is law: a false `expired` hides a live job forever,
a false `uncertain` costs one re-check — so every ambiguity resolves to
`uncertain` (Lever API 404s are non-authoritative by design — confidential
postings 404 the API while the public page is live; bot challenges and
blocked/redirected pages never resolve to `expired`). SSRF by
construction: fixed hosts, per-segment charset validation, `redirect:
'error'` on API calls. No settings toggle: the feature is click-triggered,
and the deep-check button is the per-use fallback to the old behaviour.

Observed and accepted: `api.smartrecruiters.com/robots.txt` disallows `*`
(LinkedInBot excepted) — but this is SmartRecruiters' documented public
Posting API, which our fetcher has polled hourly since the source landed;
one extra GET per user click does not change that posture.

## Consequences

✅ dead ATS postings resolve as `expired` in seconds at $0
✅ verification verdicts say which rung answered; liveness is queryable
❌ rung 1 trusts vendor semantics (Ashby board membership, Workable
`state`, SR `active`) — a vendor changing payload shape degrades to
`uncertain`, never to a wrong `expired`
❌ deferred: marking jobs `expired` when they vanish from a polled board
feed (worker-side; design together with F4 source health) — designed in
[ADR 0019](./0019-source-health-streaks.md) and deferred again, with the
gate written down there (list-completeness assertion)

## When to revisit

A vendor moves or gates its public posting endpoint (probe code then
returns `uncertain` — delete the vendor from rung 1); or F4 lands and the
board-feed-vanish signal gets designed properly.
