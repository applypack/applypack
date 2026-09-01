import { logger } from '../logger';
import { runAllFetchers, type SourceProgress } from '../fetchers';
import { isFailureStatus } from '../fetchers/source-health';
import { getActiveProfile } from '../profiles';
import { getSettings } from '../settings';
import { recordCandidatesFromText } from '../discovery';
import { makeFetchPauseProbe } from './fetch-pause';
import { processNormalizedJobs, type ProcessStats } from './process-jobs';
import type { CronStats } from './cron-run';

export interface FetchJobOptions {
  /**
   * "Fetch now" from the dashboard. The cron tick skips while fetching is
   * paused; a manual run fetches anyway but then stores jobs unscored —
   * paused means no AI spend (issue #50), so classification follows the flag.
   */
  manual?: boolean;
  /** Live progress for the dashboard's run page. */
  onSource?: (progress: SourceProgress) => void;
  onProcessing?: () => void;
}

export async function runFetchJob(opts: FetchJobOptions = {}): Promise<{ stats: CronStats }> {
  const started = Date.now();
  logger.info({ manual: opts.manual === true }, 'fetch-job: start');

  const settings = await getSettings();
  if (!settings.fetchingEnabled && !opts.manual) {
    logger.info('fetch-job: skipped (fetching paused in settings)');
    return { stats: { skipped: 1, reason: 'fetching-paused' } };
  }
  const classify = settings.fetchingEnabled;

  const profile = await getActiveProfile();
  if (!profile) {
    logger.warn(
      'fetch-job: no active profile configured; aborting (configure one at /settings)',
    );
    return { stats: { aborted: 1, reason: 'no-active-profile' } };
  }
  const { classifierMode } = settings;
  logger.info(
    { profile: profile.name, minFitScore: profile.minFitScore, classifierMode, classify },
    'fetch-job: using active profile',
  );

  // Pausing on /settings must also stop a tick that is already running —
  // every long phase below polls this probe and aborts within seconds. A
  // manual run that started paused has nothing to abort on.
  const paused = classify ? makeFetchPauseProbe() : undefined;

  let sources = 0;
  let sourcesFailed = 0;
  const fetched = await runAllFetchers(paused, (progress) => {
    sources = progress.done;
    if (isFailureStatus(progress.status)) sourcesFailed++;
    opts.onSource?.(progress);
  });
  logger.info({ count: fetched.length, sources, sourcesFailed }, 'fetch-job: total fetched');

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
      if (paused && (await paused())) break;
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

  if (paused && (await paused())) {
    const durationMs = Date.now() - started;
    logger.warn(
      { fetched: fetched.length, durationMs },
      'fetch-job: aborted before classify (fetching paused mid-run)',
    );
    return {
      stats: {
        profile: profile.name,
        aborted: 1,
        reason: 'paused-mid-run',
        fetched: fetched.length,
        sources,
        sourcesFailed,
        candidatesRecorded: candidates,
        durationMs,
      },
    };
  }

  opts.onProcessing?.();
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
    crossListed: 0,
    abortedMidRun: 0,
    skippedByPause: 0,
    skippedBlankProfile: 0,
  };
  await processNormalizedJobs(fetched, profile, inner, {
    classifierMode,
    classify,
    isCancelled: paused,
  });

  const durationMs = Date.now() - started;
  const stats: CronStats = {
    profile: profile.name,
    classifierMode,
    ...(!classify && { classify: false }),
    fetched: fetched.length,
    sources,
    sourcesFailed,
    candidatesRecorded: candidates,
    ...inner,
    durationMs,
  };
  logger.info(stats, 'fetch-job: done');
  return { stats };
}
