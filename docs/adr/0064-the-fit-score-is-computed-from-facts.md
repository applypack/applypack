# 0064 — The classifier reports facts, and code computes the fit score

**Status:** Accepted (2026-10-29). Issue #634. Amends
[0028](./0028-parallel-searches-one-call-per-posting.md) (the reply shape:
no `fit_score`, no `tech_match`); applies to the classifier what
[0012](./0012-deterministic-match-score.md) did for the resume match.

## Context

`fit_score` was a field in the classifier's JSON, steered by four bands of
"SCORING GUIDANCE" (90–100, 70–89, 40–69, 0–39). The model picked one number
per band. On a fresh install (#634) 38 of 52 matches scored exactly 92, so
**Highest fit** on /jobs, the Overview's best match, the pack trigger and
the alert order could not tell them apart. The 92 was loose too: the band
asks for "salary clear and meets target" and most of the 38 named none.

Both remedies the issue names were measured on 41 stored postings of a used
install: every match (17, fit ≥ 70) and 24 below it, one search (TypeScript,
Node.js, React; senior; remote from PL; floor 70), Haiku 4.5 through the
Claude Code CLI. A second run of the top 12 measures stability.

| | shipped prompt | anchors inside each band | facts (this ADR) |
| --- | --- | --- | --- |
| matches (≥ 70) | 17 | 17 | 22 |
| distinct values among them | 6 | 7 | 12 |
| most common value | 72 × 7 (92 × 5 on top) | 78 × 5 | 86 × 4 |
| postings sharing the top value | 5 | 3 | 1 |
| second run: mean \|Δ\|, top 12 | 5.9 | 3.8 | 2.2 |
| second run: crossed 70 | 1 | 0 | 0 |
| order vs stored (Spearman / Kendall τb) | — | 0.93 / 0.82 | 0.75 / 0.61 |

The shipped prompt run again put 7 of the 12 back on 92. Anchors ("score to
the unit; 96 = one nice-to-have short …") moved the cluster from 92 to 78:
the model picks the anchor instead of the band. Facts broke the ties.

The facts took four rounds, and the first three are why the design is what it
is. With seniority and role type graded by the model, a second run moved the
top 12 by 9 points on average, and one posting fell from 92 to 39 because a
"Level: Regular" posting read as a match once and two steps off the next time.
With order-preserving ceilings added, 16 points and four floor crossings:
seniority still flipped, and backend roles were called "adjacent" for a
search that lists backend, because the search is named "Full-Stack". Asking
for the levels the posting names and counting the distance in code took it
to 5.5; asking which of the search's own role types the job is took it to 2.2.

## Decision

The reply carries facts. Once for the posting, beside salary and location:
`levels` (the rungs it names: intern, junior, mid, senior, staff, lead,
principal; "Regular" is mid) and `min_years`. Per search: `stack_used` and
`nice_used` (the search's own items the role uses), `stack_role`
(core / secondary / none), `role_types` (the search's own role types the job
is) with `role_type` for when it is none of them (adjacent / other),
`excluded` (the search's auto-reject signals that describe the role),
`off_stack` (none / some / most), plus `location_match`, `red_flags`,
`summary` as before. `CLASSIFIER_PROMPT_VERSION` 7.

`src/fit-score.ts` (pure) holds every named item to the search's own lists
(an item it never listed is dropped; a role type it lists makes the role type
a match; listed stack with "none" is "secondary") and computes:

| fact | points |
| --- | --- |
| stack: core / secondary / none | 40 / 15 / 0 |
| breadth: share of the required list used | × 10 |
| role type: match / adjacent / other | 15 / 7 / 0 |
| seniority: match / unstated / adjacent / mismatch (code: closest rung; years when no rung) | 15 / 10 / 4 / 0 |
| salary: disclosed / not disclosed / under the floor | 10 / 4 / 0 |
| nice-to-haves: share of up to five | × 5 |
| off-stack: none / some / most | 5 / 2 / 0 |

A fact the old guidance called partial or a miss also sets a ceiling — no
required stack 35 (gotcha 8's rule, now code), stack used on the side 69,
adjacent role type 69, another discipline 39, two rungs off 39, an
auto-reject signal 25. The points are **scaled** under the lowest ceiling
that applies, never clipped to it, so postings under one ceiling keep their
order. `capFitForMissingStack` (≤ 50) still runs after; priority rules still
lift the result in `buildVerdicts`. `tech_match` is `stack_used` ∪
`nice_used` in the search's spelling, so the facets and the score read the
same facts.

Location is not a component. `location_match` stays the gate
`decideDismissReason` reads after the floor: a posting that fits the skills
but is closed to the search is dismissed as `location-mismatch`, where the
model used to sink it under the floor as `low-fit`.

## Consequences

✅ Ties break on facts; the same facts give the same number, unit-tested
(`fit-score.test.ts`); the caps are code, not prompt rules.
✅ A second run moved the top less than the shipped prompt (2.2 vs 5.9).
✅ Copies of one posting agree: four listings of one role on one board scored
72, 72, 72 and 52, and now 81, 81, 81 and 80.
✅ One spelling per technology on the stack facets ("github actions", not
"github-actions" in one row and "GitHub Actions" in another).

❌ A wrong fact moves the number a lot, where the old number hedged. In the
final pass 2 of 41: Node.js read as "secondary" in a Node.js / NestJS
backend role (72 → 46), and one of three identical "Senior Frontend
Developer (React + React Native)" postings filed as full-stack (35 → 91).
❌ Rows scored before v7 keep the model's number until re-classified, so the
Highest-fit sort mixes two scales until **Save & re-classify** runs. The
engine trial compares a new reading with stored verdicts that may predate it.
❌ About 200–300 more input tokens a call (the fact definitions) and 40–60
more output (322 on average for one search, 672 at most);
`MAX_TOKENS_PER_PROFILE` 180 → 320.
❌ The facts are not stored, so a change of weights needs a re-classify.
❌ On this sample 6 postings crossed the floor upward and 1 down; each is
named by its facts on the `classifier: fit from facts` debug line.

## When to revisit

When the weights need tuning: store the facts on `JobScore` first, so a new
formula re-scores without a model call and the job page can say why. When a
re-run on a used install shows more than one fact error in ten postings, or a
classifier model other than Haiku 4.5 becomes the default: measure again
before trusting the ceilings.
