/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { idParam } from '../params';
import { AtsType, JobStatus } from '@prisma/client';
import { z } from 'zod';
import { isUniqueViolation, prisma } from '../../db';
import { logger } from '../../logger';
import { probeAts } from '../../ats-probe';
import { quietReason } from '../../fetchers/source-health';
import { getSettings, getSourceKeys, pausedFamilies } from '../../settings';
import { unlockedSources } from '../../source-keys';
import { toStringArray } from '../../text-utils';
import {
  companiesInSegments,
  countsBySegment,
  findCompany,
  segments as packSegments,
} from '../../starter-packs/catalog';
import { resolvePack } from '../../starter-packs/probe';
import { activeWatchlistRun } from '../watchlist-runs';
import { installAiTokens } from '../../watchlist/resolve';
import { currentSuggestions, waitingSuggestions } from '../source-suggestions';
import { clearFlashCookie, firstIssue, flashRedirect, parseFlashCookie, refusedField, safeBack } from '../flash';
import {
  boardUrl,
  buildPreview,
  allowedAttempt,
  keyOf,
} from '../../starter-packs/resolve';
import { CompaniesPage } from '../pages/companies';
import type { WatchedRow } from '../pages/watchlist';
import {
  StarterPackPreviewPage,
  StarterPackResultPage,
  type PackOrigin,
} from '../pages/starter-pack';
import { findMute, listMutes, muteEmployer, unmuteEmployer } from '../../jobs/employer-store';
import { roleLines, titleWordsOf, type TitleWords } from '../../watchlist/paste';
import { listActiveProfiles } from '../../profiles';
import { packOffers } from '../pack-offers';
import { isBlankProfile } from '../../profile-guards';
import { t } from '../../i18n/t';

const NewCompanySchema = z.object({
  name: z.string().min(1).max(100),
  atsType: z.enum([
    AtsType.GREENHOUSE,
    AtsType.LEVER,
    AtsType.ASHBY,
    AtsType.WORKABLE,
    AtsType.SMARTRECRUITERS,
    AtsType.RECRUITEE,
    AtsType.BREEZY,
    AtsType.BAMBOOHR,
    AtsType.PINPOINT,
    AtsType.RIPPLING,
    AtsType.PERSONIO,
    AtsType.TEAMTAILOR,
    AtsType.DOU,
    AtsType.DJINNI,
    AtsType.JOBTECH,
    AtsType.ADZUNA,
    AtsType.FRANCETRAVAIL,
    AtsType.FEED,
    AtsType.CAREER_PAGE,
  ] as const),
  atsToken: z.string().min(1).max(120),
  careerUrl: z.string().url().optional().or(z.literal('')),
});

export const companiesRoute = new Hono();

/** One "how many rows point at this company" row, from a grouped count. */
interface CompanyTally {
  companyId: number;
  n: number;
}

companiesRoute.get('/companies', async (c) => {
  const companies = await prisma.company.findMany({
    where: { atsType: { not: AtsType.MANUAL } },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: {
      _count: { select: { jobs: true } },
      jobs: {
        select: { fetchedAt: true, status: true },
        orderBy: { fetchedAt: 'desc' },
        take: 1,
      },
    },
  });

  const alertedCounts = await prisma.job.groupBy({
    by: ['companyId'],
    where: { status: { in: [JobStatus.ALERTED, JobStatus.APPLIED] } },
    _count: { _all: true },
  });
  const alertedMap = new Map<number, number>();
  for (const row of alertedCounts) {
    alertedMap.set(row.companyId, row._count._all);
  }

  // What "Delete" would take beyond the jobs. A job cascades to the
  // application tracked against it, its comparisons and its letters, and the
  // confirm used to count the jobs only — on real data that hid six
  // applications behind "and all its 73 jobs?" (audit, TASKS §14).
  const applicationCounts = await prisma.job.groupBy({
    by: ['companyId'],
    where: { OR: [{ pipelineStage: { not: null } }, { status: JobStatus.APPLIED }] },
    _count: { _all: true },
  });
  const applicationMap = new Map(applicationCounts.map((r) => [r.companyId, r._count._all]));
  // Counted in SQL, one row per company: `groupBy` cannot group across a
  // relation, and loading every match and every letter to tally them in
  // memory would grow with the user's whole history for a confirm string.
  const [matchCounts, letterCounts] = await Promise.all([
    prisma.$queryRaw<CompanyTally[]>`
      SELECT j."companyId" AS "companyId", count(*)::int AS n
      FROM resume_match m JOIN job j ON j.id = m."jobId" GROUP BY j."companyId"`,
    prisma.$queryRaw<CompanyTally[]>`
      SELECT j."companyId" AS "companyId", count(*)::int AS n
      FROM cover_letter l JOIN job j ON j.id = l."jobId" GROUP BY j."companyId"`,
  ]);
  const matchMap = new Map(matchCounts.map((r) => [r.companyId, r.n]));
  const letterMap = new Map(letterCounts.map((r) => [r.companyId, r.n]));

  const settings = await getSettings();
  const paused = pausedFamilies(settings);
  const now = new Date();
  // A page drawn in the browser is a watchlist row only (TASKS N8): it is never
  // fetched, so the source table would list it as a dead source forever.
  const rows = companies.filter((c) => c.atsType !== AtsType.BROWSER_PAGE).map((c) => ({
    id: c.id,
    name: c.name,
    atsType: c.atsType,
    atsToken: c.atsToken,
    active: c.active,
    careerUrl: c.careerUrl,
    jobsTotal: c._count.jobs,
    alertedTotal: alertedMap.get(c.id) ?? 0,
    deleteImpact: {
      jobs: c._count.jobs,
      applications: applicationMap.get(c.id) ?? 0,
      comparisons: matchMap.get(c.id) ?? 0,
      letters: letterMap.get(c.id) ?? 0,
    },
    lastFetchedAt: c.jobs[0]?.fetchedAt ?? null,
    lastFetchStatus: c.lastFetchStatus,
    consecutiveFailures: c.consecutiveFailures,
    lastOkAt: c.lastOkAt,
    // Only sources we actually poll can be judged: a disabled row, or one in
    // a source family the user switched off, is silent by instruction.
    quiet:
      c.active && !paused.includes(c.atsType)
        ? quietReason(c, now)
        : null,
  }));

  const counts = countsBySegment();
  const packs = packSegments().map((s) => ({
    ...s,
    count: counts.get(s.id) ?? 0,
  }));

  // Postings a watched company put up in the last week — the number the user
  // opens this page for. One grouped count, not one query per row.
  const freshCounts = await prisma.job.groupBy({
    by: ['companyId'],
    where: { companyId: { in: companies.filter((c) => c.watched).map((c) => c.id) }, fetchedAt: { gte: weekAgo(now) } },
    _count: { _all: true },
  });
  const freshMap = new Map(freshCounts.map((r) => [r.companyId, r._count._all]));

  const flash = parseFlashCookie(c.req.header('cookie'));
  return c.html(
    <CompaniesPage
      companies={rows}
      watchlist={watchedRows(companies, freshMap, titleWordsOf((await listActiveProfiles()).filter((p) => !isBlankProfile(p))))}
      watchlistRun={activeWatchlistRun()}
      packs={packs}
      suggestions={await currentSuggestions()}
      fitPacks={await packOffers()}
      keyedUnlocked={unlockedSources(await getSourceKeys())}
      flash={flash}
      fetchingEnabled={settings.fetchingEnabled}
      muted={await listMutes()}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

const MuteFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  reason: z.string().optional().default(''),
  back: z.string().optional().default('/companies#muted'),
});

/** ADR 0056: mute a company by name — from its posting, or from the Muted companies card. */
companiesRoute.post('/companies/mutes', async (c) => {
  const body = await c.req.parseBody();
  const back = safeBack(body.back, '/companies#muted');
  const parsed = MuteFormSchema.safeParse(body);
  if (!parsed.success) return flashRedirect(back, 'err', t('mute.flash.invalid', { issue: firstIssue(parsed.error.issues) }), refusedField(c.req.path, parsed.error.issues));
  const mute = await muteEmployer(parsed.data.name, parsed.data.reason);
  if (!mute) return flashRedirect(back, 'err', t('mute.flash.noLetters'));
  const hidden = await prisma.job.count({ where: { employerKey: mute.key } });
  return flashRedirect(back, 'ok', t('mute.flash.muted', { name: mute.name, n: hidden }));
});

companiesRoute.post('/companies/mutes/delete', async (c) => {
  const body = await c.req.parseBody();
  const back = safeBack(body.back, '/companies#muted');
  const mute = typeof body.key === 'string' ? await findMute(body.key) : null;
  if (!mute || !(await unmuteEmployer(mute.key))) return flashRedirect(back, 'err', t('mute.flash.notMuted'));
  return flashRedirect(back, 'ok', t('mute.flash.unmuted', { name: mute.name }));
});

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function weekAgo(now: Date): Date {
  return new Date(now.getTime() - WEEK_MS);
}

/** The watchlist section's rows (TASKS §17), newest interval-first is not a thing — by name. */
function watchedRows(
  companies: readonly {
    id: number;
    name: string;
    atsType: AtsType;
    atsToken: string;
    active: boolean;
    careerUrl: string | null;
    watched: boolean;
    checkEvery: string;
    alertPolicy: string;
    nextCheckAt: Date | null;
    lastContentAlertAt: Date | null;
    pendingContentHash: string | null;
    lastOkAt: Date | null;
    lastFetchStatus: string | null;
    pastedLines: string[];
    pastedNew: string[];
    pastedAt: Date | null;
    _count: { jobs: number };
  }[],
  fresh: Map<number, number>,
  searches: readonly TitleWords[],
): WatchedRow[] {
  return companies
    .filter((c) => c.watched)
    .map((c) => ({
      id: c.id,
      name: c.name,
      atsType: c.atsType,
      atsToken: c.atsToken,
      active: c.active,
      careerUrl: c.careerUrl,
      checkEvery: c.checkEvery,
      alertPolicy: c.alertPolicy,
      nextCheckAt: c.nextCheckAt,
      lastContentAlertAt: c.lastContentAlertAt,
      changePending: c.pendingContentHash !== null,
      lastOkAt: c.lastOkAt,
      lastFetchStatus: c.lastFetchStatus,
      jobsTotal: c._count.jobs,
      newJobs: fresh.get(c.id) ?? 0,
      // The first paste has nothing to be new against, so its role lines are read off the whole page.
      paste:
        c.pastedAt === null
          ? null
          : {
              at: c.pastedAt,
              lines: c.pastedLines.length,
              added: c.pastedNew,
              roles: roleLines(c.pastedNew.length > 0 ? c.pastedNew : c.pastedLines, searches),
            },
    }));
}

// --- sources for the searches' countries (plan §4.3) -----------------------

/** What the running searches' places and stacks call for, against the rows tracked. */
const SuggestedAddSchema = z.object({ atsType: z.string(), atsToken: z.string().min(1).max(120) });

/**
 * Adds one suggested row, inactive like a pack import (ADR 0017). The pair is
 * recomputed here and must be among today's suggestions — the browser
 * round-trips it, so it is not trusted; and the feed is probed first, so a
 * category the board does not know never becomes a silent empty source.
 */
companiesRoute.post('/companies/suggested', async (c) => {
  const form = await c.req.parseBody();
  const parsed = SuggestedAddSchema.safeParse({ atsType: form.atsType, atsToken: form.atsToken });
  if (!parsed.success) {
    return redirectWithFlash('err', t('sources.flash.noSource'));
  }
  const wanted = (await currentSuggestions()).find(
    (s) => s.atsType === parsed.data.atsType && s.atsToken === parsed.data.atsToken && s.state === 'missing',
  );
  if (!wanted) {
    return redirectWithFlash('err', t('sources.flash.notSuggested'));
  }

  const probe = await probeAts(wanted.atsType, wanted.atsToken, { keys: await getSourceKeys() });
  if (!probe.ok) return redirectWithFlash('err', t('companies.flash.probeFailed', { reason: probe.error ?? t('companies.flash.noReason') }));

  try {
    await prisma.company.create({
      data: { name: wanted.name, atsType: wanted.atsType, atsToken: wanted.atsToken, careerUrl: wanted.careerUrl, active: false },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return redirectWithFlash('err', t('sources.flash.alreadyListed', { name: wanted.name }));
  }
  logger.info({ name: wanted.name, atsToken: wanted.atsToken, jobs: probe.jobsCount }, 'companies: suggested source added');
  return redirectWithFlash('ok', t('sources.flash.added', { name: wanted.name, n: probe.jobsCount ?? 0 }));
});

/**
 * Every fitting source in one press (#148): the missing ones are probed and
 * added ON, the switched-off ones are switched on. A feed that fails its probe
 * is named in the flash and left out — never a silent empty source.
 */
companiesRoute.post('/companies/suggested/all', async (c) => {
  const form = await c.req.parseBody();
  const back = form.next === 'welcome' ? '/welcome?step=sources' : '/companies';
  const keys = await getSourceKeys();
  const enabled: string[] = [];
  const failed: string[] = [];
  for (const s of waitingSuggestions(await currentSuggestions())) {
    if (s.state === 'off' && s.companyId !== null) {
      await prisma.company.update({ where: { id: s.companyId }, data: { active: true } });
      enabled.push(s.name);
      continue;
    }
    const probe = await probeAts(s.atsType, s.atsToken, { keys });
    if (!probe.ok) {
      failed.push(s.name);
      continue;
    }
    try {
      await prisma.company.create({
        data: { name: s.name, atsType: s.atsType, atsToken: s.atsToken, careerUrl: s.careerUrl, active: true },
      });
    } catch (err) {
      // Added from another tab between the listing and now — not a failure.
      if (!isUniqueViolation(err)) throw err;
      continue;
    }
    enabled.push(s.name);
  }
  logger.info({ enabled, failed }, 'companies: suggested sources enabled');
  // Two sentences at most: what was switched on, then what was left out and why.
  const said = [
    enabled.length === 0 ? t('sources.flash.nothingToEnable') : t('sources.flash.enabled', { n: enabled.length, list: enabled.join(', ') }),
    ...(failed.length > 0 ? [t('sources.flash.failed', { n: failed.length, list: failed.join(', ') })] : []),
  ];
  return flashRedirect(back, enabled.length === 0 && failed.length > 0 ? 'err' : 'ok', said.join(' '));
});

// --- starter packs ----------------------------------------------------------

/** Boards already tracked, as the `ATS:token` keys buildPreview dedupes on. */
async function trackedBoardKeys(): Promise<Set<string>> {
  const rows = await prisma.company.findMany({
    select: { atsType: true, atsToken: true },
  });
  return new Set(rows.map((r) => keyOf(r.atsType, r.atsToken)));
}

companiesRoute.post('/companies/starter-pack', async (c) => {
  // Repeated checkboxes collapse to the last value without `all` (gotcha 1).
  const form = await c.req.parseBody({ all: true });
  const chosen = toStringArray(form.segment);
  const next = packOrigin(form.next);
  const targets = companiesInSegments(chosen);
  if (targets.length === 0) {
    return redirectWithFlash('err', t('packs.flash.pickSegment'));
  }

  const { resolved, unresolved } = await resolvePack(targets);
  const preview = buildPreview(resolved, unresolved, await trackedBoardKeys());
  logger.info(
    {
      segments: chosen,
      toAdd: preview.toAdd.length,
      alreadyAdded: preview.alreadyAdded.length,
      unresolved: preview.unresolved.length,
    },
    'starter-pack: previewed',
  );

  const labels = packSegments()
    .filter((s) => chosen.includes(s.id))
    .map((s) => s.label);
  return c.html(
    <StarterPackPreviewPage preview={preview} segmentLabels={labels} next={next} />,
  );
});

companiesRoute.post('/companies/starter-pack/import', async (c) => {
  const form = await c.req.parseBody({ all: true });
  const picks = toStringArray(form.pick);
  const next = packOrigin(form.next);
  if (picks.length === 0) {
    return redirectWithFlash('err', t('packs.flash.nonePicked'));
  }

  const added: Array<{
    id: number;
    name: string;
    atsType: string;
    atsToken: string;
  }> = [];
  let skipped = 0;

  for (const pick of picks) {
    const [segment, name, atsType, atsToken] = pick.split('|');
    if (!segment || !name || !atsType || !atsToken) {
      skipped++;
      continue;
    }
    // Only pairs the catalog's own resolve plan allows may be written — the
    // browser round-trips this value, so it is not trusted input. The match
    // also narrows `atsType` from a form string to a vendor we can probe.
    const entry = findCompany(segment, name);
    const attempt = entry && allowedAttempt(entry, atsType, atsToken);
    if (!attempt) {
      logger.warn({ pick }, 'starter-pack: rejected a pick outside the catalog');
      skipped++;
      continue;
    }

    try {
      const created = await prisma.company.create({
        data: {
          name,
          atsType: attempt.atsType,
          atsToken: attempt.atsToken,
          careerUrl: boardUrl(attempt.atsType, attempt.atsToken),
          // Inactive on purpose: a whole pack going live inside the next tick
          // would swamp the classifier (ADR 0017).
          active: false,
        },
        select: { id: true, name: true, atsType: true, atsToken: true },
      });
      added.push(created);
    } catch (err) {
      // Unique (atsType, atsToken) — someone added it between preview and now.
      // Anything else is a real failure and must not be counted as "skipped".
      if (!isUniqueViolation(err)) throw err;
      skipped++;
    }
  }

  logger.info({ added: added.length, skipped }, 'starter-pack: imported');
  return c.html(<StarterPackResultPage added={added} skipped={skipped} next={next} />);
});

companiesRoute.post('/companies/starter-pack/enable', async (c) => {
  const form = await c.req.parseBody({ all: true });
  const ids = toStringArray(form.id)
    .map(Number)
    .filter((n) => Number.isInteger(n));
  const back = packOrigin(form.next) === 'welcome' ? '/welcome?step=sources' : null;
  if (ids.length === 0) {
    const text = t('packs.flash.noneNamed');
    return back ? flashRedirect(back, 'err', text) : redirectWithFlash('err', text);
  }

  const { count } = await prisma.company.updateMany({
    where: { id: { in: ids }, active: false },
    data: { active: true },
  });
  const text = t('packs.flash.enabled', { n: count });
  return back ? flashRedirect(back, 'ok', text) : redirectWithFlash('ok', text);
});

/** The wizard's boards step threads `next=welcome` through preview → add → enable, so the flow returns to setup. */
function packOrigin(value: unknown): PackOrigin {
  return toStringArray(value).includes('welcome') ? 'welcome' : undefined;
}

companiesRoute.post('/companies/:id/toggle-active', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);

  const current = await prisma.company.findUnique({
    where: { id },
    select: { active: true, name: true, atsType: true },
  });
  if (!current) return c.text('Not found', 404);
  // TASKS N8: an active row would put a page nothing can read into every tick.
  if (!current.active && current.atsType === AtsType.BROWSER_PAGE) {
    return redirectWithFlash('err', t('watchlist.flash.browserOnly', { name: current.name }));
  }

  await prisma.company.update({
    where: { id },
    data: { active: !current.active },
  });
  return redirectWithFlash('ok', t(current.active ? 'companies.flash.disabled' : 'companies.flash.enabled', { name: current.name }));
});

/**
 * Repair path for a quiet source: re-run the same public probe the add form
 * uses. A probe that comes back clean clears the streak, so a source that
 * recovered stops nagging without waiting for the next tick.
 */
companiesRoute.post('/companies/:id/reprobe', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const company = await prisma.company.findUnique({
    where: { id },
    select: { name: true, atsType: true, atsToken: true },
  });
  if (!company) return c.text('Not found', 404);

  const probe = await probeAts(company.atsType, company.atsToken, {
    keys: await getSourceKeys(),
    aiTokens: await installAiTokens(),
  });
  if (!probe.ok) {
    return redirectWithFlash(
      'err',
      t('companies.flash.reprobeFailed', { name: company.name, reason: probe.error ?? t('companies.flash.noReason') }),
    );
  }

  const jobsCount = probe.jobsCount ?? 0;
  await prisma.company.update({
    where: { id },
    data: {
      lastFetchStatus: jobsCount > 0 ? 'ok' : 'empty',
      consecutiveFailures: 0,
      ...(jobsCount > 0 ? { lastOkAt: new Date() } : {}),
    },
  });
  return redirectWithFlash('ok', t('companies.flash.reprobeOk', { name: company.name, n: jobsCount }));
});

companiesRoute.post('/companies/:id/delete', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const current = await prisma.company.findUnique({
    where: { id },
    select: { name: true, atsType: true },
  });
  if (!current) return c.text('Not found', 404);
  await prisma.company.delete({ where: { id } });
  return redirectWithFlash(
    'ok',
    t(current.atsType === AtsType.BROWSER_PAGE ? 'watchlist.flash.removed' : 'companies.flash.deleted', { name: current.name }),
  );
});

companiesRoute.post('/companies/new', async (c) => {
  const form = await c.req.parseBody();
  const parsed = NewCompanySchema.safeParse({
    name: form.name,
    atsType: form.atsType,
    atsToken: form.atsToken,
    careerUrl: form.careerUrl,
  });
  if (!parsed.success) {
    logger.warn(
      { errors: parsed.error.flatten().fieldErrors },
      'companies/new: validation failed',
    );
    return redirectWithFlash('err', t('companies.flash.invalid', { issue: firstIssue(parsed.error.issues) }));
  }
  const { name, atsType, atsToken, careerUrl } = parsed.data;

  const probe = await probeAts(atsType, atsToken, {
    keys: await getSourceKeys(),
    aiTokens: await installAiTokens(),
  });
  if (!probe.ok) {
    return redirectWithFlash('err', t('companies.flash.probeFailed', { reason: probe.error ?? t('companies.flash.noReason') }));
  }

  // Refuse silent overwrites — if the (atsType, atsToken) pair already
  // exists, send the user to the existing row with a hint.
  const existing = await prisma.company.findUnique({
    where: { atsType_atsToken: { atsType, atsToken: atsToken.trim() } },
  });
  if (existing) {
    return redirectWithFlash('err', t('companies.flash.exists', { ats: atsType, token: atsToken, name: existing.name }));
  }

  try {
    await prisma.company.create({
      data: {
        name: name.trim(),
        atsType,
        atsToken: atsToken.trim(),
        careerUrl: careerUrl && careerUrl.length > 0 ? careerUrl : null,
        active: true,
      },
    });
  } catch (err) {
    // The findUnique above is a read; two tabs pass it together (ADR 0053).
    if (!isUniqueViolation(err)) throw err;
    return redirectWithFlash('err', t('companies.flash.addedElsewhere', { ats: atsType, token: atsToken }));
  }

  return redirectWithFlash('ok', t('companies.flash.added', { name, n: probe.jobsCount ?? 0 }));
});

// --- helpers ----------------------------------------------------------------

/** Back to the list with a flash, in the cookie every page reads (flash.ts) — the watchlist and mute routes land here too. */
function redirectWithFlash(kind: 'ok' | 'err', text: string): Response {
  return flashRedirect('/companies', kind, text);
}
