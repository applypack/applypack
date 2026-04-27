import { logger } from '../logger';
import { runAllFetchers } from '../fetchers';
import { getActiveProfile } from '../profiles';
import { getSettings } from '../settings';
import { processNormalizedJobs, type ProcessStats } from './process-jobs';
import type { CronStats } from './cron-run';

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
  const { classifierMode } = await getSettings();
  logger.info(
    { profile: profile.name, minFitScore: profile.minFitScore, classifierMode },
    'fetch-job: using active profile',
  );

  const fetched = await runAllFetchers();
  logger.info({ count: fetched.length }, 'fetch-job: total fetched');

  const inner: ProcessStats = {
    filterRejected: 0,
    duplicate: 0,
    preFiltered: 0,
    classified: 0,
    classifyFailed: 0,
    persisted: 0,
    dismissed: 0,
    alerted: 0,
    alertFailed: 0,
    priorityBoosted: 0,
  };
  await processNormalizedJobs(fetched, profile, classifierMode, inner);

  const durationMs = Date.now() - started;
  const stats: CronStats = {
    profile: profile.name,
    classifierMode,
    fetched: fetched.length,
    ...inner,
    durationMs,
  };
  logger.info(stats, 'fetch-job: done');
  return { stats };
}
