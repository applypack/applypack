import { JobStatus } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { sendDigest, type QuietSourceAlert } from '../notifier';
import { attributionLine } from '../web/pages/attribution';
import { QUIET_STREAK } from '../fetchers/source-health';
import { getSettings, toAtsTypes } from '../settings';
import { lastSuccessfulRunAt, type CronStats } from './cron-run';
import type { AlertJob } from '../types';

/** The reach of the very first recap, before there is a previous one to measure from. */
const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function runDigestJob(): Promise<{ stats: CronStats }> {
  const started = Date.now();
  // The recap covers what arrived since the last recap, not a fixed day. The
  // digest hours are the user's now (TASKS §16) and there may be several: with
  // 09:00 and 19:00 a fixed 24-hour window would make the evening message
  // repeat the morning's in full. A failed run does not move the mark, so
  // nothing is skipped either; `digest-once.js` does move it, which is right —
  // asking for the recap now means the next one starts from here.
  const previous = await lastSuccessfulRunAt('digest');
  const since = previous ?? new Date(Date.now() - DIGEST_WINDOW_MS);
  logger.info({ since: since.toISOString(), firstEver: previous === null }, 'digest-job: start');

  const jobs = await prisma.job.findMany({
    where: {
      status: { in: [JobStatus.NEW, JobStatus.ALERTED] },
      fetchedAt: { gte: since },
      // A held match is delivered on its own a few minutes from now (TASKS
      // §16); listing it here too would show the user the same posting twice.
      alertHeldAt: null,
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
    attribution: attributionLine(j.company.atsType, j.company.atsToken),
    countries: j.countries,
    workplace: j.workplace,
    url: j.url,
    fitScore: j.fitScore ?? 0,
    salaryMin: j.salaryMin,
    salaryCurrency: j.salaryCurrency,
    salaryPeriod: j.salaryPeriod,
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
