import { AtsType } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { sleep } from '../http';
import { fetchGreenhouse } from './greenhouse';
import { fetchLever } from './lever';
import { fetchAshby } from './ashby';
import { fetchLarajobs } from './larajobs';
import type { NormalizedJob } from '../types';

const POLITE_DELAY_MS = 1_000;

export interface FetcherResult {
  job: NormalizedJob;
  companyName: string;
}

export async function runAllFetchers(): Promise<FetcherResult[]> {
  const companies = await prisma.company.findMany({
    where: { active: true },
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

async function fetchOne(company: {
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
  }
}
