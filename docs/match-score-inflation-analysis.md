# Match-score inflation on stack-mismatched postings — analysis

**Date:** 2026-08-29 · **Status:** analysis only, nothing implemented yet
(pairs with [ADR 0012](./adr/0012-deterministic-match-score.md); formula
changes must go through a bench fixture first).

## The report

A Python posting compared against the PHP resume looked "not bad" (user saw
~84). The posting's stack barely overlaps the resume, so any comfortable
number is a rubric failure. Second report, same session: /target must judge a
pasted/uploaded resume (e.g. a friend's) on its **raw text only** — today the
comparison silently mixes in the owner's stored facts and skills from their
other resumes.

## The numbers (real case: match 39, job 1057 "Senior Full Stack Engineer" @ Imgix)

| Signal | Value |
| --- | --- |
| Stored AI match (resume "Senior Backend PHP" v4) | **67/100** |
| Classifier fit for the same job | 50 |
| Breakdown | keywords 42/60 (45.5/65 weighted), alignment 25/40, penalty **0**, cap 70 (2/3 primary), ceiling 70 |
| Where "84" came from | almost certainly the **live estimate**: `entriesFromLive` credits an `ask_user` term at **1.0** the moment its literal word exists in the text (stored credit is 0). This match has four `must`-level ask_user terms ("documentation", "accessibility", "on-call rotation", "component library") = 12 weighted units of headroom |

## Why 67 happened — five stacked causes

1. **Keyword dilution.** The model extracted 20 `must` terms and only ONE of
   them is Python. Thirteen generic musts (JavaScript, PostgreSQL, REST,
   cloud, code review, testing, CSS, mentor, Claude Code, …) are genuinely in
   the resume → 42/60 keyword points. The posting's Python-ness is worth
   ~6 of 65 weighted units of coverage.
2. **The posting hedges its own stack.** It "welcomes Go/Node developers
   willing to ramp", so the model set primary = {Python, React, TypeScript} —
   and React + TypeScript really are in the resume text (verified by ILIKE).
   2/3 primary → cap 70 instead of 45/30. The summary honestly opens
   "Primary stack 2/3 (Python missing)".
3. **The penalty self-cancels.** The single red flag ("Python is absent") is
   exactly the missing-primary flag that scoring v3 exempts ("the cap already
   punishes the stack"). But the cap (70) does not bind (raw 67 < 70), so the
   missing headline language costs **zero points**. v3 fixed over-punishment
   (the 65-point treadmill); this is the opposite edge — under-punishment on
   hedged postings.
4. **Alignment 25/40** (title partial · summary strong · recent_role partial)
   — an "adjacent" ecosystem grades generously by the letter of the criteria.
5. **A model slip caught red-handed.** Keyword "Senior Full Stack Engineer"
   was marked `present` while the exact phrase does NOT exist in the resume
   (`ILIKE` = false) — the model's own note admits the header says
   "Senior Software Engineer". +3 weighted units for nothing, despite the
   VERBATIM prompt rule.

## The context-leak mechanisms (confirmed in code, inactive in THIS match)

In match 39 both channels were empty (no CandidateFact rows touched it, every
`elsewhere` field is empty) — but the mechanisms are global and unconditional
in [`src/resume/match.ts`](../src/resume/match.ts):

- `listFacts()` — ALL of the owner's confirmed/denied facts are injected into
  **every** comparison, and `applyFacts` makes stored facts always win.
- `listOtherResumeSkills(resume.id)` — skills from every other visible resume
  are injected, and MATCH_SYSTEM step 3 allows marking a keyword `add`
  (half credit) because "a skill named in OTHER RESUMES of this candidate"
  evidences it.

So a friend's resume pasted into /target inherits the owner's confirmed
facts and gets `add` credit for the owner's skills. Wrong for that use case
by construction.

## Proposed fixes (not implemented — in priority order)

1. **Raw mode for /target scratch resumes.** When the compared resume is the
   hidden scratch row (`resume.hidden`), pass an empty `MatchContext` (no
   confirmed facts, no denied terms, no other-resume skills) and skip the
   `applyFacts` / `annotateElsewhere` post-passes. One flag through
   `matchResumeToJob`. Optionally a small "raw comparison — no stored facts
   used" chip on such matches.
2. **Drop `add`-via-other-resume from scoring** (prompt v5). Half credit for
   text that is not in THIS resume contradicts the ATS-honesty story. Keep
   the informational `in "<resume>"` badge — it is a hint, not a score.
3. **Deterministic `present` verification.** After the model reply, search
   the resume text for every `present` term (term + aliases — the matcher
   logic already exists in `target.mjs` / needs a TS twin) and downgrade
   unfound ones to `add`. Kills the whole class of cause #5 with a pure,
   testable pass and no extra AI.
4. **Bench fixture "hedged-stack posting", then careful formula tuning.**
   Candidate ideas, to be decided only against fixtures (ADR 0012 revisit):
   don't exempt the missing-primary flag from the penalty when the cap does
   not bind; or a harsher cap tier when the missing primary is the role's
   headline language.
5. **Open question — live credit for typed `ask_user` terms.** Full credit on
   textual presence is the documented source of the 84-vs-67 gap; 0.5 until
   confirmed would keep the live number closer to honest.

Items 1–3 are independent of the formula and safe to ship first; 4 changes
scoring semantics and needs the fixture; 5 is a product decision.
