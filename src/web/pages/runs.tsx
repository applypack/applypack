/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { CronRunStatus } from '@prisma/client';
import { Layout } from '../layout';
import { Badge, Card, Disclosure, Empty, Flash, PageHeader, Table, Td, Tr } from '../ui';
import type { FlashMessage } from '../flash';
import { formatDate, formatDuration } from '../format';
import type { FetchRun } from '../fetch-runs';
import type { CronStats, SourceStat } from '../../jobs/cron-run';
import { summarizeRun } from '../runs-summary';
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

/** How many runs the page shows before the rest fold away: two days of hourly ticks. */
const RECENT_RUNS = 50;

const COLUMNS = ['Job', 'Started', <span class="block text-right">Duration</span>, 'Status', 'What happened'];
const WIDTHS = ['w-[15%]', 'w-[17%]', 'w-[8%]', 'w-[7%]', 'w-[53%]'];

export const RunsPage: FC<RunsProps> = ({ runs, fetchRun, flash }) => {
  const recent = runs.slice(0, RECENT_RUNS);
  const earlier = runs.slice(RECENT_RUNS);
  const earlierFailed = earlier.filter((r) => r.status === 'FAILED').length;
  return (
    <Layout title="Runs" active="runs">
      <PageHeader title="Runs" meta={`last ${runs.length}`} actions={<FetchNowButton run={fetchRun} />} />
      <Flash flash={flash} />

      {runs.length === 0 ? (
        <Empty title="No runs yet">
          The worker writes a row here on every tick, and it has not ticked yet. Press Fetch now to run
          the first search.
        </Empty>
      ) : (
        <>
          <RunsTable runs={recent} caption="Runs" />
          {earlier.length > 0 && (
            // A failure never hides: the fold says so, and opens itself when there is one.
            <Disclosure
              variant="button"
              summary={`${earlier.length} earlier runs${earlierFailed > 0 ? ` · ${earlierFailed} failed` : ''}`}
              open={earlierFailed > 0}
              class="mt-4"
            >
              <div class="mt-3">
                <RunsTable runs={earlier} caption="Earlier runs" />
              </div>
            </Disclosure>
          )}
        </>
      )}
    </Layout>
  );
};

const RunsTable: FC<{ runs: RunRow[]; caption: string }> = ({ runs, caption }) => (
  <Card flush>
    <div class="overflow-x-auto">
      <div class="min-w-[56rem]">
        <Table caption={caption} columns={COLUMNS} widths={WIDTHS}>
          {runs.map((r) => (
            <Tr class="align-top">
              <Td class="whitespace-nowrap font-mono text-[13px] text-ink">{r.name}</Td>
              <Td class="whitespace-nowrap text-ink-muted">{formatDate(r.startedAt)}</Td>
              <Td class="whitespace-nowrap text-right font-mono text-[13px] tabular-nums text-ink-muted">
                {r.finishedAt ? formatDuration(r.finishedAt.getTime() - r.startedAt.getTime()) : '—'}
              </Td>
              <Td>
                <Badge tone={runTone(r.status)}>{runLabel(r.status)}</Badge>
              </Td>
              <Td>
                {r.errorMessage ? (
                  <pre class="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-danger">
                    {r.errorMessage}
                  </pre>
                ) : r.stats ? (
                  <StatsCell name={r.name} stats={r.stats} />
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
);

/**
 * A run as a sentence (runs-summary.ts): the facts in a fixed order on one
 * line, the dot between them drawn rather than typed. What they were read
 * from folds behind "Details" on the same line — a fetch tick's per-source
 * list, slowest first so the source that took the minute leads, then the
 * stats JSON. (Two folds under every sentence measured worse than the JSON
 * they replaced: 2 152 words and 8 372 px against 1 410 and 7 741.)
 */
const StatsCell: FC<{ name: string; stats: unknown }> = ({ name, stats }) => {
  const { bySource, ...rest } = (typeof stats === 'object' && stats !== null ? stats : {}) as CronStats;
  const sources = Array.isArray(bySource) ? bySource : [];
  const facts = summarizeRun(name, rest);
  return (
    <div class="flex flex-wrap items-baseline gap-x-4">
      {facts.length > 0 && (
        <ul class="flex flex-wrap gap-x-2 text-[13px] leading-5 tabular-nums text-ink-muted [&>li+li]:before:mr-2 [&>li+li]:before:text-ink-faint [&>li+li]:before:content-['·']">
          {facts.map((fact) => (
            <li>{fact}</li>
          ))}
        </ul>
      )}
      {/* A bare <details>, not the Disclosure primitive: a drawn chevron a hundred times over
          is 40 KB of markup on the one page that is a log. The native marker does here. */}
      <details class="contents">
        <summary class="cursor-pointer text-xs text-ink-faint transition-colors duration-150 hover:text-ink">Details</summary>
        {/* min-w-0 + break-all: a space-less JSON string is one unbreakable word, and a flex
            item will not shrink under its longest word on its own. */}
        <div class="order-last min-w-0 basis-full pt-1 font-mono text-xs leading-5 text-ink-faint">
          {sources.length > 0 && (
            <ul class="mb-1">
              {[...sources]
                .sort((a: SourceStat, b: SourceStat) => b.ms - a.ms)
                .map((s: SourceStat) => (
                  <li>
                    {formatDuration(s.ms)} · {s.name} · {s.status}
                    {s.count > 0 ? ` · ${s.count}` : ''}
                  </li>
                ))}
            </ul>
          )}
          <code class="block whitespace-pre-wrap break-all">{JSON.stringify(rest)}</code>
        </div>
      </details>
    </div>
  );
};
