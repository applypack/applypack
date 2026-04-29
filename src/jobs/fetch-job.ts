import { logger } from '../logger';
import { runAllFetchers } from '../fetchers';
import { getActiveProfile } from '../profiles';
import { getSettings } from '../settings';
import { recordCandidatesFromText } from '../discovery';
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
  const settings = await getSettings();
  const { classifierMode } = settings;
  logger.info(
    { profile: profile.name, minFitScore: profile.minFitScore, classifierMode },
    'fetch-job: using active profile',
  );

  const fetched = await runAllFetchers();
  logger.info({ count: fetched.length }, 'fetch-job: total fetched');

  // Phase 7.5 — universal ATS-URL discovery from any fetched job's URL
  // and description. The HN /jobs feed is the primary source: each
  // hit's URL points directly at jobs.ashbyhq.com / boards.greenhouse.io
  // / etc., so extractAtsToken (called inside recordCandidatesFromText)
  // automatically registers a CompanyCandidate row for the underlying
  // employer. Other aggregators (Larajobs, Jobicy, RemoteOK, …) almost
  // never include direct ATS links, so this is a near-noop for them.
  // Idempotent on (atsType, atsToken), so cheap to re-run.
  let candidates = 0;
  if (settings.discoveryEnabled) {
    const sourceTag = `fetch-${new Date().toISOString().slice(0, 7)}`;
    for (const { job, companyName } of fetched) {
      const text = `${job.url}\n${job.description}`;
      const recorded = await recordCandidatesFromText(text, sourceTag, {
        name: null,
        sourceUrl: job.url,
        signal: `Found in ${companyName} feed: ${job.title.slice(0, 80)}`,
      });
      candidates += recorded;
    }
    if (candidates > 0) {
      logger.info({ candidates }, 'fetch-job: discovery harvested candidates');
    }
  }

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
    candidatesRecorded: candidates,
    ...inner,
    durationMs,
  };
  logger.info(stats, 'fetch-job: done');
  return { stats };
}
