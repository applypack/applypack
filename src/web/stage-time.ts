// Pure time-in-stage math for the /applications board cards. The honesty
// rule from stats.ts applies here too: backfill rows carry no real event
// day, so they never date a stage — such cards fall back to appliedAt.

import { TERMINAL_STAGES } from './stats';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A non-terminal stage without movement for this long reads as stale. */
export const STALE_DAYS = 14;

export interface StageTimeEvent {
  toStage: string | null;
  occurredOn: Date;
  recordedAt: Date;
  source: string; // ui | backfill | correction
}

export interface StageTimeLine {
  text: string;
  stale: boolean;
  /** The day the line counts from — for an absolute-date tooltip. */
  since: Date;
}

/**
 * The card's one time line. Dated by the latest real ledger event into the
 * current stage; without one it falls back to "applied Nd ago" from
 * appliedAt. Stale needs a known stage-entry day (an event, or appliedAt
 * when the stage IS applied) — an apply-date alone can't claim "no
 * movement" for a later stage. Terminal stages are archives, never stale.
 */
export function stageTimeLine(
  stage: string,
  appliedAt: Date | null,
  events: StageTimeEvent[],
  now: Date,
): StageTimeLine | null {
  const entered = events
    .filter((e) => e.toStage === stage && e.source !== 'backfill')
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())[0];

  const since = entered?.occurredOn ?? appliedAt;
  if (!since) return null;

  const days = Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS));
  const terminal = (TERMINAL_STAGES as readonly string[]).includes(stage);
  const entryKnown = entered !== undefined || stage === 'applied';

  let text: string;
  if (!entered && stage !== 'applied') {
    text = days === 0 ? 'applied today' : `applied ${days}d ago`;
  } else if (stage === 'applied' || terminal) {
    text = days === 0 ? `${stage} today` : `${stage} ${days}d ago`;
  } else {
    text = days === 0 ? `in ${stage} today` : `in ${stage} ${days}d`;
  }

  // The word, not just a warn colour — colour alone carries no meaning.
  const stale = !terminal && entryKnown && days > STALE_DAYS;
  return { text: stale ? `${text} · stalled` : text, stale, since };
}
