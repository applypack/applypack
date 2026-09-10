# §21 — Future direction: application feedback

**Verdict: drop for now — already decided with a measurement, and the trigger is written down.**

## What the plan proposes

After enough applications, correlations: high-match applications get more
responses; some resume versions perform better; some sources yield
interviews; some roles always reject. Never presented as causal.

## What the repo has today

- The data model is complete: `Job.appliedResumeId` / `appliedResumeVersion`
  (which resume went out, v1.11.0), `JobStageEvent` (every stage change with
  the day, ADR 0024), `JobScore.fitScore` per search, the source on the
  company row.
- The analysis was done and closed twice: F5's funnel cards were removed
  (`eddfe40`) and F19 closed on 2026-09-01 with *"the F5 funnel records 0
  interviews ever reached … analytics over n≈3 applications is noise"*; the
  reopen trigger in TASKS §7 is *"the funnel showing real volume"*.

## Assessment

The plan does not know this was tried. Nothing has changed in the inputs: the
live instance today has one job. Building correlation views over single-digit
n produces exactly the causal reading the plan warns against, dressed as a
chart.

## Steps

None. Keep the F19 trigger. If §19's strip ever shows ≥ 30 applications in
a quarter, this becomes a stage of `search-funnel`, reading the ledger that
is already there.
