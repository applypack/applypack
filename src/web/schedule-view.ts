import { prisma } from '../db';
import { config } from '../config';
import { cronMinute } from '../schedule';
import { getInstanceId } from '../settings';
import { alertChannel } from '../notifier';
import { countHeldAlerts } from '../jobs/alert-delivery';
import { heldReason } from '../jobs/held-alerts';
import { heldLine, type HeldLine } from './held-line';
import {
  describeNextFetch,
  isFetchDue,
  lastRealFetch,
  nextFetchAt,
  parseSchedule,
  RUN_LOOKBACK,
  type Schedule,
} from '../user-schedule';

/**
 * What the Overview pill and the Schedule card both need to say (TASKS §16),
 * resolved once so the two pages cannot drift: the parsed schedule, whether
 * this hour would search, and the next heartbeat that will — named in the
 * user's own zone, at this install's own cron minute.
 */
export interface NextCheck {
  schedule: Schedule;
  /** True when a heartbeat right now would search. */
  dueNow: boolean;
  /** "today at 14:05" — empty when the schedule reaches no heartbeat within a week. */
  next: string;
}

/** The waiting line both pages show, or null when nothing is held. */
export async function loadHeldLine(schedule: Schedule): Promise<HeldLine | null> {
  const count = await countHeldAlerts();
  if (count === 0) return null;
  return heldLine(count, heldReason(await alertChannel(), schedule.alerts.mode));
}

export async function loadNextCheck(rawSchedule: unknown, now = new Date()): Promise<NextCheck> {
  const schedule = parseSchedule(rawSchedule, config.TZ);
  const runs = await prisma.cronRun.findMany({
    where: { name: 'fetch' },
    select: { startedAt: true, stats: true },
    orderBy: { startedAt: 'desc' },
    take: RUN_LOOKBACK,
  });
  const lastFetch = lastRealFetch(runs);
  const minute = cronMinute(await getInstanceId(), 'fetch');
  return {
    schedule,
    dueNow: isFetchDue(now, schedule, lastFetch),
    next: describeNextFetch(nextFetchAt(now, schedule, lastFetch, minute), now, schedule.timezone),
  };
}
