import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CronRunStatus } from '@prisma/client';
import { config } from './config';
import { prisma } from './db';
import { logger } from './logger';
import { runSeed } from './seed';
import {
  addTelegramTarget,
  getSettings,
  listTelegramTargets,
  setTelegramEnabled,
} from './settings';
import { createProfile, listProfiles, setActiveProfile } from './profiles';

export async function init(): Promise<void> {
  applySchema();

  logger.info('init: pinging database');
  await prisma.$queryRaw`SELECT 1`;

  await failInterruptedCronRuns();

  logger.info('init: seeding companies');
  const seeded = await runSeed();
  logger.info(seeded, 'init: seed complete');

  await bootstrapDefaultProfile();
  await bootstrapTelegramFromEnv();
}

/**
 * A RUNNING CronRun at worker boot is a run the previous process died
 * under (issue #18) — only this process starts cron jobs, so nothing can
 * legitimately be RUNNING before registerCron. The one near-miss is a
 * web-owned reclassify-all in flight during a worker restart; its final
 * update still lands and overwrites this verdict.
 */
async function failInterruptedCronRuns(): Promise<void> {
  const stale = await prisma.cronRun.updateMany({
    where: { status: CronRunStatus.RUNNING },
    data: {
      status: CronRunStatus.FAILED,
      finishedAt: new Date(),
      errorMessage: 'interrupted',
    },
  });
  if (stale.count > 0) {
    logger.warn({ count: stale.count }, 'init: marked interrupted cron runs FAILED');
  }
}

/**
 * On first boot, if no Profile exists, seed a blank starter profile with
 * only stack-neutral defaults, pulling MIN_FIT_SCORE / MIN_SALARY_USD from
 * .env. The user shapes it on /settings → Profile — fastest via
 * "Fill from a resume". After this, the /settings page is the source of truth.
 */
async function bootstrapDefaultProfile(): Promise<void> {
  const existing = await listProfiles();
  if (existing.length > 0) return;

  const profile = await createProfile({
    name: 'My profile',
    stackRequired: [],
    roleTypes: [],
    stackNiceToHave: [],
    stackExclude: [
      'junior',
      'intern',
      'internship',
      'entry-level',
      'entry level',
      'apprentice',
    ],
    notes: null,
    seniority: [],
    resumeId: null,
    remoteOk: true,
    remoteRegions: [],
    onsiteCities: [],
    hybridOk: false,
    minSalaryUsd: config.MIN_SALARY_USD,
    minFitScore: config.MIN_FIT_SCORE,
    telegramTargetId: null,
    priorityRules: [],
  });
  await setActiveProfile(profile.id);
  logger.info(
    { profileId: profile.id, name: profile.name },
    'init: bootstrapped default profile; manage via /settings',
  );
}

/**
 * On first boot, if .env contains TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID and
 * the settings table has no targets yet, import them as a single target and
 * enable telegram. After this, .env values are no longer consulted at runtime
 * — the dashboard / Settings page is the source of truth.
 */
async function bootstrapTelegramFromEnv(): Promise<void> {
  const existing = await listTelegramTargets();
  if (existing.length > 0) return;
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;

  await addTelegramTarget({
    name: 'from .env',
    botToken: config.TELEGRAM_BOT_TOKEN,
    chatId: config.TELEGRAM_CHAT_ID,
  });
  const settings = await getSettings();
  if (!settings.telegramEnabled) {
    await setTelegramEnabled(true);
  }
  logger.info(
    'init: bootstrapped Telegram target from .env; manage via /settings now',
  );
}

function applySchema(): void {
  const migrationsDir = resolve(process.cwd(), 'prisma', 'migrations');
  if (existsSync(migrationsDir)) {
    logger.info('init: running prisma migrate deploy');
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      env: process.env,
    });
    return;
  }
  logger.info(
    'init: no migrations folder found — running prisma db push (Phase 1)',
  );
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    stdio: 'inherit',
    env: process.env,
  });
}
