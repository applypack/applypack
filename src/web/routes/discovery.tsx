/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { CandidateStatus } from '@prisma/client';
import { logger } from '../../logger';
import {
  deleteCandidate,
  ignoreCandidate,
  listCandidates,
  promoteCandidate,
} from '../../discovery';
import { getSettings, setDiscoveryEnabled, setHnParserEnabled } from '../../settings';
import { recordCronRun } from '../../jobs/cron-run';
import { runDiscoveryJob } from '../../jobs/discovery-job';
import { runHnHiringJob } from '../../jobs/hn-hiring-job';
import { DiscoveryPage } from '../pages/discovery';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';

let probeInFlight = false;
let hnRunInFlight = false;

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
      hnParserEnabled={settings.hnParserEnabled}
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

discoveryRoute.post('/discovery/toggle', async (c) => {
  const settings = await getSettings();
  await setDiscoveryEnabled(!settings.discoveryEnabled);
  return flashRedirect('/discovery', 'ok',
    `Auto-discovery ${!settings.discoveryEnabled ? 'enabled' : 'disabled'}.`,
  );
});

discoveryRoute.post('/discovery/hn-parser-toggle', async (c) => {
  const settings = await getSettings();
  await setHnParserEnabled(!settings.hnParserEnabled);
  return flashRedirect('/discovery', 'ok',
    `HN "Who is hiring" parser ${!settings.hnParserEnabled ? 'enabled' : 'disabled'}.`,
  );
});

discoveryRoute.post('/discovery/hn-run', (c) => {
  if (hnRunInFlight) {
    return flashRedirect('/discovery', 'err', 'An HN parse run is already in progress. Watch /runs.');
  }
  hnRunInFlight = true;
  void (async () => {
    try {
      await recordCronRun('hn-hiring', runHnHiringJob);
    } catch (err) {
      logger.error({ err }, 'hn-hiring (manual trigger): failed');
    } finally {
      hnRunInFlight = false;
    }
  })();
  return flashRedirect('/discovery', 'ok',
    'HN parse started in the background. Track progress at /runs.',
  );
});

discoveryRoute.post('/discovery/:id/promote', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  try {
    await promoteCandidate(id);
  } catch (err) {
    return flashRedirect('/discovery', 'err',
      err instanceof Error ? err.message : 'Promote failed.',
    );
  }
  return flashRedirect('/discovery', 'ok',
    'Promoted to active company. Next fetch tick will pull its jobs.',
  );
});

discoveryRoute.post('/discovery/:id/ignore', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  await ignoreCandidate(id);
  return flashRedirect('/discovery', 'ok', 'Marked as ignored.');
});

discoveryRoute.post('/discovery/:id/delete', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  await deleteCandidate(id);
  return flashRedirect('/discovery', 'ok', 'Candidate deleted.');
});

discoveryRoute.post('/discovery/probe-now', (c) => {
  if (probeInFlight) {
    return flashRedirect('/discovery', 'err',
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
  return flashRedirect('/discovery', 'ok',
    'Discovery probe started. Track progress at /runs.',
  );
});
