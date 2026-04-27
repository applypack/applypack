import { Hono } from 'hono';
import { prisma } from '../../db';

export const healthRoute = new Hono();

healthRoute.get('/health', async (c) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    return c.json(
      { ok: false, db: 'down', error: err instanceof Error ? err.message : 'unknown' },
      503,
    );
  }
  const lastFetch = await prisma.cronRun.findFirst({
    where: { name: 'fetch' },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true, status: true },
  });
  return c.json({
    ok: true,
    db: 'up',
    lastFetch: lastFetch
      ? { at: lastFetch.startedAt.toISOString(), status: lastFetch.status }
      : null,
  });
});
