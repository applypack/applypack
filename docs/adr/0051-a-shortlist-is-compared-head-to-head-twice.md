# 0051 — A shortlist is compared head to head, twice, and the comparison is never a score

**Status:** accepted (2026-09-09) — stage D of docs/screening-criteria-plan.md §5.1

## Context

The screening table orders applicants by a number computed from one
reading per resume (ADR 0047, 0050). The person who asked for it then
asked the next question: "why is №15 above №22?" — and, on a pile where
twenty-one documents shared one vocabulary, whether the model could just
"compare the candidates and say who fits best".

Listwise reading has two measured properties. A model compares two texts
it holds at once far better than it scores three hundred one at a time;
and it prefers the first and the last slot of a list it is shown
(position bias), so the order of the prompt leaks into the answer.

Three alternatives were on the table: fold a pairwise reading into the
score (a rank-aggregation step over the whole pile), run the listwise
call once and show it, or never let the model see two resumes at once.

## Decision

- **Two views for the shortlist, neither a score.** *Side by side* is the
  stored scorecards as columns, one row per criterion with the quotes —
  no call. *Compare with AI* is one call carrying two to five redacted
  resumes, the posting and the criteria, asking who is stronger on each
  criterion and why (with each applicant's own line), whom to talk to
  first (a reason each), and the one question that would decide between
  the first two.
- **Twice, in reverse.** The call runs two readings at once, the second
  with the resumes in the reverse order, and the page marks every
  criterion and the first place where the readings disagree. A
  disagreement is information — "the texts do not settle it" — not a bug
  to average away.
- **Stored, exported, never folded in.** `ScreeningComparison` keeps both
  anchored readings with the order each was shown in; a quote is kept only
  in the resume it was attributed to. The table's order stays the
  criteria's; the comparison is the argument for the shortlist meeting,
  copied as Markdown.
- **A ceiling of five.** Five resumes and the posting fit one call on the
  resume model's budget; above that the page says "narrow the shortlist
  first". The whole pile is never read listwise.

## Consequences

- The person gets the two things the score cannot give — the argument
  between two specific people and the question to ask — without a second
  number to reconcile with the first.
- Two calls per comparison. On a five-person shortlist that is the price
  of one applicant's scoring; on the whole pile it would be ruinous, hence
  the ceiling.
- Position bias is shown, not removed. Three readings would tighten it
  and cost half as much again; the plan's stage E can measure whether
  disagreements are frequent enough to justify that.
- A comparison read under an earlier rubric is still shown, labelled; the
  criteria it ranked are matched by id, so a criterion added since reads
  as unanswered and one removed is not shown.
