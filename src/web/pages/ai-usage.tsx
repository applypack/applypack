/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Badge, Card, CardHeader, CardLink, Empty, Hint, Notice, PageHeader, Tabs } from '../ui';
import { formatDuration } from '../format';
import { billingWords, formatUsd, SPEND_PERIODS, type ModelUsage, type SpendPeriod, type SpendRow, type SpendView } from '../../ai-spend';
import type { AiBilling } from '../../ai-usage';
import type { AiPlanRow } from '../ai-plan';
import type { UsageHint } from '../usage-hints';
import { AiPlan, BILLING_TONE } from './ai-plan';
import type { MessageKey } from '../../i18n/catalog';
import { formatNumber } from '../../i18n/format';
import { t } from '../../i18n/t';
import { tRich } from '../rich';

/*
 * AI usage (ADR 0055, 0060): which model did what, how long it took and what
 * it cost, from the ledger — and what that suggests changing. Three kinds of
 * money side by side and never added: a bill, what a plan covered (at API
 * prices, an estimate), and a local model's free calls.
 */
export interface AiUsageProps {
  period: SpendPeriod;
  view: SpendView;
  models: ModelUsage[];
  hints: UsageHint[];
  plan: AiPlanRow[];
  /** The monthly ceiling on billed money in cents (null = none), and what this UTC month has billed, micro-dollars. */
  budget: { cents: number | null; billedThisMonthMicro: number };
}

/** A period on its tab, and in the caption of the table it filters. */
const PERIOD_LABEL = {
  '7d': 'ai.period.7d',
  month: 'ai.period.month',
  'last-month': 'ai.period.lastMonth',
  year: 'ai.period.year',
} as const satisfies Record<SpendPeriod, MessageKey>;

const BY_MODEL_CAPTION = {
  '7d': 'ai.byModelCaption.7d',
  month: 'ai.byModelCaption.month',
  'last-month': 'ai.byModelCaption.lastMonth',
  year: 'ai.byModelCaption.year',
} as const satisfies Record<SpendPeriod, MessageKey>;

/** The three kinds of money, a card each: its name, and the line under its figure (`n` is its calls). */
const TOTALS = [
  { billing: 'billed', label: 'ai.total.billed', sub: 'ai.total.billed.sub' },
  { billing: 'plan', label: 'ai.total.plan', sub: 'ai.total.plan.sub' },
  { billing: 'local', label: 'ai.total.local', sub: 'ai.total.local.sub' },
] as const satisfies readonly { billing: AiBilling; label: MessageKey; sub: MessageKey }[];

const MONEY_TITLE = {
  billed: 'ai.moneyTitle.billed',
  plan: 'ai.moneyTitle.plan',
  local: 'ai.moneyTitle.local',
} as const satisfies Record<AiBilling, MessageKey>;

const COLUMNS = ['ai.col.feature', 'ai.col.calls', 'ai.col.time', 'ai.col.tokens', 'ai.col.money'] as const satisfies readonly MessageKey[];

/** The slow tail gets a line of its own once it is this far from the middle; under it the two say the same. */
const SLOW_TAIL = 1.1;

/** A suggestion is a quiet box; only a warning and an all-clear take a tone. */
const NEUTRAL_HINT = 'rounded-md border border-line bg-surface-overlay/60 px-3.5 py-2.5 text-note leading-5 text-ink';

export const AiUsagePage: FC<AiUsageProps> = ({ period, view, models, hints, plan, budget }) => (
  <Layout title={t('nav.ai')} active="ai">
    <PageHeader title={t('nav.ai')} actions={<CardLink href="/settings?tab=ai">{t('ai.aiEngines')}</CardLink>}>
      {t('ai.whichModelDidWhatHow')}
    </PageHeader>
    <div class="space-y-6">
      <Tabs
        label={t('ai.period')}
        tabs={SPEND_PERIODS.map((p) => ({ href: p === '7d' ? '/ai' : `/ai?period=${p}`, label: t(PERIOD_LABEL[p]), current: p === period }))}
      />
      <dl class="grid gap-4 sm:grid-cols-3">
        {TOTALS.map((kind) => {
          const total = view.totals[kind.billing];
          return (
            <div class="rounded-lg border border-line bg-surface-raised px-5 py-4 shadow-card">
              <dt class="text-label text-ink-muted">{t(kind.label)}</dt>
              <dd class="mt-1 text-kpi tabular-nums text-ink">
                {kind.billing === 'local' ? formatNumber(total.calls) : money(kind.billing, total.micro)}
              </dd>
              <dd data-ui="hint" class="mt-0.5 text-meta text-ink-faint">
                {t(kind.sub, { n: total.calls })}
              </dd>
            </div>
          );
        })}
      </dl>

      {hints.length > 0 && (
        <Card>
          <CardHeader title={t('ai.worthALook')} info={t('ai.readOffTheCallsOn')} />
          <div class="mt-4 space-y-3">
            {hints.map((h) => {
              const body = (
                <>
                  {h.text}
                  {h.action && (
                    <>
                      {' '}
                      <a href={h.action.href} class="whitespace-nowrap font-medium underline">
                        {h.action.label} →
                      </a>
                    </>
                  )}
                </>
              );
              return h.tone === 'neutral' ? <div class={NEUTRAL_HINT}>{body}</div> : <Notice tone={h.tone}>{body}</Notice>;
            })}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title={t('ai.byModel')}
          info={t('ai.everyAiCallInThe')}
        />
        {models.length === 0 ? (
          <Empty bare title={t('ai.noAiCallsInThis')}>
            {t('ai.everyCallIsRecordedOnce')}
          </Empty>
        ) : (
          <div class="mt-4 overflow-x-auto" tabindex={0} role="region" aria-label={t(BY_MODEL_CAPTION[period])}>
            <table class="w-full min-w-[40rem] text-sm">
              <caption class="sr-only">{t(BY_MODEL_CAPTION[period])}</caption>
              <thead>
                <tr class="text-left text-label text-ink-muted">
                  {COLUMNS.map((column, i) => (
                    <th scope="col" class={`border-b border-line px-4 py-2.5 font-[550] first:pl-0 last:pr-0 ${i === 0 ? '' : 'text-right'}`}>
                      {t(column)}
                    </th>
                  ))}
                </tr>
              </thead>
              {models.map((m) => (
                <tbody class="divide-y divide-line">
                  <tr>
                    <th scope="rowgroup" colspan={5} class="pb-2 pt-5 text-left font-normal">
                      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span class="text-entity text-ink" translate="no">
                          {m.engine}
                        </span>
                        {m.model ? (
                          <span class="font-mono text-note text-ink-muted" translate="no">
                            {m.model}
                          </span>
                        ) : (
                          <span class="font-mono text-note text-ink-muted">{t('ai.cliDefault')}</span>
                        )}
                        <Badge tone={BILLING_TONE[m.billing]}>{billingWords(m.billing)}</Badge>
                        <span class="text-note tabular-nums text-ink-faint">
                          {t('ai.calls', { n: m.calls })}
                          {m.billing !== 'local' && ` · ${money(m.billing, m.micro)}`}
                        </span>
                      </div>
                    </th>
                  </tr>
                  {m.rows.map((r) => (
                    <FeatureRow row={r} />
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
        {view.notes.map((note) => (
          <Hint class="mt-3">{note}</Hint>
        ))}
      </Card>

      <Card>
        <CardHeader title={t('ai.whoAnswersWhatNow')} action={<CardLink href="/settings?tab=ai">{t('ai.change')}</CardLink>} />
        <div class="mt-4 space-y-3">
          <AiPlan plan={plan} />
        </div>
      </Card>

      <Hint>
        {t('ai.nothingKept')}{' '}
        {tRich(
          budget.cents ? 'ai.billedThisMonth.budget' : 'ai.billedThisMonth.noBudget',
          {
            billed: formatUsd(budget.billedThisMonthMicro),
            budget: formatUsd((budget.cents ?? 0) * 10_000),
            percent: budget.cents ? Math.round((budget.billedThisMonthMicro / (budget.cents * 10_000)) * 100) : 0,
          },
          {
            link: (words) => (
              <a href="/settings?tab=ai#budget" class="font-medium underline">
                {words}
              </a>
            ),
          },
        )}
      </Hint>
    </div>
  </Layout>
);

const FeatureRow: FC<{ row: SpendRow }> = ({ row: r }) => (
  <tr class="transition-colors duration-150 hover:bg-surface-selected/50">
    <td class="py-2.5 pr-4 text-ink">{r.feature}</td>
    <td class="px-4 py-2.5 text-right tabular-nums">
      {formatNumber(r.calls)}
      {r.failed > 0 && <div class="text-meta text-warn">{t('ai.didNotAnswer', { n: r.failed })}</div>}
    </td>
    <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
      {formatDuration(r.medianMs)}
      {r.medianMs !== null && r.p90Ms !== null && r.p90Ms > r.medianMs * SLOW_TAIL && (
        <div class="text-meta text-ink-faint">{t('ai.nineInTenUnder', { time: formatDuration(r.p90Ms) })}</div>
      )}
    </td>
    <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-ink-muted">
      {compact(r.tokensIn)} → {compact(r.tokensOut)}
    </td>
    <td class="whitespace-nowrap py-2.5 pl-4 text-right tabular-nums" title={t(MONEY_TITLE[r.billing])}>
      {r.billing === 'local' ? t('ai.free') : r.unpriced > 0 && r.micro === 0 ? t('ai.notPriced') : money(r.billing, r.micro)}
    </td>
  </tr>
);

/** A bill as it is, what a plan covered as an estimate: "$0.12", "≈ $0.30". */
function money(billing: AiBilling, micro: number): string {
  return `${billing === 'plan' ? '≈ ' : ''}${formatUsd(micro)}`;
}

/** 1 204 → "1.2k", 3 400 000 → "3.4M": the table's tokens at a glance. */
function compact(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
