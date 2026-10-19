import { prisma } from '../db';
import { companyForMessage } from '../employer';
import { logger } from '../logger';
import { dashboardAddress, sendStaleReminder } from '../notifier';
import { getSchedule, getSettings } from '../settings';
import { daysSince } from '../text-utils';
import { appliedWithLabel } from './applied-with';
import { formatStaleMessage, type StaleApplicationItem } from './stale-applications-format';

const STALE_APPLICATION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily cron: find APPLIED jobs that have sat in 'applied' stage for more
 * than 14 days with no recruiter contact, and send a reminder of its own.
 */
export async function runStaleApplicationsJob() {
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
      company: { select: { name: true, atsType: true } },
      appliedResume: { select: { name: true } },
    },
    orderBy: { appliedAt: 'asc' },
  });

  const items: StaleApplicationItem[] = rows.map((j) => ({
    jobId: j.id,
    title: j.title,
    companyName: companyForMessage(j.employer, j.company),
    url: j.url,
    appliedAt: j.appliedAt as Date,
    daysSince: daysSince(j.appliedAt as Date),
    appliedWith: appliedWithLabel({
      name: j.appliedResume?.name ?? null,
      version: j.appliedResumeVersion,
    }),
  }));

  if (items.length === 0) {
    logger.info('stale-applications: no stale applications to report');
    return { stats: { found: 0 } };
  }

  const [address, schedule] = await Promise.all([dashboardAddress(), getSchedule()]);
  const delivery = await sendStaleReminder(
    formatStaleMessage(items, STALE_APPLICATION_DAYS, { address, timeZone: schedule.timezone }),
  );

  // A snapshot of a standing state: tomorrow's first digest hour asks again.
  if (delivery.skipped !== null) {
    logger.info({ found: items.length, reason: delivery.skipped }, 'stale-applications: nothing sent');
    return { stats: { skipped: 1, reason: delivery.skipped, found: items.length } };
  }
  logger.info({ found: items.length }, 'stale-applications: reminder sent');
  return { stats: { found: items.length } };
}
