/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { CronRunStatus } from '@prisma/client';
import { Layout } from '../layout';
import { Badge, Card, Disclosure, Empty, Flash, PageHeader, SectionTitle, Table, Td, Tr } from '../ui';
import type { FlashMessage } from '../flash';
import { formatDate, formatDuration, formatStamp } from '../format';
import { displayZoneLabel } from '../display-zone';
import type { FetchRun } from '../fetch-runs';
import type { CronStats, SourceStat } from '../../jobs/cron-run';
import { failedRunLine, summarizeRun } from '../runs-summary';
import { FetchNowButton } from './fetch-run';
import { FunnelCard } from './funnel-card';
import { runLabel, runTone } from './overview';
import type { FunnelView } from '../../funnel';
import type { SourceYield } from '../../jobs/funnel-store';
import { t } from '../../i18n/t';

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
  /** The search funnel over the last 7 and 30 days, and what each source brought. */
  funnel: { week: FunnelView; month: FunnelView; sources: SourceYield[] };
  /** The manual fetch in flight, if any — the button turns into a link to it. */
  fetchRun: FetchRun | null;
  flash?: FlashMessage | null;
}

/** How many runs the page shows before the rest fold away: two days of hourly ticks. */
const RECENT_RUNS = 50;

/** The header names the zone once, so each row can say only the day and the time. */
const columns = () => [
  t('runs.column.job'),
  t('runs.column.started', { zone: displayZoneLabel() }),
  <span class="block text-right">{t('runs.duration')}</span>,
  t('runs.column.status'),
  t('runs.column.whatHappened'),
];
const WIDTHS = ['w-[15%]', 'w-[17%]', 'w-[8%]', 'w-[7%]', 'w-[53%]'];

export const RunsPage: FC<RunsProps> = ({ runs, funnel, fetchRun, flash }) => {
  const recent = runs.slice(0, RECENT_RUNS);
  // A fresh install has read nothing yet: the empty state below says what to do.
  const funnelShown = funnel.month.stages.some((s) => s.count > 0) || funnel.sources.length > 0;
  const earlier = runs.slice(RECENT_RUNS);
  const earlierFailed = earlier.filter((r) => r.status === 'FAILED').length;
  return (
    <Layout title={t('runs.runs')} active="runs">
      <PageHeader title={t('runs.runs')} meta={t('runs.lastN', { n: runs.length })} actions={<FetchNowButton run={fetchRun} />}>
        {t('runs.whatTheSearchKeptAnd')}
      </PageHeader>
      <Flash flash={flash} />

      {funnelShown && <FunnelCard {...funnel} />}
      {funnelShown && runs.length > 0 && <SectionTitle level="section">{t('runs.runHistory')}</SectionTitle>}

      {runs.length === 0 ? (
        <Empty title={t('runs.noRunsYet')}>
          {t('runs.theWorkerWritesARow')}
        </Empty>
      ) : (
        <>
          <RunsTable runs={recent} caption={t('runs.runs')} />
          {earlier.length > 0 && (
            // A failure never hides: the fold says so, and opens itself when there is one.
            <Disclosure
              variant="button"
              summary={t(earlierFailed > 0 ? 'runs.earlierWithFailed' : 'runs.earlierCount', { n: earlier.length, failed: earlierFailed })}
              open={earlierFailed > 0}
              class="mt-4"
            >
              <div class="mt-3">
                <RunsTable runs={earlier} caption={t('runs.earlierRuns')} />
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
      {/* TASKS U7: a phone keeps the job, its status and what happened. */}
      <div class="md:min-w-[56rem]">
        <Table caption={caption} columns={columns()} widths={WIDTHS} hideBelow={['', 'sm', 'md', '', '']}>
          {runs.map((r) => (
            <Tr class="align-top">
              <Td class="whitespace-nowrap font-mono text-note text-ink">
                <span translate="no">{r.name}</span>
              </Td>
              <Td class="whitespace-nowrap text-ink-muted">
                <span title={formatDate(r.startedAt)}>{formatStamp(r.startedAt)}</span>
              </Td>
              <Td class="whitespace-nowrap text-right font-mono text-note tabular-nums text-ink-muted">
                {r.finishedAt ? formatDuration(r.finishedAt.getTime() - r.startedAt.getTime()) : '—'}
              </Td>
              <Td>
                <Badge tone={runTone(r.status)}>{runLabel(r.status)}</Badge>
              </Td>
              <Td>
                {r.errorMessage ? (
                  <div>
                    <p class="text-note leading-5 text-danger">{failedRunLine(r.name, r.errorMessage)}</p>
                    <details class="mt-1">
                      <summary class="cursor-pointer text-meta text-ink-faint transition-colors duration-150 hover:text-ink">{t('runs.details')}</summary>
                      <pre class="mt-1 whitespace-pre-wrap break-words font-mono text-meta leading-5 text-ink-muted">{r.errorMessage}</pre>
                    </details>
                  </div>
                ) : r.stats ? (
                  <StatsCell name={r.name} stats={r.stats} />
                ) : (
                  <span class="text-meta text-ink-faint">—</span>
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
        <ul class="flex flex-wrap gap-x-2 text-note leading-5 tabular-nums text-ink-muted [&>li+li]:before:mr-2 [&>li+li]:before:text-ink-faint [&>li+li]:before:content-['·']">
          {facts.map((fact) => (
            <li>{fact}</li>
          ))}
        </ul>
      )}
      {/* A bare <details>, not the Disclosure primitive: a drawn chevron a hundred times over
          is 40 KB of markup on the one page that is a log. The native marker does here. */}
      <details class="contents">
        <summary class="cursor-pointer text-meta text-ink-faint transition-colors duration-150 hover:text-ink">{t('runs.details')}</summary>
        {/* min-w-0 + break-all: a space-less JSON string is one unbreakable word, and a flex
            item will not shrink under its longest word on its own. */}
        <div class="order-last min-w-0 basis-full pt-1 font-mono text-meta leading-5 text-ink-faint">
          {sources.length > 0 && (
            <ul class="mb-1">
              {[...sources]
                .sort((a: SourceStat, b: SourceStat) => b.ms - a.ms)
                .map((s: SourceStat) => (
                  <li>
                    {formatDuration(s.ms)} · <span translate="no">{s.name} · {s.status}</span>
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
