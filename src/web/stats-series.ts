/*
 * Day series for the Overview's statistics (pure). Counts are bucketed into
 * UTC days — the key `funnel_day` is stored under, so a chart off the rollup
 * and a chart off the jobs agree on where a day ends. A day nothing happened
 * on is a zero, never a gap; a rate is shown only when the number under it is
 * large enough to mean something.
 */
import { formatDateRange, formatDateTime, formatNumber } from '../i18n/format';

const DAY_MS = 86_400_000;

/** The UTC day a moment falls on, as whole days since the epoch. */
export function dayNumber(at: Date): number {
  return Math.floor(at.getTime() / DAY_MS);
}

/** Midnight UTC of a day number. */
export function dayStart(day: number): Date {
  return new Date(day * DAY_MS);
}

/** How many of the moments fall on each UTC day. */
export function countByDay(moments: readonly (Date | null | undefined)[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const at of moments) {
    if (!at) continue;
    const day = dayNumber(at);
    out.set(day, (out.get(day) ?? 0) + 1);
  }
  return out;
}

/** `days` consecutive UTC days ending today, oldest first, each with its count. */
export function dailySeries(counts: ReadonlyMap<number, number>, days: number, now: Date): number[] {
  const today = dayNumber(now);
  return Array.from({ length: days }, (_, i) => counts.get(today - (days - 1 - i)) ?? 0);
}

/** The ranges the chart offers. A long range reads in wider steps, thirty points at most. */
export const RANGES = {
  '7d': { days: 7, step: 1 },
  '30d': { days: 30, step: 1 },
  '90d': { days: 90, step: 3 },
  '180d': { days: 180, step: 6 },
} as const;
export type RangeKey = keyof typeof RANGES;
export const RANGE_KEYS = Object.keys(RANGES) as RangeKey[];
export const DEFAULT_RANGE: RangeKey = '30d';

export function isRangeKey(value: unknown): value is RangeKey {
  return typeof value === 'string' && Object.hasOwn(RANGES, value);
}

export interface SeriesPoint {
  /** First and last UTC day of the point; the same day when the step is one. */
  from: Date;
  to: Date;
  value: number;
}

/**
 * A range as the points a chart draws: the last `days` days in steps of
 * `step`, the last point ending today. `days` is a multiple of `step` for
 * every range above, so no point is a partial one.
 */
export function rangePoints(counts: ReadonlyMap<number, number>, range: RangeKey, now: Date): SeriesPoint[] {
  const { days, step } = RANGES[range];
  const today = dayNumber(now);
  const first = today - (days - 1);
  const points: SeriesPoint[] = [];
  for (let start = first; start <= today; start += step) {
    let value = 0;
    for (let d = start; d < start + step; d++) value += counts.get(d) ?? 0;
    points.push({ from: dayStart(start), to: dayStart(start + step - 1), value });
  }
  return points;
}

/** The sum over a range, and over the equal range just before it. */
export function rangeTotals(counts: ReadonlyMap<number, number>, range: RangeKey, now: Date): { current: number; previous: number } {
  const { days } = RANGES[range];
  const today = dayNumber(now);
  let current = 0;
  let previous = 0;
  for (let d = today - (days - 1); d <= today; d++) current += counts.get(d) ?? 0;
  for (let d = today - (2 * days - 1); d <= today - days; d++) previous += counts.get(d) ?? 0;
  return { current, previous };
}

/** Under this, a percentage is noise: "+300 %" of one job says nothing, "+3" does. */
const PERCENT_FLOOR = 10;

export interface Trend {
  /** current − previous. */
  delta: number;
  /** Whole percent against the previous period, or null when that period is under the floor. */
  percent: number | null;
  direction: 'up' | 'down' | 'flat';
}

export function trend(current: number, previous: number): Trend {
  const delta = current - previous;
  return {
    delta,
    percent: previous >= PERCENT_FLOOR ? Math.round((delta / previous) * 100) : null,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
  };
}

/** "+12%" when the previous period carries a rate, "+3" when it does not, "0" when nothing moved. */
export function trendText(trend: Trend): string {
  if (trend.direction === 'flat') return '0';
  const sign = trend.delta > 0 ? '+' : '−';
  return trend.percent === null ? `${sign}${formatNumber(Math.abs(trend.delta))}` : `${sign}${Math.abs(trend.percent)}%`;
}

/**
 * Axis ticks from zero to a round ceiling at or above `maxValue`, whole
 * numbers only, in at most `maxSteps` steps. An empty series still gets an
 * axis (0 … 4), so a chart with nothing on it is a flat line, not a blank.
 */
export function niceTicks(maxValue: number, maxSteps = 4): number[] {
  const top = Math.max(maxValue, maxSteps);
  const rough = top / maxSteps;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => Number.isInteger(s) && s >= rough) ?? Math.ceil(rough);
  const steps = Math.ceil(top / step);
  return Array.from({ length: steps + 1 }, (_, i) => i * step);
}

const DAY = { month: 'short', day: 'numeric', timeZone: 'UTC' } as const;

/** "Sep 18" — a UTC day as an axis writes it. */
export function dayLabel(day: Date): string {
  return formatDateTime(day, DAY);
}

/** "Sep 18" for a day, "Sep 16 – 18" for a few, "Sep 29 – Oct 1" across a month's end. */
export function pointLabel(point: SeriesPoint): string {
  if (point.from.getTime() === point.to.getTime()) return dayLabel(point.to);
  return formatDateRange(point.from, point.to, DAY);
}

/** Which of `count` points carry an axis label: `max` of them at most, evenly spread, the first and the last always. */
export function labelIndexes(count: number, max = 7): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  return [...new Set(Array.from({ length: max }, (_, j) => Math.round((j * (count - 1)) / (max - 1))))];
}
