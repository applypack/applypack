/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { CronRunStatus } from '@prisma/client';
import { Layout } from '../layout';
import {
  Badge,
  Card,
  Empty,
  FitBadge,
  PageHeader,
  SectionTitle,
  Stat,
  StatusBadge,
} from '../ui';
import { formatDateShort, formatDuration, formatRelative, statusTone } from '../format';
import type { Tone } from '../format';

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

const STATUS_ORDER = ['NEW', 'ALERTED', 'APPLIED', 'SAVED', 'DISMISSED'] as const;

export const OverviewPage: FC<OverviewProps> = ({
  counts,
  last24h,
  recentAlerts,
  latestRuns,
}) => {
  const byStatus = mapCounts(counts);
  const byStatus24h = mapCounts(last24h);

  return (
    <Layout title="Overview" active="overview">
      <PageHeader title="Overview" meta="auto-refresh: 30s" />

      <StatRow title="All time" counts={byStatus} />
      <StatRow title="Last 24h" counts={byStatus24h} />

      <div class="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle>Recent alerts</SectionTitle>
          {recentAlerts.length === 0 ? (
            <Empty>No alerted jobs yet.</Empty>
          ) : (
            <Card>
              <ul class="divide-y divide-line">
                {recentAlerts.map((j) => (
                  <li class="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div class="min-w-0 flex-1">
                      <a
                        href={`/jobs/${j.id}`}
                        class="block truncate text-sm font-medium text-ink hover:text-accent"
                      >
                        {j.title}
                      </a>
                      <div class="mt-0.5 truncate text-xs text-ink-faint">
                        {j.company.name} · {j.location || 'Remote'} ·{' '}
                        {formatRelative(j.alertedAt ?? j.fetchedAt)}
                      </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <FitBadge score={j.fitScore} />
                      <StatusBadge status={j.status} />
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
            <ul class="divide-y divide-line">
              {latestRuns.map(({ name, run }) => (
                <li class="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div class="min-w-0">
                    <div class="font-mono text-sm text-ink">{name}</div>
                    <div class="text-xs text-ink-faint">
                      {run
                        ? `${formatDateShort(run.startedAt)} · ${formatDuration(
                            run.finishedAt
                              ? run.finishedAt.getTime() - run.startedAt.getTime()
                              : null,
                          )}`
                        : 'never'}
                    </div>
                  </div>
                  {run ? (
                    <Badge tone={runTone(run.status)}>{run.status}</Badge>
                  ) : (
                    <span class="text-xs text-ink-faint">—</span>
                  )}
                </li>
              ))}
            </ul>
            <div class="mt-4 border-t border-line pt-3 text-right">
              <a href="/runs" class="text-xs text-ink-muted hover:text-ink">
                Full history →
              </a>
            </div>
          </Card>
        </div>
      </div>
    </Layout>
  );
};

const StatRow: FC<{ title: string; counts: Record<string, number> }> = ({
  title,
  counts,
}) => {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total" value={total} />
        {STATUS_ORDER.map((s) => (
          <Stat label={s} value={counts[s] ?? 0} tone={counts[s] ? statusTone(s) : undefined} />
        ))}
      </div>
    </>
  );
};

function mapCounts(rows: { status: string; count: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.count;
  return out;
}

export function runTone(status: CronRunStatus): Tone {
  if (status === 'OK') return 'ok';
  if (status === 'FAILED') return 'danger';
  return 'info';
}
