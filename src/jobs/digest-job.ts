import { JobStatus } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { sendDigest } from '../notifier';
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
    include: { company: true },
    orderBy: [{ fitScore: 'desc' }, { fetchedAt: 'desc' }],
  });

  const alerts: AlertJob[] = jobs.map((j) => ({
    title: j.title,
    companyName: j.company.name,
    location: j.location,
    url: j.url,
    fitScore: j.fitScore ?? 0,
    salaryMin: j.salaryMin,
    salaryMax: j.salaryMax,
    techMatch: j.techMatch,
    redFlags: j.redFlags,
    summary: j.summary ?? '',
  }));

  await sendDigest(alerts);
  const durationMs = Date.now() - started;
  logger.info({ count: alerts.length, durationMs }, 'digest-job: done');
  return { stats: { count: alerts.length, durationMs } };
}
