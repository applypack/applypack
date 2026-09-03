import { logger } from './logger';
import {
  getSettings,
  listActiveTelegramTargets,
  markTargetUsed,
} from './settings';
import { prisma } from './db';
import type { TelegramTarget } from '@prisma/client';
import { describeStatus } from './fetchers/source-health';
import type { AlertJob } from './types';

const TELEGRAM_API = 'https://api.telegram.org';
const TELEGRAM_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_LENGTH = 4096;
/**
 * Quiet sources named in full before the line collapses to a count. A total
 * outage marks every source at once, and an uncapped list would push the
 * digest header past MAX_MESSAGE_LENGTH — Telegram then rejects the whole
 * message, losing the alert exactly when it matters most.
 */
const MAX_QUIET_NAMED = 8;

/**
 * One alert per posting (ADR 0028). `targetId` is the winning search's
 * `Profile.telegramTargetId` — a number, not the whole row, because routing is
 * the only thing the notifier ever wanted from a profile, and passing the row
 * invited callers to think the message was per-profile.
 */
export async function sendTelegramAlert(
  job: AlertJob,
  targetId?: number | null,
): Promise<void> {
  const text = formatJobMessage(job);
  await broadcast(text, targetId);
}

export async function sendDigest(
  jobs: AlertJob[],
  targetId?: number | null,
  quiet: QuietSourceAlert[] = [],
): Promise<void> {
  const healthLine = formatSourceHealthLine(quiet);
  if (jobs.length === 0) {
    const empty = escapeMarkdownV2('No new matches in the last 24h.');
    await broadcast(healthLine ? `${empty}\n\n${healthLine}` : empty, targetId);
    return;
  }
  const header = `*Daily digest — ${jobs.length} match${jobs.length === 1 ? '' : 'es'}*${
    healthLine ? `\n${healthLine}` : ''
  }`;
  const blocks = jobs.map(formatJobMessage);
  const separator = '\n\n———\n\n';

  // Pack into chunks under Telegram's 4096-char message limit.
  let buf = header;
  for (const block of blocks) {
    const candidate = buf.length === 0 ? block : `${buf}${separator}${block}`;
    if (candidate.length > MAX_MESSAGE_LENGTH) {
      await broadcast(buf, targetId);
      buf = block;
    } else {
      buf = candidate;
    }
  }
  if (buf.length > 0) {
    await broadcast(buf, targetId);
  }
}

async function broadcast(text: string, targetId?: number | null): Promise<void> {
  const settings = await getSettings();
  if (!settings.telegramEnabled) {
    logger.info(
      { telegram: 'disabled', preview: text.slice(0, 200) },
      'telegram: alerts disabled in settings; skipping',
    );
    return;
  }

  const targets = await resolveTargets(targetId);
  if (targets.length === 0) {
    logger.info(
      {
        telegram: 'no-targets',
        targetId,
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
 * - If the search named a target and that target is active, send only there.
 * - Otherwise broadcast to all active targets.
 */
async function resolveTargets(targetId?: number | null): Promise<TelegramTarget[]> {
  if (targetId) {
    const t = await prisma.telegramTarget.findUnique({ where: { id: targetId } });
    if (t && t.active) return [t];
    logger.warn(
      { targetId },
      'telegram: search target inactive or missing; falling back to all active',
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

/** Pure — exported so the MarkdownV2 escaping can be unit-tested; Telegram
 *  rejects a whole message on a single unescaped special character. */
export function formatJobMessage(job: AlertJob): string {
  const lines: string[] = [];
  // The header names the search that wanted it, so a reader running several
  // knows which hunt fired without opening the link (ADR 0028).
  lines.push(
    job.matchedProfile
      ? `*${escapeMarkdownV2(job.matchedProfile)} — fit ${job.fitScore}/100*`
      : `*New role match — fit ${job.fitScore}/100*`,
  );
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
  if (job.profileScores) {
    lines.push(`🎯 ${escapeMarkdownV2(job.profileScores)}`);
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

export interface QuietSourceAlert {
  name: string;
  atsType: string;
  /** Raw FetchStatus — rendered through describeStatus for the label. */
  status: string | null;
  streak: number;
}

/**
 * One digest line for sources that crossed the failure streak (ADR 0019).
 * Failing sources only: a silent board is a judgement call that belongs on
 * the dashboard, and nagging about it daily is how a digest trains its
 * reader to stop looking.
 */
export function formatSourceHealthLine(sources: QuietSourceAlert[]): string {
  if (sources.length === 0) return '';
  const items = sources
    .slice(0, MAX_QUIET_NAMED)
    .map(
      (s) =>
        `${escapeMarkdownV2(s.name)} ${escapeMarkdownV2(
          `(${s.atsType}, ${describeStatus(s.status).label.toLowerCase()} ×${s.streak})`,
        )}`,
    );
  const hidden = sources.length - items.length;
  if (hidden > 0) items.push(escapeMarkdownV2(`and ${hidden} more`));
  const header = `⚠️ *${sources.length} quiet source${sources.length === 1 ? '' : 's'}*`;
  return `${header} — ${items.join(', ')}`;
}

export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

export function escapeMarkdownV2Url(url: string): string {
  return url.replace(/([\\)])/g, '\\$1');
}
