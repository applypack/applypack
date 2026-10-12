import type { FolderAlerts } from '../datasets/map';
import { t } from '../i18n/t';
import { logger } from '../logger';
import { listActiveProfiles } from '../profiles';
import { getSchedule, getSettings } from '../settings';
import type { NormalizedJob } from '../types';
import { deliverHeldAlerts } from './alert-delivery';
import type { CronStats } from './cron-run';
import { tryFetchLock } from './fetch-lock';
import { makeFetchPauseProbe } from './fetch-pause';
import { addToFunnel } from './funnel-store';
import { emptyProcessStats, processNormalizedJobs } from './process-jobs';

/**
 * Rows the user imported (ADR 0062), through the pipeline every fetched
 * posting takes — `processNormalizedJobs`: filter, mute, dedupe, classify,
 * persist, alert. It shares the fetch lock with the tick and "Fetch now",
 * because it shares their classifier: two at once would pay for the same
 * posting twice. While fetching is paused the rows are stored unscored, as
 * "Fetch now" stores them. No request is made: the rows are already here.
 *
 * A file is one event (#402). Its matches are never sent one by one — 300 of
 * 2,000 rows was 300 messages in one run: they are held as they are scored
 * and leave as one message a chat when the import ends, the best listed and
 * the rest counted (alert-delivery.ts). With `alerts: 'off'` nothing is sent
 * or held and no pack is queued, as for a folder whose alerts are off.
 */
export async function runImportJob(source: { id: number; name: string }, jobs: NormalizedJob[], alerts: FolderAlerts): Promise<{ stats: CronStats }> {
  const lock = await tryFetchLock();
  if (!lock) {
    logger.warn({ source: source.name }, 'import-job: a fetch is running; nothing imported');
    return { stats: { skipped: 1, reason: 'overlap', source: source.name } };
  }
  const startedAt = new Date();
  try {
    const settings = await getSettings();
    const profiles = await listActiveProfiles();
    if (profiles.length === 0) {
      logger.warn({ source: source.name }, 'import-job: no active search; nothing imported');
      return { stats: { aborted: 1, reason: 'no-active-profile', source: source.name } };
    }
    const classify = settings.fetchingEnabled;
    const schedule = await getSchedule();
    const inner = emptyProcessStats();
    await processNormalizedJobs(
      jobs.map((job) => ({ job, companyName: source.name, ...(alerts === 'off' && { quiet: true }) })),
      profiles,
      inner,
      {
        classifierMode: settings.classifierMode,
        classify,
        // A pause on /settings stops an import that is scoring, as it stops a tick.
        isCancelled: classify ? makeFetchPauseProbe() : undefined,
        schedule,
        groupAlerts: true,
      },
    );
    // The one message. A send every chat refuses leaves the rows held, and the next heartbeat tries again.
    let alertCounted = 0;
    if (inner.alertHeld > 0) {
      const sent = await deliverHeldAlerts(new Date(), schedule, { companyId: source.id, title: t('import.alertTitle', { source: source.name }) }).catch((err: unknown) => {
        logger.error({ err, source: source.name }, 'import-job: the matches were not sent; they stay held');
        return { delivered: 0, messages: 0, counted: 0, failed: 0 };
      });
      inner.alerted += sent.delivered;
      inner.alertFailed += sent.failed;
      inner.alertHeld = Math.max(0, inner.alertHeld - sent.delivered - sent.counted - sent.failed);
      alertCounted = sent.counted;
    }
    const stats: CronStats = {
      source: source.name,
      profile: profiles.map((p) => p.name).join(' · '),
      classifierMode: settings.classifierMode,
      ...(!classify && { classify: false }),
      fetched: jobs.length,
      ...inner,
      ...(alertCounted > 0 && { alertCounted }),
      durationMs: Date.now() - startedAt.getTime(),
    };
    logger.info(stats, 'import-job: done');
    // The funnel is a view of the run, not part of it: a failed write is logged, the run stands.
    await addToFunnel(startedAt, stats).catch((err) => logger.warn({ err }, 'import-job: funnel day not updated'));
    return { stats };
  } finally {
    await lock.release();
  }
}
