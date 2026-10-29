// F5 (ADR 0024). Pure builders for JobStageEvent rows; the two routes that
// write pipelineStage put these in the same $transaction as the Job update.
// The ledger stores days, not instants (occurredOn is a DATE column): the day
// in the display zone, as the board and the export read it (#680).

import { dayMarker } from '../zoned-day';

export type StageEventSource = 'ui' | 'backfill' | 'correction';

export interface StageEventData {
  jobId: number;
  fromStage: string | null;
  toStage: string | null;
  occurredOn: Date;
  source: StageEventSource;
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
  timeZone: string,
): StageEventData | null {
  if (fromStage === toStage) return null;
  return {
    jobId,
    fromStage,
    toStage,
    occurredOn: dayMarker(toStage === 'applied' && appliedAt ? appliedAt : now, timeZone),
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
  timeZone: string,
): StageEventData | null {
  if (stage === null || newAppliedAt === null) return null;
  if (oldAppliedAt && dayMarker(oldAppliedAt, timeZone).getTime() === dayMarker(newAppliedAt, timeZone).getTime()) {
    return null;
  }
  return {
    jobId,
    fromStage: null,
    toStage: 'applied',
    occurredOn: dayMarker(newAppliedAt, timeZone),
    source: 'correction',
  };
}
