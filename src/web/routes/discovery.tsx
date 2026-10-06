/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { idParam } from '../params';
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
import { t } from '../../i18n/t';

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
    t(!settings.discoveryEnabled ? 'discovery.flash.autoEnabled' : 'discovery.flash.autoDisabled'),
  );
});

discoveryRoute.post('/discovery/hn-parser-toggle', async (c) => {
  const settings = await getSettings();
  await setHnParserEnabled(!settings.hnParserEnabled);
  return flashRedirect('/discovery', 'ok',
    t(!settings.hnParserEnabled ? 'discovery.flash.hnEnabled' : 'discovery.flash.hnDisabled'),
  );
});

discoveryRoute.post('/discovery/hn-run', (c) => {
  if (hnRunInFlight) {
    return flashRedirect('/discovery', 'err', t('discovery.flash.hnRunning'));
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
    t('discovery.flash.hnStarted'),
  );
});

discoveryRoute.post('/discovery/:id/promote', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text(t('http.badId'), 400);
  try {
    await promoteCandidate(id);
  } catch (err) {
    // The one throw is "Candidate N not found": someone reviewed it in another tab.
    const reason = err instanceof Error ? err.message : t('discovery.flash.noReason');
    return flashRedirect('/discovery', 'err',
      t('discovery.flash.promoteFailed', { reason }),
    );
  }
  return flashRedirect('/discovery', 'ok',
    t('discovery.flash.promoted'),
  );
});

discoveryRoute.post('/discovery/:id/ignore', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text(t('http.badId'), 400);
  if (!(await ignoreCandidate(id))) return flashRedirect('/discovery', 'warn', t('discovery.flash.gone'));
  return flashRedirect('/discovery', 'ok', t('discovery.flash.ignored'));
});

discoveryRoute.post('/discovery/:id/delete', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text(t('http.badId'), 400);
  if (!(await deleteCandidate(id))) return flashRedirect('/discovery', 'warn', t('discovery.flash.gone'));
  return flashRedirect('/discovery', 'ok', t('discovery.flash.deleted'));
});

discoveryRoute.post('/discovery/probe-now', (c) => {
  if (probeInFlight) {
    return flashRedirect('/discovery', 'err',
      t('discovery.flash.probeRunning'),
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
    t('discovery.flash.probeStarted'),
  );
});
