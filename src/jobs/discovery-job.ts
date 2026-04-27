import { CandidateStatus, AtsType } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { probeAts } from '../ats-probe';
import { getSettings } from '../settings';
import { sleep } from '../http';
import type { CronStats } from './cron-run';

const POLITE_DELAY_MS = 1_000;

/**
 * Weekly cron: revisit each PENDING CompanyCandidate and probe its ATS
 * endpoint to confirm the slug still resolves. Updates jobsSeen so the
 * /discovery review page can sort by "candidates with jobs right now".
 *
 * Marks candidates DEAD when the probe returns a clear 404 (token retired
 * or never existed). PENDING with jobsSeen=0 stays — the company may
 * simply have no listings this week.
 */
export async function runDiscoveryJob(): Promise<{ stats: CronStats }> {
  const started = Date.now();
  const settings = await getSettings();
  if (!settings.discoveryEnabled) {
    logger.info('discovery: skipped (toggle off)');
    return { stats: { skipped: 1, reason: 'discovery-disabled' } };
  }

  const candidates = await prisma.companyCandidate.findMany({
    where: { status: CandidateStatus.PENDING },
    orderBy: { id: 'asc' },
  });

  let probed = 0;
  let alive = 0;
  let dead = 0;
  let updated = 0;

  for (const c of candidates) {
    if (
      c.atsType !== AtsType.GREENHOUSE &&
      c.atsType !== AtsType.LEVER &&
      c.atsType !== AtsType.ASHBY
    ) {
      // No probe available for aggregator types — leave as-is.
      continue;
    }
    const result = await probeAts(c.atsType, c.atsToken);
    probed++;
    if (result.ok) {
      alive++;
      const before = c.jobsSeen;
      const after = result.jobsCount ?? 0;
      if (before !== after) {
        await prisma.companyCandidate.update({
          where: { id: c.id },
          data: { jobsSeen: after },
        });
        updated++;
      }
    } else {
      // 404-ish errors → mark DEAD so they stop appearing in review.
      if (result.error && /HTTP 4\d\d/.test(result.error)) {
        await prisma.companyCandidate.update({
          where: { id: c.id },
          data: { status: CandidateStatus.DEAD },
        });
        dead++;
      }
    }
    await sleep(POLITE_DELAY_MS);
  }

  const durationMs = Date.now() - started;
  const stats: CronStats = {
    pending: candidates.length,
    probed,
    alive,
    dead,
    jobsCountUpdated: updated,
    durationMs,
  };
  logger.info(stats, 'discovery: done');
  return { stats };
}
