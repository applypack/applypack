/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { prisma } from '../../db';
import { RunsPage } from '../pages/runs';
import { FetchRunPage } from '../pages/fetch-run';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { FETCH_RUN_STEPS, activeFetchRun, getFetchRun } from '../fetch-runs';
import { beginFetchNow } from '../fetch-now';
import { summarizeFetchRun } from '../fetch-summary';
import { loadFunnel, loadSourceYield } from '../../jobs/funnel-store';
import { t } from '../../i18n/t';

const RUNS_LIMIT = 100;

export const runsRoute = new Hono();

runsRoute.get('/runs', async (c) => {
  const now = new Date();
  const [runs, funnel, sources] = await Promise.all([
    prisma.cronRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: RUNS_LIMIT,
    }),
    loadFunnel(now),
    loadSourceYield(now),
  ]);
  return c.html(
    <RunsPage
      runs={runs}
      funnel={{ ...funnel, sources }}
      fetchRun={activeFetchRun()}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

/** "Fetch now" from the Overview or /runs — every source, due or not (fetch-now.ts). */
runsRoute.post('/runs/fetch-now', async (c) => {
  const run = await beginFetchNow({ backUrl: '/runs' });
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
      t('runs.fetchRunGone'),
    );
  }
  if (run.stage === 'done') {
    const { kind, text } = summarizeFetchRun(run.stats ?? {}, typeof run.scope === 'object' ? t('runs.checked', { name: run.scope.name }) : undefined);
    return flashRedirect(run.backUrl, kind, text);
  }
  return c.html(<FetchRunPage run={run} />);
});
