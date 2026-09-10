# §19 — Future direction: job-search analytics

**Verdict: adopt stage 1 (P2, small, no AI): the numbers already exist per tick and were shown once, then removed. Stages 2–3 are §20 and §22 and wait for stage 1's real data.**

## What the plan proposes

A funnel — *Jobs discovered 128 · Location rejects 68 · Stack rejects 31 ·
Relevant 16 · Applied 9 · Responses 4 · Interviews 2* — answering "where are
you losing opportunities?".

## What the repo has today

- **Every fetch tick already records the funnel** in `CronRun.stats`
  (`src/jobs/fetch-job.ts:173–215`): `fetched`, `filterRejected`,
  `duplicate`, `preFiltered`, `classified`, `classifyFailed`, `persisted`,
  `dismissed`, `alerted`, `alertHeld`, `crossListed`, `priorityBoosted`, per
  source in `bySource`. Rows are kept 30 days (`cleanup-job.ts:6`). `/runs`
  shows one tick at a time; nothing sums them.
- The measured shape on 2026-09-01 (TASKS §1.4): 5 494 fetched → 5 182
  filter-rejected (94.3 %) → ~310 duplicates → 0–4 classified per tick.
- "Location rejects" is countable after the classifier:
  `JobScore.locationMatch` per (job, search). Before it, the base filter
  returns a boolean (`filter.ts:passesBaseFilter`) — `filterRejected` is one
  number with no reason.
- The application half (Applied → Responses → Interviews) had cards: the F5
  ledger (`JobStageEvent`, ADR 0024) still records every stage change, but
  the funnel cards were **removed on 2026-09-01** (`eddfe40`, −648 lines)
  in the board redesign, and F19 (salary / gap analytics) was closed with
  *"analytics over n≈3 applications is noise"* and a reopen trigger.
- The live database today is a fresh baseline (1 job) after the 2026-09-09
  restore, so no new measurement was possible in this analysis.

## Assessment

The search half of the plan's table is a sum over stored JSON — a pure
function and one card. It answers a question users ask ("is it finding
anything?") that `/runs` answers only one tick at a time, and it is the
prerequisite for deciding §20 and §22 on real numbers instead of examples.
The application half stays behind the F19 trigger: the Overview already
counts statuses, and a funnel over three applications is a lie in a nicer
font.

"Stack rejects" as a reason needs the base filter to say *why* it rejected —
a `filterReason` alongside the boolean. Cheap in `filter.ts` (pure, tested),
but it changes a hot path called 5 000× a tick; do it in stage 1 only if the
first card without it proves too coarse.

## Steps → TASKS §20, block `search-funnel`

- [ ] `src/web/funnel.ts` (pure, tested): sum the tick stats over a window
      (7 / 30 days), plus `locationMismatch` share from `job_score`; returns
      the rows and the ratios.
- [ ] A "Last 7 days" strip on `/runs` (and the same numbers as one line on
      the Overview): fetched → after filter → after dedupe → classified →
      matches → alerted; each row links to the existing chip on `/jobs` where
      one exists.
- [ ] Decide on the `filterReason` breakdown after two weeks of the strip.
