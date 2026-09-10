# §12 — Preserve high-value explanations

**Verdict: adopt as the guard-rail for §11; no work of its own.**

## What the plan proposes

Keep every explanation that prevents a wrong decision: why a score is capped,
why a keyword does not count, why "unknown", why a claim was blocked, why a
job is suspicious, what an AI call will do, employer legal notices, privacy,
destructive actions, error recovery.

## What the repo has today

Each of those has a home already, written in code so the words cannot drift
from the rule:

| Explanation | Where |
| --- | --- |
| Why the score is capped | `src/web/score-lines.ts` (the five lines under the score), `ScoreBreakdownChips` |
| Why a keyword does not count | `keyword-shape.ts`, `keyword-anchor.ts`, the "skills line only" evidence badge |
| Why "unknown" | `hardRequirements` status + note; the screening scorecard's per-criterion quote |
| Why a claim was blocked | `replacement-gate.ts` writes the reason onto the card's `why` line |
| Why a job is suspicious | the verification card's evidence URLs |
| What an AI call will do | violet buttons (DESIGN.md), the wizard's hints, the run pages' lane bands |
| Employer legal / notice | `/settings` → Screening, `src/screening/notice.ts` |
| Destructive actions | `src/web/delete-confirm.ts` names the blast radius (audit 2026-09 fixed the last gap) |

## Steps

None beyond the rule in [11-ui-copy.md](./11-ui-copy.md): those sentences are
on the must-stay list of every copy PR.
