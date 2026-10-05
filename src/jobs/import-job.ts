import { logger } from '../logger';
import { listActiveProfiles } from '../profiles';
import { getSchedule, getSettings } from '../settings';
import type { NormalizedJob } from '../types';
import type { CronStats } from './cron-run';
import { tryFetchLock } from './fetch-lock';
import { makeFetchPauseProbe } from './fetch-pause';
import { addToFunnel } from './funnel-store';
import { emptyProcessStats, processNormalizedJobs } from './process-jobs';

/**
 * Rows the user imported (ADR 0062), through the pipeline every fetched
 * posting takes — `processNormalizedJobs`: filter, mute, dedupe, classify,
 * persist, alert. It shares the fetch lock with the tick and "Fetch now",
 * because it shares their classifier: two at once would pay for the same
 * posting twice. While fetching is paused the rows are stored unscored, as
 * "Fetch now" stores them. No request is made: the rows are already here.
 */
export async function runImportJob(source: { name: string }, jobs: NormalizedJob[]): Promise<{ stats: CronStats }> {
  const lock = await tryFetchLock();
  if (!lock) {
    logger.warn({ source: source.name }, 'import-job: a fetch is running; nothing imported');
    return { stats: { skipped: 1, reason: 'overlap', source: source.name } };
  }
  const startedAt = new Date();
  try {
    const settings = await getSettings();
    const profiles = await listActiveProfiles();
    if (profiles.length === 0) {
      logger.warn({ source: source.name }, 'import-job: no active search; nothing imported');
      return { stats: { aborted: 1, reason: 'no-active-profile', source: source.name } };
    }
    const classify = settings.fetchingEnabled;
    const inner = emptyProcessStats();
    await processNormalizedJobs(
      jobs.map((job) => ({ job, companyName: source.name })),
      profiles,
      inner,
      {
        classifierMode: settings.classifierMode,
        classify,
        // A pause on /settings stops an import that is scoring, as it stops a tick.
        isCancelled: classify ? makeFetchPauseProbe() : undefined,
        schedule: await getSchedule(),
      },
    );
    const stats: CronStats = {
      source: source.name,
      profile: profiles.map((p) => p.name).join(' · '),
      classifierMode: settings.classifierMode,
      ...(!classify && { classify: false }),
      fetched: jobs.length,
      ...inner,
      durationMs: Date.now() - startedAt.getTime(),
    };
    logger.info(stats, 'import-job: done');
    // The funnel is a view of the run, not part of it: a failed write is logged, the run stands.
    await addToFunnel(startedAt, stats).catch((err) => logger.warn({ err }, 'import-job: funnel day not updated'));
    return { stats };
  } finally {
    await lock.release();
  }
}
