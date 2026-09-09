# 0047 — A screening scores evidence, not keywords, and a person decides

**Status:** Accepted (2026-09-09). Successor to [0012](./0012-deterministic-match-score.md) and [0030](./0030-resume-strength-review.md) for the other side of the table.

## Context

TASKS §19 asked for the employer's view: a folder of resumes against one
position, "by content, not by keywords", with an order to interview in.
`score.ts` is the wrong instrument for it — 60 points for term presence
plus 40 for how the document is presented measure the resume, not the
person, and this product's own tailoring loop (§18) can raise that number
without adding a fact. A resume is also a weak predictor of performance
(years of experience r ≈ .16–.18 in the Schmidt & Hunter / Sackett
meta-analyses), so whatever the tool computes can only be a priority to
talk to, never a prediction.

## Decision

- **The model marks facts with verbatim quotes; the code computes.** The
  reply (`screening/prompts.ts:ScreenReplySchema`) carries an evidence rung
  per rubric term — absent / listed / project / role / production — a
  pass / unknown / fail per gate, the roles with their dates copied verbatim,
  the level, the impact grade, the sector, and 3–5 interview questions.
  `screening/anchor.ts` checks every quote against the redacted text: a
  rung above "listed" with no located quote falls to what `evidence.ts`
  reads off the text, a gate's pass or fail with no quote becomes unknown,
  a role whose position or dates are not in the text is dropped, and a term
  the rubric never named is dropped. The text outranks the model (0045).
- **`screening/score.ts` is the formula:** must-have 35, relevant years and
  recency 15 (from the dated relevant roles, in code), level and scope 15,
  impact 15, domain 10, nice-to-have 5, education 5 — the weights editable
  per rubric — with three caps: no core-stack term anywhere → 30, two
  levels under the posting → 50, duties-only impact → 60. Either/or groups
  count once (0044). A part the text cannot answer leaves the denominator
  and lowers the **confidence**, which is shown beside the score and never
  folded into it: a short resume is unread, not weak.
- **Gates are a bucket, never points.** Every gate passed = "Priority to
  talk to"; one unknown = "Ask first", with the question on the scorecard;
  one failed = "Did not pass a gate". The table orders bucket, then score,
  then confidence. The score is still computed inside every bucket, for
  the file.
- **No automatic decision.** `Applicant.decision` is written by one route,
  from one form, and logged as the user's; the model's `summary.verdict`
  is worded "priority to talk to", never "best candidate". A gap between
  dates, age, family, origin and health are named in the prompt as things
  that never count.

## Consequences

✅ "Why is №3 above №7" is a table on each scorecard: term → rung → quote →
points, gate → status → quote, and the cap in a sentence; the same rubric
and prompt version give the same order a month later. ❌ The rungs' credits
(0 / 0.3 / 0.5 / 0.8 / 1) and the weights are the plan's starting values,
not measured against a human ranking — stage 0 of §19 (a gold set) was not
built, so this is a defensible score, not a calibrated one. The formula
says so in its constants, and the rubric editor lets a person move them.

## When to revisit

A human-ranked set of thirty resumes for one posting (Kendall τ against the
order this produces), or a real hiring round where the bucket order was
wrong for a reason the scorecard could not show.
