/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { JobStatus } from '@prisma/client';
import { prisma } from '../../db';
import { CompaniesPage } from '../pages/companies';

export const companiesRoute = new Hono();

companiesRoute.get('/companies', async (c) => {
  const companies = await prisma.company.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: {
      _count: {
        select: {
          jobs: true,
        },
      },
      jobs: {
        select: { fetchedAt: true, status: true },
        orderBy: { fetchedAt: 'desc' },
        take: 1,
      },
    },
  });

  // Per-company alerted counts (single roundtrip).
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

  return c.html(<CompaniesPage companies={rows} />);
});

companiesRoute.post('/companies/:id/toggle-active', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);

  const current = await prisma.company.findUnique({
    where: { id },
    select: { active: true },
  });
  if (!current) return c.text('Not found', 404);

  await prisma.company.update({
    where: { id },
    data: { active: !current.active },
  });
  return c.redirect('/companies', 303);
});
