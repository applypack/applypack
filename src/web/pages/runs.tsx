/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { CronRunStatus } from '@prisma/client';
import { Layout } from '../layout';
import { Card, Empty } from '../ui';
import { formatDate, formatDuration } from '../format';

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
}

export const RunsPage: FC<RunsProps> = ({ runs }) => (
  <Layout title="Cron runs" active="runs">
    <div class="mb-6 flex items-baseline justify-between">
      <h1 class="text-2xl font-semibold tracking-tight">Cron runs</h1>
      <span class="text-sm text-zinc-500 tabular-nums">
        last {runs.length}
      </span>
    </div>

    {runs.length === 0 ? (
      <Empty>No runs recorded yet. Worker has not ticked.</Empty>
    ) : (
      <Card class="!p-0 overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th class="px-4 py-2.5 font-medium">Job</th>
              <th class="px-4 py-2.5 font-medium">Started</th>
              <th class="px-4 py-2.5 font-medium">Duration</th>
              <th class="px-4 py-2.5 font-medium">Status</th>
              <th class="px-4 py-2.5 font-medium">Stats / error</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-900">
            {runs.map((r) => (
              <tr class="hover:bg-zinc-900/50 align-top">
                <td class="px-4 py-2.5 font-medium text-zinc-100">{r.name}</td>
                <td class="px-4 py-2.5 text-zinc-400">
                  {formatDate(r.startedAt)}
                </td>
                <td class="px-4 py-2.5 text-zinc-300 tabular-nums">
                  {r.finishedAt
                    ? formatDuration(
                        r.finishedAt.getTime() - r.startedAt.getTime(),
                      )
                    : '—'}
                </td>
                <td class="px-4 py-2.5">
                  <RunBadge status={r.status} />
                </td>
                <td class="px-4 py-2.5">
                  {r.errorMessage ? (
                    <pre class="whitespace-pre-wrap break-words text-xs text-rose-400">
                      {r.errorMessage}
                    </pre>
                  ) : r.stats ? (
                    <code class="block whitespace-pre-wrap break-words font-mono text-xs text-zinc-400">
                      {JSON.stringify(r.stats)}
                    </code>
                  ) : (
                    <span class="text-xs text-zinc-600">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    )}
  </Layout>
);

const RunBadge: FC<{ status: CronRunStatus }> = ({ status }) => {
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
