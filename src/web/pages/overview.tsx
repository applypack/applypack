/** @jsxImportSource hono/jsx */
import type { Child, FC } from 'hono/jsx';
import type { CronRunStatus } from '@prisma/client';
import { Layout } from '../layout';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CardLink,
  Empty,
  FitBadge,
  Flash,
  IconTile,
  Notice,
  PageHeader,
  SectionTitle,
  StatCard,
  StatusBadge,
  TONE_FILL,
  Tag,
  When,
} from '../ui';
import { Icon, type IconName } from '../icons';
import type { FlashMessage } from '../flash';
import type { FetchRun } from '../fetch-runs';
import type { HeldLine } from '../held-line';
import type { NextThing } from '../next-things';
import { jobHref } from '../job-tabs';
import type { ReadyPack } from '../../pack/store';
import { KPI_STATUSES, overviewHref, type KpiStatus } from '../overview-numbers';
import type { OverviewStats } from '../overview-stats';
import { placeLine } from '../place-line';
import { techLabel } from '../tech-label';
import type { WorkplaceCode } from '../../location';
import { FetchNowButton } from './fetch-run';
import { MatchesChart } from './matches-chart';
import {
  formatDate,
  formatDateShort,
  formatDuration,
  formatRelative,
  formatStamp,
  formatTime,
  statusLabel,
  statusTone,
} from '../format';
import type { Tone } from '../format';

interface JobRow {
  id: number;
  title: string;
  location: string;
  workplace: WorkplaceCode;
  countries: string[];
  regions: string[];
  techMatch: string[];
  fitScore: number | null;
  fetchedAt: Date;
  alertedAt: Date | null;
  status: 'NEW' | 'ALERTED' | 'APPLIED' | 'DISMISSED' | 'SAVED';
  /** ADR 0056: who hires, when an aggregator named them. */
  employer: string | null;
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
  recentAlerts: JobRow[];
  latestRuns: { name: string; run: RunRow | null }[];
  fetchingEnabled: boolean;
  /** "" while the schedule lets every hour through; "Sleeping until Mon 07:05" otherwise (TASKS §16). */
  sleepingUntil: string;
  /** Matches waiting to be sent — for the window, for Alerts, for a chat — or null. */
  held: HeldLine | null;
  /** §17: watched companies, what they put up in the last 24h (ADR 0036), and the pages only a paste can read (TASKS N8). */
  watched: { companies: number; newJobs: number; toPaste: number };
  /** The numbers behind the cards, the chart and the right-hand column (overview-stats.ts). */
  stats: OverviewStats;
  /** The places the running searches hunt in — a row names them before the rest. */
  places: string[];
  /** The manual fetch in flight, if any — the button turns into a link to it. */
  fetchRun: FetchRun | null;
  /** A wizard step is still undone (skipped or not) — show the way back to /welcome. */
  finishSetup: boolean;
  /** TASKS N11: open a match → compare → tailor, until the first comparison; null hides the card. */
  next: NextThing[] | null;
  /** Application packs prepared and not yet sent (ADR 0063); empty on an install that never asked for one. */
  readyPacks: ReadyPack[];
  flash?: FlashMessage | null;
}

/** What each status card is about, as a picture. */
const KPI_ICON: Record<KpiStatus, IconName> = {
  NEW: 'file-text',
  ALERTED: 'bell',
  APPLIED: 'send',
  SAVED: 'bookmark',
};

/** Technologies named on a row before the rest become a count. */
const ROW_TAGS = 3;

const QUIET_LINK = 'font-medium text-accent-strong transition-colors duration-150 hover:text-accent-deep';

const count = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

export const OverviewPage: FC<OverviewProps> = ({
  counts,
  recentAlerts,
  latestRuns,
  fetchingEnabled,
  sleepingUntil,
  held,
  watched,
  stats,
  places,
  fetchRun,
  finishSetup,
  next,
  readyPacks,
  flash,
}) => {
  const byStatus = mapCounts(counts);
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const failing = latestRuns.filter(({ run }) => run?.status === 'FAILED').length;
  const checked = stats.lastCheckedAt;

  return (
    <Layout title="Overview" active="overview" refresh={30}>
      <PageHeader
        title="Overview"
        meta={
          checked && (
            <span title={`${formatDate(checked)} · this page refreshes every 30 seconds`}>
              Last checked{' '}
              <time datetime={checked.toISOString()}>
                {formatDateShort(checked) === formatDateShort(new Date()) ? formatTime(checked) : formatStamp(checked)}
              </time>
            </span>
          )
        }
        actions={
          <>
            {finishSetup && (
              <a href="/welcome" class="inline-flex" title="Some setup steps are still open">
                <Badge tone="warn" size="md">
                  Finish setup
                  <Icon name="arrow-right" size={14} />
                </Badge>
              </a>
            )}
            <Badge tone={fetchingEnabled && !sleepingUntil ? 'ok' : 'neutral'} size="md">
              <span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
              {!fetchingEnabled ? 'Pipeline paused' : sleepingUntil ? `Sleeping until ${sleepingUntil}` : 'Pipeline running'}
            </Badge>
            <FetchNowButton run={fetchRun} />
            {/* Quick master switch — same toggle as Settings → General. */}
            <form method="post" action="/settings/fetching-toggle" class="flex">
              <input type="hidden" name="back" value="/" />
              <Button variant="secondary">
                <Icon name={fetchingEnabled ? 'pause' : 'play'} size={16} />
                {fetchingEnabled ? 'Pause' : 'Resume'}
              </Button>
            </form>
          </>
        }
      >
        Your job search activity and pipeline status.
      </PageHeader>
      <Flash flash={flash} />

      {/* What stands between the search and its alerts, said before any number. */}
      {!fetchingEnabled && (
        <Notice tone="warn" class="mb-4">
          Paused means no new jobs or alerts. Fresh installs start paused so a blank profile doesn't spend AI credit —{' '}
          <a href="/settings?tab=profile" class="font-medium underline">
            fill the profile
          </a>
          , then press Resume. Fetch now still works while paused — it stores new jobs unscored.
        </Notice>
      )}
      {fetchingEnabled && held && (
        <Notice tone="warn" class="mb-4">
          {held.text} —{' '}
          <a href={held.href} class="font-medium underline">
            {held.action}
          </a>
          .
        </Notice>
      )}

      <section aria-label="Jobs by status" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(18rem,27%)]">
        {KPI_STATUSES.map((status) => {
          const moved = stats.kpi[status].last24h;
          return (
            <StatCard
              label={statusLabel(status)}
              value={byStatus[status] ?? 0}
              tone={statusTone(status)}
              icon={KPI_ICON[status]}
              href={`/jobs?status=${status}`}
              hrefLabel="open in Jobs"
              spark={stats.kpi[status].spark}
              delta={
                moved > 0 ? (
                  <>
                    <span class="font-medium text-ok">+{count(moved)}</span> in the last 24h
                  </>
                ) : (
                  '0 in the last 24h'
                )
              }
            />
          );
        })}
      </section>
      <p data-ui="hint" class="mb-4 mt-2.5 text-meta tabular-nums text-ink-faint">
        {count(total)} jobs tracked all-time · {count(byStatus.DISMISSED ?? 0)} dismissed
      </p>

      {next && <NextThingsCard steps={next} />}
      {readyPacks.length > 0 && <ReadyPacksCard packs={readyPacks} />}

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,27%)]">
        <div class="min-w-0 space-y-4">
          <MatchesChart chart={stats.chart} funnel={stats.funnel} />
          <RecentAlerts jobs={recentAlerts} places={places} />
        </div>

        <div class="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-1">
          <Card>
            <CardHeader
              title="Pipeline health"
              info="The latest run of each scheduled job: when it started and how long it took."
              action={<CardLink href="/runs">View history</CardLink>}
            >
              {failing > 0 && <Badge tone="danger">{failing} failing</Badge>}
            </CardHeader>
            <ul class="divide-y divide-line">
              {latestRuns.map(({ name, run }) => (
                <li class="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span
                    class={`h-2 w-2 shrink-0 rounded-full ${run ? TONE_FILL[runTone(run.status)] : 'bg-line-strong'}`}
                    aria-hidden="true"
                  />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">{name}</span>
                  {/* The word, not the dot alone: said aloud for a healthy run, shown for one that is not. */}
                  {run && run.status === 'OK' && <span class="sr-only">OK</span>}
                  {run && run.status !== 'OK' && <Badge tone={runTone(run.status)}>{runLabel(run.status)}</Badge>}
                  <span class="shrink-0 text-note tabular-nums text-ink-faint">
                    {run
                      ? `${formatRelative(run.startedAt)} · ${formatDuration(
                          run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
                        )}`
                      : 'never ran'}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Recent activity" info="What the search did in the last 24 hours, and when each last happened.">
              <span class="shrink-0 text-note text-ink-faint">24 hours</span>
            </CardHeader>
            <ul class="divide-y divide-line">
              <ActivityRow
                icon="download"
                title={stats.activity.fetched24h > 0 ? `${plural(stats.activity.fetched24h, 'new job', 'new jobs')} fetched` : 'No new jobs fetched'}
                at={stats.activity.lastFetchedAt}
              />
              <ActivityRow
                icon="search"
                title={stats.activity.matches24h > 0 ? `${plural(stats.activity.matches24h, 'match', 'matches')} found` : 'No matches found'}
                at={stats.activity.lastMatchAt}
                none="None in the last 30 days"
              />
              <ActivityRow
                icon="bell"
                title={stats.activity.alerts24h > 0 ? `${plural(stats.activity.alerts24h, 'alert', 'alerts')} sent` : 'No alerts sent'}
                at={stats.activity.lastAlertAt}
              />
              {watched.companies > 0 && (
                <ActivityRow
                  icon="building"
                  tone="neutral"
                  title={`${plural(watched.companies, 'watched company', 'watched companies')}`}
                  detail={
                    <>
                      {watched.newJobs === 0 ? (
                        'nothing new in the last 24h'
                      ) : (
                        <a href="/jobs?watched=1" class={QUIET_LINK}>
                          {plural(watched.newJobs, 'new posting', 'new postings')} in the last 24h
                        </a>
                      )}
                      {watched.toPaste > 0 && (
                        <>
                          {' · '}
                          <a href="/companies#browser-pages" class={QUIET_LINK}>
                            {count(watched.toPaste)} to paste by hand
                          </a>
                        </>
                      )}
                    </>
                  }
                />
              )}
            </ul>
          </Card>

          {stats.stack.terms.length > 0 && (
            <Card>
              <CardHeader
                title="Jobs by stack"
                info="The technologies from your searches that the last 30 days' matches name. A job counts once for each one it names. Pick a bar to narrow the chart."
              >
                <span class="shrink-0 text-note text-ink-faint">30 days</span>
              </CardHeader>
              <ul class="space-y-2.5">
                {stats.stack.terms.map((t) => {
                  const current = stats.chart.stack === t.term;
                  return (
                    <li>
                      <a
                        href={`${overviewHref({ range: stats.chart.stackAllowed ? stats.chart.range : '30d', stack: current ? null : t.term })}#matches`}
                        aria-current={current ? 'true' : undefined}
                        title={current ? 'Show every technology again' : `Narrow the chart to ${techLabel(t.term)}`}
                        class="group flex items-center gap-3 text-sm"
                      >
                        <span
                          class={`w-24 shrink-0 truncate transition-colors duration-150 group-hover:text-accent-strong ${
                            current ? 'font-semibold text-accent-strong' : 'text-ink'
                          }`}
                        >
                          {techLabel(t.term)}
                        </span>
                        <span class="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-overlay" aria-hidden="true">
                          <span
                            class={`block h-full rounded-full ${current ? 'bg-accent-strong' : 'bg-accent'}`}
                            style={`width:${Math.max(3, t.share)}%`}
                          />
                        </span>
                        <span class="w-8 shrink-0 text-right tabular-nums text-ink-muted">{count(t.count)}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
              <p data-ui="hint" class="mt-4 border-t border-line pt-3 text-meta text-ink-faint">
                Out of {plural(stats.stack.matches, 'match', 'matches')} in the last 30 days.
              </p>
            </Card>
          )}
        </div>
      </div>
      <script type="module" dangerouslySetInnerHTML={{ __html: OVERVIEW_BOOT }} />
    </Layout>
  );
};

/** The chart's hover and the technology select that submits itself — both optional to the page. */
const OVERVIEW_BOOT = `
import { wireCharts } from '/static/chart.mjs';
import { wireSelectCommits } from '/static/select-commit.mjs';
wireCharts(document);
wireSelectCommits(document);
`;

const RecentAlerts: FC<{ jobs: JobRow[]; places: string[] }> = ({ jobs, places }) => (
  <Card flush>
    <CardHeader title="Recent alerts" class="px-5 pb-3 pt-5" action={<CardLink href="/jobs?status=ALERTED">View all</CardLink>} />
    {jobs.length === 0 ? (
      <Empty
        bare
        title="No alerts yet"
        action={
          <Button href="/jobs" variant="secondary" size="sm">
            See all jobs
          </Button>
        }
      >
        A job lands here when a running search scores it at or above its threshold.
      </Empty>
    ) : (
      <ul class="divide-y divide-line border-t border-line">
        {jobs.map((j) => {
          const place = placeLine(j, places);
          const who = j.employer ?? j.company.name;
          return (
            <li>
              <a
                href={`/jobs/${j.id}`}
                class="flex items-center gap-3.5 px-5 py-3 transition-colors duration-150 hover:bg-surface-selected/40"
              >
                <Avatar name={who} />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-entity text-ink">{j.title}</div>
                  <div class="mt-0.5 truncate text-note text-ink-faint" title={`${who} · ${place.title}`}>
                    {who} · {place.text}
                  </div>
                </div>
                {j.techMatch.length > 0 && (
                  // Two technologies where the column is narrow, three from 2xl; the rest is a count either way.
                  <div class="hidden shrink-0 items-center gap-1.5 lg:flex" title={j.techMatch.map(techLabel).join(', ')}>
                    {j.techMatch.slice(0, ROW_TAGS).map((t, i) => (
                      <span class={i === ROW_TAGS - 1 ? 'hidden 2xl:inline-flex' : 'inline-flex'}>
                        <Tag>{techLabel(t)}</Tag>
                      </span>
                    ))}
                    {j.techMatch.length >= ROW_TAGS && (
                      <span class="text-meta tabular-nums text-ink-faint 2xl:hidden">+{j.techMatch.length - (ROW_TAGS - 1)}</span>
                    )}
                    {j.techMatch.length > ROW_TAGS && (
                      <span class="hidden text-meta tabular-nums text-ink-faint 2xl:inline">+{j.techMatch.length - ROW_TAGS}</span>
                    )}
                  </div>
                )}
                <div class="flex shrink-0 items-center gap-3">
                  <FitBadge score={j.fitScore} />
                  <span class="hidden sm:inline-flex">
                    <StatusBadge status={j.status} />
                  </span>
                  <span class="hidden w-14 text-right text-note tabular-nums text-ink-faint sm:block">
                    <When at={j.alertedAt ?? j.fetchedAt} />
                  </span>
                </div>
              </a>
            </li>
          );
        })}
      </ul>
    )}
  </Card>
);

/** One line of what happened: its picture, the count in words, and when it last did — or that it never has. */
const ActivityRow: FC<{ icon: IconName; title: string; at?: Date | null; none?: string; detail?: Child; tone?: Tone }> = ({
  icon,
  title,
  at,
  none = 'None yet',
  detail,
  tone = 'ok',
}) => (
  <li class="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
    <IconTile icon={icon} tone={tone} class="h-9 w-9 !rounded-full" />
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-medium text-ink">{title}</div>
      <div class="mt-0.5 truncate text-note text-ink-faint">
        {detail ?? (at ? <>Latest <When at={at} /></> : none)}
      </div>
    </div>
  </li>
);

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

/** The loop the product is for, in three steps, until the user has walked it once (TASKS N11). */
/** What the worker prepared while nobody watched: read the edits, download the file, apply. */
const ReadyPacksCard: FC<{ packs: ReadyPack[] }> = ({ packs }) => (
  <Card class="mb-4">
    <SectionTitle>Ready to send ({packs.length})</SectionTitle>
    <ul class="mt-2 divide-y divide-line">
      {packs.map((p) => (
        <li class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
          <a href={jobHref(p.jobId, 'pack')} class={`min-w-0 ${QUIET_LINK}`}>
            {p.title} — {p.company}
          </a>
          <span class="text-meta tabular-nums text-ink-faint">
            {p.scoreBefore !== null && `match ${p.scoreBefore}${p.scoreAfter !== null && p.scoreAfter !== p.scoreBefore ? ` → ${p.scoreAfter}` : ''} · `}
            prepared <When at={p.finishedAt} />
          </span>
        </li>
      ))}
    </ul>
  </Card>
);

const NextThingsCard: FC<{ steps: NextThing[] }> = ({ steps }) => (
  <Card class="mb-4">
    <SectionTitle>Next: three things</SectionTitle>
    <ol class="mt-3 grid gap-5 md:grid-cols-3">
      {steps.map((s, i) => (
        <li class="min-w-0">
          <div class="text-label text-ink">
            <span class="tabular-nums text-ink-faint">{i + 1}.</span>{' '}
            {s.href ? (
              <a href={s.href} class={QUIET_LINK}>
                {s.title}
              </a>
            ) : (
              s.title
            )}
          </div>
          <p data-ui="hint" class="mt-1 text-meta text-ink-faint">
            {s.body}
          </p>
        </li>
      ))}
    </ol>
  </Card>
);
