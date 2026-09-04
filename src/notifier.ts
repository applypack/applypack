import { logger } from './logger';
import { flagOf } from './countries';
import { formatSalaryRange } from './currency';
import { WORKPLACE_LABEL } from './location';
import {
  getSettings,
  listActiveTelegramTargets,
  markTargetUsed,
} from './settings';
import { prisma } from './db';
import type { TelegramTarget } from '@prisma/client';
import { describeStatus } from './fetchers/source-health';
import type { AlertJob } from './types';

/** Arrangement words a location string may already carry. */
const WORKPLACE_WORDS = '\\b(remote|hybrid|on-?site|in-office)\\b';

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
  /** What the header calls this batch — the daily recap, or a held delivery (TASKS §16). */
  title = 'Daily digest',
): Promise<void> {
  const healthLine = formatSourceHealthLine(quiet);
  if (jobs.length === 0) {
    const empty = escapeMarkdownV2('No new matches since the last digest.');
    await broadcast(healthLine ? `${empty}\n\n${healthLine}` : empty, targetId);
    return;
  }
  const header = `*${title} — ${jobs.length} match${jobs.length === 1 ? '' : 'es'}*${
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

/**
 * The place line: the posting's own words, the flags of the countries the
 * stage-1 columns hold, and the arrangement when the words do not already
 * say it (ADR 0033). "🇩🇪 Remote · Berlin, Germany", "🇺🇦 Kyiv · hybrid".
 */
export function formatPlaceLine(job: AlertJob): string {
  const flags = (job.countries ?? []).map(flagOf).filter((f) => f.length > 0).join('');
  const workplace = job.workplace && job.workplace !== 'UNKNOWN' ? WORKPLACE_LABEL[job.workplace] : '';
  const words = job.location.trim();
  const said = words.length > 0 && new RegExp(WORKPLACE_WORDS, 'i').test(words);
  const place = words.length > 0 ? words : workplace || 'Remote';
  const tail = workplace && !said && words.length > 0 ? ` · ${workplace.toLowerCase()}` : '';
  return `${flags ? `${flags} ` : ''}${place}${tail}`;
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

/** The posting's own money and period (src/currency.ts); null columns read as USD a year. */
export function formatSalary(
  min: number | null,
  max: number | null,
  currency?: string | null,
  period?: string | null,
): string {
  return formatSalaryRange(min, max, currency, period);
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

export interface PageChangeNotice {
  companyName: string;
  url: string;
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

export async function sendPageChangeAlert(pages: readonly PageChangeNotice[]): Promise<void> {
  if (pages.length === 0) return;
  await broadcast(formatPageChangeMessage(pages), null);
}

export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

export function escapeMarkdownV2Url(url: string): string {
  return url.replace(/([\\)])/g, '\\$1');
}
