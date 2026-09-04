import { logger } from '../logger';
import { runAllFetchers, type SourceProgress } from '../fetchers';
import { beginConditionalTick, commitConditionalCache, tickStoredEverything } from '../fetchers/conditional';
import { syncFranceTravail, type MirrorStats } from './france-travail-sync';
import { isFailureStatus } from '../fetchers/source-health';
import { listActiveProfiles } from '../profiles';
import type { Profile } from '@prisma/client';
import { getSettings, getSourceKeys } from '../settings';
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

  // France Travail's licence asks the board again about every stored offer
  // at least daily (ADR 0034 rule 5), and that duty is not a search: it
  // fetches nothing new, spends no AI and adds no row — it re-reads what is
  // already stored and removes what the board withdrew. So it runs above
  // every gate below. A pause, a missing search, a schedule that says "not
  // now" must not be able to put this install in breach.
  const mirrored = await syncFranceTravail({ countries: [], regions: [], keys: await getSourceKeys(), now: new Date() });
  const licence = mirrorStats(mirrored);

  if (!settings.fetchingEnabled && !opts.manual) {
    logger.info('fetch-job: skipped (fetching paused in settings)');
    return { stats: { skipped: 1, reason: 'fetching-paused', ...licence } };
  }
  const classify = settings.fetchingEnabled;

  const profiles = await listActiveProfiles();
  if (profiles.length === 0) {
    logger.warn(
      'fetch-job: no active search configured; aborting (switch one on at /settings)',
    );
    return { stats: { aborted: 1, reason: 'no-active-profile', ...licence } };
  }
  const { classifierMode } = settings;
  logger.info(
    {
      searches: profiles.map((p) => `${p.name} (>=${p.minFitScore})`),
      classifierMode,
      classify,
    },
    'fetch-job: using active searches',
  );

  // Pausing on /settings must also stop a tick that is already running —
  // every long phase below polls this probe and aborts within seconds. A
  // manual run that started paused has nothing to abort on.
  const paused = classify ? makeFetchPauseProbe() : undefined;

  let sources = 0;
  let sourcesFailed = 0;
  let sourcesUnchanged = 0;
  // Validators learned below are staged, not live, until the jobs they came
  // with are stored (docs/scale-plan.md §4).
  beginConditionalTick();
  const fetched = await runAllFetchers(paused, (progress) => {
    sources = progress.done;
    if (isFailureStatus(progress.status)) sourcesFailed++;
    if (progress.status === 'not_modified') sourcesUnchanged++;
    opts.onSource?.(progress);
  }, { manual: opts.manual === true });
  logger.info(
    { count: fetched.length, sources, sourcesFailed, sourcesUnchanged },
    'fetch-job: total fetched',
  );

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
        profile: searchNames(profiles),
        aborted: 1,
        reason: 'paused-mid-run',
        fetched: fetched.length,
        sources,
        sourcesFailed,
        ...(sourcesUnchanged > 0 && { sourcesUnchanged }),
        candidatesRecorded: candidates,
        ...licence,
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
  await processNormalizedJobs(fetched, profiles, inner, {
    classifierMode,
    classify,
    isCancelled: paused,
  });

  // Only now may this tick's validators be sent, and only if it stored
  // everything it fetched — see tickStoredEverything for why each counter
  // costs us a full re-read next tick instead of a skipped posting.
  if (tickStoredEverything(inner)) commitConditionalCache();

  const durationMs = Date.now() - started;
  const stats: CronStats = {
    profile: searchNames(profiles),
    classifierMode,
    ...(!classify && { classify: false }),
    fetched: fetched.length,
    sources,
    sourcesFailed,
    ...(sourcesUnchanged > 0 && { sourcesUnchanged }),
    candidatesRecorded: candidates,
    ...licence,
    ...inner,
    durationMs,
  };
  logger.info(stats, 'fetch-job: done');
  return { stats };
}

/**
 * The mirror's counters for the run row — omitted when it had nothing to do,
 * so a quiet tick stays readable. `ftExpired` is the one to watch: it counts
 * offers withdrawn because nobody could ask the board about them in time.
 */
function mirrorStats(m: MirrorStats): CronStats {
  return {
    ...(m.checked > 0 && { ftChecked: m.checked }),
    ...(m.deleted > 0 && { ftDeleted: m.deleted }),
    ...(m.anonymised > 0 && { ftAnonymised: m.anonymised }),
    ...(m.expired > 0 && { ftExpired: m.expired }),
  };
}

/** One `profile` line for the run row, whatever the number of searches. */
function searchNames(profiles: Profile[]): string {
  return profiles.map((p) => p.name).join(' · ');
}
