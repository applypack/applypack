/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { CronRunStatus } from '@prisma/client';
import { Layout } from '../layout';
import { Badge, Card, Empty, PageHeader, Table, Td, Tr } from '../ui';
import { formatDate, formatDuration } from '../format';
import { runTone } from './overview';

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
    <PageHeader title="Cron runs" meta={`last ${runs.length}`} />

    {runs.length === 0 ? (
      <Empty>No runs recorded yet. Worker has not ticked.</Empty>
    ) : (
      <Card flush>
        <Table columns={['Job', 'Started', 'Duration', 'Status', 'Stats / error']}>
          {runs.map((r) => (
            <Tr class="align-top">
              <Td class="font-mono text-ink">{r.name}</Td>
              <Td class="whitespace-nowrap text-ink-muted">{formatDate(r.startedAt)}</Td>
              <Td class="font-mono tabular-nums text-ink-muted">
                {r.finishedAt
                  ? formatDuration(r.finishedAt.getTime() - r.startedAt.getTime())
                  : '—'}
              </Td>
              <Td>
                <Badge tone={runTone(r.status)}>{r.status}</Badge>
              </Td>
              <Td>
                {r.errorMessage ? (
                  <pre class="whitespace-pre-wrap break-words font-mono text-xs text-danger">
                    {r.errorMessage}
                  </pre>
                ) : r.stats ? (
                  <code class="block whitespace-pre-wrap break-words font-mono text-xs text-ink-faint">
                    {JSON.stringify(r.stats)}
                  </code>
                ) : (
                  <span class="text-xs text-ink-faint">—</span>
                )}
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>
    )}
  </Layout>
);
