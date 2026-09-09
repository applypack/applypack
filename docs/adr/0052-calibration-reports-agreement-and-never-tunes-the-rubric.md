# 0052 — Calibration reports agreement with the person's decisions and never tunes the rubric by itself

**Status:** accepted (2026-09-09) — stage E of docs/screening-criteria-plan.md §9

## Context

The screening score is a sum over criteria the person chose (ADR 0050),
and the person's decisions are the one write the tool never makes
(ADR 0047). Once a screening has been worked, those decisions sit next to
the table's order and ask the obvious question: do the criteria rank the
way this person does? The cheap answer — fit the weights to the decisions
— is the one every ranking product eventually ships.

## Decision

- **Measure, do not tune.** The calibration card reads the decisions
  against the order (concordant pairs, the person's own top k, the
  surprises with the criteria behind them, per-criterion gaps between the
  interviewed and the declined) and stops there. A weight or a criterion
  changes only in the editor, by hand, with the gap on the card as the
  argument.
- **Counts beside every ratio.** "63 % of your pairs (5 of 8)" — never a
  bare percentage, never a grade on the list page. Below three decisions
  with both an interview and a declined among them the card only asks for
  decisions.
- **Adjustments are named, not absorbed.** A pair the person's ±30 turned
  into the table's order is counted apart ("3 of those only after your
  adjustments"): the rubric did not rank the way the person did, and the
  correction carried it.
- **The gold set is a bench, not a feature.** `npm run bench:screen` runs
  a ranked folder through the screening's own path and prints τ,
  precision@5, stability between runs, leaks and gate confusion; it spends
  calls and writes nothing, so it is hand-run.

## Consequences

- A rubric never drifts on its own; what a screening ranks is what the
  person wrote, and the card shows where that disagrees with them.
- Self-tuning would have learned the person's habits along with their
  judgement — a criterion that "works" because the person always prefers
  one kind of employer. Refusing it keeps §2.4 of the plan (what HR wants
  but must not get) enforceable: every criterion stays written and
  visible.
- The signal is small per screening; the per-criterion gaps mean little
  under a handful of decisions and say so by greying. The bench, once a
  recruiter has ranked a set, is where the criteria are judged at scale.
