/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Badge, Card, CardHeader, CardLink, Empty, Hint, Notice, PageHeader, Tabs } from '../ui';
import { formatDuration } from '../format';
import { BILLING_WORDS, formatUsd, SPEND_PERIODS, type ModelUsage, type SpendPeriod, type SpendRow, type SpendView } from '../../ai-spend';
import type { AiBilling } from '../../ai-usage';
import type { AiPlanRow } from '../ai-plan';
import type { UsageHint } from '../usage-hints';
import { AiPlan, BILLING_TONE } from './ai-plan';

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

const PERIOD_LABELS: Record<SpendPeriod, string> = {
  '7d': 'Last 7 days',
  month: 'This month',
  'last-month': 'Last month',
  year: 'This year',
};

const TOTALS: { billing: AiBilling; label: string; sub: (calls: number) => string }[] = [
  { billing: 'billed', label: 'Billed', sub: (n) => `${calls(n)} on pay-per-token keys` },
  { billing: 'plan', label: 'Covered by your plans', sub: (n) => `${calls(n)} — at API prices, an estimate, not a bill` },
  { billing: 'local', label: 'Local models', sub: (n) => `${calls(n)}, free` },
];

const MONEY_TITLE: Record<AiBilling, string> = {
  billed: 'Billed per token; our price from the dated table, or the vendor’s own figure',
  plan: 'Your plan covers this; the figure is what it would cost on the API',
  local: 'A local model costs nothing per call',
};

/** The slow tail gets a line of its own once it is this far from the middle; under it the two say the same. */
const SLOW_TAIL = 1.1;

/** A suggestion is a quiet box; only a warning and an all-clear take a tone. */
const NEUTRAL_HINT = 'rounded-md border border-line bg-surface-overlay/60 px-3.5 py-2.5 text-note leading-5 text-ink';

export const AiUsagePage: FC<AiUsageProps> = ({ period, view, models, hints, plan, budget }) => (
  <Layout title="AI usage" active="ai">
    <PageHeader title="AI usage" actions={<CardLink href="/settings?tab=ai">AI engines</CardLink>}>
      Which model did what, how long it took and what it cost.
    </PageHeader>
    <div class="space-y-6">
      <Tabs
        label="Period"
        tabs={SPEND_PERIODS.map((p) => ({ href: p === '7d' ? '/ai' : `/ai?period=${p}`, label: PERIOD_LABELS[p], current: p === period }))}
      />
      <dl class="grid gap-4 sm:grid-cols-3">
        {TOTALS.map((t) => {
          const total = view.totals[t.billing];
          return (
            <div class="rounded-lg border border-line bg-surface-raised px-5 py-4 shadow-card">
              <dt class="text-label text-ink-muted">{t.label}</dt>
              <dd class="mt-1 text-kpi tabular-nums text-ink">
                {t.billing === 'local' ? total.calls.toLocaleString('en-US') : `${t.billing === 'plan' ? '≈ ' : ''}${formatUsd(total.micro)}`}
              </dd>
              <dd data-ui="hint" class="mt-0.5 text-meta text-ink-faint">
                {t.billing === 'local' ? `call${total.calls === 1 ? '' : 's'}, free` : t.sub(total.calls)}
              </dd>
            </div>
          );
        })}
      </dl>

      {hints.length > 0 && (
        <Card>
          <CardHeader title="Worth a look" info="Read off the calls on record, the engines set up here and the vendors' published prices. Nothing here says a model is good enough for a task: that is not measured." />
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
          title="By model"
          info="Every AI call in the period, by the model that answered. Time is the wall time of the calls that answered: the middle one, and the one nine in ten were faster than. Tokens are what the vendor reported. Days are UTC, as on the vendors' own dashboards."
        />
        {models.length === 0 ? (
          <Empty bare title="No AI calls in this period">
            Every call is recorded once it is made: a scored posting, a comparison, a letter. The ledger starts with version 2.21.0.
          </Empty>
        ) : (
          <div class="mt-4 overflow-x-auto" tabindex={0} role="region" aria-label={`AI calls by model, ${PERIOD_LABELS[period].toLowerCase()}`}>
            <table class="w-full min-w-[40rem] text-sm">
              <caption class="sr-only">{`AI calls by model, ${PERIOD_LABELS[period].toLowerCase()}`}</caption>
              <thead>
                <tr class="text-left text-label text-ink-muted">
                  {['What it did', 'Calls', 'Typical time', 'Tokens in → out', 'Money'].map((c, i) => (
                    <th scope="col" class={`border-b border-line px-4 py-2.5 font-[550] first:pl-0 last:pr-0 ${i === 0 ? '' : 'text-right'}`}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              {models.map((m) => (
                <tbody class="divide-y divide-line">
                  <tr>
                    <th scope="rowgroup" colspan={5} class="pb-2 pt-5 text-left font-normal">
                      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span class="text-entity text-ink">{m.engine}</span>
                        <span class="font-mono text-note text-ink-muted">{m.model || 'CLI default'}</span>
                        <Badge tone={BILLING_TONE[m.billing]}>{BILLING_WORDS[m.billing]}</Badge>
                        <span class="text-note tabular-nums text-ink-faint">
                          {calls(m.calls)}
                          {m.billing !== 'local' && ` · ${m.billing === 'plan' ? '≈ ' : ''}${formatUsd(m.micro)}`}
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
        <CardHeader title="Who answers what now" action={<CardLink href="/settings?tab=ai">Change</CardLink>} />
        <div class="mt-4 space-y-3">
          <AiPlan plan={plan} />
        </div>
      </Card>

      <Hint>
        Nothing of a prompt or a reply is kept: the ledger holds counts, times and prices.{' '}
        {budget.cents
          ? `Billed this month: ${formatUsd(budget.billedThisMonthMicro)} of your ${formatUsd(budget.cents * 10_000)} budget (${Math.round((budget.billedThisMonthMicro / (budget.cents * 10_000)) * 100)} %). `
          : `Billed this month: ${formatUsd(budget.billedThisMonthMicro)}, with no monthly budget set. `}
        <a href="/settings?tab=ai#budget" class="font-medium underline">
          {budget.cents ? 'Change the budget' : 'Set a budget'}
        </a>
      </Hint>
    </div>
  </Layout>
);

const FeatureRow: FC<{ row: SpendRow }> = ({ row: r }) => (
  <tr class="transition-colors duration-150 hover:bg-surface-selected/50">
    <td class="py-2.5 pr-4 text-ink">{r.feature}</td>
    <td class="px-4 py-2.5 text-right tabular-nums">
      {r.calls.toLocaleString('en-US')}
      {r.failed > 0 && <div class="text-meta text-warn">{r.failed} did not answer</div>}
    </td>
    <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
      {formatDuration(r.medianMs)}
      {r.medianMs !== null && r.p90Ms !== null && r.p90Ms > r.medianMs * SLOW_TAIL && (
        <div class="text-meta text-ink-faint">9 in 10 under {formatDuration(r.p90Ms)}</div>
      )}
    </td>
    <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-ink-muted">
      {compact(r.tokensIn)} → {compact(r.tokensOut)}
    </td>
    <td class="whitespace-nowrap py-2.5 pl-4 text-right tabular-nums" title={MONEY_TITLE[r.billing]}>
      {r.billing === 'local' ? 'free' : r.unpriced > 0 && r.micro === 0 ? 'not priced' : `${r.billing === 'plan' ? '≈ ' : ''}${formatUsd(r.micro)}`}
    </td>
  </tr>
);

function calls(n: number): string {
  return `${n.toLocaleString('en-US')} call${n === 1 ? '' : 's'}`;
}

/** 1 204 → "1.2k", 3 400 000 → "3.4M": the table's tokens at a glance. */
function compact(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
