import { formatSalaryRange } from '../currency';
import type { JobStatus } from '@prisma/client';
import { displayZone } from './display-zone';
import { formatDateTime, formatNumber } from '../i18n/format';
import { t } from '../i18n/t';

/** The posting's own money and period (src/currency.ts); null columns read as USD a year. */
/**
 * A URL from outside — a feed's link, the verifier's finding, a typed career
 * page — as an href only when it is http(s). A `javascript:` link from a
 * feed would run in the dashboard's own origin on a click; anything else is
 * no link at all (audit FETCH-5, found while making feed links absolute).
 */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function formatSalary(
  min: number | null,
  max: number | null,
  currency?: string | null,
  period?: string | null,
): string {
  return formatSalaryRange(min, max, currency, period);
}

/** A moment, in the zone of the user's schedule, with the zone named so the reader does not have to guess it. */
export function formatDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return formatDateTime(d, {
    timeZone: displayZone(),
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/** A moment in a table cell: day and 24-hour time, no year; the column header names the zone (`displayZoneLabel`). */
export function formatStamp(d: Date | null | undefined): string {
  if (!d) return '—';
  return formatDateTime(d, {
    timeZone: displayZone(),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

export function formatDateShort(d: Date | null | undefined): string {
  if (!d) return '—';
  return formatDateTime(d, {
    timeZone: displayZone(),
    month: 'short',
    day: 'numeric',
  });
}

/** The time of day alone, 24-hour, in the display zone: "13:54" — for a moment the reader knows was today. */
export function formatTime(d: Date): string {
  return formatDateTime(d, { timeZone: displayZone(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/**
 * "5m ago", worded by the catalog (`time.ago.*`) rather than by
 * `Intl.RelativeTimeFormat`: CLDR's narrow forms are uneven — French writes
 * "-5 min", German "vor 5 m" — and a message is ours to word (ADR 0061).
 */
export function formatRelative(d: Date | null | undefined): string {
  if (!d) return '—';
  const ms = Date.now() - d.getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return t('time.ago.seconds', { n: sec });
  const min = Math.round(sec / 60);
  if (min < 60) return t('time.ago.minutes', { n: min });
  const hr = Math.round(min / 60);
  if (hr < 48) return t('time.ago.hours', { n: hr });
  const day = Math.round(hr / 24);
  return t('time.ago.days', { n: day });
}

/**
 * The mirror of formatRelative for a time that has not happened yet — "in
 * 22h", "in 6d". A past instant reads as "due now", because that is what a
 * `nextCheckAt` in the past means to the reader (§17): the row is waiting for
 * the next heartbeat, not overdue by a day.
 */
export function formatUntil(d: Date | null | undefined): string {
  if (!d) return '—';
  const sec = Math.round((d.getTime() - Date.now()) / 1000);
  if (sec <= 0) return t('time.dueNow');
  if (sec < 60) return t('time.in.seconds', { n: sec });
  const min = Math.round(sec / 60);
  if (min < 60) return t('time.in.minutes', { n: min });
  const hr = Math.round(min / 60);
  if (hr < 48) return t('time.in.hours', { n: hr });
  return t('time.in.days', { n: Math.round(hr / 24) });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return t('duration.ms', { n: ms });
  const s = ms / 1000;
  if (s < 60) return t('duration.seconds', { n: oneDecimal(s) });
  return t('duration.minutes', { n: oneDecimal(s / 60) });
}

/** "1.5" in English, "1,5" where the language writes a comma — the digits `toFixed(1)` gives, never regrouped. */
function oneDecimal(n: number): string {
  return formatNumber(Number(n.toFixed(1)), { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });
}

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'violet' | 'neutral';

/** Display label for a job status — the enum stays SCREAMING_CASE in data. */
export function statusLabel(status: JobStatus): string {
  return t(`job.status.${status}`);
}

export function statusTone(status: JobStatus): Tone {
  switch (status) {
    case 'NEW':
      return 'info';
    case 'ALERTED':
      return 'warn';
    case 'APPLIED':
      return 'ok';
    case 'SAVED':
      return 'violet';
    default:
      return 'neutral';
  }
}

/** The tone cut-offs — mirrored by public/target-page.mjs:ringTone; tone-parity.test.ts holds the two equal. */
export const FIT_OK_FLOOR = 85;
export const FIT_INFO_FLOOR = 70;
export const FIT_WARN_FLOOR = 50;

export function fitTone(score: number | null | undefined): Tone {
  if (score == null) return 'neutral';
  if (score >= FIT_OK_FLOOR) return 'ok';
  if (score >= FIT_INFO_FLOOR) return 'info';
  if (score >= FIT_WARN_FLOOR) return 'warn';
  return 'neutral';
}

/** The same floors in a word, for where there is room beside the number: a job page's header. */
export function fitWord(score: number | null | undefined): string {
  if (score == null) return '';
  if (score >= FIT_OK_FLOOR) return t('fit.strong');
  if (score >= FIT_INFO_FLOOR) return t('fit.good');
  if (score >= FIT_WARN_FLOOR) return t('fit.partial');
  return t('fit.weak');
}
