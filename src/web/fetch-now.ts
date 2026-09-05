import { getSettings } from '../settings';
import { recordCronRun, type CronStats } from '../jobs/cron-run';
import { runFetchJob, type FetchJobOptions } from '../jobs/fetch-job';
import { activeFetchRun, createFetchRun, recordSource, startFetchRun, updateFetchRun, type FetchRun } from './fetch-runs';

/**
 * "Fetch now": the hourly tick started from the dashboard — one at a time,
 * in the web process, recorded as a 'fetch-now' CronRun (the re-classify
 * pattern). While the pipeline is paused the run still fetches, but stores
 * new jobs unscored: paused means no AI spend. The /runs button and the
 * wizard's test search both start here; a press while one runs joins it.
 */
export async function beginFetchNow(
  opts: { backUrl: string } & Pick<FetchJobOptions, 'only' | 'places'>,
): Promise<FetchRun> {
  const { fetchingEnabled } = await getSettings();
  // No await between the guard and the create — a double submit lands on the same run.
  const active = activeFetchRun();
  if (active) return active;
  const run = createFetchRun({ classify: fetchingEnabled, backUrl: opts.backUrl });
  startFetchRun(run.id, async () => {
    let stats: CronStats | undefined;
    await recordCronRun('fetch-now', async () => {
      const out = await runFetchJob({
        manual: true,
        only: opts.only,
        places: opts.places,
        onSource: (p) => recordSource(run.id, p),
        onProcessing: () => updateFetchRun(run.id, { stage: 'store' }),
      });
      stats = out.stats;
      return out;
    });
    updateFetchRun(run.id, { stage: 'done', stats });
  });
  return run;
}
