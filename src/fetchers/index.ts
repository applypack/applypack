import { AtsType } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { sleep } from '../http';
import { getSettings } from '../settings';
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
import type { NormalizedJob } from '../types';

const POLITE_DELAY_MS = 1_000;

export interface FetcherResult {
  job: NormalizedJob;
  companyName: string;
}

export async function runAllFetchers(): Promise<FetcherResult[]> {
  const settings = await getSettings();
  const disabled = settings.disabledSources.filter(
    (s): s is AtsType => (Object.values(AtsType) as string[]).includes(s),
  );
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

  const out: FetcherResult[] = [];

  for (const company of companies) {
    try {
      const jobs = await fetchOne(company);
      logger.info(
        { company: company.name, count: jobs.length, ats: company.atsType },
        'fetcher: ok',
      );
      for (const job of jobs) {
        out.push({ job, companyName: company.name });
      }
    } catch (err) {
      logger.error(
        { err, company: company.name, ats: company.atsType },
        'fetcher: failed',
      );
    }
    await sleep(POLITE_DELAY_MS);
  }

  return out;
}

export async function fetchOne(company: {
  id: number;
  atsType: AtsType;
  atsToken: string;
}): Promise<NormalizedJob[]> {
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
      return fetchJobicy(company.id);
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
    case AtsType.MANUAL:
      // Pasted by hand on /jobs/new — nothing to fetch (and the row is inactive).
      return [];
  }
}
