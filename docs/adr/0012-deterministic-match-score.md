# 0012 — The resume-match score is computed by application code, not by the model

**Status:** Accepted (2026-08-28)

## Context

The match score was a field in the model's JSON reply, constrained by a
rubric in the prompt. Two paid-for bugs (CLAUDE.md gotchas 8 and 11) showed
that a model asked to do its own arithmetic averages its way to flattering
numbers unless every rule carries an explicit hard cap — and even then the
number is untestable, drifts between runs, and the live editor's keyword
score used a different scale than the AI score, confusing the one user this
tool has. The resume-ATS blueprint (docs/resume-ats-blueprint.md) reaches
the same conclusion: LLMs judge evidence; deterministic code owns the score.

ADR 0010's split (instant browser score, expensive AI call on demand) stays
in force — this ADR changes what each side computes, not the split.

## Decision

One AI call per comparison, unchanged. The reply carries **facts only**:
per-keyword `status` (`present | add | ask_user | cannot_claim`),
`requirement` (`must | preferred | nice | context`), `primary` flags,
three `alignment` grades, `hard_requirements` gates and red flags — no
`match_score`. `src/resume/score.ts` composes the number:

| Component | Points |
| --- | --- |
| Keyword coverage (weight must 3 / preferred 2 / nice 1 / context 0; credit present 1 / add 0.5 / else 0) | 60 |
| Alignment: title 10 + summary 10 + recent role 20 (strong 1 / partial 0.5 / off 0) | 40 |
| Each red flag beyond the missing-primary count (v3: bounded at −20 total; soft concerns live in unscored `cautions`) | −10 |
| Primary-stack cap (all → none, ≥half → 70, some → 45, none → 30); only must-requirement items count as primary (v3) | applied last |

Scoring v3 (same day) exists because the v2 penalty built a treadmill: a
97.9-point resume sat at 68 behind three rotating style "red flags", and the
keyword set drifted between runs. v3 bounds the penalty, never counts flags
that restate missing primaries, demotes non-must "primary" marks, feeds the
previous run's keyword frame back into the prompt for term stability, and
stores a `ceiling` — the honest maximum this resume can reach on this
posting — so the UI can say what editing can and cannot achieve.

`src/web/public/score.mjs` is a line-for-line mirror for the live editor
(credit from textual presence; `cannot_claim` never counts even when
typed), parity-tested in `src/web/score.test.ts`. The breakdown is stored
on `ResumeMatch.breakdown` with a version. User answers to `ask_user`
keywords persist as `CandidateFact` rows; a confirmation flips the keyword
and recomputes the stored score with zero AI calls.

## Consequences

✅ Same facts → same number, unit-tested (score.test.ts, gotcha-11 fixture);
"why not 100" is displayable from the stored breakdown; version deltas are
computed, not narrated; fact confirmations are instant.
❌ Two copies of the formula (TS + browser mjs) held together by a parity
test; pre-0012 rows keep their model-era scores and render without a
breakdown.

## When to revisit

If the formula needs semantic inputs code can't provide (e.g. per-evidence
strength grading), or if the browser copy diverges twice despite the parity
test — then generate one artifact from a single source instead.
