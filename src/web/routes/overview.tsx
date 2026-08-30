/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { JobStatus } from '@prisma/client';
import { prisma } from '../../db';
import { getSettings } from '../../settings';
import { clearFlashCookie, parseFlashCookie } from '../flash';
import { OverviewPage } from '../pages/overview';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 8;
const CRON_NAMES = ['fetch', 'digest', 'cleanup'] as const;

export const overviewRoute = new Hono();

overviewRoute.get('/', async (c) => {
  const since24h = new Date(Date.now() - DAY_MS);

  const [settings, countsRows, last24hRows, recentAlerts, latestRunRows] = await Promise.all([
    getSettings(),
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
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});
