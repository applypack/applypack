/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';
import type { JobStatus } from '@prisma/client';
import { fitColor, statusColor } from './format';

export const StatusBadge: FC<{ status: JobStatus }> = ({ status }) => (
  <span
    class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusColor(status)}`}
  >
    {status}
  </span>
);

export const FitBadge: FC<{ score: number | null }> = ({ score }) => (
  <span class={`font-semibold tabular-nums ${fitColor(score)}`}>
    {score == null ? '—' : score}
  </span>
);

export const Tag: FC<PropsWithChildren<{ tone?: 'green' | 'red' | 'zinc' }>> = ({
  children,
  tone = 'zinc',
}) => {
  const colors: Record<string, string> = {
    green: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20',
    red: 'bg-rose-500/10 text-rose-300 ring-rose-500/20',
    zinc: 'bg-zinc-500/10 text-zinc-300 ring-zinc-500/20',
  };
  return (
    <span
      class={`inline-flex items-center rounded px-1.5 py-0.5 text-xs ring-1 ring-inset ${colors[tone] ?? colors.zinc}`}
    >
      {children}
    </span>
  );
};

export const Card: FC<PropsWithChildren<{ class?: string }>> = ({
  children,
  class: className = '',
}) => (
  <div
    class={`rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 ${className}`}
  >
    {children}
  </div>
);

export const SectionTitle: FC<PropsWithChildren> = ({ children }) => (
  <h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
    {children}
  </h2>
);

export const Stat: FC<{ label: string; value: string | number; tone?: string }> = ({
  label,
  value,
  tone = 'text-zinc-100',
}) => (
  <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
    <div class="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
    <div class={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
  </div>
);

export const Empty: FC<PropsWithChildren> = ({ children }) => (
  <div class="rounded-lg border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
    {children}
  </div>
);
