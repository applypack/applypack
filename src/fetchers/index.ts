import { AtsType } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { HttpError, sleep } from '../http';
import { getSettings, toAtsTypes } from '../settings';
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
import { MAX_ADZUNA_ROWS, fetchAdzuna } from './adzuna';
import { fetchFranceTravail } from './francetravail';
import { getSourceKeys } from '../settings';
import { politeDelayMs, shuffleSources, tickSeed } from './source-order';
import type { NormalizedJob } from '../types';

export interface FetcherResult {
  job: NormalizedJob;
  companyName: string;
  /** Which source the row came from — the alert's attribution line reads it (ADR 0034). */
  source: { atsType: AtsType; atsToken: string };
}

/** One source answered — live progress for the dashboard's "Fetch now" page. */
export interface SourceProgress {
  company: string;
  status: FetchStatus;
  count: number;
  done: number;
  total: number;
}

export async function runAllFetchers(
  isCancelled?: () => Promise<boolean>,
  onSource?: (progress: SourceProgress) => void,
  opts: { manual?: boolean } = {},
): Promise<FetcherResult[]> {
  const settings = await getSettings();
  const disabled = toAtsTypes(settings.disabledSources);
  if (disabled.length > 0) {
    logger.info({ disabled }, 'fetchers: skipping disabled source families');
  }

  const companies = await prisma.company.findMany({
    where: {
      active: true,
      ...(disabled.length > 0 ? { atsType: { notIn: disabled } } : {}),
    },
    orderBy: { id: 'asc' },
  });

  // Where the running searches hunt (stage 3a): sources with a geo filter
  // ask for these places instead of the whole world. Blank searches are
  // left out here as they are in process-jobs — they gate on nothing.
  const places = searchPlaces((await listActiveProfiles()).filter((p) => !isBlankProfile(p)));
  if (places.countries.length > 0 || places.regions.length > 0) {
    logger.info(places, 'fetchers: geo-filtered sources follow the searches');
  }
  // The keyed sources' credentials ride in the context (ADR 0034); the
  // context is never logged whole from here on.
  const context: FetchContext = { ...places, keys: await getSourceKeys(), manual: opts.manual === true, now: new Date() };
  // Adzuna's monthly limit allows ten rows on the four-a-day cadence; any
  // beyond that are refused, not silently fetched (ADR 0034). Decided from
  // the id order, BEFORE the shuffle: which markets are live has to be the
  // same answer every tick, or the user cannot tell which ten they get.
  const adzunaOverflow = new Set(
    companies.filter((c) => c.atsType === AtsType.ADZUNA).slice(MAX_ADZUNA_ROWS).map((c) => c.id),
  );
  // Every install seeds the same ids, so a fixed order means every install
  // asks the same board in the same second (docs/scale-plan.md §3).
  const walk = shuffleSources(companies, tickSeed());

  const out: FetcherResult[] = [];
  let done = 0;

  for (const company of walk) {
    if (isCancelled && (await isCancelled())) {
      logger.warn(
        { done, remaining: companies.length - done },
        'fetchers: aborted (fetching paused mid-run)',
      );
      break;
    }
    done++;
    let status: FetchStatus;
    let count = 0;
    try {
      if (adzunaOverflow.has(company.id)) {
        throw new HttpError(`Adzuna: more than ${MAX_ADZUNA_ROWS} rows would exceed the monthly limit — this one is not fetched`, 429, '');
      }
      const jobs = await fetchOne(company, context);
      count = jobs.length;
      // Status comes from the RAW count, before passesBaseFilter — a profile
      // that matches nothing is not a broken board (ADR 0019).
      status = classifyFetchCount(count);
      logger.info(
        { company: company.name, count, ats: company.atsType, status },
        'fetcher: ok',
      );
      for (const job of jobs) {
        out.push({ job, companyName: company.name, source: { atsType: company.atsType, atsToken: company.atsToken } });
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
          { err, company: company.name, ats: company.atsType, status },
          'fetcher: failed',
        );
      }
    }
    await recordFetchHealth(company, status, cachedCount(company.id));
    onSource?.({ company: company.name, status, count, done, total: companies.length });
    // Back off in proportion to what we just spent of the board's: a feed we
    // did not download does not earn the same second as one we did.
    await sleep(politeDelayMs(status, company.atsType));
  }

  return out;
}

/**
 * Persist one source's health (ADR 0019). Never allowed to break the tick:
 * a health write that fails must not cost us the jobs we just fetched.
 */
async function recordFetchHealth(
  company: { id: number; name: string; consecutiveFailures: number },
  status: FetchStatus,
  lastFullCount: number | null,
): Promise<void> {
  const streak = nextStreak(status, company.consecutiveFailures);
  try {
    await prisma.company.update({
      where: { id: company.id },
      data: {
        lastFetchStatus: status,
        consecutiveFailures: streak,
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
  company: { id: number; atsType: AtsType; atsToken: string },
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
    case AtsType.MANUAL:
      // Pasted by hand on /jobs/new — nothing to fetch (and the row is inactive).
      return [];
  }
}
