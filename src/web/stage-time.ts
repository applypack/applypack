// Pure time-in-stage math for the /applications board cards. The ledger's
// honesty rule applies here too: backfill rows carry no real event day,
// so they never date a stage — such cards fall back to appliedAt.

import { TERMINAL_KEYS } from './stage-config';
import { t } from '../i18n/t';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A non-terminal stage without movement for this long reads as stale. */
const STALE_DAYS = 14;

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
  label = stage,
  /** The label is one ApplyPack names (`stage-config.ts:wordedStage`): its line is a message of its own, never a lowercased label. */
  worded = false,
): StageTimeLine | null {
  const entered = events
    .filter((e) => e.toStage === stage && e.source !== 'backfill')
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())[0];

  const since = entered?.occurredOn ?? appliedAt;
  if (!since) return null;

  const days = Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS));
  const terminal = TERMINAL_KEYS.includes(stage);
  const entryKnown = entered !== undefined || stage === 'applied';

  // The user's own column name is data, lowercased inside the line as it always was.
  const name = label.toLowerCase();
  let text: string;
  if (!entered && stage !== 'applied') {
    text = days === 0 ? t('applications.line.appliedToday') : t('applications.line.appliedAgo', { days });
  } else if (worded) {
    text = days === 0 ? t('applications.line.namedToday', { stage }) : t('applications.line.namedAgo', { stage, days });
  } else if (stage === 'applied' || terminal) {
    text = days === 0 ? t('applications.line.stageToday', { stage: name }) : t('applications.line.stageAgo', { stage: name, days });
  } else {
    text = days === 0 ? t('applications.line.inStageToday', { stage: name }) : t('applications.line.inStage', { stage: name, days });
  }

  // The word, not just a warn colour — colour alone carries no meaning.
  const stale = !terminal && entryKnown && days > STALE_DAYS;
  return { text: stale ? t('applications.line.stalled', { line: text }) : text, stale, since };
}

/**
 * Ledger rows keyed by job, dropping any row whose job is not on the board.
 * The query is scoped the same way (applications.tsx) — grouping here keeps
 * the map honest if it ever isn't, and testable without Prisma. Generic so
 * the caller keeps its own row type; only `jobId` is read.
 */
export function groupEventsByJob<E extends { jobId: number }>(
  events: readonly E[],
  jobIds: readonly number[],
): Map<number, E[]> {
  const onBoard = new Set(jobIds);
  const byJob = new Map<number, E[]>();
  for (const e of events) {
    if (!onBoard.has(e.jobId)) continue;
    const list = byJob.get(e.jobId);
    if (list) list.push(e);
    else byJob.set(e.jobId, [e]);
  }
  return byJob;
}
