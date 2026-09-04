import { AtsType } from '@prisma/client';
import type { Prisma, TelegramTarget } from '@prisma/client';
import { prisma } from './db';
import { logger } from './logger';
import type { AiEngineConfig } from './ai-engine';
import { parseAiKeys, type AiKeyProviderId, type AiKeys } from './ai-keys';
import { parseSourceKeys, type KeyedSource, type SourceKeyField, type SourceKeys } from './source-keys';
import { parseSchedule, type Schedule } from './user-schedule';
import { config } from './config';

export const SETTINGS_ID = 1;
const TELEGRAM_API = 'https://api.telegram.org';
const TELEGRAM_TIMEOUT_MS = 10_000;

export type ClassifierMode = 'single' | 'two_stage';

export interface AppSettingsView {
  telegramEnabled: boolean;
  classifierMode: ClassifierMode;
  applicationTrackingEnabled: boolean;
  staleApplicationsDigestEnabled: boolean;
  hnParserEnabled: boolean;
  disabledSources: string[];
  discoveryEnabled: boolean;
  fetchingEnabled: boolean;
  /** One digest line when a source crosses the failure streak (ADR 0019). */
  sourceHealthAlerts: boolean;
  /** Raw AppSettings.aiEngine JSON — parse with parseAiEngineConfig. */
  aiEngine: unknown;
  /** Raw AppSettings.aiUsage JSON — summarize with summarizeAiUsage. */
  aiUsage: unknown;
  /** Raw AppSettings.coverAngles JSON — parse with readCoverAngles. */
  coverAngles: unknown;
  /** Raw AppSettings.pipelineStages JSON — parse with parseStageConfig (ADR 0025). */
  pipelineStages: unknown;
  /** Raw AppSettings.schedule JSON — parse with parseSchedule (TASKS §16). */
  schedule: unknown;
  /** NULL until the first-run wizard finishes or is skipped — `/` redirects to /welcome meanwhile. */
  setupCompletedAt: Date | null;
  updatedAt: Date;
}

/**
 * Creates the singleton AppSettings row if it is missing. Callers that reach
 * for it with raw SQL — an atomic `jsonb_set`, a `FOR UPDATE` lock — need the
 * row to exist first: an UPDATE or a lock over nothing is a silent no-op.
 */
export async function ensureSettingsRow(): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
}

/**
 * Returns the singleton AppSettings row, creating it with defaults if missing.
 */
export async function getSettings(): Promise<AppSettingsView> {
  const row = await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
  return {
    telegramEnabled: row.telegramEnabled,
    classifierMode: normaliseClassifierMode(row.classifierMode),
    applicationTrackingEnabled: row.applicationTrackingEnabled,
    staleApplicationsDigestEnabled: row.staleApplicationsDigestEnabled,
    hnParserEnabled: row.hnParserEnabled,
    disabledSources: row.disabledSources,
    discoveryEnabled: row.discoveryEnabled,
    fetchingEnabled: row.fetchingEnabled,
    sourceHealthAlerts: row.sourceHealthAlerts,
    aiEngine: row.aiEngine,
    aiUsage: row.aiUsage,
    coverAngles: row.coverAngles,
    pipelineStages: row.pipelineStages,
    schedule: row.schedule,
    setupCompletedAt: row.setupCompletedAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * This install's identity (docs/scale-plan.md §2). Read at worker boot to
 * pick the cron minute; deliberately outside AppSettingsView, because
 * nothing renders it and nothing else has any business with it.
 */
export async function getInstanceId(): Promise<string> {
  const row = await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
    select: { instanceId: true },
  });
  return row.instanceId;
}

/** Marks the first-run wizard as finished (or skipped); `/` stops redirecting. */
export async function setSetupCompleted(): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { setupCompletedAt: new Date() },
    create: { id: SETTINGS_ID, setupCompletedAt: new Date() },
  });
  logger.info('settings: setup marked complete');
}

/**
 * Standing cover-letter angle inputs (F8.1) — written on every generation,
 * prefilled into the card on every job page, so the user types them once.
 */
export async function setCoverAngles(angles: {
  whyCompany?: string;
  problem?: string;
  approach?: string;
  notes?: string;
}): Promise<void> {
  const value = JSON.parse(JSON.stringify(angles)) as Prisma.InputJsonValue;
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { coverAngles: value },
    create: { id: SETTINGS_ID, coverAngles: value },
  });
}

/** The board's work columns (ADR 0025) — always a full, validated list. */
export async function setPipelineStages(
  stages: { key: string; label: string }[],
): Promise<void> {
  const value = JSON.parse(JSON.stringify(stages)) as Prisma.InputJsonValue;
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { pipelineStages: value },
    create: { id: SETTINGS_ID, pipelineStages: value },
  });
}

export async function setAiEngineConfig(engine: AiEngineConfig): Promise<void> {
  const value = engine as unknown as Prisma.InputJsonValue;
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { aiEngine: value },
    create: { id: SETTINGS_ID, aiEngine: value },
  });
  logger.info({ engine }, 'settings: ai engine updated');
}

/**
 * The pasted per-engine credentials (ADR 0027). Deliberately NOT part of
 * AppSettingsView: a secret is only ever read by the code that is about to
 * use it, so an ordinary settings read can never carry one into a log line
 * or a rendered page.
 */
export async function getAiKeys(): Promise<AiKeys> {
  const row = await prisma.appSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { aiKeys: true },
  });
  return parseAiKeys(row?.aiKeys ?? null);
}

/**
 * Stores a pasted key, or removes it when `key` is blank. Logs the engine only.
 *
 * The merge is one SQL statement on purpose (issue #72). Read the map, merge
 * in memory, write the map back and two tabs saving two engines lose one of
 * them: the later write carries a snapshot taken before the earlier one. A
 * transaction around the same read and write would not help — Postgres runs
 * at Read Committed, so the read inside it still returns the version current
 * when it started. `jsonb_set` (and `-` for a removal) touches one path and
 * leaves every other engine's key exactly as the row has it, so the database
 * does the merge and there is no window to lose.
 */
export async function setAiKey(id: AiKeyProviderId, key: string): Promise<void> {
  const value = key.trim();
  // The statement below is an UPDATE, so the singleton row has to exist.
  await ensureSettingsRow();
  if (value.length === 0) {
    await prisma.$executeRaw`
      UPDATE app_settings SET "aiKeys" = COALESCE("aiKeys", '{}'::jsonb) - ${id}
      WHERE id = ${SETTINGS_ID}`;
  } else {
    await prisma.$executeRaw`
      UPDATE app_settings SET "aiKeys" =
        jsonb_set(COALESCE("aiKeys", '{}'::jsonb), ARRAY[${id}], to_jsonb(${value}::text), true)
      WHERE id = ${SETTINGS_ID}`;
  }
  logger.info({ provider: id, stored: value.length > 0 }, 'settings: ai key updated');
}

/** The keyed sources' credentials (ADR 0034) — same rules as getAiKeys: read only by the code about to use them. */
export async function getSourceKeys(): Promise<SourceKeys> {
  const row = await prisma.appSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { sourceKeys: true },
  });
  return parseSourceKeys(row?.sourceKeys ?? null);
}

/** Stores one field of one source's credential, or removes it when blank. One SQL merge, as setAiKey. */
export async function setSourceKey(source: KeyedSource, field: SourceKeyField, value: string): Promise<void> {
  const secret = value.trim();
  await ensureSettingsRow();
  if (secret.length === 0) {
    await prisma.$executeRaw`
      UPDATE app_settings SET "sourceKeys" =
        jsonb_set(COALESCE("sourceKeys", '{}'::jsonb), ARRAY[${source}],
          COALESCE("sourceKeys" -> ${source}, '{}'::jsonb) - ${field}, true)
      WHERE id = ${SETTINGS_ID}`;
  } else {
    // jsonb_set never creates the parent object, so the source's map is
    // put in place first — measured: a two-element path over '{}' is a
    // silent no-op, and the flash said "saved" over a row that had nothing.
    await prisma.$executeRaw`
      UPDATE app_settings SET "sourceKeys" =
        jsonb_set(
          jsonb_set(COALESCE("sourceKeys", '{}'::jsonb), ARRAY[${source}], COALESCE("sourceKeys" -> ${source}, '{}'::jsonb), true),
          ARRAY[${source}, ${field}], to_jsonb(${secret}::text), true)
      WHERE id = ${SETTINGS_ID}`;
  }
  logger.info({ source, field, stored: secret.length > 0 }, 'settings: source key updated');
}

/**
 * The schedule as the gate wants it: parsed, with `config.TZ` standing in for
 * a zone the user never chose. One read per heartbeat, so a change on
 * /settings takes effect on the next one (gotcha 9).
 */
export async function getSchedule(): Promise<Schedule> {
  const row = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID }, select: { schedule: true } });
  return parseSchedule(row?.schedule ?? null, config.TZ);
}

/** Stores the whole object — a schedule is only ever edited as one form. */
export async function setSchedule(schedule: Schedule): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { schedule },
    create: { id: SETTINGS_ID, schedule },
  });
  logger.info({ schedule }, 'settings: schedule updated');
}

export async function setTelegramEnabled(enabled: boolean): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { telegramEnabled: enabled },
    create: { id: SETTINGS_ID, telegramEnabled: enabled },
  });
}

export async function setClassifierMode(mode: ClassifierMode): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { classifierMode: mode },
    create: { id: SETTINGS_ID, classifierMode: mode },
  });
  logger.info({ mode }, 'settings: classifier mode set');
}

export async function setApplicationTrackingEnabled(enabled: boolean): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { applicationTrackingEnabled: enabled },
    create: { id: SETTINGS_ID, applicationTrackingEnabled: enabled },
  });
}

export async function setStaleApplicationsDigestEnabled(
  enabled: boolean,
): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { staleApplicationsDigestEnabled: enabled },
    create: { id: SETTINGS_ID, staleApplicationsDigestEnabled: enabled },
  });
}

export async function setHnParserEnabled(enabled: boolean): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { hnParserEnabled: enabled },
    create: { id: SETTINGS_ID, hnParserEnabled: enabled },
  });
}

export async function setDisabledSources(sources: string[]): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { disabledSources: sources },
    create: { id: SETTINGS_ID, disabledSources: sources },
  });
  logger.info({ disabled: sources }, 'settings: disabled sources updated');
}

export async function setDiscoveryEnabled(enabled: boolean): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { discoveryEnabled: enabled },
    create: { id: SETTINGS_ID, discoveryEnabled: enabled },
  });
}

export async function setFetchingEnabled(enabled: boolean): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { fetchingEnabled: enabled },
    create: { id: SETTINGS_ID, fetchingEnabled: enabled },
  });
  logger.info({ enabled }, enabled ? 'settings: job fetching resumed' : 'settings: job fetching paused');
}

/**
 * `disabledSources` is a free-form String[] column. Anything that is not a
 * live AtsType has to be dropped before it reaches a Prisma enum filter —
 * one stale value there throws and takes the whole job down with it.
 */
export function toAtsTypes(values: string[]): AtsType[] {
  const known = Object.values(AtsType) as string[];
  return values.filter((v): v is AtsType => known.includes(v));
}

export async function setSourceHealthAlerts(enabled: boolean): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { sourceHealthAlerts: enabled },
    create: { id: SETTINGS_ID, sourceHealthAlerts: enabled },
  });
}

function normaliseClassifierMode(raw: string): ClassifierMode {
  return raw === 'two_stage' ? 'two_stage' : 'single';
}

export async function listTelegramTargets(): Promise<TelegramTarget[]> {
  return prisma.telegramTarget.findMany({ orderBy: { id: 'asc' } });
}

export async function listActiveTelegramTargets(): Promise<TelegramTarget[]> {
  return prisma.telegramTarget.findMany({
    where: { active: true },
    orderBy: { id: 'asc' },
  });
}

export async function addTelegramTarget(input: {
  name: string;
  botToken: string;
  chatId: string;
}): Promise<TelegramTarget> {
  return prisma.telegramTarget.create({
    data: {
      name: input.name,
      botToken: input.botToken,
      chatId: input.chatId,
      active: true,
    },
  });
}

export async function toggleTelegramTarget(id: number): Promise<void> {
  const t = await prisma.telegramTarget.findUnique({ where: { id } });
  if (!t) return;
  await prisma.telegramTarget.update({
    where: { id },
    data: { active: !t.active },
  });
}

export async function deleteTelegramTarget(id: number): Promise<void> {
  await prisma.telegramTarget.delete({ where: { id } }).catch((err) => {
    logger.warn({ err, id }, 'settings: delete target failed (already gone?)');
  });
}

export async function markTargetUsed(id: number): Promise<void> {
  await prisma.telegramTarget
    .update({ where: { id }, data: { lastUsed: new Date() } })
    .catch(() => undefined);
}

export interface TelegramTestResult {
  ok: boolean;
  botUsername?: string;
  error?: string;
}

/**
 * Verifies a (token, chat) pair by calling getMe + sendMessage.
 * Returns success only if both calls return 200 + ok:true.
 */
export async function testTelegramTarget(
  botToken: string,
  chatId: string,
): Promise<TelegramTestResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const meResp = await fetch(`${TELEGRAM_API}/bot${botToken}/getMe`, {
      signal: ctrl.signal,
    });
    if (!meResp.ok) {
      const body = await meResp.text().catch(() => '');
      return { ok: false, error: `getMe failed: ${meResp.status} ${body.slice(0, 200)}` };
    }
    const meData = (await meResp.json()) as {
      ok: boolean;
      result?: { username?: string };
    };
    if (!meData.ok) {
      return { ok: false, error: 'getMe responded with ok=false' };
    }
    const botUsername = meData.result?.username;

    const sendResp = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '✅ ApplyPack test — this target is configured correctly.',
        disable_web_page_preview: true,
      }),
      signal: ctrl.signal,
    });
    if (!sendResp.ok) {
      const body = await sendResp.text().catch(() => '');
      return {
        ok: false,
        botUsername,
        error: `sendMessage failed: ${sendResp.status} ${body.slice(0, 200)}`,
      };
    }
    return { ok: true, botUsername };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'unknown error',
    };
  } finally {
    clearTimeout(timer);
  }
}

export { maskToken } from './text-utils';
