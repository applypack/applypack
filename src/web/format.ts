import { formatSalaryRange } from '../currency';
import type { JobStatus } from '@prisma/client';

const SHORT_TZ = 'America/Chicago';

/** The posting's own money and period (src/currency.ts); null columns read as USD a year. */
export function formatSalary(
  min: number | null,
  max: number | null,
  currency?: string | null,
  period?: string | null,
): string {
  return formatSalaryRange(min, max, currency, period);
}

export function formatDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toLocaleString('en-US', {
    timeZone: SHORT_TZ,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateShort(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toLocaleString('en-US', {
    timeZone: SHORT_TZ,
    month: 'short',
    day: 'numeric',
  });
}

export function formatRelative(d: Date | null | undefined): string {
  if (!d) return '—';
  const ms = Date.now() - d.getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
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
  if (sec <= 0) return 'due now';
  if (sec < 60) return `in ${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `in ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `in ${hr}h`;
  return `in ${Math.round(hr / 24)}d`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  return `${m.toFixed(1)}m`;
}

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'violet' | 'neutral';

const STATUS_LABEL: Record<JobStatus, string> = {
  NEW: 'New',
  ALERTED: 'Alerted',
  APPLIED: 'Applied',
  SAVED: 'Saved',
  DISMISSED: 'Dismissed',
};

/** Display label for a job status — the enum stays SCREAMING_CASE in data. */
export function statusLabel(status: JobStatus): string {
  return STATUS_LABEL[status] ?? status;
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

export function fitTone(score: number | null | undefined): Tone {
  if (score == null) return 'neutral';
  if (score >= 85) return 'ok';
  if (score >= 70) return 'info';
  if (score >= 50) return 'warn';
  return 'neutral';
}
