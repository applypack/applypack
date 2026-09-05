/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { CronRunStatus } from '@prisma/client';
import { Layout } from '../layout';
import { Badge, Card, Empty, Flash, PageHeader, Table, Td, Tr } from '../ui';
import type { FlashMessage } from '../flash';
import { formatDate, formatDuration } from '../format';
import type { FetchRun } from '../fetch-runs';
import type { SourceStat } from '../../jobs/cron-run';
import { FetchNowButton } from './fetch-run';
import { runLabel, runTone } from './overview';

interface RunRow {
  id: number;
  name: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: CronRunStatus;
  stats: unknown;
  errorMessage: string | null;
}

export interface RunsProps {
  runs: RunRow[];
  /** The manual fetch in flight, if any — the button turns into a link to it. */
  fetchRun: FetchRun | null;
  flash?: FlashMessage | null;
}

export const RunsPage: FC<RunsProps> = ({ runs, fetchRun, flash }) => (
  <Layout title="Cron runs" active="runs">
    <PageHeader
      title="Cron runs"
      meta={`last ${runs.length}`}
      actions={<FetchNowButton run={fetchRun} />}
    />
    <Flash flash={flash} />

    {runs.length === 0 ? (
      <Empty>No runs recorded yet. The worker has not ticked — press Fetch now to run the first one.</Empty>
    ) : (
      <Card flush>
        <div class="overflow-x-auto">
          <div class="min-w-[56rem]">
            <Table
              columns={[
                'Job',
                'Started',
                <span class="block text-right">Duration</span>,
                'Status',
                'Stats / error',
              ]}
            >
              {runs.map((r) => (
                <Tr class="align-top">
                  <Td class="whitespace-nowrap font-mono text-[13px] text-ink">{r.name}</Td>
                  <Td class="whitespace-nowrap text-ink-muted">{formatDate(r.startedAt)}</Td>
                  <Td class="whitespace-nowrap text-right font-mono text-[13px] tabular-nums text-ink-muted">
                    {r.finishedAt
                      ? formatDuration(r.finishedAt.getTime() - r.startedAt.getTime())
                      : '—'}
                  </Td>
                  <Td>
                    <Badge tone={runTone(r.status)}>{runLabel(r.status)}</Badge>
                  </Td>
                  <Td class="w-full">
                    {r.errorMessage ? (
                      <pre class="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-danger">
                        {r.errorMessage}
                      </pre>
                    ) : r.stats ? (
                      <StatsCell stats={r.stats} />
                    ) : (
                      <span class="text-xs text-ink-faint">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </Table>
          </div>
        </div>
      </Card>
    )}
  </Layout>
);

/**
 * The stats JSON, with a fetch tick's per-source list folded under it —
 * slowest first, so the source that took the minute is the first line.
 */
const StatsCell: FC<{ stats: unknown }> = ({ stats }) => {
  const { bySource, ...rest } = (typeof stats === 'object' && stats !== null ? stats : {}) as Record<string, unknown>;
  const sources = Array.isArray(bySource) ? (bySource as SourceStat[]) : [];
  return (
    <>
      <code class="block whitespace-pre-wrap break-words font-mono text-xs leading-5 text-ink-faint">
        {JSON.stringify(rest)}
      </code>
      {sources.length > 0 && (
        <details class="mt-1">
          <summary class="cursor-pointer text-xs text-ink-faint">by source ({sources.length}), slowest first</summary>
          <ul class="mt-1 font-mono text-xs leading-5 text-ink-faint">
            {[...sources]
              .sort((a, b) => b.ms - a.ms)
              .map((s) => (
                <li>
                  {formatDuration(s.ms)} · {s.name} · {s.status}
                  {s.count > 0 ? ` · ${s.count}` : ''}
                </li>
              ))}
          </ul>
        </details>
      )}
    </>
  );
};
