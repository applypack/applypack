import { z } from 'zod';

/**
 * When the user wants the search to run and alerts to arrive (TASKS §16).
 * Pure — no clock of its own, no database, no node-cron.
 *
 * Not to be confused with `src/schedule.ts`, which answers a different
 * question: which MINUTE of the hour this particular install ticks at, so
 * that every ApplyPack in the world does not knock on the same free board in
 * the same second (ADR 0035). That one is about politeness to strangers and
 * is not user-facing; this one is the user's own working hours. The two
 * compose: the cron still fires hourly at the install's minute, and the gate
 * here decides whether that tick does anything.
 *
 * The design (TASKS §16.2) is a fixed hourly heartbeat plus a tested pure
 * gate, exactly like the pause flag — never a user-written cron expression
 * and never a worker that re-registers itself when the web process writes a
 * setting.
 */

/** How often the search may run, at most. Whole hours only — see §16.3. */
export const FETCH_EVERY = ['hour', '2h', '4h', 'day'] as const;
export type FetchEvery = (typeof FETCH_EVERY)[number];

/** instant = as today; window = held outside the hours; digest = held until a digest hour. */
export const ALERT_MODES = ['instant', 'window', 'digest'] as const;
export type AlertMode = (typeof ALERT_MODES)[number];

/** ISO weekdays: 1 = Monday … 7 = Sunday, the order the pills are drawn in. */
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const HOUR_MS = 60 * 60 * 1000;
/** Minimum gap per cadence. `hour` has none: every heartbeat qualifies. */
const EVERY_MS: Record<FetchEvery, number> = { hour: 0, '2h': 2 * HOUR_MS, '4h': 4 * HOUR_MS, day: 24 * HOUR_MS };
/**
 * Slack on that gap. Ticks are an hour apart by the clock, but a run starts
 * a moment late and `lastFetchAt` is the previous START — without slack a
 * 2h cadence would measure 1 h 59 min 58 s and skip a whole slot.
 */
const EVERY_TOLERANCE_MS = 5 * 60 * 1000;
/** How far `nextFetchAt` will look ahead: a week and a day covers any weekday set. */
const LOOKAHEAD_TICKS = 24 * 8;
/**
 * How many `fetch` run rows `lastRealFetch` is given. It only has to outlast
 * the longest stretch of skipped ticks — a Fri-evening-to-Mon-morning window
 * is 56, a week of pause is 168 — and reading fewer keeps the stats JSON off
 * every page render. Finding none means "nothing recent", which lets the next
 * heartbeat run.
 */
export const RUN_LOOKBACK = 200;

/** At most four digest times — more than that is a window, not a digest. */
export const MAX_DIGEST_HOURS = 4;

const HourSchema = z.number().int().min(0).max(23);
const DaysSchema = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .max(7)
  .transform((days) => [...new Set(days)].sort((a, b) => a - b));

const TimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isTimezone, { message: 'unknown time zone' });

export const ScheduleSchema = z.object({
  timezone: TimezoneSchema,
  fetch: z.object({ every: z.enum(FETCH_EVERY), from: HourSchema, to: HourSchema, days: DaysSchema }),
  alerts: z.object({
    mode: z.enum(ALERT_MODES),
    from: HourSchema,
    to: HourSchema,
    days: DaysSchema,
    digestAt: z.array(HourSchema).min(1).max(MAX_DIGEST_HOURS).transform((h) => [...new Set(h)].sort((a, b) => a - b)),
  }),
});

export type Schedule = z.infer<typeof ScheduleSchema>;

/**
 * Today's behaviour, written out: search around the clock every hour, alert
 * the moment a match is scored, recap at 09:00 — which is where the digest
 * cron has always run. A fresh install must not notice this feature exists.
 */
export function defaultSchedule(timezone: string): Schedule {
  const tz = isTimezone(timezone) ? timezone : 'UTC';
  return {
    timezone: tz,
    fetch: { every: 'hour', from: 0, to: 23, days: [...ALL_DAYS] },
    alerts: { mode: 'instant', from: 8, to: 22, days: [...ALL_DAYS], digestAt: [9] },
  };
}

/**
 * Reads the stored JSON. Anything unparseable falls back to the defaults
 * whole rather than field by field: a half-understood schedule would stop
 * the search at an hour nobody chose.
 */
export function parseSchedule(raw: unknown, timezone: string): Schedule {
  const parsed = ScheduleSchema.safeParse(raw ?? undefined);
  return parsed.success ? parsed.data : defaultSchedule(timezone);
}

/** Whether the runtime knows this IANA zone. */
export function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export interface ZonedNow {
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** 0–23 in the schedule's own zone, DST included. */
  hour: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** The weekday and hour an instant falls on in `timezone`. */
export function zonedParts(at: Date, timezone: string): ZonedNow {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '0';
  return { weekday: WEEKDAY_INDEX[weekday] ?? 1, hour: Number(hour) };
}

/**
 * Both ends inclusive, and a window that wraps past midnight (22 → 6) is
 * read as one stretch rather than as an empty set.
 */
export function inHours(hour: number, from: number, to: number): boolean {
  return from <= to ? hour >= from && hour <= to : hour >= from || hour <= to;
}

/** Whether this heartbeat should fetch. `lastFetchAt` is the last tick that actually asked the boards. */
export function isFetchDue(now: Date, schedule: Schedule, lastFetchAt: Date | null): boolean {
  const { weekday, hour } = zonedParts(now, schedule.timezone);
  if (!schedule.fetch.days.includes(weekday)) return false;
  if (!inHours(hour, schedule.fetch.from, schedule.fetch.to)) return false;
  const gap = EVERY_MS[schedule.fetch.every];
  if (gap === 0 || lastFetchAt === null) return true;
  return now.getTime() - lastFetchAt.getTime() >= gap - EVERY_TOLERANCE_MS;
}

/** Whether a match found now may be sent now, or has to wait. */
export function canAlertNow(now: Date, schedule: Schedule): boolean {
  const { mode, from, to, days } = schedule.alerts;
  if (mode === 'instant') return true;
  if (mode === 'digest') return false;
  const { weekday, hour } = zonedParts(now, schedule.timezone);
  return days.includes(weekday) && inHours(hour, from, to);
}

/** Whether this hour is one of the digest hours. */
export function isDigestHour(now: Date, schedule: Schedule): boolean {
  return schedule.alerts.digestAt.includes(zonedParts(now, schedule.timezone).hour);
}

/**
 * Whether this is the day's FIRST digest hour — what a once-a-day summary
 * runs on. The stale-application nudge is a snapshot of a standing state, not
 * a window of new things, so four digest times must not mean the same
 * reminder four times. `digestAt` is stored sorted, so the earliest is [0].
 */
export function isFirstDigestHour(now: Date, schedule: Schedule): boolean {
  return schedule.alerts.digestAt[0] === zonedParts(now, schedule.timezone).hour;
}

/**
 * Whether held matches go out on this heartbeat. In `instant` mode anything
 * held is a leftover from an earlier setting, so it leaves at once rather
 * than sitting in a state the user can no longer reach.
 */
export function shouldDeliverHeld(now: Date, schedule: Schedule): boolean {
  if (schedule.alerts.mode === 'instant') return true;
  if (schedule.alerts.mode === 'digest') return isDigestHour(now, schedule);
  return canAlertNow(now, schedule);
}

/**
 * The instant of the next heartbeat that would fetch, or null when the
 * schedule reaches none within a week (only possible if the cadence's gap
 * outruns the window). `minute` is this install's cron minute.
 *
 * The candidates are built at `minute` past each UTC hour. In a deployment
 * whose zone is offset by a half hour the predicted clock time can read 30
 * minutes out; the gate itself only ever compares hours, so it is exact
 * everywhere.
 */
export function nextFetchAt(now: Date, schedule: Schedule, lastFetchAt: Date | null, minute: number): Date | null {
  for (let i = 0; i < LOOKAHEAD_TICKS; i++) {
    const tick = tickAfter(now, minute, i);
    if (isFetchDue(tick, schedule, lastFetchAt)) return tick;
  }
  return null;
}

/** The i-th heartbeat strictly after `now`, at `minute` past the hour. */
export function tickAfter(now: Date, minute: number, i: number): Date {
  const t = new Date(now.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(minute);
  if (t.getTime() <= now.getTime()) t.setUTCHours(t.getUTCHours() + 1);
  t.setUTCHours(t.getUTCHours() + i);
  return t;
}

/**
 * The last heartbeat that actually asked the boards. A tick skipped by the
 * pause, by an empty search list or by this very schedule must not reset a
 * cadence clock — it did no work. `fetched` is the counter only a real run
 * writes, so its presence is the test.
 */
export function lastRealFetch(runs: readonly { startedAt: Date; stats: unknown }[]): Date | null {
  for (const run of runs) {
    const stats = run.stats;
    if (stats && typeof stats === 'object' && typeof (stats as Record<string, unknown>).fetched === 'number') {
      return run.startedAt;
    }
  }
  return null;
}

/** "today at 14:05" / "Mon at 07:05" / "" when there is no next check. */
export function describeNextFetch(next: Date | null, now: Date, timezone: string): string {
  if (next === null) return '';
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(next);
  const dayOf = (at: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  if (dayOf(next) === dayOf(now)) return `today at ${clock}`;
  const tomorrow = new Date(now.getTime() + 24 * HOUR_MS);
  if (dayOf(next) === dayOf(tomorrow)) return `tomorrow at ${clock}`;
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short' }).format(next);
  return `${weekday} at ${clock}`;
}

/** "Every hour, 07:00–23:00, Mon–Fri" — one sentence for the card and the overview. */
export function describeSchedule(schedule: Schedule): string {
  const { every, from, to, days } = schedule.fetch;
  const cadence = every === 'hour' ? 'Every hour' : every === 'day' ? 'Once a day' : `Every ${every.replace('h', ' hours')}`;
  const hours = from === 0 && to === 23 ? 'around the clock' : `${pad(from)}:00–${pad(to)}:59`;
  return `${cadence}, ${hours}, ${describeDays(days)}`;
}

/** "every day" / "Mon–Fri" / "Mon, Wed, Fri" — contiguous runs are named as ranges. */
export function describeDays(days: readonly number[]): string {
  if (days.length === 7) return 'every day';
  if (days.length === 5 && days.every((d) => d <= 5)) return 'Mon–Fri';
  if (days.length === 2 && days[0] === 6 && days[1] === 7) return 'weekends';
  return days.map((d) => DAY_LABELS[d - 1]).join(', ');
}

function pad(hour: number): string {
  return String(hour).padStart(2, '0');
}
