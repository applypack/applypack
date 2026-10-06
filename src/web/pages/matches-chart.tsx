/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Button, Card, CardHeader, CardLink, Select } from '../ui';
import { Icon } from '../icons';
import { PLOT_HEIGHT, PLOT_WIDTH, areaPath, linePath, plotPoints, tickOffset } from '../chart-svg';
import { overviewHref } from '../overview-numbers';
import type { OverviewChart } from '../overview-stats';
import { DEFAULT_RANGE, RANGES, RANGE_KEYS, dayLabel, labelIndexes, pointLabel, trendText } from '../stats-series';
import { techLabel } from '../tech-label';
import { stageCount, type FunnelView, type StageKey } from '../../funnel';
import { formatNumber } from '../../i18n/format';
import { t } from '../../i18n/t';

/*
 * The Overview's chart: how many jobs matched the searches, day by day. The
 * server draws it (chart-svg.ts), so it is in the page before any script and
 * without one; public/chart.mjs adds the hover. The range and the technology
 * are links and a plain form — the page's 30-second refresh reloads the same
 * URL, so what was picked stays picked.
 */

/** The four stages the card's foot walks through; the word each count is followed by is `overview.flow.<key>`. */
const FLOW = ['read', 'passed', 'matches', 'alerted'] as const satisfies readonly StageKey[];

const RangeSwitch: FC<{ chart: OverviewChart }> = ({ chart }) => (
  <nav aria-label={t('overview.chartRange')} class="inline-flex rounded-md bg-surface-overlay p-0.5">
    {RANGE_KEYS.map((key) => {
      const current = key === chart.range;
      // A technology filter reaches back 30 days; a longer range lets go of it.
      const stack = RANGES[key].days <= RANGES['30d'].days ? chart.stack : null;
      return (
        <a
          href={overviewHref({ range: key, stack })}
          aria-current={current ? 'true' : undefined}
          class={`rounded-[6px] px-2.5 py-1 text-note font-medium tabular-nums transition-colors duration-150 ${
            current ? 'bg-surface-raised text-accent-strong shadow-sm' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {t('overview.chart.rangeLabel', { n: RANGES[key].days })}
        </a>
      );
    })}
  </nav>
);

const StackFilter: FC<{ chart: OverviewChart }> = ({ chart }) => (
  <form method="get" action="/" class="relative flex items-center gap-2">
    {chart.range !== DEFAULT_RANGE && <input type="hidden" name="range" value={chart.range} />}
    <span class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint">
      <Icon name="layers" size={16} />
    </span>
    <Select
      name="stack"
      data-commit="submit"
      aria-label={t('overview.technology')}
      class="!w-auto !py-1 !pl-8 font-medium"
      disabled={!chart.stackAllowed}
      title={chart.stackAllowed ? undefined : t('overview.byTechnologyTheChartLooks')}
    >
      <option value="">{t('overview.allStack')}</option>
      {chart.options.map((o) => (
        <option value={o.term} selected={o.term === chart.stack} translate="no">
          {techLabel(o.term)}
        </option>
      ))}
    </Select>
    {/* The no-JS path: select-commit.mjs submits on a pick and this button never shows. */}
    <noscript>
      <Button size="sm" variant="secondary">
        {t('overview.apply')}
      </Button>
    </noscript>
  </form>
);

export const MatchesChart: FC<{ chart: OverviewChart; funnel: FunnelView }> = ({ chart, funnel }) => {
  const { days, step } = RANGES[chart.range];
  const top = chart.ticks[chart.ticks.length - 1] ?? 0;
  const values = chart.points.map((p) => p.value);
  const points = plotPoints(values, top);
  const count = chart.points.length;
  // Read by public/chart.mjs for the hover card, which words its own lines in the browser.
  const stepWords = step === 1 ? 'day' : `${step} days`;
  const peak = chart.points.reduce((best, p) => (p.value > best.value ? p : best), chart.points[0]!);
  const tech = chart.stack ? techLabel(chart.stack) : '';
  const said = { n: chart.total, days, step, tech, peak: peak.value, when: pointLabel(peak) };
  const caption =
    chart.total === 0
      ? t(chart.stack ? 'overview.chart.captionNoneStack' : 'overview.chart.captionNone', said)
      : t(chart.stack ? 'overview.chart.captionStack' : 'overview.chart.caption', said);
  const hoverData = chart.points.map((p, i) => ({ l: pointLabel(p), v: p.value, y: Math.round((points[i]!.y / PLOT_HEIGHT) * 10000) / 100 }));
  const labelled = labelIndexes(count);
  const phoneEvery = Math.ceil(labelled.length / 3);

  return (
    <Card id="matches">
      <CardHeader
        title={t('overview.jobsMatchingYourSearches')}
        info={t('overview.chart.info')}
        class="mb-3"
        action={
          <div class="flex flex-wrap items-center gap-2">
            <RangeSwitch chart={chart} />
            {chart.options.length > 0 && <StackFilter chart={chart} />}
          </div>
        }
      />

      <p class="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span class="text-kpi tabular-nums text-ink">{formatNumber(chart.total)}</span>
        <span class="text-sm text-ink-muted">{t(chart.stack ? 'overview.chart.unitStack' : 'overview.chart.unit', { n: chart.total, tech })}</span>
        {chart.trend ? (
          <>
            <span
              class={`inline-flex items-center gap-1 self-center rounded-full px-2 py-0.5 text-note font-medium tabular-nums ring-1 ring-inset ${
                chart.trend.direction === 'up' ? 'pill-ok text-ok ring-ok/25' : 'bg-surface-overlay text-ink-muted ring-line'
              }`}
            >
              {chart.trend.direction !== 'flat' && (
                <Icon name={chart.trend.direction === 'up' ? 'arrow-up-right' : 'arrow-down-right'} size={14} />
              )}
              {trendText(chart.trend)}
            </span>
            <span class="text-note text-ink-faint">{t('overview.chart.vsPrevious', { days })}</span>
          </>
        ) : (
          <span class="text-note text-ink-faint">{t('overview.chart.inLast', { days })}</span>
        )}
      </p>

      <figure class="mt-5">
        {/* The plot: ticks and dates are HTML beside a stretched SVG, so no label ever scales with it. */}
        <div
          class="relative ml-8 h-56 cursor-crosshair rounded-sm outline-offset-4 sm:h-60"
          data-plot
          data-points={JSON.stringify(hoverData)}
          data-unit="job"
          data-step={stepWords}
          tabindex={0}
          role="img"
          aria-label={t('overview.chart.aria', { caption })}
        >
          {chart.ticks.map((tick) => (
            <span
              aria-hidden="true"
              class="absolute -left-8 w-6 -translate-y-1/2 text-right text-meta tabular-nums text-ink-faint"
              style={`top:${tickOffset(tick, top)}%`}
            >
              {formatNumber(tick)}
            </span>
          ))}
          <svg
            viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
            preserveAspectRatio="none"
            class="absolute inset-0 h-full w-full overflow-visible"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="matches-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="rgb(var(--accent))" stop-opacity="0.24" />
                <stop offset="1" stop-color="rgb(var(--accent))" stop-opacity="0.02" />
              </linearGradient>
            </defs>
            {chart.ticks.map((t) => {
              const y = (tickOffset(t, top) / 100) * PLOT_HEIGHT;
              return (
                <line
                  x1="0"
                  x2={PLOT_WIDTH}
                  y1={y}
                  y2={y}
                  stroke={t === 0 ? 'rgb(var(--line-strong))' : 'rgb(var(--line))'}
                  stroke-width="1"
                  vector-effect="non-scaling-stroke"
                />
              );
            })}
            <path d={areaPath(points)} fill="url(#matches-fill)" />
            <path
              d={linePath(points)}
              fill="none"
              stroke="rgb(var(--accent))"
              stroke-width="2.25"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          {chart.total === 0 && (
            <p data-ui="hint" class="absolute inset-x-0 top-1/3 text-center text-note text-ink-faint">
              {t(chart.stack ? 'overview.chart.emptyStack' : 'overview.chart.empty', { days, tech })}
            </p>
          )}
          <div class="pointer-events-none absolute inset-0" data-chart-hover hidden>
            <span class="absolute inset-y-0 w-0 -translate-x-1/2 border-l border-dashed border-accent" data-chart-guide />
            <span
              class="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-raised bg-accent shadow-sm"
              data-chart-dot
            />
            <div
              class="absolute z-10 w-max max-w-[14rem] rounded-md border border-line bg-surface-raised px-3 py-2 shadow-pop"
              data-chart-tip
            >
              <div class="text-meta text-ink-faint" data-tip-label />
              <div class="text-entity tabular-nums text-ink" data-tip-value />
              <div
                class="text-meta font-medium tabular-nums text-ink-faint data-[direction=up]:text-ok"
                data-tip-delta
              />
            </div>
          </div>
        </div>
        <div class="relative ml-8 mt-2 h-4" aria-hidden="true">
          {labelled.map((i, k) => (
            <span
              class={`absolute whitespace-nowrap text-meta tabular-nums text-ink-faint ${
                i === 0 ? '' : i === count - 1 ? '-translate-x-full' : '-translate-x-1/2'
              } ${
                // A phone has room for three dates: the first, the middle, the last.
                k % phoneEvery === 0 || k === labelled.length - 1 ? '' : 'hidden sm:block'
              }`}
              style={`left:${count > 1 ? (i / (count - 1)) * 100 : 0}%`}
            >
              {dayLabel(chart.points[i]!.to)}
            </span>
          ))}
        </div>
        <figcaption class="sr-only">{caption}</figcaption>
        <table class="sr-only">
          <caption>{t('overview.chart.tableCaption', { step })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('overview.chart.dayColumn', { step })}</th>
              <th scope="col">{t('nav.jobs')}</th>
            </tr>
          </thead>
          <tbody>
            {chart.points.map((p) => (
              <tr>
                <th scope="row">{pointLabel(p)}</th>
                <td>{p.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>

      {stageCount(funnel, 'read') > 0 && (
        <div class="mt-5 border-t border-line pt-4">
          <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h3 class="text-label text-ink-muted">{t('overview.chart.funnelHeading', { days })}</h3>
            <CardLink href="/runs#funnel">{t('overview.whereTheRestWent')}</CardLink>
          </div>
          <ol class="mt-3 grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
            {FLOW.map((key, i) => (
              <li class="flex items-center gap-3">
                <div class="min-w-0 flex-1">
                  <div class="text-section tabular-nums text-ink">{formatNumber(stageCount(funnel, key))}</div>
                  <div class="truncate text-note text-ink-muted">{t(`overview.flow.${key}`, { n: stageCount(funnel, key) })}</div>
                </div>
                {i < FLOW.length - 1 && (
                  <span class="hidden shrink-0 text-line-strong sm:block" aria-hidden="true">
                    <Icon name="arrow-right" size={18} />
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
};
