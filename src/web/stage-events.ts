// F5 (ADR 0024). Pure builders for JobStageEvent rows; the two routes that
// write pipelineStage put these in the same $transaction as the Job update.

export type StageEventSource = 'ui' | 'backfill' | 'correction';

export interface StageEventData {
  jobId: number;
  fromStage: string | null;
  toStage: string | null;
  occurredOn: Date;
  source: StageEventSource;
}

/** The ledger stores days, not instants (occurredOn is a DATE column). */
export function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * The event for an actual stage change, or null when nothing changed —
 * a tracking-card resubmit that only edits notes must not append history.
 * Clearing the stage is recorded as toStage=null, source=correction.
 * For a move into 'applied' the event day is the (backdatable) appliedAt.
 */
export function stageChangeEvent(
  jobId: number,
  fromStage: string | null,
  toStage: string | null,
  appliedAt: Date | null,
  now: Date,
): StageEventData | null {
  if (fromStage === toStage) return null;
  return {
    jobId,
    fromStage,
    toStage,
    occurredOn: dateOnly(toStage === 'applied' && appliedAt ? appliedAt : now),
    source: toStage === null ? 'correction' : 'ui',
  };
}

/**
 * The correction row for an appliedAt edit while the stage stays put:
 * the apply-day changed, so day-math needs a fresh 'applied' date. Null
 * when there is nothing to correct (stage empty, date unset or equal).
 */
export function appliedDateCorrection(
  jobId: number,
  stage: string | null,
  oldAppliedAt: Date | null,
  newAppliedAt: Date | null,
): StageEventData | null {
  if (stage === null || newAppliedAt === null) return null;
  if (oldAppliedAt && dateOnly(oldAppliedAt).getTime() === dateOnly(newAppliedAt).getTime()) {
    return null;
  }
  return {
    jobId,
    fromStage: null,
    toStage: 'applied',
    occurredOn: dateOnly(newAppliedAt),
    source: 'correction',
  };
}
