/** @jsxImportSource hono/jsx */
import { Hono, type Context } from 'hono';
import { CandidateStatus } from '@prisma/client';
import { logger } from '../../logger';
import {
  deleteCandidate,
  ignoreCandidate,
  listCandidates,
  promoteCandidate,
} from '../../discovery';
import { getSettings } from '../../settings';
import { recordCronRun } from '../../jobs/cron-run';
import { runDiscoveryJob } from '../../jobs/discovery-job';
import { DiscoveryPage } from '../pages/discovery';

const FLASH_TTL_SECONDS = 5;

let probeInFlight = false;

export const discoveryRoute = new Hono();

discoveryRoute.get('/discovery', async (c) => {
  const [settings, pending, promoted, ignored, dead] = await Promise.all([
    getSettings(),
    listCandidates(CandidateStatus.PENDING),
    listCandidates(CandidateStatus.PROMOTED),
    listCandidates(CandidateStatus.IGNORED),
    listCandidates(CandidateStatus.DEAD),
  ]);
  const flash = parseFlashCookie(c.req.header('cookie'));
  return c.html(
    <DiscoveryPage
      discoveryEnabled={settings.discoveryEnabled}
      pending={pending}
      promoted={promoted}
      ignored={ignored}
      dead={dead}
      flash={flash}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

discoveryRoute.post('/discovery/:id/promote', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  try {
    await promoteCandidate(id);
  } catch (err) {
    return redirectWithFlash(
      c,
      'err',
      err instanceof Error ? err.message : 'Promote failed.',
    );
  }
  return redirectWithFlash(
    c,
    'ok',
    'Promoted to active company. Next fetch tick will pull its jobs.',
  );
});

discoveryRoute.post('/discovery/:id/ignore', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  await ignoreCandidate(id);
  return redirectWithFlash(c, 'ok', 'Marked as ignored.');
});

discoveryRoute.post('/discovery/:id/delete', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  await deleteCandidate(id);
  return redirectWithFlash(c, 'ok', 'Candidate deleted.');
});

discoveryRoute.post('/discovery/probe-now', (c) => {
  if (probeInFlight) {
    return redirectWithFlash(
      c,
      'err',
      'A discovery probe is already running. Watch /runs.',
    );
  }
  probeInFlight = true;
  void (async () => {
    try {
      await recordCronRun('discovery', runDiscoveryJob);
    } catch (err) {
      logger.error({ err }, 'discovery (manual): failed');
    } finally {
      probeInFlight = false;
    }
  })();
  return redirectWithFlash(
    c,
    'ok',
    'Discovery probe started. Track progress at /runs.',
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
    headers: { Location: '/discovery', 'Set-Cookie': cookie },
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
