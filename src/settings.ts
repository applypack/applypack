import { AtsType } from '@prisma/client';
import type { Prisma, TelegramTarget } from '@prisma/client';
import { prisma } from './db';
import { logger } from './logger';
import type { AiEngineConfig } from './ai-engine';

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
  updatedAt: Date;
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
    updatedAt: row.updatedAt,
  };
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

export async function setAiEngineConfig(engine: AiEngineConfig): Promise<void> {
  const value = engine as unknown as Prisma.InputJsonValue;
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { aiEngine: value },
    create: { id: SETTINGS_ID, aiEngine: value },
  });
  logger.info({ engine }, 'settings: ai engine updated');
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
        text: '✅ applypack test — this target is configured correctly.',
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
