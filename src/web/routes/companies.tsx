/** @jsxImportSource hono/jsx */
import { Hono, type Context } from 'hono';
import { AtsType, JobStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { logger } from '../../logger';
import { probeAts } from '../../ats-probe';
import { toStringArray } from '../../text-utils';
import {
  companiesInSegments,
  countsBySegment,
  findCompany,
  segments as packSegments,
} from '../../starter-packs/catalog';
import { resolvePack } from '../../starter-packs/probe';
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
  ] as const),
  atsToken: z.string().min(1).max(120),
  careerUrl: z.string().url().optional().or(z.literal('')),
});

export const companiesRoute = new Hono();

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

  const rows = companies.map((c) => ({
    id: c.id,
    name: c.name,
    atsType: c.atsType,
    atsToken: c.atsToken,
    active: c.active,
    careerUrl: c.careerUrl,
    jobsTotal: c._count.jobs,
    alertedTotal: alertedMap.get(c.id) ?? 0,
    lastFetchedAt: c.jobs[0]?.fetchedAt ?? null,
  }));

  const counts = countsBySegment();
  const packs = packSegments().map((s) => ({
    ...s,
    count: counts.get(s.id) ?? 0,
  }));

  const flash = parseFlashCookie(c.req.header('cookie'));
  return c.html(
    <CompaniesPage companies={rows} packs={packs} flash={flash} />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
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
