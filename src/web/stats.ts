// F5 (ADR 0024). Pure funnel / velocity / calibration math over
// JobStageEvent rows. The honesty rules are code, not captions:
// backfill rows never enter day-math, in-flight jobs never enter rates,
// and a rate under MIN_RATE_N is null — a small count is an anecdote.

export const STAGE_ORDER = ['applied', 'screen', 'tech', 'onsite', 'offer'] as const;
export type RankedStage = (typeof STAGE_ORDER)[number];
export const TERMINAL_STAGES = ['rejected', 'ghosted'] as const;
export type TerminalStage = (typeof TERMINAL_STAGES)[number];

export const MIN_RATE_N = 5;
/** Interview = any human process: screen or beyond. */
export const INTERVIEW_RANK = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StageEventRow {
  jobId: number;
  toStage: string | null;
  occurredOn: Date;
  recordedAt: Date;
  source: string; // ui | backfill | correction
}

interface JobHistory {
  maxRank: number; // -1 when no ranked stage reached
  terminal: TerminalStage | null; // from the last event
  /** Latest non-backfill occurredOn per stage name (ranked or terminal). */
  dates: Map<string, Date>;
}

const rankOf = (stage: string | null): number =>
  stage === null ? -1 : STAGE_ORDER.indexOf(stage as RankedStage);

/**
 * Fold one job's events into its history. Events after the last
 * toStage=null win: a cleared stage voids the mis-entered run before it.
 */
export function foldJob(events: StageEventRow[]): JobHistory {
  const sorted = [...events].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
  );
  const lastClear = sorted.reduce(
    (acc, e, i) => (e.toStage === null ? i : acc),
    -1,
  );
  const live = sorted.slice(lastClear + 1);

  let maxRank = -1;
  const dates = new Map<string, Date>();
  for (const e of live) {
    if (e.toStage === null) continue;
    maxRank = Math.max(maxRank, rankOf(e.toStage));
    if (e.source !== 'backfill') dates.set(e.toStage, e.occurredOn);
  }
  const last = live[live.length - 1];
  const terminal =
    last && (TERMINAL_STAGES as readonly string[]).includes(last.toStage ?? '')
      ? (last.toStage as TerminalStage)
      : null;
  return { maxRank, terminal, dates };
}

export function groupByJob(rows: StageEventRow[]): Map<number, JobHistory> {
  const byJob = new Map<number, StageEventRow[]>();
  for (const r of rows) {
    const list = byJob.get(r.jobId);
    if (list) list.push(r);
    else byJob.set(r.jobId, [r]);
  }
  return new Map([...byJob].map(([id, events]) => [id, foldJob(events)]));
}

// ---------------------------------------------------------------- funnel

export interface FunnelRow {
  stage: RankedStage;
  everReached: number;
}

export interface Funnel {
  rows: FunnelRow[];
  rejected: number;
  ghosted: number;
  inFlight: number;
}

/** "Ever reached" is monotone: an offer event implies screen/tech/onsite. */
export function funnel(histories: Iterable<JobHistory>): Funnel {
  const all = [...histories].filter((h) => h.maxRank >= 0 || h.terminal !== null);
  const rows = STAGE_ORDER.map((stage, rank) => ({
    stage,
    everReached: all.filter((h) => h.maxRank >= rank).length,
  }));
  return {
    rows,
    rejected: all.filter((h) => h.terminal === 'rejected').length,
    ghosted: all.filter((h) => h.terminal === 'ghosted').length,
    inFlight: all.filter((h) => h.terminal === null).length,
  };
}

// -------------------------------------------------------------- velocity

export interface HopStats {
  from: string;
  to: string;
  medianDays: number | null;
  n: number;
  sameDay: number; // 0-day hops: excluded from the median, counted here
  censored: number; // reached `from`, still waiting for `to`
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

function hop(histories: JobHistory[], from: string, to: string): HopStats {
  const days: number[] = [];
  let sameDay = 0;
  let censored = 0;
  for (const h of histories) {
    const a = h.dates.get(from);
    const b = h.dates.get(to);
    if (a && b) {
      const d = Math.round((b.getTime() - a.getTime()) / DAY_MS);
      if (d === 0) sameDay++;
      else if (d > 0) days.push(d);
      // d < 0: a backdated correction crossed itself — not a real duration
    } else if (
      // Counting the still-waiting needs no dates, so backfill-only
      // histories censor too — only durations demand real event days.
      rankOf(from) >= 0 &&
      rankOf(to) >= 0 &&
      h.maxRank >= rankOf(from) &&
      h.maxRank < rankOf(to) &&
      h.terminal === null
    ) {
      censored++;
    }
  }
  return { from, to, medianDays: median(days), n: days.length, sameDay, censored };
}

/**
 * Consecutive funnel hops, plus applied→rejected and applied→offer kept
 * apart — a mixed "days to terminal" number reads grim and means nothing.
 */
export function velocity(histories: Iterable<JobHistory>): HopStats[] {
  const all = [...histories];
  const hops: HopStats[] = [];
  for (let i = 0; i < STAGE_ORDER.length - 1; i++) {
    hops.push(hop(all, STAGE_ORDER[i]!, STAGE_ORDER[i + 1]!));
  }
  hops.push(hop(all, 'applied', 'rejected'));
  return hops;
}

// ----------------------------------------------------------- calibration

export const FIT_BANDS = [
  { label: '<60', min: 0, max: 59 },
  { label: '60–74', min: 60, max: 74 },
  { label: '75–84', min: 75, max: 84 },
  { label: '≥85', min: 85, max: 100 },
] as const;

export interface BandStats {
  label: string;
  applied: number;
  /** null when the resolved count is under MIN_RATE_N. */
  interviewRate: number | null;
  interviewResolved: number;
  offerRate: number | null;
  offerResolved: number;
}

export type CalibrationVerdict = 'separating' | 'flat' | 'inverted' | 'insufficient';

export interface Calibration {
  bands: BandStats[];
  verdict: CalibrationVerdict;
  unknownFit: number;
}

/**
 * A job enters a rate only once its outcome is known: it reached the
 * milestone, or it ended (rejected/ghosted) without it. Still-waiting
 * jobs are excluded — counting them either way biases the number.
 */
function rate(histories: JobHistory[], milestoneRank: number): {
  rate: number | null;
  resolved: number;
} {
  const reached = histories.filter((h) => h.maxRank >= milestoneRank);
  const endedWithout = histories.filter(
    (h) => h.maxRank < milestoneRank && h.terminal !== null,
  );
  const resolved = reached.length + endedWithout.length;
  return {
    rate: resolved >= MIN_RATE_N ? reached.length / resolved : null,
    resolved,
  };
}

export function calibration(
  jobs: Array<{ fitScore: number | null; history: JobHistory }>,
): Calibration {
  const inFunnel = jobs.filter(
    (j) => j.history.maxRank >= 0 || j.history.terminal !== null,
  );
  const unknownFit = inFunnel.filter((j) => j.fitScore === null).length;

  const bands: BandStats[] = FIT_BANDS.map((band) => {
    const members = inFunnel
      .filter(
        (j) =>
          j.fitScore !== null && j.fitScore >= band.min && j.fitScore <= band.max,
      )
      .map((j) => j.history);
    const interview = rate(members, INTERVIEW_RANK);
    const offer = rate(members, rankOf('offer'));
    return {
      label: band.label,
      applied: members.length,
      interviewRate: interview.rate,
      interviewResolved: interview.resolved,
      offerRate: offer.rate,
      offerResolved: offer.resolved,
    };
  });

  const known = bands.filter((b) => b.interviewRate !== null);
  let verdict: CalibrationVerdict = 'insufficient';
  if (known.length >= 2) {
    const first = known[0]!.interviewRate!;
    const last = known[known.length - 1]!.interviewRate!;
    if (last - first > 0.1) verdict = 'separating';
    else if (first - last > 0.1) verdict = 'inverted';
    else verdict = 'flat';
  }
  return { bands, verdict, unknownFit };
}
