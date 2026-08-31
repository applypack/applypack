import { logger } from './logger';
import {
  getSettings,
  listActiveTelegramTargets,
  markTargetUsed,
} from './settings';
import { prisma } from './db';
import type { Profile, TelegramTarget } from '@prisma/client';
import type { AlertJob } from './types';

const TELEGRAM_API = 'https://api.telegram.org';
const TELEGRAM_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_LENGTH = 4096;

export async function sendTelegramAlert(
  job: AlertJob,
  profile?: Profile,
): Promise<void> {
  const text = formatJobMessage(job);
  await broadcast(text, profile);
}

export async function sendDigest(
  jobs: AlertJob[],
  profile?: Profile,
): Promise<void> {
  if (jobs.length === 0) {
    await broadcast(escapeMarkdownV2('No new matches in the last 24h.'), profile);
    return;
  }
  const header = `*Daily digest — ${jobs.length} match${jobs.length === 1 ? '' : 'es'}*`;
  const blocks = jobs.map(formatJobMessage);
  const separator = '\n\n———\n\n';

  // Pack into chunks under Telegram's 4096-char message limit.
  let buf = header;
  for (const block of blocks) {
    const candidate = buf.length === 0 ? block : `${buf}${separator}${block}`;
    if (candidate.length > MAX_MESSAGE_LENGTH) {
      await broadcast(buf, profile);
      buf = block;
    } else {
      buf = candidate;
    }
  }
  if (buf.length > 0) {
    await broadcast(buf, profile);
  }
}

async function broadcast(text: string, profile?: Profile): Promise<void> {
  const settings = await getSettings();
  if (!settings.telegramEnabled) {
    logger.info(
      { telegram: 'disabled', preview: text.slice(0, 200) },
      'telegram: alerts disabled in settings; skipping',
    );
    return;
  }

  const targets = await resolveTargets(profile);
  if (targets.length === 0) {
    logger.info(
      {
        telegram: 'no-targets',
        profile: profile?.name,
        preview: text.slice(0, 200),
      },
      'telegram: no eligible targets; skipping',
    );
    return;
  }

  const results = await Promise.allSettled(
    targets.map((t) => deliverToTarget(t, text)),
  );
  const okCount = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results
    .map((r, i) => ({ r, name: targets[i]?.name ?? 'unknown' }))
    .filter((x): x is { r: PromiseRejectedResult; name: string } =>
      x.r.status === 'rejected',
    );
  for (const f of failed) {
    logger.error(
      { err: f.r.reason, target: f.name },
      'telegram: delivery failed for target',
    );
  }
  logger.info(
    { ok: okCount, failed: failed.length, total: targets.length },
    'telegram: broadcast complete',
  );
}

/**
 * Pick the targets for this broadcast:
 * - If profile.telegramTargetId is set and that target is active, send only there.
 * - Otherwise broadcast to all active targets.
 */
async function resolveTargets(
  profile?: Profile,
): Promise<TelegramTarget[]> {
  if (profile?.telegramTargetId) {
    const t = await prisma.telegramTarget.findUnique({
      where: { id: profile.telegramTargetId },
    });
    if (t && t.active) return [t];
    logger.warn(
      { profile: profile.name, targetId: profile.telegramTargetId },
      'telegram: profile target inactive or missing; falling back to all active',
    );
  }
  return listActiveTelegramTargets();
}

async function deliverToTarget(
  target: TelegramTarget,
  text: string,
): Promise<void> {
  const url = `${TELEGRAM_API}/bot${target.botToken}/sendMessage`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: target.chatId,
        text,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(
        `Telegram sendMessage [${target.name}]: ${resp.status} ${body.slice(0, 300)}`,
      );
    }
    await markTargetUsed(target.id);
  } finally {
    clearTimeout(timer);
  }
}

function formatJobMessage(job: AlertJob): string {
  const lines: string[] = [];
  lines.push(`*New role match — fit ${job.fitScore}/100*`);
  lines.push(
    `*${escapeMarkdownV2(job.title)}* @ ${escapeMarkdownV2(job.companyName)}`,
  );
  const loc = job.location || 'Remote';
  lines.push(
    `📍 ${escapeMarkdownV2(loc)} \\| 💰 ${escapeMarkdownV2(formatSalary(job.salaryMin, job.salaryMax))}`,
  );
  if (job.techMatch.length > 0) {
    lines.push(`✅ Tech: ${escapeMarkdownV2(job.techMatch.join(', '))}`);
  }
  if (job.redFlags.length > 0) {
    lines.push(`⚠️ Flags: ${escapeMarkdownV2(job.redFlags.join(', '))}`);
  }
  if (job.crossListedAt) {
    lines.push(
      `🔁 Also listed at ${escapeMarkdownV2(job.crossListedAt)} — apply through one channel only`,
    );
  }
  if (job.summary) {
    lines.push(`_${escapeMarkdownV2(job.summary)}_`);
  }
  lines.push(`[Apply →](${escapeMarkdownV2Url(job.url)})`);
  return lines.join('\n');
}

export function formatSalary(min: number | null, max: number | null): string {
  if (min === null && max === null) return '—';
  const fmt = (n: number) => `$${Math.round(n / 1000)}k`;
  if (min !== null && max !== null) return `${fmt(min)}-${fmt(max)}`;
  if (min !== null) return `${fmt(min)}+`;
  if (max !== null) return `up to ${fmt(max)}`;
  return '—';
}

export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

export function escapeMarkdownV2Url(url: string): string {
  return url.replace(/([\\)])/g, '\\$1');
}
