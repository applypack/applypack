# 0006 — Discovery via HN parser, not vendor lists

**Status:** Accepted (phase-4.2)

## Context

Phase 4 added auto-discovery: a way for the system to find new
companies the user might want to track, beyond the ones they manually
add via `/companies`. Sources considered:

- **Vendor customer lists** — Greenhouse / Lever / Ashby publish their
  customer lists somewhere (sales pages, LinkedIn). Scraping these
  is messy, the lists are huge (100k+ on Greenhouse), and most
  customers aren't tech companies hiring engineers.
- **GitHub trending / awesome-* lists** — high-quality but low-volume
  and biased to OSS-friendly companies.
- **HN "Who is hiring?" monthly thread** — already parsing this for
  job postings (phase-3.2). Each comment that says "Stripe | Senior
  PHP | https://boards.greenhouse.io/stripe/jobs/123" carries an ATS
  URL we can extract.
- **JobSpy / Wellfound scraping** — ruled out by ADR 0005.

## Decision

Discovery harvests `CompanyCandidate` rows by scanning the text of
HN Who-is-hiring comments for ATS URLs (`extractAtsToken` in
`src/text-utils.ts` recognises greenhouse, lever, ashby, workable,
smartrecruiters URLs). The user reviews on `/discovery` and clicks
**Promote** to add the candidate to `Company` with `active=true`.

A weekly cron (`runDiscoveryJob`) re-probes each pending candidate
via `probeAts` so that:
- `jobsSeen` reflects current-month listings (sorted descending in the UI),
- 4xx-returning slugs flip to status=DEAD and stop appearing in review.

## Consequences

✅ One source feeds two outputs: jobs (during HN parser) AND candidates
(via the same comment text). No new external integration to maintain.
✅ HN comments are written by the companies themselves and pre-include
the ATS URL — accuracy is high.
✅ The user retains gate-keeping: PENDING → PROMOTED requires a click.
The system never silently starts fetching from a new company.
✅ The pattern generalises — if we ever add another source that
contains free-form ATS URLs (a Slack archive, a GitHub repo), the
same `recordCandidatesFromText` helper will work.

❌ Discovery only works in months when there's an active HN
Who-is-hiring thread (every month — but if HN ever closes that, the
pipeline goes dry). Acceptable risk.
❌ Companies that don't post on HN are invisible to discovery. The
manual `/companies` add form remains the primary way to add anything
HN doesn't surface.
❌ Discovery and HN parser are coupled. Disabling `hnParserEnabled`
also turns off discovery feed. Acceptable — we explicitly gate
discovery on `discoveryEnabled` so the user can keep HN parsing while
turning off candidate harvesting if the review queue gets noisy.

## When to revisit

If HN's Who-is-hiring thread ever stops, or if we want to harvest
candidates from a non-HN source. The harvest helper is generic
(`recordCandidatesFromText(text, sourceTag, …)`) — wiring up another
text source is mostly tagging it (e.g. `source='reddit-cscareerquestions-2026-04'`).
