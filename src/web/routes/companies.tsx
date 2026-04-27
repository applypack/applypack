/** @jsxImportSource hono/jsx */
import { Hono, type Context } from 'hono';
import { AtsType, JobStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { logger } from '../../logger';
import { probeAts } from '../../ats-probe';
import { CompaniesPage } from '../pages/companies';

const FLASH_TTL_SECONDS = 5;

const NewCompanySchema = z.object({
  name: z.string().min(1).max(100),
  atsType: z.enum([
    AtsType.GREENHOUSE,
    AtsType.LEVER,
    AtsType.ASHBY,
  ] as const),
  atsToken: z.string().min(1).max(120),
  careerUrl: z.string().url().optional().or(z.literal('')),
});

export const companiesRoute = new Hono();

companiesRoute.get('/companies', async (c) => {
  const companies = await prisma.company.findMany({
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

  const flash = parseFlashCookie(c.req.header('cookie'));
  return c.html(<CompaniesPage companies={rows} flash={flash} />, 200, {
    'Set-Cookie': clearFlashCookie(),
  });
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
