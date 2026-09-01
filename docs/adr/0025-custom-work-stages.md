# 0025 — Work columns are user-defined; the funnel keeps fixed entry and exits

**Status:** Accepted (2026-09-01)

## Context
The board froze its stage vocabulary (TASKS §10.1) because the funnel /
velocity / calibration cards ranked stages by a hardcoded order. After a
day of real use the owner asked for the opposite: add / remove / reorder
columns, and called the three stat cards noise — at n=3 applications
every velocity row is `— n=0` and every calibration cell `— (0/5)`,
numbers years away from significance. The two requests resolve each
other: with the rank-math cards gone, nothing but the UI consumes stage
order. The worker never did — it touches only `pipelineStage='applied'`
(stale digest, status→APPLIED hook) and `null` (cleanup).

## Decision
- `AppSettings.pipelineStages` (JSONB) stores the ordered **work
  columns** `[{key, label}]`; `null` means the built-in
  screen/tech/onsite/offer. Pure ops in `src/web/stage-config.ts`.
- **`applied` stays the fixed first column** (appliedAt semantics, stale
  digest, status hook) and **`rejected`/`ghosted` stay the fixed Closed
  panel** (terminal fold). Everything between is add / rename / reorder /
  remove — remove only when no job sits in the column, enforced
  server-side, and `applied`/`rejected`/`ghosted` are reserved keys.
- Keys are slugs, immutable after creation; rename changes the label
  only, so `JobStageEvent` history stays readable. The ledger (ADR 0024)
  keeps recording every move exactly as before.
- The funnel / velocity / calibration cards and their math
  (`stats.ts`, `funnel-stats.tsx`) are **removed**, not hidden — dead
  code otherwise. Resurrect from git (tag v1.3.0) if the ledger ever
  holds enough rows to make the rates meaningful.

## Consequences
✅ the board is the owner's board; the analytics freeze no longer vetoes UX
✅ history survives any column edit — events are strings, keys never change
❌ no funnel rates until someone rebuilds them against configurable ranks
❌ a job must be moved out of a column before that column can be deleted

## When to revisit
The ledger reaches ~50 applications with real (non-backfill) dates —
rebuild "does fit predict interviews?" on top of per-config ranks then.
