import type { NotificationTarget } from '@prisma/client';
import type { AlertJob } from '../types';
import { formatPlaceLine, formatSalary, quietSourceItems, type PageChangeNotice, type QuietSourceAlert } from './lines';
import { packMessages } from './pack';

/*
 * The Discord channel (ADR 0041): an incoming webhook, one outbound POST per
 * message, Discord's own markdown. The formatters are pure and tested; only
 * postDiscord talks to the network.
 */

/** Discord's content limit for a webhook message. */
export const DISCORD_MAX_LENGTH = 2000;
const DISCORD_TIMEOUT_MS = 10_000;
const WEBHOOK_URL = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

/** Only Discord's own webhook hosts — the URL is a secret and a POST target, not a place to send anything else. */
export function isDiscordWebhookUrl(url: string): boolean {
  return WEBHOOK_URL.test(url.trim());
}

/** The webhook without its token: "discord.com/api/webhooks/123/***wxyz". */
export function maskWebhook(url: string): string {
  const m = /^https:\/\/([^/]+\/api\/webhooks\/\d+)\/([\w-]+)$/.exec(url.trim());
  return m ? `${m[1]}/***${m[2]!.slice(-4)}` : '***';
}

/** Discord markdown — the characters that would format a posting's own words. */
export function escapeDiscord(text: string): string {
  return text.replace(/([\\*_~`|>#])/g, '\\$1');
}

/** One posting, the same lines as the Telegram message, in Discord's markup. */
export function formatDiscordAlert(job: AlertJob): string {
  const headline = job.watched ? '★ New posting' : job.matchedProfile ? escapeDiscord(job.matchedProfile) : 'New role match';
  const lines = [
    `**${headline} — fit ${job.fitScore}/100**`,
    `**${escapeDiscord(job.title)}** @ ${escapeDiscord(job.companyName)}`,
    `📍 ${escapeDiscord(formatPlaceLine(job))} | 💰 ${escapeDiscord(
      formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod),
    )}`,
  ];
  if (job.techMatch.length > 0) lines.push(`✅ Tech: ${escapeDiscord(job.techMatch.join(', '))}`);
  if (job.redFlags.length > 0) lines.push(`⚠️ Flags: ${escapeDiscord(job.redFlags.join(', '))}`);
  if (job.crossListedAt) lines.push(`🔁 Also listed at ${escapeDiscord(job.crossListedAt)} — apply through one channel only`);
  if (job.profileScores) lines.push(`🎯 ${escapeDiscord(job.profileScores)}`);
  if (job.summary) lines.push(`_${escapeDiscord(job.summary)}_`);
  if (job.attribution) lines.push(escapeDiscord(job.attribution));
  // Angle brackets keep Discord from unfurling the posting into an embed.
  lines.push(`Apply → <${job.url}>`);
  return lines.join('\n');
}

export function formatDiscordHealthLine(quiet: readonly QuietSourceAlert[]): string {
  if (quiet.length === 0) return '';
  const { named, hidden } = quietSourceItems(quiet);
  const items = named.map(escapeDiscord);
  if (hidden > 0) items.push(`and ${hidden} more`);
  return `⚠️ **${quiet.length} quiet source${quiet.length === 1 ? '' : 's'}** — ${items.join(', ')}`;
}

/** The digest, packed under Discord's 2000-character limit. */
export function formatDiscordDigest(jobs: readonly AlertJob[], quiet: readonly QuietSourceAlert[], title: string): string[] {
  const health = formatDiscordHealthLine(quiet);
  if (jobs.length === 0) {
    const empty = 'No new matches since the last digest.';
    return [health ? `${empty}\n\n${health}` : empty];
  }
  const header = `**${escapeDiscord(title)} — ${jobs.length} match${jobs.length === 1 ? '' : 'es'}**${health ? `\n${health}` : ''}`;
  return packMessages(header, jobs.map(formatDiscordAlert), '\n\n———\n\n', DISCORD_MAX_LENGTH);
}

export function formatDiscordPageChanges(pages: readonly PageChangeNotice[]): string {
  const header =
    pages.length === 1 ? '**★ A watched careers page changed**' : `**★ ${pages.length} watched careers pages changed**`;
  const lines = pages.map((p) => `• **${escapeDiscord(p.companyName)}** — <${p.url}>`);
  return [header, ...lines, 'We cannot read this page for jobs — have a look.'].join('\n');
}

export interface DiscordSendResult {
  ok: boolean;
  error?: string;
}

/**
 * One webhook POST. A raw fetch on purpose: fetchWithRetry names the URL in
 * its errors, and this URL is the secret. `allowed_mentions` is empty so a
 * posting's own text cannot page @everyone — the untrusted-content rule
 * (ADR 0022) applied to the one channel that would obey it.
 */
export async function postDiscord(
  webhookUrl: string,
  content: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordSendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCORD_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, DISCORD_MAX_LENGTH), allowed_mentions: { parse: [] } }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return { ok: false, error: `Discord webhook: ${resp.status} ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
  } finally {
    clearTimeout(timer);
  }
}

export async function deliverDiscord(target: Pick<NotificationTarget, 'name' | 'webhookUrl'>, content: string): Promise<void> {
  if (!target.webhookUrl) throw new Error(`Discord target [${target.name}] has no webhook URL`);
  const result = await postDiscord(target.webhookUrl, content);
  if (!result.ok) throw new Error(`[${target.name}] ${result.error ?? 'unknown error'}`);
}

/** The same proof the Telegram form asks for: a real message before the row is saved. */
export async function testDiscordWebhook(webhookUrl: string): Promise<DiscordSendResult> {
  return postDiscord(webhookUrl, '✅ ApplyPack test — this webhook is configured correctly.');
}
