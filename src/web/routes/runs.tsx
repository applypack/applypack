/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { prisma } from '../../db';
import { getSettings } from '../../settings';
import { recordCronRun, type CronStats } from '../../jobs/cron-run';
import { runFetchJob } from '../../jobs/fetch-job';
import { RunsPage } from '../pages/runs';
import { FetchRunPage } from '../pages/fetch-run';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import {
  FETCH_RUN_STEPS,
  activeFetchRun,
  createFetchRun,
  getFetchRun,
  recordSource,
  startFetchRun,
  updateFetchRun,
} from '../fetch-runs';
import { summarizeFetchRun } from '../fetch-summary';

const RUNS_LIMIT = 100;

export const runsRoute = new Hono();

runsRoute.get('/runs', async (c) => {
  const runs = await prisma.cronRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: RUNS_LIMIT,
  });
  return c.html(
    <RunsPage runs={runs} fetchRun={activeFetchRun()} flash={parseFlashCookie(c.req.header('cookie'))} />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

/**
 * "Fetch now": the hourly tick started from the dashboard — one at a time,
 * in the web process, recorded as a 'fetch-now' CronRun (the re-classify
 * pattern). While the pipeline is paused the run still fetches, but stores
 * new jobs unscored: paused means no AI spend.
 */
runsRoute.post('/runs/fetch-now', async (c) => {
  const { fetchingEnabled } = await getSettings();
  // No await between the guard and the create — a double submit lands on the same run.
  const active = activeFetchRun();
  if (active) return c.redirect(`/runs/fetch-now/${active.id}`, 303);
  const run = createFetchRun({ classify: fetchingEnabled });
  startFetchRun(run.id, async () => {
    let stats: CronStats | undefined;
    await recordCronRun('fetch-now', async () => {
      const out = await runFetchJob({
        manual: true,
        onSource: (p) => recordSource(run.id, p),
        onProcessing: () => updateFetchRun(run.id, { stage: 'store' }),
      });
      stats = out.stats;
      return out;
    });
    updateFetchRun(run.id, { stage: 'done', stats });
  });
  return c.redirect(`/runs/fetch-now/${run.id}`, 303);
});

/** Polled by the progress page; terminal states reload into the redirect below. */
runsRoute.get('/runs/fetch-now/:id/state', (c) => {
  const run = getFetchRun(c.req.param('id'));
  if (!run) return c.json({ gone: true }, 404);
  const { stage, classify, sourcesDone, sourcesTotal, jobsFetched, lastSource } = run;
  return c.json({
    stage,
    steps: FETCH_RUN_STEPS,
    classify,
    sourcesDone,
    sourcesTotal,
    jobsFetched,
    lastSource,
    stageElapsedMs: Date.now() - run.stageAt,
    elapsedMs: Date.now() - run.startedAt,
  });
});

runsRoute.get('/runs/fetch-now/:id', (c) => {
  const run = getFetchRun(c.req.param('id'));
  if (!run) {
    return flashRedirect(
      '/runs',
      'err',
      'That fetch run is gone (live progress lasts ~30 min) — its row below still has the result.',
    );
  }
  if (run.stage === 'done') {
    const { kind, text } = summarizeFetchRun(run.stats ?? {});
    return flashRedirect('/runs', kind, text);
  }
  return c.html(<FetchRunPage run={run} />);
});
