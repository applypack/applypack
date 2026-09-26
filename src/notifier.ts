import { logger } from './logger';
import { getSettings, listActiveNotificationTargets, markTargetUsed } from './settings';
import { prisma } from './db';
import type { NotificationTarget } from '@prisma/client';
import type { AlertJob } from './types';
import {
  formatPlaceLine,
  formatSalary,
  moreOnDashboard,
  quietSourceItems,
  type PageChangeNotice,
  type QuietSourceAlert,
} from './notify/lines';
import { deliverDiscord, formatDiscordAlert, formatDiscordDigest, formatDiscordPageChanges } from './notify/discord';
import { packMessages } from './notify/pack';

/*
 * Alerts, digests and notices go out through here to every active target,
 * each in its channel's own markup (ADR 0041): this file is the Telegram
 * channel — MarkdownV2, the 4096-char limit, the bot API — and the switch
 * that hands a Discord row to notify/discord.ts. The words both channels
 * share are in notify/lines.ts.
 */

export { formatPlaceLine, formatSalary } from './notify/lines';
export type { PageChangeNotice, QuietSourceAlert } from './notify/lines';

const TELEGRAM_API = 'https://api.telegram.org';
const TELEGRAM_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_LENGTH = 4096;

/** What one broadcast says, in each channel's own markup (ADR 0041). */
interface Outgoing {
  telegram: string[];
  discord: string[];
}

/**
 * Whether a message could leave right now. `alerts-off` = there is a chat and
 * the Alerts switch is off: what is found then waits for it to come back on.
 * `no-targets` = no active chat at all, so there is nothing to wait for.
 */
export type AlertChannel = 'open' | 'alerts-off' | 'no-targets';

/**
 * What a broadcast did. `skipped` says why nothing was attempted; otherwise
 * `reached` targets got the message, at least one — when every target
 * refuses it, the broadcast throws `AlertDeliveryError` instead.
 */
export interface Delivery {
  reached: number;
  skipped: Exclude<AlertChannel, 'open'> | null;
}

/** Every target refused the message; nothing reached anyone, so the caller may safely try again. */
export class AlertDeliveryError extends Error {
  constructor(readonly targets: number) {
    super(`notify: every target failed (${targets})`);
    this.name = 'AlertDeliveryError';
  }
}

/** A chat first, then the switch: with no chat there is nothing to hold a match for. Pure. */
export function channelFor(activeTargets: number, alertsOn: boolean): AlertChannel {
  if (activeTargets === 0) return 'no-targets';
  return alertsOn ? 'open' : 'alerts-off';
}

/** The channel as it stands, for a caller deciding whether to hold a match before it sends anything. */
export async function alertChannel(): Promise<AlertChannel> {
  const targets = await listActiveNotificationTargets();
  return channelFor(targets.length, (await getSettings()).telegramEnabled);
}

/**
 * One alert per posting (ADR 0028). `targetId` is the winning search's
 * `Profile.notificationTargetId` — a number, not the whole row, because
 * routing is the only thing the notifier ever wanted from a profile, and
 * passing the row invited callers to think the message was per-profile.
 */
export async function sendAlert(job: AlertJob, targetId?: number | null): Promise<Delivery> {
  return broadcast({ telegram: [formatJobMessage(job)], discord: [formatDiscordAlert(job)] }, targetId);
}

export async function sendDigest(
  jobs: AlertJob[],
  targetId?: number | null,
  quiet: QuietSourceAlert[] = [],
  /** What the header calls this batch — the daily recap, or a held delivery (TASKS §16). */
  title = 'Daily digest',
  /** Matches counted in the header but not listed — a long wait's backlog stays on the dashboard. */
  more = 0,
): Promise<Delivery> {
  return broadcast(
    { telegram: formatTelegramDigest(jobs, quiet, title, more), discord: formatDiscordDigest(jobs, quiet, title, more) },
    targetId,
  );
}

/** The Telegram digest, packed under the 4096-char message limit. Pure — exported for the test. */
export function formatTelegramDigest(
  jobs: readonly AlertJob[],
  quiet: readonly QuietSourceAlert[],
  title: string,
  more = 0,
): string[] {
  const healthLine = formatSourceHealthLine([...quiet]);
  if (jobs.length === 0) {
    const empty = escapeMarkdownV2('No new matches since the last digest.');
    return [healthLine ? `${empty}\n\n${healthLine}` : empty];
  }
  const total = jobs.length + more;
  const header = `*${title} — ${total} match${total === 1 ? '' : 'es'}*${healthLine ? `\n${healthLine}` : ''}`;
  const blocks = jobs.map(formatJobMessage);
  if (more > 0) blocks.push(escapeMarkdownV2(moreOnDashboard(more)));
  return packMessages(header, blocks, '\n\n———\n\n', MAX_MESSAGE_LENGTH);
}

async function broadcast(out: Outgoing, targetId?: number | null): Promise<Delivery> {
  const targets = await resolveTargets(targetId);
  const channel = channelFor(targets.length, (await getSettings()).telegramEnabled);
  if (channel !== 'open') {
    logger.info({ alerts: channel, targetId, preview: out.telegram[0]?.slice(0, 200) }, 'notify: nothing sent');
    return { reached: 0, skipped: channel };
  }

  const results = await Promise.allSettled(targets.map((t) => deliverToTarget(t, out)));
  const okCount = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results
    .map((r, i) => ({ r, name: targets[i]?.name ?? 'unknown', kind: targets[i]?.kind }))
    .filter((x): x is { r: PromiseRejectedResult; name: string; kind: NotificationTarget['kind'] } => x.r.status === 'rejected');
  for (const f of failed) {
    logger.error({ err: f.r.reason, target: f.name, kind: f.kind }, 'notify: delivery failed for target');
  }
  logger.info({ ok: okCount, failed: failed.length, total: targets.length }, 'notify: broadcast complete');
  if (okCount === 0) throw new AlertDeliveryError(targets.length);
  return { reached: okCount, skipped: null };
}

/**
 * Pick the targets for this broadcast:
 * - If the search named a target and that target is active, send only there.
 * - Otherwise broadcast to all active targets.
 */
async function resolveTargets(targetId?: number | null): Promise<NotificationTarget[]> {
  if (targetId) {
    const t = await prisma.notificationTarget.findUnique({ where: { id: targetId } });
    if (t && t.active) return [t];
    logger.warn({ targetId }, 'notify: search target inactive or missing; falling back to all active');
  }
  return listActiveNotificationTargets();
}

/** Each target gets the messages in its own channel's markup; the row's kind decides. */
async function deliverToTarget(target: NotificationTarget, out: Outgoing): Promise<void> {
  const texts = target.kind === 'DISCORD' ? out.discord : out.telegram;
  const { sent, error } = await sendParts(texts, (text) =>
    target.kind === 'DISCORD' ? deliverDiscord(target, text) : deliverTelegram(target, text),
  );
  if (error !== undefined) {
    logger.error({ err: error, target: target.name, sent, total: texts.length }, 'notify: message cut short; the rest is not re-sent');
  }
  await markTargetUsed(target.id);
}

/**
 * The parts of one message, in order, stopping at the first refusal. It
 * throws only when nothing went out: once the first part has arrived the
 * target counts as reached, because the retry a failure earns would send
 * that part a second time. The error is handed back for the log.
 */
export async function sendParts(
  texts: readonly string[],
  send: (text: string) => Promise<void>,
): Promise<{ sent: number; error?: unknown }> {
  let sent = 0;
  for (const text of texts) {
    try {
      await send(text);
    } catch (error) {
      if (sent === 0) throw error;
      return { sent, error };
    }
    sent++;
  }
  return { sent };
}

async function deliverTelegram(target: NotificationTarget, text: string): Promise<void> {
  if (!target.botToken || !target.chatId) throw new Error(`Telegram target [${target.name}] has no token or chat id`);
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
      throw new Error(`Telegram sendMessage [${target.name}]: ${resp.status} ${body.slice(0, 300)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Pure — exported so the MarkdownV2 escaping can be unit-tested; Telegram
 *  rejects a whole message on a single unescaped special character. */
export function formatJobMessage(job: AlertJob): string {
  const lines: string[] = [];
  // The header names the search that wanted it, so a reader running several
  // knows which hunt fired without opening the link (ADR 0028). A watched
  // company's posting says what it is instead: it may be here because the
  // user asked for every posting, not because a search wanted it (ADR 0036).
  const headline = job.watched
    ? '★ New posting'
    : job.matchedProfile
      ? escapeMarkdownV2(job.matchedProfile)
      : 'New role match';
  lines.push(`*${headline} — fit ${job.fitScore}/100*`);
  lines.push(
    `*${escapeMarkdownV2(job.title)}* @ ${escapeMarkdownV2(job.companyName)}`,
  );
  lines.push(
    `📍 ${escapeMarkdownV2(formatPlaceLine(job))} \\| 💰 ${escapeMarkdownV2(formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod))}`,
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
  if (job.attribution) {
    lines.push(escapeMarkdownV2(job.attribution));
  }
  lines.push(`[Apply →](${escapeMarkdownV2Url(job.url)})`);
  return lines.join('\n');
}

/**
 * One digest line for sources that crossed the failure streak (ADR 0019).
 * Failing sources only: a silent board is a judgement call that belongs on
 * the dashboard, and nagging about it daily is how a digest trains its
 * reader to stop looking.
 */
export function formatSourceHealthLine(sources: QuietSourceAlert[]): string {
  if (sources.length === 0) return '';
  const { named, hidden } = quietSourceItems(sources);
  const items = named.map(escapeMarkdownV2);
  if (hidden > 0) items.push(escapeMarkdownV2(`and ${hidden} more`));
  const header = `⚠️ *${sources.length} quiet source${sources.length === 1 ? '' : 's'}*`;
  return `${header} — ${items.join(', ')}`;
}

/**
 * "This careers page changed" (TASKS §17 stage C, ADR 0036). Pure, so the
 * MarkdownV2 escaping is unit-tested like every other message.
 *
 * The wording is deliberately modest. This rung reads a page that publishes
 * nothing machine-readable, so it does not know what changed, whether a job
 * was added or a photo was swapped. Claiming otherwise would train the reader
 * to ignore it.
 */
export function formatPageChangeMessage(pages: readonly PageChangeNotice[]): string {
  const header =
    pages.length === 1
      ? '*★ A watched careers page changed*'
      : `*★ ${pages.length} watched careers pages changed*`;
  const lines = pages.map(
    (p) => `• [${escapeMarkdownV2(p.companyName)}](${escapeMarkdownV2Url(p.url)})`,
  );
  return [header, ...lines, escapeMarkdownV2('We cannot read this page for jobs — have a look.')].join('\n');
}

export async function sendPageChangeAlert(pages: readonly PageChangeNotice[]): Promise<Delivery> {
  return broadcast({ telegram: [formatPageChangeMessage(pages)], discord: [formatDiscordPageChanges(pages)] }, null);
}

export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

export function escapeMarkdownV2Url(url: string): string {
  return url.replace(/([\\)])/g, '\\$1');
}
