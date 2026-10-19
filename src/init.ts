import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CronRunStatus } from '@prisma/client';
import { config } from './config';
import { isDiscordWebhookUrl } from './notify/discord';
import { prisma } from './db';
import { logger } from './logger';
import { PRISMA_CLI_ENV } from './prisma-env';
import { runSeed } from './seed';
import { fillEmployerKeys } from './jobs/employer-store';
import { unlinkOtherRoles } from './jobs/cross-listing-store';
import { fillUnnamedModels } from './ai-ledger';
import {
  addNotificationTarget,
  getSettings,
  listNotificationTargets,
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
  await bootstrapTargetsFromEnv();
  // ADR 0056, once per install: a failure leaves the flag unset, so the next
  // boot tries again, and the worker starts either way.
  await fillEmployerKeys().catch((err: unknown) => logger.warn({ err }, 'init: employer keys not filled; the next boot tries again'));
  await unlinkOtherRoles().catch((err: unknown) => logger.warn({ err }, 'init: cross-listings not checked; the next boot tries again'));
  await fillUnnamedModels().catch((err: unknown) => logger.warn({ err }, 'init: unnamed AI calls not filled; the next boot tries again'));
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
 * .env. The user shapes it on /settings → Searches — fastest via
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
    countries: [],
    regions: [],
    workplace: ['REMOTE'],
    residence: null,
    relocation: 'no',
    onsiteCities: [],
    minSalaryUsd: config.MIN_SALARY_USD,
    minFitScore: config.MIN_FIT_SCORE,
    notificationTargetId: null,
    priorityRules: [],
  });
  await setActiveProfile(profile.id);
  logger.info(
    { profileId: profile.id, name: profile.name },
    'init: bootstrapped default profile; manage via /settings',
  );
}

/**
 * On first boot, if .env names a Telegram bot + chat or a Discord webhook and
 * the settings table has no targets yet, import them and enable alerts. After
 * this, .env values are no longer consulted at runtime — the dashboard /
 * Settings page is the source of truth (ADR 0041).
 */
async function bootstrapTargetsFromEnv(): Promise<void> {
  const existing = await listNotificationTargets();
  if (existing.length > 0) return;
  let added = 0;
  if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
    // Null = another boot of the same compose stack got there first.
    const target = await addNotificationTarget({
      kind: 'TELEGRAM',
      name: 'from .env',
      botToken: config.TELEGRAM_BOT_TOKEN,
      chatId: config.TELEGRAM_CHAT_ID,
    });
    if (target) added++;
  }
  if (config.DISCORD_WEBHOOK_URL) {
    if (isDiscordWebhookUrl(config.DISCORD_WEBHOOK_URL)) {
      const target = await addNotificationTarget({ kind: 'DISCORD', name: 'Discord from .env', webhookUrl: config.DISCORD_WEBHOOK_URL });
      if (target) added++;
    } else {
      logger.warn('init: DISCORD_WEBHOOK_URL is not a Discord webhook URL; ignored');
    }
  }
  if (added === 0) return;
  const settings = await getSettings();
  if (!settings.telegramEnabled) {
    await setTelegramEnabled(true);
  }
  logger.info({ added }, 'init: bootstrapped notification targets from .env; manage via /settings now');
}

/** The tables this release expects, created or brought up to date — every boot, and `npm run db:import` before the rows go in. */
export function applySchema(): void {
  const migrationsDir = resolve(process.cwd(), 'prisma', 'migrations');
  if (existsSync(migrationsDir)) {
    logger.info('init: running prisma migrate deploy');
    const out = runPrisma('npx prisma migrate deploy');
    logger.info({ applied: out.match(/^Applying migration/gm)?.length ?? 0 }, 'init: schema up to date');
    return;
  }
  logger.info(
    'init: no migrations folder found — running prisma db push (Phase 1)',
  );
  runPrisma('npx prisma db push --skip-generate --accept-data-loss');
}

/**
 * A Prisma command with its output kept back: a first `npm start` printed a
 * line for each of a hundred migrations. Its own words are the diagnosis, so
 * they are shown when it fails.
 */
function runPrisma(command: string): string {
  try {
    return execSync(command, { env: { ...process.env, ...PRISMA_CLI_ENV }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const { stdout, stderr } = err as { stdout?: string; stderr?: string };
    process.stderr.write(`${stdout ?? ''}${stderr ?? ''}`);
    throw err;
  }
}
