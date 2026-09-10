# §20 — Future direction: skill market intelligence

**Verdict: defer — needs one prompt/schema change and real volume; decide after §19 stage 1. The "already know it? add evidence / don't know it? consider learning" split is right and is the same rule the tailoring loop already enforces.**

## What the plan proposes

Local statistics from the user's own searches: *AWS 68 % · Docker 62 % …*,
then "requested but not evidenced in your resume: Terraform 36 %, Redis 31 %".

## What the repo has today

- Per posting, the classifier stores `techMatch` = the overlap with the
  **profile's** stack (`JobScore.techMatch`), not the posting's stack. A term
  the profile does not list is never counted — so "Terraform 36 %" cannot be
  computed from today's rows.
- The posting brief (`PostingBrief.brief`, ADR 0044) does carry the
  requirement groups and keyword frame — but only for postings that were
  compared with a resume, i.e. tens, not thousands.
- `Resume.industries` and the resume scan's `primary_skills` give the
  resume side.

## Assessment

The honest version is one added field in the classifier reply —
`stack_mentioned: string[]`, the technologies the posting names, normalised
through `keyword-aliases.ts` — stored on `JobScore` or `Job`, and a card that
counts them over the last N classified postings against the resume's skills.
Zero extra calls (same classifier call, ~20 more output tokens), one column,
one pure aggregation. Its risk is the one gotcha 8 paid for: a model that
lists "full-stack" as a technology; the alias table and a stop-list handle
that.

Why defer: the count is only meaningful over hundreds of classified postings
in one search direction; the 2026-09-01 numbers show 0–4 classified per tick
(≈ 50–100 a day). After §19's strip shows the actual volume for a month, this
is either a week's card or a feature for a different user.

## Steps

None now. Record the design above in TASKS §20 as a deferred block with its
trigger: ≥ 500 classified postings in a running search.
