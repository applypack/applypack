/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { CronRunStatus } from '@prisma/client';
import { Layout } from '../layout';
import { Card, Empty, FitBadge, SectionTitle, Stat, StatusBadge } from '../ui';
import { formatDateShort, formatDuration, formatRelative } from '../format';

interface JobRow {
  id: number;
  title: string;
  url: string;
  location: string;
  fitScore: number | null;
  fetchedAt: Date;
  alertedAt: Date | null;
  status: 'NEW' | 'ALERTED' | 'APPLIED' | 'DISMISSED' | 'SAVED';
  company: { name: string };
}

interface RunRow {
  id: number;
  name: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: CronRunStatus;
  stats: unknown;
  errorMessage: string | null;
}

export interface OverviewProps {
  counts: { status: string; count: number }[];
  last24h: { status: string; count: number }[];
  recentAlerts: JobRow[];
  latestRuns: { name: string; run: RunRow | null }[];
}

const STATUS_ORDER = ['NEW', 'ALERTED', 'APPLIED', 'SAVED', 'DISMISSED'];

export const OverviewPage: FC<OverviewProps> = ({
  counts,
  last24h,
  recentAlerts,
  latestRuns,
}) => {
  const total = counts.reduce((acc, c) => acc + c.count, 0);
  const total24h = last24h.reduce((acc, c) => acc + c.count, 0);
  const byStatus = mapCounts(counts);
  const byStatus24h = mapCounts(last24h);

  return (
    <Layout title="Overview" active="overview">
      <div class="mb-6 flex items-baseline justify-between">
        <h1 class="text-2xl font-semibold tracking-tight">Overview</h1>
        <span class="text-xs text-zinc-500">auto-refresh: 30s</span>
      </div>

      <SectionTitle>All time</SectionTitle>
      <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total" value={total} />
        {STATUS_ORDER.map((s) => (
          <Stat label={s} value={byStatus[s] ?? 0} />
        ))}
      </div>

      <SectionTitle>Last 24h</SectionTitle>
      <div class="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total" value={total24h} />
        {STATUS_ORDER.map((s) => (
          <Stat label={s} value={byStatus24h[s] ?? 0} />
        ))}
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle>Recent alerts</SectionTitle>
          {recentAlerts.length === 0 ? (
            <Empty>No alerted jobs yet.</Empty>
          ) : (
            <Card>
              <ul class="divide-y divide-zinc-800">
                {recentAlerts.map((j) => (
                  <li class="py-3 first:pt-0 last:pb-0">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0 flex-1">
                        <a
                          href={`/jobs/${j.id}`}
                          class="truncate text-sm font-medium text-zinc-100 hover:text-emerald-400"
                        >
                          {j.title}
                        </a>
                        <div class="mt-0.5 truncate text-xs text-zinc-500">
                          {j.company.name} · {j.location || 'Remote'} ·{' '}
                          {formatRelative(j.alertedAt ?? j.fetchedAt)}
                        </div>
                      </div>
                      <div class="flex shrink-0 items-center gap-2">
                        <FitBadge score={j.fitScore} />
                        <StatusBadge status={j.status} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div>
          <SectionTitle>Cron health</SectionTitle>
          <Card>
            <ul class="space-y-3">
              {latestRuns.map(({ name, run }) => (
                <li class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-zinc-100">{name}</div>
                    <div class="text-xs text-zinc-500">
                      {run
                        ? `${formatDateShort(run.startedAt)} · ${formatDuration(
                            run.finishedAt
                              ? run.finishedAt.getTime() - run.startedAt.getTime()
                              : null,
                          )}`
                        : 'never'}
                    </div>
                  </div>
                  <div>
                    {run ? <RunStatusBadge status={run.status} /> : (
                      <span class="text-xs text-zinc-600">—</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div class="mt-4 border-t border-zinc-800 pt-3 text-right">
              <a href="/runs" class="text-xs text-zinc-400 hover:text-zinc-100">
                Full history →
              </a>
            </div>
          </Card>
        </div>
      </div>
    </Layout>
  );
};

function mapCounts(rows: { status: string; count: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.status] = r.count;
  }
  return out;
}

const RunStatusBadge: FC<{ status: CronRunStatus }> = ({ status }) => {
  const cls =
    status === 'OK'
      ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
      : status === 'FAILED'
        ? 'bg-rose-500/15 text-rose-300 ring-rose-500/30'
        : 'bg-sky-500/15 text-sky-300 ring-sky-500/30';
  return (
    <span
      class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {status}
    </span>
  );
};
