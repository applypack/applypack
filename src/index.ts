import cron from 'node-cron';
import { config } from './config';
import { logger } from './logger';
import { prisma } from './db';
import { init } from './init';
import { runFetchJob } from './jobs/fetch-job';
import { runDigestJob } from './jobs/digest-job';
import { runCleanupJob } from './jobs/cleanup-job';
import { runStaleApplicationsJob } from './jobs/stale-applications-job';
import { runHnHiringJob } from './jobs/hn-hiring-job';
import { runDiscoveryJob } from './jobs/discovery-job';
import { recordCronRun, type CronStats } from './jobs/cron-run';
import { spreadMinute } from './schedule';
import { getInstanceId, getSchedule } from './settings';
import { isDigestHour, isFirstDigestHour, type Schedule } from './user-schedule';

const SHUTDOWN_POLL_MS = 250;
const SHUTDOWN_MAX_WAIT_MS = 60_000;

let inFlight = 0;
let shuttingDown = false;
/** This install's identity — read once in main(), before anything registers. */
let instanceId = '';

async function main(): Promise<void> {
  await init();

  // Every install ships the same seed data; without this they would all ask
  // the same board in the same second (docs/scale-plan.md §2).
  instanceId = await getInstanceId();

  registerCron('5 * * * *', 'fetch', () => recordCronRun('fetch', runFetchJob));
  // Both daily summaries follow the one "digest time" the user picks
  // (TASKS §16.4), so the heartbeat is hourly and the hour decides. They read
  // that hour differently: the recap is a window and goes out at every digest
  // time, the nudge is a standing state and goes out at the first one.
  registerCron('0 * * * *', 'digest', () => onSchedule('digest', isDigestHour, runDigestJob));
  registerCron('0 3 * * 0', 'cleanup', () => recordCronRun('cleanup', runCleanupJob));
  registerCron('0 * * * *', 'stale-applications', () =>
    onSchedule('stale-applications', isFirstDigestHour, runStaleApplicationsJob),
  );
  // 06:00 Chicago on the 1st of each month (Who-is-hiring threads land
  // around the 1st-2nd of the month).
  registerCron('0 6 1 * *', 'hn-hiring', () =>
    recordCronRun('hn-hiring', runHnHiringJob),
  );
  // Sunday 04:00 Chicago: re-probe pending candidates so /discovery shows
  // accurate jobsSeen and dead candidates fall off the review list.
  registerCron('0 4 * * 0', 'discovery', () =>
    recordCronRun('discovery', runDiscoveryJob),
  );

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  logger.info({ tz: config.TZ }, 'applypack: cron registered, idle');
}

/**
 * The daily summaries beat hourly and do their work on the hours `due` picks.
 * Unlike the fetch tick, a beat that is not one writes no run row: twenty-three
 * "skipped" lines a day on /runs would be noise, not evidence, and CronRun
 * rows are never trimmed.
 */
async function onSchedule(
  name: string,
  due: (now: Date, schedule: Schedule) => boolean,
  fn: () => Promise<{ stats: CronStats }>,
): Promise<void> {
  const schedule = await getSchedule();
  if (!due(new Date(), schedule)) return;
  await recordCronRun(name, fn);
}

function registerCron(
  expression: string,
  name: string,
  fn: () => Promise<void>,
): void {
  const schedule = spreadMinute(expression, instanceId, name);
  cron.schedule(
    schedule,
    async () => {
      if (shuttingDown) {
        logger.warn({ name }, 'cron: skipping (shutting down)');
        return;
      }
      inFlight++;
      const started = Date.now();
      logger.info({ name }, 'cron: tick start');
      try {
        await fn();
      } catch (err) {
        logger.error({ err, name }, 'cron: tick failed');
      } finally {
        inFlight--;
        logger.info(
          { name, durationMs: Date.now() - started },
          'cron: tick end',
        );
      }
    },
    { timezone: config.TZ },
  );
  logger.info({ name, schedule, tz: config.TZ }, 'cron: registered');
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal, inFlight }, 'shutdown: waiting for in-flight jobs');

  const deadline = Date.now() + SHUTDOWN_MAX_WAIT_MS;
  while (inFlight > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, SHUTDOWN_POLL_MS));
  }
  if (inFlight > 0) {
    logger.warn({ inFlight }, 'shutdown: deadline reached, forcing exit');
  }

  try {
    await prisma.$disconnect();
  } catch (err) {
    logger.error({ err }, 'shutdown: prisma disconnect failed');
  }
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'fatal: startup failed');
  process.exit(1);
});
