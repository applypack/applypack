import { JobStatus, type Prisma, type Profile } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { runAllFetchers } from '../fetchers';
import { passesBaseFilter } from '../filter';
import { classifyWithClaude } from '../classifier';
import { sendTelegramAlert } from '../notifier';
import { getActiveProfile } from '../profiles';
import type { CronStats } from './cron-run';
import type { ClaudeClassification, NormalizedJob } from '../types';

export async function runFetchJob(): Promise<{ stats: CronStats }> {
  const started = Date.now();
  logger.info('fetch-job: start');

  const profile = await getActiveProfile();
  if (!profile) {
    logger.warn(
      'fetch-job: no active profile configured; aborting (configure one at /settings)',
    );
    return { stats: { aborted: 1, reason: 'no-active-profile' } };
  }
  logger.info(
    { profile: profile.name, minFitScore: profile.minFitScore },
    'fetch-job: using active profile',
  );

  const fetched = await runAllFetchers();
  logger.info({ count: fetched.length }, 'fetch-job: total fetched');

  const stats = {
    profile: profile.name,
    fetched: fetched.length,
    filterRejected: 0,
    duplicate: 0,
    classified: 0,
    classifyFailed: 0,
    persisted: 0,
    dismissed: 0,
    alerted: 0,
    alertFailed: 0,
  };

  for (const { job, companyName } of fetched) {
    if (!passesBaseFilter(job, profile)) {
      stats.filterRejected++;
      continue;
    }

    const existing = await prisma.job.findUnique({
      where: {
        companyId_externalId: {
          companyId: job.companyId,
          externalId: job.externalId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      stats.duplicate++;
      continue;
    }

    const classification = await classifyWithClaude(
      {
        title: job.title,
        companyName,
        location: job.location,
        description: job.description,
        postedAt: job.postedAt,
      },
      profile,
    );
    if (!classification) {
      stats.classifyFailed++;
      continue;
    }
    stats.classified++;

    const dismissReason = decideDismissReason(classification, profile);
    if (dismissReason) {
      await prisma.job.create({
        data: buildJobData(job, classification, JobStatus.DISMISSED),
      });
      stats.persisted++;
      stats.dismissed++;
      logger.debug(
        {
          title: job.title,
          companyName,
          fitScore: classification.fit_score,
          reason: dismissReason,
        },
        'fetch-job: dismissed',
      );
      continue;
    }

    const created = await prisma.job.create({
      data: buildJobData(job, classification, JobStatus.NEW),
    });
    stats.persisted++;

    try {
      await sendTelegramAlert(
        {
          title: created.title,
          companyName,
          location: created.location,
          url: created.url,
          fitScore: created.fitScore ?? classification.fit_score,
          salaryMin: created.salaryMin,
          salaryMax: created.salaryMax,
          techMatch: created.techMatch,
          redFlags: created.redFlags,
          summary: created.summary ?? '',
        },
        profile,
      );
      await prisma.job.update({
        where: { id: created.id },
        data: { status: JobStatus.ALERTED, alertedAt: new Date() },
      });
      stats.alerted++;
    } catch (err) {
      stats.alertFailed++;
      logger.error(
        { err, jobId: created.id, title: created.title },
        'fetch-job: alert failed',
      );
    }
  }

  const durationMs = Date.now() - started;
  logger.info({ ...stats, durationMs }, 'fetch-job: done');
  return { stats: { ...stats, durationMs } };
}

function decideDismissReason(
  c: ClaudeClassification,
  profile: Profile,
): 'low-fit' | 'location-mismatch' | 'low-salary' | null {
  if (c.fit_score < profile.minFitScore) return 'low-fit';
  if (!c.location_match) return 'location-mismatch';
  if (
    profile.minSalaryUsd > 0 &&
    c.salary_min_usd !== null &&
    c.salary_min_usd > 0 &&
    c.salary_min_usd < profile.minSalaryUsd
  ) {
    return 'low-salary';
  }
  return null;
}

function buildJobData(
  job: NormalizedJob,
  c: ClaudeClassification,
  status: JobStatus,
): Prisma.JobCreateInput {
  return {
    company: { connect: { id: job.companyId } },
    externalId: job.externalId,
    title: job.title,
    url: job.url,
    location: job.location,
    description: job.description,
    postedAt: job.postedAt,
    fitScore: c.fit_score,
    salaryMin: c.salary_min_usd,
    salaryMax: c.salary_max_usd,
    techMatch: c.tech_match,
    redFlags: c.red_flags,
    summary: c.summary,
    status,
  };
}
