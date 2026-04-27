/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { prisma } from '../../db';
import { RunsPage } from '../pages/runs';

const RUNS_LIMIT = 100;

export const runsRoute = new Hono();

runsRoute.get('/runs', async (c) => {
  const runs = await prisma.cronRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: RUNS_LIMIT,
  });
  return c.html(<RunsPage runs={runs} />);
});
