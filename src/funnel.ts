import { EMPLOYER_GATES, type EmployerGate } from './employer';
import { FILTER_REASONS, type FilterReason } from './filter';
import type { DismissReason } from './jobs/verdict-merge';
import type { MessageKey } from './i18n/catalog';
import { t } from './i18n/t';

/**
 * The search funnel (TASKS §20 `search-funnel`): what the ticks read, what the
 * filter turned away and why, what was new, what the AI scored, what became
 * a match and what reached a chat — summed over days. Pure: the tick's stats
 * go in, rows for a page come out. Zero AI; the numbers are the ones every
 * tick already writes into its run row.
 */

/** The tick counters the funnel keeps; every other stat (durations, flags, the per-source list) stays in the run row. */
export const FUNNEL_KEYS = [
  'fetched',
  'filterRejected',
  'rejectedTitle',
  'rejectedExcluded',
  'rejectedWorkplace',
  'rejectedPlace',
  'rejectedMuted',
  'rejectedApplied',
  'duplicate',
  'preFiltered',
  'classified',
  'classifyFailed',
  'dismissed',
  'dismissedLowFit',
  'dismissedLocation',
  'dismissedSalary',
  'matched',
  'alerted',
  'heldDelivered',
  'alertHeld',
  'alertsOffHeld',
  'alertFailed',
] as const;
export type FunnelKey = (typeof FUNNEL_KEYS)[number];
export type FunnelCounts = Partial<Record<FunnelKey, number>>;

/** The funnel's counters out of one run's stats; anything else, and anything that is not a count, is left out. */
export function funnelCounts(stats: Record<string, unknown>): FunnelCounts {
  const out: FunnelCounts = {};
  for (const key of FUNNEL_KEYS) {
    const value = stats[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value;
  }
  return out;
}

/** What still counts from a run cut short: what it delivered. */
const DELIVERED: readonly FunnelKey[] = ['alerted', 'heldDelivered'];

/**
 * What one finished run adds to its day. A run cut short — paused mid-run, or
 * with every running search blank — read postings it never judged: counting
 * them would put them past the filter and new to you, and the next tick would
 * count them again. Only what it delivered counts. The backfill in
 * `20260928120000_funnel_day` applies the same rule to the stored runs.
 */
export function runCounts(stats: Record<string, unknown>): FunnelCounts {
  const counts = funnelCounts(stats);
  const cutShort = stats.reason === 'paused-mid-run' || stats.abortedMidRun === 1 || stats.skippedBlankProfile === 1;
  if (!cutShort) return counts;
  return Object.fromEntries(DELIVERED.filter((key) => counts[key] !== undefined).map((key) => [key, counts[key]]));
}

/** Two sets of counters as one. */
export function addCounts(a: FunnelCounts, b: FunnelCounts): FunnelCounts {
  const out: FunnelCounts = { ...a };
  for (const key of FUNNEL_KEYS) {
    const sum = (a[key] ?? 0) + (b[key] ?? 0);
    if (sum > 0) out[key] = sum;
  }
  return out;
}

/** A stored day's counters read back: whatever is not a known count is dropped. */
export function readCounts(value: unknown): FunnelCounts {
  return value && typeof value === 'object' ? funnelCounts(value as Record<string, unknown>) : {};
}

export type StageKey = 'read' | 'passed' | 'fresh' | 'scored' | 'matches' | 'alerted';

export interface FunnelStage {
  key: StageKey;
  label: string;
  count: number;
}

/** "4 900 without a title keyword": the count and the words that follow it. */
export interface FunnelReason {
  label: string;
  count: number;
}

export interface FunnelView {
  stages: FunnelStage[];
  /** What the base filter turned away, by gate, largest first; zeros left out. */
  filtered: FunnelReason[];
  /** What every search dismissed after scoring, by the winning reason, largest first. */
  dismissed: FunnelReason[];
}

/** Why the tick turned a posting away before any AI: a filter gate, or who hires (ADR 0056). */
type TurnedAway = FilterReason | EmployerGate;

/** The counter each gate adds to (process-jobs.ts writes it, the funnel reads it). */
export const FILTER_KEY = {
  title: 'rejectedTitle',
  excluded: 'rejectedExcluded',
  workplace: 'rejectedWorkplace',
  place: 'rejectedPlace',
  muted: 'rejectedMuted',
  applied: 'rejectedApplied',
} as const satisfies Record<TurnedAway, FunnelKey>;

/** The counter each dismissal reason adds to, in a tick and in a re-score. */
export const DISMISS_KEY = {
  'low-fit': 'dismissedLowFit',
  'location-mismatch': 'dismissedLocation',
  'low-salary': 'dismissedSalary',
} as const satisfies Record<DismissReason, FunnelKey>;

/** The words a count is followed by, as catalog keys: "4,900 without a title keyword". */
const FILTERED_AS = {
  title: 'funnel.filtered.title',
  excluded: 'funnel.filtered.excluded',
  workplace: 'funnel.filtered.workplace',
  place: 'funnel.filtered.place',
  muted: 'funnel.filtered.muted',
  applied: 'funnel.filtered.applied',
} as const satisfies Record<TurnedAway, MessageKey>;

const DISMISSED_AS = {
  'low-fit': 'funnel.dismissed.lowFit',
  'location-mismatch': 'funnel.dismissed.location',
  'low-salary': 'funnel.dismissed.salary',
} as const satisfies Record<DismissReason, MessageKey>;

/** Largest first, zeros left out. */
function largestFirst(parts: FunnelReason[]): FunnelReason[] {
  return parts.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
}

/** Why the tick turned postings away before any AI, by gate. */
export function filteredReasons(counts: FunnelCounts): FunnelReason[] {
  return largestFirst(
    [...FILTER_REASONS, ...EMPLOYER_GATES].map((reason) => ({ label: t(FILTERED_AS[reason]), count: counts[FILTER_KEY[reason]] ?? 0 })),
  );
}

/** Why every search set a scored posting aside, by the winning search's reason. */
export function dismissedReasons(counts: FunnelCounts): FunnelReason[] {
  return largestFirst(
    (Object.keys(DISMISS_KEY) as DismissReason[]).map((reason) => ({ label: t(DISMISSED_AS[reason]), count: counts[DISMISS_KEY[reason]] ?? 0 })),
  );
}

/** The reasons, then what the total holds beyond them — the days stored before they were counted. */
function withRest(list: FunnelReason[], total: number): FunnelReason[] {
  const rest = total - list.reduce((sum, r) => sum + r.count, 0);
  // The reasons started with the funnel; a day stored before it carries the total only.
  return rest > 0 ? [...list, { label: t('funnel.unrecorded'), count: rest }] : list;
}

/** The stages a reader follows left to right, and the two "why" lists. */
export function funnelView(counts: FunnelCounts): FunnelView {
  const n = (key: FunnelKey) => counts[key] ?? 0;
  const read = n('fetched');
  const passed = Math.max(0, read - n('filterRejected'));
  const fresh = Math.max(0, passed - n('duplicate'));
  return {
    stages: [
      { key: 'read', label: t('funnel.stage.read'), count: read },
      { key: 'passed', label: t('funnel.stage.passed'), count: passed },
      { key: 'fresh', label: t('funnel.stage.fresh'), count: fresh },
      { key: 'scored', label: t('funnel.stage.scored'), count: n('classified') + n('preFiltered') },
      { key: 'matches', label: t('funnel.stage.matches'), count: n('matched') },
      { key: 'alerted', label: t('funnel.stage.alerted'), count: n('alerted') + n('heldDelivered') },
    ],
    filtered: withRest(filteredReasons(counts), n('filterRejected')),
    dismissed: withRest(dismissedReasons(counts), n('dismissed')),
  };
}

/** One stage's count by its key. */
export function stageCount(view: FunnelView, key: StageKey): number {
  return view.stages.find((s) => s.key === key)?.count ?? 0;
}

/** "4,900 without a title keyword, 150 outside your places" — the first `max` reasons. */
export function reasonsText(list: readonly FunnelReason[], max = list.length): string {
  return list
    .slice(0, max)
    .map((r) => t('funnel.reason', { n: r.count, label: r.label }))
    .join(', ');
}

/** The UTC day a run belongs to — the rollup's key. */
export function utcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** Sum the stored days that fall inside the last `days` days, today included. */
export function sumDays(rows: readonly { day: Date; counts: FunnelCounts }[], days: number, now: Date): FunnelCounts {
  const from = utcDay(now).getTime() - (days - 1) * 86_400_000;
  return rows.filter((r) => r.day.getTime() >= from).reduce((acc, r) => addCounts(acc, r.counts), {} as FunnelCounts);
}
