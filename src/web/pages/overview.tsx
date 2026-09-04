/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { CronRunStatus } from '@prisma/client';
import { Layout } from '../layout';
import { Badge, Button, Card, Empty, FitBadge, Flash, PageHeader, SectionTitle, Stat, StatusBadge } from '../ui';
import type { FlashMessage } from '../flash';
import type { FetchRun } from '../fetch-runs';
import { FetchNowButton } from './fetch-run';
import {
  formatDateShort,
  formatDuration,
  formatRelative,
  statusLabel,
  statusTone,
} from '../format';
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
  fetchingEnabled: boolean;
  /** "" while the schedule lets every hour through; "Sleeping until Mon 07:05" otherwise (TASKS §16). */
  sleepingUntil: string;
  /** Matches scored outside the alert window, waiting for the next one. */
  heldAlerts: number;
  /** The manual fetch in flight, if any — the button turns into a link to it. */
  fetchRun: FetchRun | null;
  /** A wizard step is still undone (skipped or not) — show the way back to /welcome. */
  finishSetup: boolean;
  flash?: FlashMessage | null;
}

/** The four statuses worth acting on; Total and Dismissed stay quiet. */
const PRIMARY_STATUSES = ['NEW', 'ALERTED', 'APPLIED', 'SAVED'] as const;

const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  violet: 'bg-violet',
  neutral: 'bg-ink-faint',
};

export const OverviewPage: FC<OverviewProps> = ({
  counts,
  last24h,
  recentAlerts,
  latestRuns,
  fetchingEnabled,
  sleepingUntil,
  heldAlerts,
  fetchRun,
  finishSetup,
  flash,
}) => {
  const byStatus = mapCounts(counts);
  const byStatus24h = mapCounts(last24h);
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const total24h = Object.values(byStatus24h).reduce((a, b) => a + b, 0);

  return (
    <Layout title="Overview" active="overview" refresh={30}>
      <PageHeader
        title="Overview"
        meta="Refreshes every 30s"
        actions={
          <>
            {finishSetup && (
              <a href="/welcome" class="inline-flex" title="Some setup steps are still open">
                <Badge tone="warn">Finish setup →</Badge>
              </a>
            )}
            <FetchNowButton run={fetchRun} />
            {/* Quick master switch — same toggle as Settings → General. */}
            <form
              method="post"
              action="/settings/fetching-toggle"
              class="flex items-center gap-2"
            >
              <input type="hidden" name="back" value="/" />
              <Badge tone={fetchingEnabled ? (sleepingUntil ? 'neutral' : 'ok') : 'neutral'}>
                {!fetchingEnabled
                  ? 'Pipeline paused'
                  : sleepingUntil
                    ? `Sleeping until ${sleepingUntil}`
                    : 'Pipeline running'}
              </Badge>
              <Button size="sm" variant="secondary">
                {fetchingEnabled ? 'Pause' : 'Resume'}
              </Button>
            </form>
          </>
        }
      />
      <Flash flash={flash} />

      {fetchingEnabled && heldAlerts > 0 && (
        <p class="-mt-2 mb-4 text-[13px] leading-5 text-ink-faint">
          {heldAlerts} {heldAlerts === 1 ? 'match is' : 'matches are'} waiting for the alert
          window to open —{' '}
          <a
            href="/settings?tab=general"
            class="font-medium text-accent-strong transition-colors duration-150 hover:text-accent-deep"
          >
            change when alerts arrive
          </a>
          .
        </p>
      )}

      {!fetchingEnabled && (
        <p class="-mt-2 mb-4 text-[13px] leading-5 text-ink-faint">
          Paused means no new jobs or alerts. Fresh installs start paused so a blank profile
          doesn't spend AI credit —{' '}
          <a
            href="/settings?tab=profile"
            class="font-medium text-accent-strong transition-colors duration-150 hover:text-accent-deep"
          >
            fill the profile
          </a>
          , then press Resume. Fetch now still works while paused — it stores new jobs unscored.
        </p>
      )}

      <div class="mb-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {PRIMARY_STATUSES.map((s) => {
          const delta = byStatus24h[s] ?? 0;
          return (
            <Stat
              label={
                <span class="inline-flex items-center gap-1.5">
                  <span
                    class={`h-1.5 w-1.5 rounded-full ${TONE_DOT[statusTone(s)]}`}
                    aria-hidden="true"
                  />
                  {statusLabel(s)}
                </span>
              }
              value={byStatus[s] ?? 0}
              sub={
                delta > 0 ? (
                  <span class="font-medium text-ok">+{delta} in the last 24h</span>
                ) : (
                  <span>0 in the last 24h</span>
                )
              }
            />
          );
        })}
      </div>

      <p class="mb-6 text-[13px] text-ink-faint tabular-nums">
        {total.toLocaleString()} jobs tracked all-time · {total24h.toLocaleString()} seen in the
        last 24h · {(byStatus.DISMISSED ?? 0).toLocaleString()} dismissed
      </p>

      <div class="grid items-start gap-6 lg:grid-cols-3">
        <div class="min-w-0 lg:col-span-2">
          <SectionTitle>Recent alerts</SectionTitle>
          {recentAlerts.length === 0 ? (
            <Empty>No alerted jobs yet.</Empty>
          ) : (
            <Card flush>
              <ul class="divide-y divide-line">
                {recentAlerts.map((j) => (
                  <li>
                    <a
                      href={`/jobs/${j.id}`}
                      class="flex items-center justify-between gap-4 px-5 py-3 transition-colors duration-150 hover:bg-surface-overlay/50"
                    >
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-sm font-medium text-ink">{j.title}</div>
                        <div class="mt-0.5 truncate text-[13px] text-ink-faint">
                          {j.company.name} · {j.location || 'Remote'} ·{' '}
                          {formatRelative(j.alertedAt ?? j.fetchedAt)}
                        </div>
                      </div>
                      <div class="flex shrink-0 items-center gap-3">
                        <FitBadge score={j.fitScore} />
                        <StatusBadge status={j.status} />
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div class="min-w-0">
          <SectionTitle>Cron health</SectionTitle>
          <Card flush>
            <ul class="divide-y divide-line">
              {latestRuns.map(({ name, run }) => (
                <li class="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div class="flex min-w-0 items-center gap-2.5">
                    <span
                      class={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        run ? TONE_DOT[runTone(run.status)] : 'bg-line-strong'
                      }`}
                      aria-hidden="true"
                    />
                    <div class="min-w-0">
                      <div class="truncate font-mono text-[13px] text-ink">{name}</div>
                      <div class="text-xs text-ink-faint">
                        {run
                          ? `${formatDateShort(run.startedAt)} · ${formatDuration(
                              run.finishedAt
                                ? run.finishedAt.getTime() - run.startedAt.getTime()
                                : null,
                            )}`
                          : 'never ran'}
                      </div>
                    </div>
                  </div>
                  {run ? (
                    <Badge tone={runTone(run.status)}>{runLabel(run.status)}</Badge>
                  ) : (
                    <span class="text-xs text-ink-faint">—</span>
                  )}
                </li>
              ))}
            </ul>
            <div class="border-t border-line px-5 py-2.5 text-right">
              <a
                href="/runs"
                class="text-[13px] font-medium text-accent-strong transition-colors duration-150 hover:text-accent-deep"
              >
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
  for (const r of rows) out[r.status] = r.count;
  return out;
}

export function runTone(status: CronRunStatus): Tone {
  if (status === 'OK') return 'ok';
  if (status === 'FAILED') return 'danger';
  return 'info';
}

export function runLabel(status: CronRunStatus): string {
  if (status === 'OK') return 'OK';
  if (status === 'FAILED') return 'Failed';
  return 'Running';
}
