/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { JobStatus, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { logger } from '../../logger';
import { classifyWithClaude } from '../../classifier';
import { getActiveProfile } from '../../profiles';
import { JobsListPage } from '../pages/jobs-list';
import { JobDetailPage } from '../pages/job-detail';

const PAGE_SIZE = 50;

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  status: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v))
    .refine(
      (v) =>
        v === undefined || ['NEW', 'ALERTED', 'APPLIED', 'SAVED', 'DISMISSED'].includes(v),
      { message: 'invalid status' },
    ),
  minFit: z
    .string()
    .optional()
    .transform((v) => (v === '' || v === undefined ? '' : v)),
  q: z.string().optional().default(''),
  sort: z
    .enum(['fetchedAt_desc', 'fitScore_desc', 'postedAt_desc', 'title_asc'])
    .default('fetchedAt_desc'),
});

const StatusBodySchema = z.object({
  status: z.enum(['NEW', 'ALERTED', 'APPLIED', 'SAVED', 'DISMISSED']),
});

export const jobsRoute = new Hono();

jobsRoute.get('/jobs', async (c) => {
  const parsed = ListQuerySchema.safeParse({
    page: c.req.query('page'),
    status: c.req.query('status'),
    minFit: c.req.query('minFit'),
    q: c.req.query('q'),
    sort: c.req.query('sort'),
  });
  if (!parsed.success) {
    return c.text('Invalid query', 400);
  }
  const { page, status, minFit, q, sort } = parsed.data;

  const where: Prisma.JobWhereInput = {};
  if (status) {
    where.status = status as JobStatus;
  }
  const minFitNum = minFit ? Number(minFit) : NaN;
  if (!Number.isNaN(minFitNum)) {
    where.fitScore = { gte: minFitNum };
  }
  if (q.trim().length > 0) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
    ];
  }

  const orderBy = sortToOrderBy(sort);

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { company: { select: { name: true } } },
    }),
    prisma.job.count({ where }),
  ]);

  return c.html(
    <JobsListPage
      jobs={jobs}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      filters={{
        status: status ?? '',
        minFit,
        q,
        sort,
      }}
    />,
  );
});

jobsRoute.get('/jobs/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);

  const job = await prisma.job.findUnique({
    where: { id },
    include: { company: { select: { id: true, name: true, atsType: true } } },
  });
  if (!job) return c.text('Not found', 404);

  const flashCookie = parseFlashCookie(c.req.header('cookie'));
  return c.html(<JobDetailPage job={job} flash={flashCookie} />, 200, {
    'Set-Cookie': clearFlashCookie(),
  });
});

jobsRoute.post('/jobs/:id/status', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);

  const form = await c.req.parseBody();
  const parsed = StatusBodySchema.safeParse({ status: form.status });
  if (!parsed.success) return c.text('Invalid status', 400);

  const data: Prisma.JobUpdateInput = { status: parsed.data.status };
  if (parsed.data.status === 'ALERTED' || parsed.data.status === 'APPLIED') {
    data.alertedAt = data.alertedAt ?? new Date();
  }

  await prisma.job.update({ where: { id }, data });
  return c.redirect(`/jobs/${id}`, 303);
});

jobsRoute.post('/jobs/:id/reclassify', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);

  const job = await prisma.job.findUnique({
    where: { id },
    include: { company: { select: { name: true } } },
  });
  if (!job) return c.text('Not found', 404);

  try {
    const profile = await getActiveProfile();
    if (!profile) {
      logger.warn({ jobId: id }, 'web: reclassify skipped — no active profile');
      return c.redirect(`/jobs/${id}`, 303);
    }
    const classification = await classifyWithClaude(
      {
        title: job.title,
        companyName: job.company.name,
        location: job.location,
        description: job.description,
        postedAt: job.postedAt,
      },
      profile,
    );
    if (!classification) {
      return c.redirect(`/jobs/${id}`, 303);
    }
    await prisma.job.update({
      where: { id },
      data: {
        fitScore: classification.fit_score,
        salaryMin: classification.salary_min_usd,
        salaryMax: classification.salary_max_usd,
        techMatch: classification.tech_match,
        redFlags: classification.red_flags,
        summary: classification.summary,
      },
    });
    return c.redirect(`/jobs/${id}`, 303);
  } catch (err) {
    logger.error({ err, jobId: id }, 'web: reclassify failed');
    return c.redirect(`/jobs/${id}`, 303);
  }
});

function sortToOrderBy(sort: string): Prisma.JobOrderByWithRelationInput[] {
  switch (sort) {
    case 'fitScore_desc':
      return [{ fitScore: { sort: 'desc', nulls: 'last' } }, { fetchedAt: 'desc' }];
    case 'postedAt_desc':
      return [{ postedAt: 'desc' }];
    case 'title_asc':
      return [{ title: 'asc' }];
    case 'fetchedAt_desc':
    default:
      return [{ fetchedAt: 'desc' }];
  }
}

function parseFlashCookie(
  cookieHeader: string | undefined,
): { kind: 'ok' | 'err'; text: string } | null {
  if (!cookieHeader) return null;
  const match = /(?:^|;\s*)flash=([^;]+)/.exec(cookieHeader);
  if (!match || !match[1]) return null;
  try {
    const decoded = decodeURIComponent(match[1]);
    const parsed = JSON.parse(decoded);
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
