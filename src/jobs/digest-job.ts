import { JobStatus } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { sendDigest, type QuietSourceAlert } from '../notifier';
import { QUIET_STREAK } from '../fetchers/source-health';
import { getSettings, toAtsTypes } from '../settings';
import type { CronStats } from './cron-run';
import type { AlertJob } from '../types';

const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function runDigestJob(): Promise<{ stats: CronStats }> {
  const started = Date.now();
  const since = new Date(Date.now() - DIGEST_WINDOW_MS);
  logger.info({ since: since.toISOString() }, 'digest-job: start');

  const jobs = await prisma.job.findMany({
    where: {
      status: { in: [JobStatus.NEW, JobStatus.ALERTED] },
      fetchedAt: { gte: since },
    },
    include: {
      company: true,
      // The search that scored each posting best, so a reader running several
      // can tell the hunts apart in one list (ADR 0028).
      scores: {
        include: { profile: { select: { name: true } } },
        orderBy: { fitScore: 'desc' },
        take: 2,
      },
    },
    orderBy: [{ fitScore: 'desc' }, { fetchedAt: 'desc' }],
  });

  const alerts: AlertJob[] = jobs.map((j) => ({
    title: j.title,
    companyName: j.company.name,
    location: j.location,
    countries: j.countries,
    workplace: j.workplace,
    url: j.url,
    fitScore: j.fitScore ?? 0,
    salaryMin: j.salaryMin,
    salaryMax: j.salaryMax,
    techMatch: j.techMatch,
    redFlags: j.redFlags,
    summary: j.summary ?? '',
    // Named only when the posting carries more than one verdict — with a
    // single search the name is noise on every line.
    matchedProfile: j.scores.length > 1 ? (j.scores[0]?.profile.name ?? null) : null,
  }));

  // Broadcast, not routed: the digest spans every search, so it goes to every
  // active target rather than to any one search's chat.
  await sendDigest(alerts, undefined, await quietSources());
  const durationMs = Date.now() - started;
  logger.info({ count: alerts.length, durationMs }, 'digest-job: done');
  return { stats: { count: alerts.length, durationMs } };
}

/**
 * Sources that crossed the failure streak (ADR 0019), behind its toggle.
 * Only actively polled rows qualify — a disabled company, or one in a source
 * family the user switched off, is quiet by instruction.
 */
async function quietSources(): Promise<QuietSourceAlert[]> {
  const settings = await getSettings();
  if (!settings.sourceHealthAlerts) return [];
  const disabled = toAtsTypes(settings.disabledSources);
  const rows = await prisma.company.findMany({
    where: {
      active: true,
      consecutiveFailures: { gte: QUIET_STREAK },
      ...(disabled.length > 0 ? { atsType: { notIn: disabled } } : {}),
    },
    select: { name: true, atsType: true, lastFetchStatus: true, consecutiveFailures: true },
    orderBy: [{ consecutiveFailures: 'desc' }, { name: 'asc' }],
  });
  return rows.map((r) => ({
    name: r.name,
    atsType: r.atsType,
    status: r.lastFetchStatus,
    streak: r.consecutiveFailures,
  }));
}
