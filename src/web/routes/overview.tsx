/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { AtsType, JobStatus, type Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { clearFlashCookie, parseFlashCookie } from '../flash';
import { activeFetchRun } from '../fetch-runs';
import { loadWelcomeContext } from '../welcome-facts';
import { currentStep, needsWelcome } from '../welcome-steps';
import { OverviewPage } from '../pages/overview';
import { loadHeldLine, loadNextCheck } from '../schedule-view';
import { withoutMuted } from '../../employer';
import { mutedKeys } from '../../jobs/employer-store';
import { getActiveProfile, listActiveProfiles } from '../../profiles';
import { readStackParam } from '../overview-numbers';
import { loadOverviewStats } from '../overview-stats';
import { preferredPlaces } from '../place-line';
import { DEFAULT_RANGE, isRangeKey } from '../stats-series';
import { nextThings, type NextThing } from '../next-things';
import { listReadyPacks } from '../../pack/store';
import { spendHint } from '../cost-hint';

/** ★ How many companies the user watches, and what they put up today (ADR 0036). */
async function watchedSummary(): Promise<{ companies: number; newJobs: number; toPaste: number }> {
  const companies = await prisma.company.count({ where: { watched: true } });
  if (companies === 0) return { companies: 0, newJobs: 0, toPaste: 0 };
  const [newJobs, toPaste] = await Promise.all([
    prisma.job.count({
      where: { company: { watched: true }, fetchedAt: { gte: new Date(Date.now() - DAY_MS) } },
    }),
    // TASKS N8: the pages only a paste can read.
    prisma.company.count({ where: { watched: true, atsType: AtsType.BROWSER_PAGE } }),
  ]);
  return { companies, newJobs, toPaste };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 8;
const CRON_NAMES = ['fetch', 'digest', 'cleanup'] as const;

export const overviewRoute = new Hono();

overviewRoute.get('/', async (c) => {
  // A fresh install is walked through setup first (docs/onboarding-plan.md §2);
  // every other page keeps working meanwhile.
  const { facts, settings } = await loadWelcomeContext();
  if (needsWelcome(settings)) return c.redirect('/welcome', 303);

  // The chart's range and technology ride in the URL; anything else reads as the default.
  const rangeParam = c.req.query('range');
  const range = isRangeKey(rangeParam) ? rangeParam : DEFAULT_RANGE;
  // The numbers link to /jobs, which hides a muted company's rows (ADR 0056): they count what it shows.
  const unmuted = withoutMuted(await mutedKeys()) ?? {};
  const [countsRows, recentAlerts, latestRunRows, stats, searches] = await Promise.all([
    prisma.job.groupBy({
      by: ['status'],
      _count: { _all: true },
      where: unmuted,
    }),
    prisma.job.findMany({
      where: { status: { in: [JobStatus.ALERTED, JobStatus.NEW] }, ...unmuted },
      orderBy: [{ alertedAt: 'desc' }, { fetchedAt: 'desc' }],
      take: RECENT_LIMIT,
      // The columns a row draws and no more: the page refreshes every 30 seconds,
      // and `include` carried eight descriptions with it each time.
      select: {
        id: true,
        title: true,
        location: true,
        workplace: true,
        countries: true,
        regions: true,
        techMatch: true,
        fitScore: true,
        fetchedAt: true,
        alertedAt: true,
        status: true,
        employer: true,
        company: { select: { name: true } },
      },
    }),
    Promise.all(
      CRON_NAMES.map((name) =>
        prisma.cronRun.findFirst({
          where: { name },
          orderBy: { startedAt: 'desc' },
        }),
      ),
    ),
    loadOverviewStats({ range, stack: readStackParam(c.req.query('stack')), unmuted }),
    listActiveProfiles(),
  ]);

  const counts = countsRows.map((r) => ({
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
      recentAlerts={recentAlerts}
      latestRuns={latestRuns}
      fetchingEnabled={settings.fetchingEnabled}
      sleepingUntil={sleepingUntil}
      held={await loadHeldLine(check.schedule)}
      watched={await watchedSummary()}
      stats={stats}
      places={preferredPlaces(searches)}
      fetchRun={activeFetchRun()}
      finishSetup={currentStep(facts) !== null}
      next={await loadNextThings(unmuted)}
      readyPacks={await listReadyPacks(READY_PACKS_SHOWN)}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

/**
 * TASKS N11: the loop the product is for, until the user has walked it once.
 * The steady state — any comparison stored — costs one count; the page
 * refreshes every 30 seconds.
 */
/** The packs the Overview lists; the rest are a click away on the Jobs page. */
const READY_PACKS_SHOWN = 8;

async function loadNextThings(unmuted: Prisma.JobWhereInput): Promise<NextThing[] | null> {
  const comparisons = await prisma.resumeMatch.count();
  if (comparisons > 0) return null;
  const profile = await getActiveProfile();
  const top = await prisma.job.findFirst({
    // A "best match" under the search's own floor would be a word for nothing.
    where: {
      status: { in: [JobStatus.NEW, JobStatus.ALERTED, JobStatus.SAVED] },
      fitScore: { gte: profile?.minFitScore ?? 0 },
      ...unmuted,
    },
    orderBy: [{ fitScore: 'desc' }, { fetchedAt: 'desc' }],
    select: { id: true, title: true, employer: true, fitScore: true, company: { select: { name: true } } },
  });
  if (top === null || top.fitScore === null) return null;
  const [resumes, compareCost] = await Promise.all([
    prisma.resume.count({ where: { hidden: false } }),
    spendHint('resume-match'),
  ]);
  return nextThings({
    top: { id: top.id, title: top.title, company: top.employer ?? top.company.name, fitScore: top.fitScore },
    comparisons,
    resumes,
    compareCost,
  });
}
