# 0050 — The rubric is a list of criteria the person chooses, answered one by one with a quote

**Status:** Accepted (2026-09-09). Extends [0047](./0047-screening-scores-evidence-not-keywords.md); the score formula there is superseded by the one here.

## Context

The first real use of employer mode put twenty-two documents of one person
against one posting and got scores within five points — correctly, since
twenty-one of them carried the same vocabulary — and the owner's complaint
was still right: the rubric was a fixed form (skills, years, level,
impact, sector, nice-to-have, education) with weights under "Advanced",
and an HR for whom *industry* or *has led a team* or *can start in two
weeks* decides had nowhere to say so. The owner asked for a field where a
criterion is typed in their own words and goes into the prompt with the
others, for the model to weigh everything in the resume, and for AI to
compare candidates rather than "scripts".

Measured before deciding (docs/screening-criteria-plan.md §8): on one pair,
three identical calls, the model's own 0–100 fit came back 92 / 93 / 92
against a computed 82 / 82 / 82 — as stable, ten points more generous, and
"exceptional" for a resume with five of nine must-haves on a skills line
and a gate unanswered. The number the model produces has no HR weights in
it and no quote behind each point.

## Decision

- **A rubric is an ordered list of criteria** (`screening/rubric.ts`,
  `Rubric.version = 2`). Each has a kind — skill, years, level, industry,
  company type, language, location, work permit, availability, education,
  certification, scale, impact, the overall read, or *in my own words* —
  a mode (**gate**: pass / unknown / fail, never points; **scored**: one
  to five stars; **note**: shown, not counted), a spec the kind needs, and
  a source (the posting's draft, or the person). The editor is one table
  with a text field per row and a text grammar per kind
  (`criterionText` / `parseCriterionText`), a free-text row first, and five
  presets that bend the draft to a shape of hiring.
- **The model answers every criterion in the shape its kind asks**
  (`screening/prompts.ts` v2): a rung on the evidence ladder, a pass /
  partial / unknown / fail, a level, an impact grade, the overall
  five-step read with reasons and concerns — each with a verbatim quote.
  Years, industry years and company type are read off the dated roles in
  code. The criteria are fenced as data with the posting and the resume:
  a line typed by the person is a question to answer, never an order to
  obey (0022).
- **`anchor.ts` checks every answer against the text** per shape: a rung
  above "listed" without a located quote falls to what the text shows
  (and rises to "role" when the matcher finds the term in a work
  sentence); a pass / partial / fail without a quote is unknown; a strong
  impact without a quote is ok; a role the text does not carry is dropped.
- **`score.ts` is the sum**: Σ stars × credit over the scored criteria the
  text could answer, one row per criterion (what was asked, what the text
  answered, the quote, the points); gates bucket; three caps carry what
  stars cannot — no core-stack skill anywhere → 30, two levels under the
  level asked (unless "or below") → 50, duties only → 60. Unknown leaves
  the denominator and lowers the confidence.
- **The overall read is one weighted row**, two stars in the standard
  draft: the model's holistic judgment moves the order exactly as much as
  the person says, printed next to its reasons.
- **Age, gender, family, origin and health cannot be criteria**: a
  free-text row naming one is refused at save with the lawful criterion
  that stands behind the wish (plan §2.4).
- A v1 rubric is converted on read; v1 verdicts read as stale.

## Consequences

✅ "Why is №3 above №7" is a table of criteria the person wrote, each with
its quote and its stars; a criterion in plain words costs thirty tokens
and reads better than any pattern; the same rubric gives the same order a
month later. ❌ More kinds, more grammar: fifteen kinds each need a
sentence in the prompt, a credit rule and a text form, and a new kind
touches all three. The rung credits and the presets are still the plan's
starting values, uncalibrated against a human ranking (0047's caveat
stands).

## When to revisit

A criterion kind the grammar cannot hold that keeps being written as a
custom question; a human-ranked set showing the overall read should weigh
more (or less) than two stars.
