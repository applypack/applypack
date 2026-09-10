# §22 — Future direction: resume coverage map

**Verdict: adopt the "lite" version as §19 stage 3 (P3): it is a pure aggregation over comparisons already stored. The three-column tree is a visualisation of the same numbers; draw it when the numbers exist.**

## What the plan proposes

Beyond one score: per area (Backend 94 % / Cloud 61 % / Leadership 82 %) with
✓ ✕ ? per term, aggregated across recent relevant jobs, so the user gets a
long-term resume strategy rather than one-job optimisation.

## What the repo has today

- Every comparison stores the keyword table with a status per term
  (`ResumeMatch.keywords`: term, requirement, status present / add /
  ask_user / cannot_claim, group label, evidence grade) — ADR 0044/0045 make
  the status a property of the text, so rows are comparable across postings.
- `Resume.industries` (ADR 0046) and the brief's requirement groups give the
  "area" axis without another call.
- `/resumes/:id` has the strength review and the match history; no
  cross-posting view.

## Assessment

"Across your last N comparisons, these terms were wanted in X and your resume
lacked them in all of them" is the useful sentence, and it is
`GROUP BY term` over `resume_match` for one resume — no AI, no schema. The
grouping into Backend / Cloud / Leadership is where it gets soft: the brief's
group labels are per posting and do not agree across postings. Start with
the flat list and the count; add the areas when a label vocabulary exists
(issue #217 is asking for exactly that on the employer side).

Threshold: show the card when a resume has ≥ 5 comparisons against distinct
postings; below that it is one posting's opinion restated.

## Steps → TASKS §20, block `search-funnel` stage 3

- [ ] `src/resume/coverage.ts` (pure, tested): fold a resume's stored
      keyword tables into term → { wanted in N postings, missing in M, must
      in K }, sorted by must-count then frequency.
- [ ] A "Missing across postings" card on `/resumes/:id` (≥ 5 comparisons),
      each term linking to the last posting that wanted it; the same two
      lines as §20's rule: *have it — add the evidence; don't — consider it.*
