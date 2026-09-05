import { config } from '../config';
import { logger } from '../logger';
import { sendDigest, sendAlert } from '../notifier';
import { listNotificationTargets } from '../settings';
import type { AlertJob } from '../types';

const TELEGRAM_API = 'https://api.telegram.org';

async function ping(): Promise<void> {
  if (!config.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN not set in .env');
  }
  const url = `${TELEGRAM_API}/bot${config.TELEGRAM_BOT_TOKEN}/getMe`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`getMe failed: ${resp.status} ${body}`);
  }
  const data = (await resp.json()) as {
    ok: boolean;
    result?: { username?: string; first_name?: string; id?: number };
  };
  if (!data.ok) {
    throw new Error(`getMe response not ok: ${JSON.stringify(data)}`);
  }
  logger.info(
    {
      bot: data.result?.username,
      name: data.result?.first_name,
      id: data.result?.id,
    },
    'telegram: getMe ok',
  );
}

const fakeAlert: AlertJob = {
  title: 'Senior PHP/Laravel Engineer (Test)',
  companyName: 'ACME Corp',
  location: 'Remote · United States',
  url: 'https://example.com/jobs/12345?utm=test&q=1',
  fitScore: 87,
  salaryMin: 140000,
  salaryMax: 180000,
  techMatch: ['php', 'laravel', 'react', 'postgres'],
  redFlags: ['no-salary-listed'],
  summary:
    'Strong senior remote-US PHP/Laravel match with explicit React experience and a clear US-eligible remote policy.',
  // ADR 0028: the search that wanted it, and what the others made of it.
  matchedProfile: 'PHP/Laravel Backend',
  profileScores: 'PHP/Laravel Backend 87 · QA Automation 41',
};

const fakeAlert2: AlertJob = {
  title: 'Staff Backend Engineer — PHP',
  companyName: 'Globex',
  location: 'Remote · Americas',
  url: 'https://example.com/jobs/67890',
  fitScore: 78,
  salaryMin: 160000,
  salaryMax: null,
  techMatch: ['php', 'symfony', 'aws'],
  redFlags: [],
  summary: 'Solid staff role; stack matches but salary range only partially disclosed.',
  matchedProfile: 'PHP/Laravel Backend',
};

async function main(): Promise<void> {
  logger.info('test-telegram: step 1/5 — getMe');
  await ping();

  logger.info('test-telegram: step 2/5 — plain text');
  // Plain text via the notifier — this exercises the "no jobs" digest path.
  await sendDigest([]);

  logger.info('test-telegram: step 3/5 — single job alert');
  await sendAlert(fakeAlert);

  logger.info('test-telegram: step 4/5 — digest with 2 jobs');
  await sendDigest([fakeAlert, fakeAlert2]);

  // ADR 0028: an alert carries the winning search's target id, so a search
  // with its own chat is delivered only there. Broadcasting instead would be
  // silent breakage — every chat still gets a message — so it is exercised
  // against a real target rather than left to a unit test.
  logger.info('test-telegram: step 5/5 — alert routed to one target');
  const targets = (await listNotificationTargets()).filter((t) => t.active);
  if (targets.length === 0) {
    logger.warn('test-telegram: no active targets; routing step skipped');
  } else {
    const target = targets[0]!;
    logger.info({ target: target.name, id: target.id }, 'test-telegram: routing to');
    await sendAlert(
      { ...fakeAlert, title: `Routed to "${target.name}" only (Test)` },
      target.id,
    );
  }

  logger.info('test-telegram: done');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'test-telegram: failed');
    process.exit(1);
  });
