/**
 * The watchlist's own pacing (TASKS §17, ADR 0036). Pure — no I/O, no Prisma.
 *
 * Two things live here and nothing else: how often the user wants a company
 * checked, and what they want to hear when it puts up a posting.
 *
 * The interval rides ON the hourly heartbeat, it does not replace it. There
 * is no second cron and no cron expression (ADR 0003, and the same choice
 * §16 made for the search schedule): the tick asks which rows are due and
 * walks those. That bounds every interval from below by the heartbeat and by
 * the user's own schedule — a company set to "every hour" is checked at most
 * once an hour, and not at all during hours the user told the search to
 * sleep. One tick, one intent.
 */

/** The presets, shortest first. The stored value is one of these strings. */
export const CHECK_INTERVALS = ['hour', 'day', 'week'] as const;
export type CheckInterval = (typeof CHECK_INTERVALS)[number];

/** How the user asks to be told about a company's postings. */
export const ALERT_POLICIES = ['matches', 'all'] as const;
export type AlertPolicy = (typeof ALERT_POLICIES)[number];

const HOUR_MS = 60 * 60 * 1000;

const INTERVAL_MS: Readonly<Record<CheckInterval, number>> = {
  hour: HOUR_MS,
  day: 24 * HOUR_MS,
  week: 7 * 24 * HOUR_MS,
};

const INTERVAL_LABEL: Readonly<Record<CheckInterval, string>> = {
  hour: 'Every hour',
  day: 'Once a day',
  week: 'Once a week',
};

/**
 * A stored string → a preset. Anything unrecognised reads as `hour`, which is
 * what every source did before the column existed: an unknown value must not
 * be able to silence a company.
 */
export function toCheckInterval(value: string | null | undefined): CheckInterval {
  return (CHECK_INTERVALS as readonly string[]).includes(value ?? '')
    ? (value as CheckInterval)
    : 'hour';
}

/** Same rule for the policy: anything unrecognised is the normal pipeline. */
export function toAlertPolicy(value: string | null | undefined): AlertPolicy {
  return (ALERT_POLICIES as readonly string[]).includes(value ?? '')
    ? (value as AlertPolicy)
    : 'matches';
}

export function intervalLabel(value: string | null | undefined): string {
  return INTERVAL_LABEL[toCheckInterval(value)];
}

/** The columns every decision here is made from. */
export interface Pacing {
  checkEvery: string;
  nextCheckAt: Date | null;
}

/**
 * Whether this row is due. NULL is due — that is what a fresh row, a row
 * added before this feature and a "Check now" all mean.
 */
export function isDue(row: Pacing, now: Date): boolean {
  return row.nextCheckAt === null || row.nextCheckAt.getTime() <= now.getTime();
}

/**
 * When to ask again, counted from the attempt rather than from the row's
 * previous due time. Counting from `nextCheckAt` would let a company that
 * fell behind — the install was off, the schedule was asleep — come due
 * several times in a row to "catch up", which is a burst against a board
 * for no information.
 */
export function nextCheckAfter(row: Pick<Pacing, 'checkEvery'>, now: Date): Date {
  return new Date(now.getTime() + INTERVAL_MS[toCheckInterval(row.checkEvery)]);
}

/** What the row asks of the pipeline. */
export interface WatchRules {
  /** ★ before the company name, on the list and in the alert. */
  watched: boolean;
  /**
   * `all`: keep and alert every posting this company puts up, whatever the
   * base filter and the fit threshold say. The posting is still classified,
   * so it carries a score — the policy decides what is done with it, not
   * whether it is understood.
   */
  alertPolicy: AlertPolicy;
}

export const NOT_WATCHED: WatchRules = { watched: false, alertPolicy: 'matches' };

export function watchRules(row: { watched: boolean; alertPolicy: string }): WatchRules {
  return { watched: row.watched, alertPolicy: toAlertPolicy(row.alertPolicy) };
}

/** True when this row's postings bypass the filter and the threshold. */
export function alertsEveryPosting(rules: WatchRules | undefined): boolean {
  return rules?.alertPolicy === 'all';
}

/** The ★ prefix a watched company's alert carries, or the name unchanged. */
export function starred(companyName: string, rules: WatchRules | undefined): string {
  return rules?.watched ? `★ ${companyName}` : companyName;
}
