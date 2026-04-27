import { AtsType } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { fetchHnHiring, findLatestHiringThread } from '../fetchers/hn-hiring';
import { getActiveProfile } from '../profiles';
import { getSettings } from '../settings';
import { recordCandidatesFromText } from '../discovery';
import { processNormalizedJobs, type ProcessStats } from './process-jobs';
import type { CronStats } from './cron-run';

const HN_COMPANY_NAME = 'HN Who is Hiring';
const HN_ATS_TOKEN = 'hn-hiring';
const HN_CAREER_URL = 'https://news.ycombinator.com/from?site=ycombinator.com';

/**
 * Monthly cron: pull comments from the latest "Ask HN: Who is hiring?"
 * thread, parse them into job-shaped records, run them through the same
 * filter / classify / alert pipeline as ATS-fetched jobs.
 */
export async function runHnHiringJob(): Promise<{ stats: CronStats }> {
  const started = Date.now();
  logger.info('hn-hiring: start');

  const settings = await getSettings();
  if (!settings.hnParserEnabled) {
    logger.info('hn-hiring: skipped (parser disabled in settings)');
    return { stats: { skipped: 1, reason: 'parser-disabled' } };
  }

  const profile = await getActiveProfile();
  if (!profile) {
    logger.warn('hn-hiring: no active profile; aborting');
    return { stats: { aborted: 1, reason: 'no-active-profile' } };
  }

  const company = await prisma.company.upsert({
    where: {
      atsType_atsToken: { atsType: AtsType.HN_HIRING, atsToken: HN_ATS_TOKEN },
    },
    update: { name: HN_COMPANY_NAME, careerUrl: HN_CAREER_URL },
    create: {
      name: HN_COMPANY_NAME,
      atsType: AtsType.HN_HIRING,
      atsToken: HN_ATS_TOKEN,
      careerUrl: HN_CAREER_URL,
      // The parent toggle (settings.hnParserEnabled) gates this job, so we
      // mark the synthetic Company active by default so the kanban / Jobs
      // page filtering respect it normally.
      active: true,
    },
  });

  const fetched = await fetchHnHiring(company.id);
  const items = fetched.map((job) => ({ job, companyName: HN_COMPANY_NAME }));

  // Phase 4.2 — harvest ATS company candidates from comment URLs.
  // Each fetched job already carries the cleaned comment text in
  // `description`, so we re-scan it for greenhouse / lever / ashby URLs.
  let candidates = 0;
  if (settings.discoveryEnabled) {
    const sourceTag = `hn-${new Date().toISOString().slice(0, 7)}`; // hn-2026-04
    const thread = await findLatestHiringThread().catch(() => null);
    for (const j of fetched) {
      const recorded = await recordCandidatesFromText(j.description, sourceTag, {
        name: null,
        sourceUrl: thread
          ? `https://news.ycombinator.com/item?id=${thread.objectID}`
          : null,
        signal: `Found in HN comment ${j.externalId}`,
      });
      candidates += recorded;
    }
    if (candidates > 0) {
      logger.info({ candidates }, 'hn-hiring: discovery harvested candidates');
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
  await processNormalizedJobs(items, profile, settings.classifierMode, inner);

  const durationMs = Date.now() - started;
  const stats: CronStats = {
    profile: profile.name,
    classifierMode: settings.classifierMode,
    fetched: fetched.length,
    candidatesRecorded: candidates,
    ...inner,
    durationMs,
  };
  logger.info(stats, 'hn-hiring: done');
  return { stats };
}
