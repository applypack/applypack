import { Hono } from 'hono';
import { prisma } from '../../db';
import { logger } from '../../logger';

export const healthRoute = new Hono();

healthRoute.get('/health', async (c) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    // The driver's message names the host, port and user; the log gets it, the caller gets the fact.
    logger.error({ err }, 'health: database unreachable');
    return c.json({ ok: false, db: 'down' }, 503);
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
