import { AtsType, type Company } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { HttpError, sleep } from '../http';
import { getSettings, pausedFamilies } from '../settings';
import { listActiveProfiles } from '../profiles';
import { isBlankProfile } from '../profile-guards';
import { EMPTY_CONTEXT, searchPlaces, type FetchContext } from './fetch-context';
import {
  QUIET_STREAK,
  advancesLastOk,
  classifyFetchCount,
  classifyFetchError,
  nextStreak,
  type FetchStatus,
} from './source-health';
import { cachedCount } from './conditional';
import { fetchGreenhouse } from './greenhouse';
import { fetchLever } from './lever';
import { fetchAshby } from './ashby';
import { fetchLarajobs } from './larajobs';
import { fetchRemoteOk } from './remoteok';
import { fetchRemotive } from './remotive';
import { fetchArbeitnow } from './arbeitnow';
import { fetchHnHiring } from './hn-hiring';
import { fetchWorkable } from './workable';
import { fetchSmartRecruiters } from './smartrecruiters';
import { fetchWeWorkRemotely } from './weworkremotely';
import { fetchGolangProjects } from './golangprojects';
import { fetchJobicy } from './jobicy';
import { fetchHnJobs } from './hn-jobs';
import { fetchWorkingNomads } from './workingnomads';
import { fetchHimalayas } from './himalayas';
import { fetchRecruitee } from './recruitee';
import { fetchBreezy } from './breezy';
import { fetchBamboo } from './bamboohr';
import { fetchPinpoint } from './pinpoint';
import { fetchRippling } from './rippling';
import { fetchFourDayWeek } from './fourdayweek';
import { fetchDou } from './dou';
import { fetchDjinni } from './djinni';
import { fetchSolidJobs } from './solidjobs';
import { fetchDevItJobs } from './devitjobs';
import { fetchLandingJobs } from './landingjobs';
import { fetchJobTech } from './jobtech';
import { fetchPersonio } from './personio';
import { fetchTeamtailor } from './teamtailor';
import { MAX_ADZUNA_ROWS, adzunaOverflowIds, fetchAdzuna } from './adzuna';
import { fetchFranceTravail } from './francetravail';
import { fetchFeed } from './feed';
import { fetchCareerPage } from './career-page';
import { fetchFolder } from './folder';
import { readSourceConfig } from '../datasets/map';
import { currentFolderRules } from '../datasets/folder-io';
import { loadLedger } from '../jobs/source-file-store';
import { config } from '../config';
import { underLauncher } from '../local/child';
import { getSourceKeys } from '../settings';
import { politeDelayMs, shuffleSources, tickSeed } from './source-order';
import { dueCutoff, nextCheckAfter, watchRules, type WatchRules } from '../watchlist/interval';
import type { NormalizedJob } from '../types';
import { forgetListing, wasListedInFull } from './listing';
import { DELISTED_CODE, delistPlan, RELISTED_CODE } from './delisted';

export interface FetcherResult {
  job: NormalizedJob;
  companyName: string;
  /** Which source the row came from — the alert's attribution line reads it (ADR 0034). */
  source: { atsType: AtsType; atsToken: string };
  /** What the watchlist asks of this row's postings (ADR 0036). */
  watch: WatchRules;
  /** The source's alerts are off (ADR 0062). */
  quiet?: boolean;
}

/** One source answered — live progress for the dashboard's "Fetch now" page. */
export interface SourceProgress {
  company: string;
  status: FetchStatus;
  count: number;
  done: number;
  total: number;
  /** How long this source took, the polite delay not included (docs/onboarding-sources.md §1). */
  durationMs: number;
}

export interface FetchWalkOptions {
  manual?: boolean;
  /**
   * Walk only the sources this keeps. The wizard's test search asks the
   * aggregators alone — they need no company row and answer with hundreds of
   * postings each (docs/onboarding-sources.md, Decision B); the watchlist's
   * Check now asks one company by its id (TASKS S23).
   */
  only?: (company: Pick<Company, 'id' | 'atsType'>) => boolean;
  /**
   * Where this walk hunts, in place of the running searches' places — the
   * wizard's "Where do you work?", asked before a search exists.
   */
  places?: Pick<FetchContext, 'countries' | 'regions'>;
}

export async function runAllFetchers(
  isCancelled?: () => Promise<boolean>,
  onSource?: (progress: SourceProgress) => void,
  opts: FetchWalkOptions = {},
): Promise<FetcherResult[]> {
  const settings = await getSettings();
  const disabled = pausedFamilies(settings);
  if (disabled.length > 0) {
    logger.info({ disabled }, 'fetchers: skipping disabled source families');
  }

  const now = new Date();
  const rosterWhere = {
    active: true,
    ...(disabled.length > 0 ? { atsType: { notIn: disabled } } : {}),
  };
  // The due-ness is a where clause, on the index that exists for it, not a
  // filter over every active row loaded in full (audit 2026-09-10, DATA-6).
  // It compares against `dueCutoff`, not against `now`, for the reason that
  // constant documents: a row stamped one interval after THIS tick started is
  // a hair short of due at the next one, and without the slack an hourly
  // company was read every other hour.
  // A manual run asks every row — see the note below.
  const [companies, roster, adzunaRows] = await Promise.all([
    prisma.company.findMany({
      where: {
        ...rosterWhere,
        ...(opts.manual ? {} : { OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: dueCutoff(now) } }] }),
      },
      orderBy: { id: 'asc' },
    }),
    prisma.company.count({ where: rosterWhere }),
    prisma.company.findMany({
      where: { ...rosterWhere, atsType: AtsType.ADZUNA },
      select: { id: true },
      orderBy: { id: 'asc' },
    }),
  ]);
  // The watchlist's intervals ride on this tick, they do not replace it
  // (ADR 0036): the heartbeat still fires, the interval decides which rows it
  // asks. A row with no `nextCheckAt` is due, so every source behaves exactly
  // as it did before the column existed until the user changes one. A manual
  // run asks regardless: "Fetch now" and the wizard's test search are the
  // user at the screen asking now, and every attempt stamps the next check
  // an interval ahead — so within the hour after a tick the pacing would
  // otherwise answer "0 sources" to the very button that promises the tick.
  const due = companies.filter((c) => opts.only?.(c) ?? true);
  const waiting = roster - companies.length;
  if (waiting > 0) {
    logger.info({ due: due.length, waiting }, 'fetchers: some sources are not due yet');
  }

  // Where the running searches hunt (stage 3a): sources with a geo filter
  // ask for these places instead of the whole world. Blank searches are
  // left out here as they are in process-jobs — they gate on nothing.
  const usable = (await listActiveProfiles()).filter((p) => !isBlankProfile(p));
  const places = opts.places ?? searchPlaces(usable);
  if (places.countries.length > 0 || places.regions.length > 0) {
    logger.info(places, 'fetchers: geo-filtered sources follow the searches');
  }
  // A model is worth asking only when something will score what it reads (process-jobs.ts drops a blank search).
  const scoring = settings.fetchingEnabled && usable.length > 0;
  // The keyed sources' credentials ride in the context (ADR 0034); the
  // context is never logged whole from here on.
  const context: FetchContext = { ...places, keys: await getSourceKeys(), manual: opts.manual === true, now, scoring };
  // Adzuna's monthly limit allows ten rows on the four-a-day cadence; any
  // beyond that are refused, not silently fetched (ADR 0034). The ids come
  // from their own query over the FULL active list, not from this tick's due
  // rows — `adzunaOverflowIds` says why.
  const adzunaOverflow = adzunaOverflowIds(adzunaRows.map((c) => c.id));
  // Every install seeds the same ids, so a fixed order means every install
  // asks the same board in the same second (docs/scale-plan.md §3).
  const walk = shuffleSources(due, tickSeed());

  const out: FetcherResult[] = [];
  let done = 0;

  for (const company of walk) {
    if (isCancelled && (await isCancelled())) {
      logger.warn(
        { done, remaining: due.length - done },
        'fetchers: aborted (fetching paused mid-run)',
      );
      break;
    }
    done++;
    const startedAt = Date.now();
    let status: FetchStatus;
    let count = 0;
    try {
      if (adzunaOverflow.has(company.id)) {
        throw new HttpError(`Adzuna: more than ${MAX_ADZUNA_ROWS} rows would exceed the monthly limit — this one is not fetched`, 429, '');
      }
      forgetListing(company.id);
      const jobs = await fetchOne(company, context);
      count = jobs.length;
      // Status comes from the RAW count, before passesBaseFilter — a profile
      // that matches nothing is not a broken board (ADR 0019).
      status = classifyFetchCount(count);
      // A whole listing that came back `ok` says what the board took down
      // (TASKS S13). Never on `empty`: SmartRecruiters answers every slug with
      // zero rows, and a board that emptied would take every row with it.
      if (status === 'ok' && wasListedInFull(company.id)) await reconcileListing(company, jobs, now);
      logger.info(
        { company: company.name, count, ats: company.atsType, status, ms: Date.now() - startedAt },
        'fetcher: ok',
      );
      const watch = watchRules(company);
      // A folder whose alerts are off keeps its matches on /jobs and sends nothing (ADR 0062).
      const quiet = company.atsType === AtsType.FOLDER && readSourceConfig(company.sourceConfig)?.alerts === 'off';
      for (const job of jobs) {
        out.push({ job, companyName: company.name, source: { atsType: company.atsType, atsToken: company.atsToken }, watch, ...(quiet && { quiet }) });
      }
    } catch (err) {
      status = classifyFetchError(err);
      if (status === 'not_modified') {
        // Not a failure: the board says its feed is what we already read, so
        // there is nothing to fetch and nothing to store (scale-plan §4).
        logger.info(
          { company: company.name, ats: company.atsType },
          'fetcher: unchanged since the last tick',
        );
      } else {
        logger.error(
          { err, company: company.name, ats: company.atsType, status, ms: Date.now() - startedAt },
          'fetcher: failed',
        );
      }
    }
    const durationMs = Date.now() - startedAt;
    await recordFetchHealth(company, status, cachedCount(company.id), now);
    onSource?.({ company: company.name, status, count, done, total: due.length, durationMs });
    // Back off in proportion to what we just spent of the board's: a feed we
    // did not download does not earn the same second as one we did.
    await sleep(politeDelayMs(status, company.atsType, company.crawlDelayMs ?? null));
  }

  return out;
}

/**
 * TASKS S13: rows of this board a whole listing no longer carries are
 * marked delisted, and the ones this rule marked are marked back when they
 * return. Never allowed to break the tick, like the health write below.
 */
async function reconcileListing(company: { id: number; name: string }, jobs: readonly NormalizedJob[], now: Date): Promise<void> {
  try {
    const stored = await prisma.job.findMany({
      where: { companyId: company.id },
      select: { id: true, externalId: true, liveness: true, livenessCode: true },
    });
    const { delisted, relisted } = delistPlan(stored, new Set(jobs.map((j) => j.externalId)));
    if (delisted.length > 0) {
      await prisma.job.updateMany({
        where: { id: { in: delisted } },
        data: { liveness: 'expired', livenessCode: DELISTED_CODE, livenessCheckedAt: now },
      });
    }
    if (relisted.length > 0) {
      await prisma.job.updateMany({
        where: { id: { in: relisted } },
        data: { liveness: 'active', livenessCode: RELISTED_CODE, livenessCheckedAt: now },
      });
    }
    if (delisted.length + relisted.length > 0) {
      logger.info({ company: company.name, delisted: delisted.length, relisted: relisted.length }, 'fetcher: listing compared with the stored rows');
    }
  } catch (err) {
    logger.warn({ err, company: company.name }, 'fetcher: listing not compared with the stored rows');
  }
}

/**
 * Persist one source's health (ADR 0019). Never allowed to break the tick:
 * a health write that fails must not cost us the jobs we just fetched.
 */
async function recordFetchHealth(
  company: { id: number; name: string; consecutiveFailures: number; checkEvery: string },
  status: FetchStatus,
  lastFullCount: number | null,
  /**
   * When the TICK started, not when this source's attempt finished. A walk
   * takes minutes — 35 on the longest measured tick — and counting from the
   * end would push every row past the next heartbeat, one source at a time.
   */
  tickStartedAt: Date,
): Promise<void> {
  const streak = nextStreak(status, company.consecutiveFailures);
  try {
    await prisma.company.update({
      where: { id: company.id },
      data: {
        lastFetchStatus: status,
        consecutiveFailures: streak,
        // Stamped after EVERY attempt, failures included: a board that throws
        // has to wait its interval like a healthy one, or a broken feed is
        // retried every heartbeat while a working one waits an hour.
        nextCheckAt: nextCheckAfter(company, tickStartedAt),
        ...(advancesLastOk(status, lastFullCount) ? { lastOkAt: new Date() } : {}),
      },
    });
  } catch (err) {
    logger.error({ err, company: company.name }, 'fetcher: health write failed');
    return;
  }
  if (streak === QUIET_STREAK) {
    logger.warn(
      { company: company.name, status, streak },
      'fetcher: source crossed the quiet threshold',
    );
  }
}

export async function fetchOne(
  company: {
    id: number;
    name: string;
    atsType: AtsType;
    atsToken: string;
    /** §17 stage C — read by CAREER_PAGE only. */
    lastContentHash?: string | null;
    lastContentAlertAt?: Date | null;
    /** ADR 0062 — read by FOLDER only. */
    sourceConfig?: unknown;
  },
  context: FetchContext = EMPTY_CONTEXT,
): Promise<NormalizedJob[]> {
  switch (company.atsType) {
    case AtsType.GREENHOUSE:
      return fetchGreenhouse({ id: company.id, atsToken: company.atsToken });
    case AtsType.LEVER:
      return fetchLever({ id: company.id, atsToken: company.atsToken });
    case AtsType.ASHBY:
      return fetchAshby({ id: company.id, atsToken: company.atsToken });
    case AtsType.LARAJOBS_RSS:
      return fetchLarajobs(company.id);
    case AtsType.REMOTEOK:
      return fetchRemoteOk(company.id);
    case AtsType.REMOTIVE:
      return fetchRemotive(company.id);
    case AtsType.ARBEITNOW:
      return fetchArbeitnow({ id: company.id, atsToken: company.atsToken });
    case AtsType.HN_HIRING:
      return fetchHnHiring(company.id);
    case AtsType.WORKABLE:
      return fetchWorkable({ id: company.id, atsToken: company.atsToken });
    case AtsType.SMARTRECRUITERS:
      return fetchSmartRecruiters({
        id: company.id,
        atsToken: company.atsToken,
      });
    case AtsType.WEWORKREMOTELY:
      return fetchWeWorkRemotely({
        id: company.id,
        atsToken: company.atsToken,
      });
    case AtsType.GOLANGPROJECTS:
      return fetchGolangProjects(company.id);
    case AtsType.JOBICY:
      return fetchJobicy(company.id, context);
    case AtsType.HN_JOBS:
      return fetchHnJobs(company.id);
    case AtsType.WORKINGNOMADS:
      return fetchWorkingNomads(company.id);
    case AtsType.HIMALAYAS:
      return fetchHimalayas(company.id, context);
    case AtsType.RECRUITEE:
      return fetchRecruitee({ id: company.id, atsToken: company.atsToken });
    case AtsType.BREEZY:
      return fetchBreezy({ id: company.id, atsToken: company.atsToken });
    case AtsType.BAMBOOHR:
      return fetchBamboo({ id: company.id, atsToken: company.atsToken });
    case AtsType.PINPOINT:
      return fetchPinpoint({ id: company.id, atsToken: company.atsToken });
    case AtsType.RIPPLING:
      return fetchRippling({ id: company.id, atsToken: company.atsToken });
    case AtsType.FOURDAYWEEK:
      return fetchFourDayWeek(company.id, context);
    case AtsType.DOU:
      return fetchDou({ id: company.id, atsToken: company.atsToken });
    case AtsType.DJINNI:
      return fetchDjinni({ id: company.id, atsToken: company.atsToken });
    case AtsType.SOLIDJOBS:
      return fetchSolidJobs(company.id);
    case AtsType.DEVITJOBS:
      return fetchDevItJobs({ id: company.id, atsToken: company.atsToken });
    case AtsType.LANDINGJOBS:
      return fetchLandingJobs(company.id);
    case AtsType.JOBTECH:
      return fetchJobTech({ id: company.id, atsToken: company.atsToken });
    case AtsType.PERSONIO:
      return fetchPersonio({ id: company.id, atsToken: company.atsToken });
    case AtsType.TEAMTAILOR:
      return fetchTeamtailor({ id: company.id, atsToken: company.atsToken });
    case AtsType.ADZUNA:
      return fetchAdzuna({ id: company.id, atsToken: company.atsToken }, context);
    case AtsType.FRANCETRAVAIL:
      return fetchFranceTravail({ id: company.id, atsToken: company.atsToken }, context);
    case AtsType.FEED:
      return fetchFeed({ id: company.id, atsToken: company.atsToken });
    case AtsType.CAREER_PAGE:
      // The change watch (ADR 0036). It reports a changed page through
      // `watchlist/page-changes.ts` and returns no jobs, ever.
      return fetchCareerPage({
        id: company.id,
        name: company.name,
        atsToken: company.atsToken,
        lastContentHash: company.lastContentHash ?? null,
        lastContentAlertAt: company.lastContentAlertAt ?? null,
      });
    case AtsType.MANUAL:
      // Pasted by hand on /jobs/new — nothing to fetch (and the row is inactive).
      return [];
    case AtsType.BROWSER_PAGE:
      // A page drawn in the browser (TASKS N8): nothing a fetch can read, and
      // the row is never active. The user pastes the page instead.
      return [];
    case AtsType.IMPORT:
      // Rows the user uploaded on /jobs/import (ADR 0062): stored then, and
      // the row is never active.
      return [];
    case AtsType.FOLDER:
      // A folder a tool writes into, or one the user saves postings into
      // (ADR 0062): read from the disk, no request. What it learns about each
      // file is staged in `folder-ledger.ts` and kept once the tick stored the jobs.
      return fetchFolder(company, await loadLedger(company.id), await currentFolderRules(underLauncher(), config.APPLYPACK_INBOX_ROOTS), {
        now: context.now,
        scoring: context.scoring !== false,
      });
  }
}
