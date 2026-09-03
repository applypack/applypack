import { AtsType } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { sleep } from '../http';
import { getSettings, toAtsTypes } from '../settings';
import { listActiveProfiles } from '../profiles';
import { isBlankProfile } from '../profile-guards';
import { EMPTY_CONTEXT, searchPlaces, type FetchContext } from './fetch-context';
import {
  QUIET_STREAK,
  classifyFetchCount,
  classifyFetchError,
  nextStreak,
  type FetchStatus,
} from './source-health';
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
import type { NormalizedJob } from '../types';

const POLITE_DELAY_MS = 1_000;

export interface FetcherResult {
  job: NormalizedJob;
  companyName: string;
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
  const context = searchPlaces((await listActiveProfiles()).filter((p) => !isBlankProfile(p)));
  if (context.countries.length > 0 || context.regions.length > 0) {
    logger.info(context, 'fetchers: geo-filtered sources follow the searches');
  }

  const out: FetcherResult[] = [];
  let done = 0;

  for (const company of companies) {
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
        out.push({ job, companyName: company.name });
      }
    } catch (err) {
      status = classifyFetchError(err);
      logger.error(
        { err, company: company.name, ats: company.atsType, status },
        'fetcher: failed',
      );
    }
    await recordFetchHealth(company, status);
    onSource?.({ company: company.name, status, count, done, total: companies.length });
    await sleep(POLITE_DELAY_MS);
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
): Promise<void> {
  const streak = nextStreak(status, company.consecutiveFailures);
  try {
    await prisma.company.update({
      where: { id: company.id },
      data: {
        lastFetchStatus: status,
        consecutiveFailures: streak,
        ...(status === 'ok' ? { lastOkAt: new Date() } : {}),
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
      return fetchArbeitnow(company.id);
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
      return fetchHimalayas(company.id);
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
      return fetchFourDayWeek(company.id);
    case AtsType.MANUAL:
      // Pasted by hand on /jobs/new — nothing to fetch (and the row is inactive).
      return [];
  }
}
