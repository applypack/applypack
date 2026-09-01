# 0024 — Funnel history is an append-only stage ledger, written only where stages are written

**Status:** Accepted (2026-08-31)

## Context

F5 (feature-expansion-plan §6) wants funnel/velocity/calibration stats,
which need transitions, not snapshots. Re-analysis against the code and
the live DB (834 jobs) corrected the plan on four points:

- The plan's "single write path" is really **two**: `POST
  /jobs/:id/application` (any stage, including clearing to null, with a
  backdatable `appliedAt`) and the `pipelineStage='applied'` seeding
  inside `POST /jobs/:id/status`. Both are web routes. The worker writes
  only inbox `status` (NEW/ALERTED/DISMISSED in bulk — 762 of 834 rows
  are DISMISSED machine states), never `pipelineStage`, and
  reclassify explicitly excludes APPLIED. So the ledger records
  **pipelineStage transitions**; inbox churn stays out (that telemetry
  is F15's).
- The plan's name `JobStatusEvent` collides with the orthogonal
  `JobStatus` inbox enum — renamed **`JobStageEvent`**.
- Backfill is tiny and clean: exactly 3 funnel rows, all at `applied`,
  all with user-entered `appliedAt` (2026-04-29/30). Fit scores 32, 92,
  15 — the user applies across the whole score range, so the plan's
  bands (<60/60–74/75–84/≥85) need no retuning (live inbox: 12/15/13/29
  per band).
- With 3 applications, every rate sits under the n=5 floor: the honesty
  rules ("— (n=3, need 5)", null not 0) are the **entire initial
  screen**, not an edge case — the cards ship with explicit empty-state
  copy.
- `cleanup-job` deletes DISMISSED jobs after 30 days; a job with a
  funnel history can be DISMISSED later, which would cascade-delete its
  ledger. Currently 0 such rows, but the hole is real.

## Decision

- `JobStageEvent(id, jobId FK cascade, fromStage?, toStage?, occurredOn
  DATE, recordedAt, source)` — append-only, no update route. `source`:
  `ui | backfill | correction` (strings, like `pipelineStage` itself;
  F17 adds `reply`). `toStage=null` records a stage cleared from the
  tracking card (`source=correction`).
- Events are written **in the same `$transaction` as the stage update**,
  at both write sites, via one helper (`src/web/stage-events.ts`). A
  form resubmit that does not change the stage writes nothing; editing
  `appliedAt` with an existing `applied` event writes a
  `correction` event carrying the new date.
- `occurredOn`: the form's `appliedAt` day for `applied`, else the
  write day. Day-math uses the latest non-backfill event per (job,
  stage); `source=backfill` rows never enter day-math.
- The migration is hand-written (gotcha 7) and backfills one
  `source=backfill` event per job with a `pipelineStage`, dated
  `appliedAt` when present.
- `cleanup-job` gains `pipelineStage: null` in its delete filter — an
  application's history is never garbage-collected.
- Analytics are pure functions in `src/web/stats.ts` (fixture-tested):
  monotone funnel fold (an `offer` event implies screen/tech/onsite were
  reached), per-hop medians with right-censoring counts and same-day
  hops excluded-but-counted, applied→rejected tracked apart from
  applied→offer, in-flight rows out of every rate, n<5 renders null.
  Cards live on `/applications`. Channel yield (n≥8 floor) deferred:
  today's channels are Greenhouse×2 + Jobicy×1.

## Consequences

✅ "Rejected after three interviews" and "rejected instantly" become
different histories; time-in-stage and calibration are computable from
day one; future features (F6 cadence, F17 replies) append to the same
table.
❌ Two write sites to keep honest (guarded by one shared helper); pre-F5
stage history is unrecoverable beyond the 3 backfilled rows; stats stay
mostly "need 5" until real volume exists.

## When to revisit

If a third stage write site appears (F17 replies, bulk actions), or if
correction events grow beyond date fixes — then consider moving stage
writes behind a single service function instead of a route-level helper.
