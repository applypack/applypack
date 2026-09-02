# 0030 — The strength review grades; the code scores

**Status:** Accepted (2026-09-02)

## Context

The owner asked for one thing the app could not answer: **"is this resume
strong, and how do I make it stronger?"** Everything built so far answers a
different question.

- `scan.ts` returns job-agnostic hygiene — heading order, date formats, bullets
  without outcomes, a missing contact line. Mechanical, and rendered as a flat
  "Issues to fix" list.
- `parse-warnings.ts` answers "can a parser read this file", deterministically.
- `match.ts` answers "does this resume fit THIS posting" — the whole rubric is
  relative to a job description.

None of them says whether the document reads like a strong professional at the
level it claims. That judgment is what a hiring manager makes in ten seconds
and what no deterministic check can produce.

The repo has also paid twice for letting a model produce a score:
CLAUDE.md gotchas 8 and 11 — a Laravel resume scored 82/100 against a Node.js
posting, and the classifier scored a Rails role at 92 for a PHP candidate.
Both were fixed the same way: the model marks facts, code applies hard caps.

## Decision

**A sixth AI call site, `resume/review.ts`, on demand only.** Never on upload,
never on a version save, never in the worker (ADR 0008). One button, one call,
about a minute, counted in `aiUsage` like every other.

**Six graded dimensions, no number from the model.** `REVIEW_SYSTEM` grades
`first_impression`, `impact`, `seniority_signal`, `clarity`,
`keyword_coverage` and `polish` as `strong | ok | weak`, each with 1-2 pieces
of evidence copied character-for-character out of the resume. The prompt says
`YOU NEVER SCORE`; `review-score.ts` turns grades into 0-100:

| | weight | why it leads or trails |
| --- | --- | --- |
| impact | 30 | what separates a senior resume from a job description of the same role |
| first_impression | 20 | the ten seconds that decide whether the rest is read |
| seniority_signal | 20 | the level the wording actually supports |
| clarity | 15 | structure and length, with the deterministic ATS checks as input |
| keyword_coverage | 10 | skills evidenced in the work, not listed in a box |
| polish | 5 | real, and never the reason someone is hired |

Credit is `strong` 1, `ok` 0.5, `weak` 0, so an all-`ok` resume scores 50 and
the number needs no explaining. **Two caps carry the judgment weights cannot:**
`impact` weak caps the total at **55** (duties without outcomes cannot read as
a top hire, however polished everything else is), and two or more weak
dimensions cap it at **45**. A dimension the reply omits earns zero and counts
as weak — a missing judgment is not a good one.

**Advice may rewrite what is there; it must ask for what is not.** Every advice
item points at a verbatim line and carries either an `example` rewrite built
only from facts already in the resume, or an `ask` — the question whose answer
the stronger line would need ("how many requests per day did that service
handle?"). This is the ADR 0020/0021 stance applied to a new surface: the app
never invents a number the candidate would have to defend in an interview. The
prompt also forbids generic career advice and judging the person rather than
the document — a gap in the dates is a presentation problem, never a guess
about someone's life.

**New table `resume_review`, one row per run.** History is what makes the
version-over-version trend free, and a run costs one small row. `reviewScore`
is written by `review-score.ts`; the prompt version rides inside `breakdown`,
the trick `resume_match` has used since ADR 0029, so a marker needs no column.
`ON DELETE CASCADE` — a review means nothing without its resume.

**One advice surface, never two.** Once a review has read the CURRENT version,
the card supersedes the scan's "Issues to fix" list, which folds into a
disclosure. A review of an older version is badged as stale rather than
silently ageing.

Two deliberate departures from the plan (docs/resumes-plan.md §B.3):

- The plan's sixth dimension was "red flags". Graded on the same
  `strong | ok | weak` scale it would read backwards — "red flags: strong". It
  is `polish` instead: the same checks (clichés, weak verbs, buzzword
  stuffing, inconsistent formatting), phrased so that `strong` always means
  good, which keeps one grade vocabulary for the score, the schema and the UI.
- The plan listed an `asks` column beside `advice`. An ask without the advice
  item it belongs to has no context, so asks live inside their advice rows.
  The metric-ask loop (phase 3) reads `advice[].ask`.

## Measured (2026-09-02, `claude_code` CLI engine, Opus, live on the stored resumes)

Three stored resumes, one run each, `/resumes/:id` → "Run strength review":

| Resume | grades | raw | cap | score | advice / asks | reply | time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Senior Backend PHP v4 | impact/seniority/keywords **strong**, first-impression + clarity **ok**… clarity and polish **weak** | 70 | 45 (two weak) | **45** | 8 / 4 | 12 110 chars | 72.6 s |
| PHP/JS/React v1 | impact/seniority/keywords strong, first-impression + clarity ok, polish weak | 77.5 | — | **78** | 7 / — | — | ~2 min* |
| "with photo" v1 | identical grade vector | 77.5 | — | **78** | 8 / — | — | ~2 min* |

\* the second and third ran concurrently on one machine, so their wall-clock
times are not comparable with the first.

**The rubric discriminates where the documents differ and agrees where they do
not.** A 33-point spread between genuinely different resumes; the two that
scored the same are two variants of one CV, and the six questions the rubric
asks do not separate them — which is the correct answer, not a failure.

**The two caps did real work.** The 45 came from weights that would have said
70: the resume's KEY SKILLS block collapses eight category labels onto one
line and every value onto another (a parser reads one long string), and the
polish grade caught a typo plus a product version that did not exist when the
role ended. Weights alone would have called that resume "above average".

**No invented facts in 23 advice items.** Every `example` rewrite used only
lines already in the document — several *removed* unsupportable percentages
rather than adding numbers — and the four questions the first review raised
("what did you actually measure for code review impact?", "which services were
consolidated for the six-figure saving?") are exactly the numbers a candidate
must supply themselves.

**Known blind spot:** the review reads the extracted text, so anything that is
not in it — a photo, a two-column layout, colour — is invisible to the rubric.
That is `parse-warnings.ts` and the scan's issue list, both of which the card
still shows.

## Consequences

✅ The app answers the owner's question with a number it can defend line by
line: every grade shows the candidate's own words, every point is traceable to
a weight, and the two caps are unit-tested — including the guard that a
duties-only resume cannot pass 55 however good the rest is. The advice is
actionable because it quotes the line it targets, and honest because the only
route to a number the resume lacks is a question to the user.

❌ A sixth AI call site and a fifth prompt to keep fenced and guarded (both
registered in `prompt-fence-registry.test.ts`). The weights and caps are
judgment, not measurement — they were set from the rubric's intent and checked
against the stored resumes, and they will need re-tuning if the grades turn out
to bunch. And a second score now exists in the product: "match 66/100" (against
one posting) and "strength 74/100" (on its own) are different questions, so the
card and the hub column both say which is which.

## When to revisit

If reviews of genuinely different resumes cluster within a few points, the
rubric is not discriminating — re-tune the weights or the grade definitions,
not the caps. If the metric-ask loop (phase 3) ships, revisit whether answers
belong in `CandidateFact` (shared with the match) or in a review-local store.
