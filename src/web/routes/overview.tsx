/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { JobStatus } from '@prisma/client';
import { prisma } from '../../db';
import { clearFlashCookie, parseFlashCookie } from '../flash';
import { activeFetchRun } from '../fetch-runs';
import { loadWelcomeContext } from '../welcome-facts';
import { currentStep, needsWelcome } from '../welcome-steps';
import { OverviewPage } from '../pages/overview';
import { countHeldAlerts } from '../../jobs/alert-delivery';
import { loadNextCheck } from '../schedule-view';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 8;
const CRON_NAMES = ['fetch', 'digest', 'cleanup'] as const;

export const overviewRoute = new Hono();

overviewRoute.get('/', async (c) => {
  // A fresh install is walked through setup first (docs/onboarding-plan.md §2);
  // every other page keeps working meanwhile.
  const { facts, settings } = await loadWelcomeContext();
  if (needsWelcome(settings)) return c.redirect('/welcome', 303);

  const since24h = new Date(Date.now() - DAY_MS);
  const [countsRows, last24hRows, recentAlerts, latestRunRows] = await Promise.all([
    prisma.job.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.job.groupBy({
      by: ['status'],
      _count: { _all: true },
      where: { fetchedAt: { gte: since24h } },
    }),
    prisma.job.findMany({
      where: { status: { in: [JobStatus.ALERTED, JobStatus.NEW] } },
      orderBy: [{ alertedAt: 'desc' }, { fetchedAt: 'desc' }],
      take: RECENT_LIMIT,
      include: { company: { select: { name: true } } },
    }),
    Promise.all(
      CRON_NAMES.map((name) =>
        prisma.cronRun.findFirst({
          where: { name },
          orderBy: { startedAt: 'desc' },
        }),
      ),
    ),
  ]);

  const counts = countsRows.map((r) => ({
    status: r.status,
    count: r._count._all,
  }));
  const last24h = last24hRows.map((r) => ({
    status: r.status,
    count: r._count._all,
  }));
  // The status pill's third state: the schedule says this hour is not one of
  // the user's, so the next heartbeat that searches is named (TASKS §16).
  const check = await loadNextCheck(settings.schedule);
  const sleepingUntil = check.dueNow ? '' : check.next;

  const latestRuns = CRON_NAMES.map((name, i) => ({
    name,
    run: latestRunRows[i] ?? null,
  }));

  return c.html(
    <OverviewPage
      counts={counts}
      last24h={last24h}
      recentAlerts={recentAlerts}
      latestRuns={latestRuns}
      fetchingEnabled={settings.fetchingEnabled}
      sleepingUntil={sleepingUntil}
      heldAlerts={await countHeldAlerts()}
      fetchRun={activeFetchRun()}
      finishSetup={currentStep(facts) !== null}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});
