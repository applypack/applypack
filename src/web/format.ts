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

export function statusColor(status: JobStatus): string {
  switch (status) {
    case 'NEW':
      return 'bg-sky-500/15 text-sky-300 ring-sky-500/30';
    case 'ALERTED':
      return 'bg-amber-500/15 text-amber-300 ring-amber-500/30';
    case 'APPLIED':
      return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30';
    case 'SAVED':
      return 'bg-violet-500/15 text-violet-300 ring-violet-500/30';
    case 'DISMISSED':
      return 'bg-zinc-500/10 text-zinc-400 ring-zinc-500/20';
    default:
      return 'bg-zinc-500/10 text-zinc-400 ring-zinc-500/20';
  }
}

export function fitColor(score: number | null | undefined): string {
  if (score == null) return 'text-zinc-400';
  if (score >= 85) return 'text-emerald-400';
  if (score >= 70) return 'text-sky-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-zinc-500';
}
