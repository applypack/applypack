import type { JobStatus } from '@prisma/client';

const SHORT_TZ = 'America/Chicago';

export function formatSalary(min: number | null, max: number | null): string {
  if (min === null && max === null) return '—';
  const fmt = (n: number) => `$${Math.round(n / 1000)}k`;
  if (min !== null && max !== null) return `${fmt(min)}-${fmt(max)}`;
  if (min !== null) return `${fmt(min)}+`;
  if (max !== null) return `up to ${fmt(max)}`;
  return '—';
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

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  return `${m.toFixed(1)}m`;
}

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'violet' | 'neutral';

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
