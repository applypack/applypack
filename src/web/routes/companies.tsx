/** @jsxImportSource hono/jsx */
import { Hono, type Context } from 'hono';
import { AtsType, JobStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { logger } from '../../logger';
import { probeAts } from '../../ats-probe';
import { quietReason } from '../../fetchers/source-health';
import { getSettings } from '../../settings';
import { toStringArray } from '../../text-utils';
import {
  companiesInSegments,
  countsBySegment,
  findCompany,
  segments as packSegments,
} from '../../starter-packs/catalog';
import { resolvePack } from '../../starter-packs/probe';
import { suggestSources, type SourceSuggestion } from '../../starter-packs/suggest';
import { listActiveProfiles } from '../../profiles';
import { isBlankProfile } from '../../profile-guards';
import {
  boardUrl,
  buildPreview,
  allowedAttempt,
  keyOf,
} from '../../starter-packs/resolve';
import { CompaniesPage } from '../pages/companies';
import {
  StarterPackPreviewPage,
  StarterPackResultPage,
} from '../pages/starter-pack';

const FLASH_TTL_SECONDS = 5;

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
    AtsType.DOU,
    AtsType.DJINNI,
    AtsType.JOBTECH,
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
  const now = new Date();
  const rows = companies.map((c) => ({
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
      c.active && !settings.disabledSources.includes(c.atsType)
        ? quietReason(c, now)
        : null,
  }));

  const counts = countsBySegment();
  const packs = packSegments().map((s) => ({
    ...s,
    count: counts.get(s.id) ?? 0,
  }));

  const flash = parseFlashCookie(c.req.header('cookie'));
  return c.html(
    <CompaniesPage
      companies={rows}
      packs={packs}
      suggestions={await suggestedSources(companies)}
      flash={flash}
      fetchingEnabled={settings.fetchingEnabled}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

// --- sources for the searches' countries (plan §4.3) -----------------------

/** What the running searches' places and stacks call for, against the rows tracked. */
async function suggestedSources(
  tracked: readonly { id: number; atsType: string; atsToken: string; active: boolean }[],
): Promise<SourceSuggestion[]> {
  const searches = (await listActiveProfiles()).filter((p) => !isBlankProfile(p));
  return suggestSources(searches, tracked);
}

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
  if (!parsed.success) return redirectWithFlash(c, 'err', 'Invalid form values.');
  const tracked = await prisma.company.findMany({ select: { id: true, atsType: true, atsToken: true, active: true } });
  const wanted = (await suggestedSources(tracked)).find(
    (s) => s.atsType === parsed.data.atsType && s.atsToken === parsed.data.atsToken && s.state === 'missing',
  );
  if (!wanted) return redirectWithFlash(c, 'err', 'That source is not among today\'s suggestions.');

  const probe = await probeAts(wanted.atsType, wanted.atsToken);
  if (!probe.ok) return redirectWithFlash(c, 'err', `Probe failed: ${probe.error}`);

  await prisma.company.create({
    data: { name: wanted.name, atsType: wanted.atsType, atsToken: wanted.atsToken, careerUrl: wanted.careerUrl, active: false },
  });
  logger.info({ name: wanted.name, atsToken: wanted.atsToken, jobs: probe.jobsCount }, 'companies: suggested source added');
  return redirectWithFlash(c, 'ok', `Added "${wanted.name}" (${probe.jobsCount ?? 0} postings), switched off — enable it when ready.`);
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
  const targets = companiesInSegments(chosen);
  if (targets.length === 0) {
    return redirectWithFlash(c, 'err', 'Pick at least one segment.');
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
    <StarterPackPreviewPage preview={preview} segmentLabels={labels} />,
  );
});

companiesRoute.post('/companies/starter-pack/import', async (c) => {
  const form = await c.req.parseBody({ all: true });
  const picks = toStringArray(form.pick);
  if (picks.length === 0) {
    return redirectWithFlash(c, 'err', 'Nothing selected.');
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
    } catch {
      // Unique (atsType, atsToken) — someone added it between preview and now.
      skipped++;
    }
  }

  logger.info({ added: added.length, skipped }, 'starter-pack: imported');
  return c.html(<StarterPackResultPage added={added} skipped={skipped} />);
});

companiesRoute.post('/companies/starter-pack/enable', async (c) => {
  const form = await c.req.parseBody({ all: true });
  const ids = toStringArray(form.id)
    .map(Number)
    .filter((n) => Number.isInteger(n));
  if (ids.length === 0) {
    return redirectWithFlash(c, 'err', 'No companies to enable.');
  }

  const { count } = await prisma.company.updateMany({
    where: { id: { in: ids }, active: false },
    data: { active: true },
  });
  return redirectWithFlash(c, 'ok', `Enabled ${count} companies.`);
});

companiesRoute.post('/companies/:id/toggle-active', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);

  const current = await prisma.company.findUnique({
    where: { id },
    select: { active: true, name: true },
  });
  if (!current) return c.text('Not found', 404);

  await prisma.company.update({
    where: { id },
    data: { active: !current.active },
  });
  return redirectWithFlash(
    c,
    'ok',
    `${current.name} ${current.active ? 'disabled' : 'enabled'}.`,
  );
});

/**
 * Repair path for a quiet source: re-run the same public probe the add form
 * uses. A probe that comes back clean clears the streak, so a source that
 * recovered stops nagging without waiting for the next tick.
 */
companiesRoute.post('/companies/:id/reprobe', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const company = await prisma.company.findUnique({
    where: { id },
    select: { name: true, atsType: true, atsToken: true },
  });
  if (!company) return c.text('Not found', 404);

  const probe = await probeAts(company.atsType, company.atsToken);
  if (!probe.ok) {
    return redirectWithFlash(
      c,
      'err',
      `${company.name}: ${probe.error ?? 'probe failed'}`,
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
  return redirectWithFlash(
    c,
    'ok',
    `${company.name}: board answered with ${jobsCount} posting${jobsCount === 1 ? '' : 's'}.`,
  );
});

companiesRoute.post('/companies/:id/delete', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const current = await prisma.company.findUnique({
    where: { id },
    select: { name: true },
  });
  if (!current) return c.text('Not found', 404);
  await prisma.company.delete({ where: { id } });
  return redirectWithFlash(c, 'ok', `Deleted "${current.name}" and its jobs.`);
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
    return redirectWithFlash(c, 'err', 'Invalid form values.');
  }
  const { name, atsType, atsToken, careerUrl } = parsed.data;

  const probe = await probeAts(atsType, atsToken);
  if (!probe.ok) {
    return redirectWithFlash(c, 'err', `Probe failed: ${probe.error}`);
  }

  // Refuse silent overwrites — if the (atsType, atsToken) pair already
  // exists, send the user to the existing row with a hint.
  const existing = await prisma.company.findUnique({
    where: { atsType_atsToken: { atsType, atsToken: atsToken.trim() } },
  });
  if (existing) {
    return redirectWithFlash(
      c,
      'err',
      `${atsType} "${atsToken}" already exists as "${existing.name}".`,
    );
  }

  await prisma.company.create({
    data: {
      name: name.trim(),
      atsType,
      atsToken: atsToken.trim(),
      careerUrl: careerUrl && careerUrl.length > 0 ? careerUrl : null,
      active: true,
    },
  });

  return redirectWithFlash(
    c,
    'ok',
    `Added "${name}" — probe found ${probe.jobsCount ?? 0} jobs total.`,
  );
});

// --- helpers ----------------------------------------------------------------

function redirectWithFlash(
  c: Context,
  kind: 'ok' | 'err',
  text: string,
): Response {
  const value = encodeURIComponent(JSON.stringify({ kind, text }));
  const cookie = `flash=${value}; Path=/; Max-Age=${FLASH_TTL_SECONDS}; HttpOnly; SameSite=Lax`;
  return new Response(null, {
    status: 303,
    headers: { Location: '/companies', 'Set-Cookie': cookie },
  });
}

function parseFlashCookie(
  cookieHeader: string | undefined,
): { kind: 'ok' | 'err'; text: string } | null {
  if (!cookieHeader) return null;
  const match = /(?:^|;\s*)flash=([^;]+)/.exec(cookieHeader);
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1]));
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed.kind === 'ok' || parsed.kind === 'err') &&
      typeof parsed.text === 'string'
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function clearFlashCookie(): string {
  return 'flash=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
}
