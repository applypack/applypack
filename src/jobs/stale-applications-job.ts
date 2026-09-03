import { prisma } from '../db';
import { logger } from '../logger';
import { sendDigest } from '../notifier';
import { getSettings } from '../settings';
import { daysSince } from '../text-utils';
import { appliedWithLabel } from './applied-with';
import {
  formatStaleMessage,
  type StaleApplicationItem,
} from './stale-applications-format';
import type { CronStats } from './cron-run';

const STALE_APPLICATION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export { formatStaleMessage, type StaleApplicationItem } from './stale-applications-format';

/**
 * Daily cron: find APPLIED jobs that have sat in 'applied' stage for more
 * than 14 days with no recruiter contact, and send a Telegram nudge.
 */
export async function runStaleApplicationsJob(): Promise<{ stats: CronStats }> {
  const settings = await getSettings();
  if (!settings.applicationTrackingEnabled) {
    logger.info('stale-applications: skipped (tracking disabled)');
    return { stats: { skipped: 1, reason: 'tracking-disabled' } };
  }
  if (!settings.staleApplicationsDigestEnabled) {
    logger.info('stale-applications: skipped (digest disabled)');
    return { stats: { skipped: 1, reason: 'digest-disabled' } };
  }

  const cutoff = new Date(Date.now() - STALE_APPLICATION_DAYS * DAY_MS);
  const rows = await prisma.job.findMany({
    where: {
      pipelineStage: 'applied',
      appliedAt: { lt: cutoff },
      recruiterContact: null,
    },
    include: {
      company: { select: { name: true } },
      appliedResume: { select: { name: true } },
    },
    orderBy: { appliedAt: 'asc' },
  });

  const items: StaleApplicationItem[] = rows.map((j) => ({
    title: j.title,
    companyName: j.company.name,
    url: j.url,
    appliedAt: j.appliedAt as Date,
    daysSince: daysSince(j.appliedAt as Date),
    recruiterContact: j.recruiterContact,
    appliedWith: appliedWithLabel({
      name: j.appliedResume?.name ?? null,
      version: j.appliedResumeVersion,
    }),
  }));

  if (items.length === 0) {
    logger.info('stale-applications: no stale applications to report');
    return { stats: { found: 0 } };
  }

  // sendDigest of an empty list outputs the "no new matches" placeholder, so
  // we manually package a single message instead of using sendDigest.
  // We piggy-back on the same notifier multi-target broadcast by passing a
  // single AlertJob-shaped record? No — the markdown is custom. Use sendDigest
  // with one synthetic AlertJob whose summary IS the digest body.
  await sendDigest(
    [
      {
        title: `${items.length} stale application${items.length === 1 ? '' : 's'}`,
        companyName: 'Reminder',
        location: '',
        url: items[0]?.url ?? '',
        fitScore: 0,
        salaryMin: null,
        salaryMax: null,
        techMatch: [],
        redFlags: [],
        summary: formatStaleMessage(items),
      },
    ],
  );

  logger.info({ found: items.length }, 'stale-applications: digest sent');
  return { stats: { found: items.length } };
}
