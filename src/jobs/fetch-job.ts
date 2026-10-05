import { logger } from '../logger';
import { prisma } from '../db';
import { runAllFetchers, type FetchWalkOptions, type SourceProgress } from '../fetchers';
import {
  beginConditionalTick,
  commitConditionalCache,
  hydrateConditionalCache,
  needsHydration,
  tickStoredEverything,
  type Entry as ValidatorEntry,
} from '../fetchers/conditional';
import { beginPageChangeTick } from '../watchlist/page-changes';
import { beginFolderTick, takeFolderLooks } from '../fetchers/folder-ledger';
import { keepFolderLooks } from './source-file-store';
import { deliverPageChanges, recordPageChanges } from './page-change-alerts';
import { syncFranceTravail, type MirrorStats } from './france-travail-sync';
import { isFailureStatus } from '../fetchers/source-health';
import { listActiveProfiles } from '../profiles';
import type { Profile } from '@prisma/client';
import { getSchedule, getSettings, getSourceKeys } from '../settings';
import { describeSchedule, isFetchDue, lastRealFetch, RUN_LOOKBACK } from '../user-schedule';
import { deliverHeldAlerts } from './alert-delivery';
import { recordCandidatesFromText } from '../discovery';
import { makeFetchPauseProbe } from './fetch-pause';
import { emptyProcessStats, processNormalizedJobs } from './process-jobs';
import { tryFetchLock } from './fetch-lock';
import { addToFunnel } from './funnel-store';
import type { CronStats, SourceStat } from './cron-run';

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
  /** The wizard's test search: a subset of the sources, a place typed before any search exists. */
  only?: FetchWalkOptions['only'];
  places?: FetchWalkOptions['places'];
}

/**
 * The tick, one at a time: the worker's cron, "Fetch now" and `fetch-once.js`
 * share the lock (`fetch-lock.ts`), and the one that cannot take it records
 * `overlap` and does nothing — no source read, no alert sent, no AI spent.
 */
export async function runFetchJob(opts: FetchJobOptions = {}): Promise<{ stats: CronStats }> {
  const lock = await tryFetchLock();
  if (!lock) {
    logger.warn({ manual: opts.manual === true }, 'fetch-job: another fetch is running; skipped');
    return { stats: { skipped: 1, reason: 'overlap' } };
  }
  const startedAt = new Date();
  try {
    const result = await fetchUnderLock(opts);
    // The funnel is a view of the run, not part of it: a failed write is logged, the run stands.
    await addToFunnel(startedAt, result.stats).catch((err) => logger.warn({ err }, 'fetch-job: funnel day not updated'));
    return result;
  } finally {
    await lock.release();
  }
}

async function fetchUnderLock(opts: FetchJobOptions): Promise<{ stats: CronStats }> {
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

  // Matches held outside the alert window go out on the first heartbeat that
  // allows it — also above the gates, for the same reason: they were found
  // and scored already, and neither a pause nor a quiet hour is a reason for
  // the user never to hear about them (TASKS §16).
  const schedule = await getSchedule();
  const held = await deliverHeldAlerts(new Date(), schedule);
  // Careers-page changes seen earlier and not reported yet, under the same rules.
  const pagesWaiting = await deliverPageChanges(new Date(), schedule);
  const delivery: CronStats = {
    ...(held.delivered > 0 && { heldDelivered: held.delivered, heldMessages: held.messages }),
    ...(pagesWaiting.alerted > 0 && { pagesChanged: pagesWaiting.alerted }),
  };

  if (!settings.fetchingEnabled && !opts.manual) {
    logger.info('fetch-job: skipped (fetching paused in settings)');
    return { stats: { skipped: 1, reason: 'fetching-paused', ...licence, ...delivery } };
  }

  // The cron is a heartbeat; the schedule decides whether this beat searches
  // (TASKS §16). "Fetch now" ignores it exactly as it ignores the pause — the
  // user is at the screen and has just asked.
  if (!opts.manual && !isFetchDue(new Date(), schedule, await lastFetchAt())) {
    logger.info({ schedule: describeSchedule(schedule) }, 'fetch-job: skipped (outside the schedule)');
    return { stats: { skipped: 1, reason: 'outside-schedule', ...licence, ...delivery } };
  }
  const classify = settings.fetchingEnabled;

  const profiles = await listActiveProfiles();
  if (profiles.length === 0) {
    logger.warn(
      'fetch-job: no active search configured; aborting (switch one on at /settings)',
    );
    return { stats: { aborted: 1, reason: 'no-active-profile', ...licence, ...delivery } };
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
  // Every source's answer and its time, on the row — which boards took the
  // minute and which failed is otherwise recorded nowhere.
  const bySource: SourceStat[] = [];
  // Validators learned below are staged, not live, until the jobs they came
  // with are stored (docs/scale-plan.md §4). A process's first tick takes the
  // ones the rows kept, so a restart is not a full read of every source (S31).
  beginConditionalTick();
  if (needsHydration()) {
    const rows = await prisma.company.findMany({ select: { id: true, validator: true } });
    logger.info({ validators: hydrateConditionalCache(rows) }, 'fetch-job: validators taken from the rows');
  }
  // A careers page that changed is staged by its fetcher during the walk and
  // reported after it (TASKS §17 stage C); anything a previous run staged and
  // never delivered is dropped here.
  beginPageChangeTick();
  // What a look at a folder learns about its files is staged the same way (ADR 0062).
  beginFolderTick();
  const fetched = await runAllFetchers(paused, (progress) => {
    sources = progress.done;
    if (isFailureStatus(progress.status)) sourcesFailed++;
    if (progress.status === 'not_modified') sourcesUnchanged++;
    bySource.push({ name: progress.company, status: progress.status, count: progress.count, ms: progress.durationMs });
    opts.onSource?.(progress);
  }, { manual: opts.manual === true, only: opts.only, places: opts.places });
  logger.info(
    { count: fetched.length, sources, sourcesFailed, sourcesUnchanged },
    'fetch-job: total fetched',
  );

  // Written down straight after the walk, and reported at once if the
  // schedule allows: the message carries no posting and costs no AI, so there
  // is nothing to wait for.
  await recordPageChanges();
  const pagesNow = await deliverPageChanges(new Date(), schedule);
  if (pagesNow.alerted > 0) delivery.pagesChanged = pagesWaiting.alerted + pagesNow.alerted;

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
        ...delivery,
        durationMs,
        bySource,
      },
    };
  }

  opts.onProcessing?.();
  const inner = emptyProcessStats();
  await processNormalizedJobs(fetched, profiles, inner, {
    classifierMode,
    classify,
    isCancelled: paused,
    schedule,
  });

  // Only now may this tick's validators be sent, and only if it stored
  // everything it fetched — see tickStoredEverything for why each counter
  // costs us a full re-read next tick instead of a skipped posting.
  if (tickStoredEverything(inner)) {
    await keepValidators(commitConditionalCache());
    // The same rule for a folder's ledger: a file is "read" only once its rows are stored.
    await keepFolderLooks(takeFolderLooks()).catch((err) => logger.warn({ err }, 'fetch-job: folder ledger not kept; the files are read again next tick'));
  }

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
    ...delivery,
    ...inner,
    durationMs,
    bySource,
  };
  logger.info({ ...stats, bySource: bySource.length }, 'fetch-job: done');
  return { stats };
}

/**
 * The last heartbeat that actually asked the boards, for the cadence gate.
 * Read from the run log rather than a new column (TASKS §16.3); the lookback
 * only has to outlast a stretch of skipped ticks, and finding none simply
 * means "nothing recent", which lets the next heartbeat run.
 */
async function lastFetchAt(): Promise<Date | null> {
  const runs = await prisma.cronRun.findMany({
    where: { name: 'fetch' },
    select: { startedAt: true, stats: true },
    orderBy: { startedAt: 'desc' },
    take: RUN_LOOKBACK,
  });
  return lastRealFetch(runs);
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

/**
 * TASKS S31: what a commit promoted goes onto the rows, for the next process
 * and for the other one. Never allowed to break the tick — a row that misses
 * it costs one full read after the next restart, which is where we started.
 */
async function keepValidators(promoted: Map<number, ValidatorEntry>): Promise<void> {
  try {
    for (const [id, entry] of promoted) {
      await prisma.company.updateMany({ where: { id }, data: { validator: { ...entry } } });
    }
  } catch (err) {
    logger.warn({ err }, 'fetch-job: validators not kept on the rows');
  }
}
