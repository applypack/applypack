import { AI_PROVIDER_LABELS, type AiProviderId } from './ai-engine';
import { costMicroUsd, PRICES_AS_OF } from './ai-prices';
import { AI_BILLING, featureName, type AiBilling, type AiFeature, type AiOutcome, type AiSpend } from './ai-usage';

/*
 * The AI spend ledger, read and written (ADR 0055). Pure: the runtime hands
 * an attempt to `ledgerRow`, the AI usage page hands grouped sums to `spendView`, and
 * the budget, the periods and the billing notes are decided here. The I/O is
 * src/ai-ledger.ts.
 */

const MICRO = 1_000_000;

export interface LedgerInput {
  at: Date;
  durationMs: number;
  engine: AiProviderId;
  /** What the call asked for; '' = the CLI's default. */
  model: string;
  feature: AiFeature;
  outcome: AiOutcome;
  spend: AiSpend | null;
  viaFallback: boolean;
  billing: AiBilling;
  jobId?: number;
  resumeId?: number;
}

/** The `ai_call` columns for one attempt. A local call is free and carries no cost at all. */
export function ledgerRow(i: LedgerInput) {
  const usage = i.spend?.usage ?? null;
  const priced = usage && i.billing !== 'local' ? costMicroUsd(i.spend?.model ?? (i.model || null), usage) : null;
  const reported = i.spend?.reportedUsd;
  return {
    at: i.at,
    durationMs: Math.max(0, Math.round(i.durationMs)),
    engine: i.engine,
    model: i.model,
    resolvedModel: i.spend?.model ?? null,
    feature: i.feature,
    outcome: i.outcome,
    viaFallback: i.viaFallback,
    billing: i.billing,
    inputTokens: usage?.inputTokens ?? null,
    cacheWriteTokens: usage?.cacheWriteTokens ?? null,
    cacheWrite1hTokens: usage?.cacheWrite1hTokens ?? null,
    cacheReadTokens: usage?.cacheReadTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    webSearches: usage?.webSearches ?? null,
    costMicroUsd: priced,
    reportedMicroUsd: typeof reported === 'number' && Number.isFinite(reported) ? Math.round(reported * MICRO) : null,
    priceAsOf: priced === null ? null : PRICES_AS_OF,
    jobId: i.jobId ?? null,
    resumeId: i.resumeId ?? null,
  };
}

/** One SQL group of the ledger: a feature on a model, on one kind of money. */
export interface SpendGroup {
  feature: string;
  engine: string;
  /** The resolved model, else the requested one; '' = a CLI's default. */
  model: string;
  billing: AiBilling;
  calls: number;
  /** Calls that did not end `ok` (a retry, a cut-off, a timeout). */
  failed: number;
  /** Calls the vendor reported no usage for — a timeout, a crash: it may still have billed. */
  noUsage: number;
  /** Calls with usage and no price: a model the table does not know, and no vendor figure. */
  unpriced: number;
  tokensIn: number;
  tokensOut: number;
  /** Our price where we have one, else the vendor's own; micro-dollars. */
  micro: number;
  /** Wall time of the calls that answered: the middle one, and the slow tail. Null when none answered. */
  medianMs: number | null;
  p90Ms: number | null;
  /** Calls the vendor turned away for a rate limit — the sign of a plan's allowance or a key's quota running out. */
  rateLimited: number;
  /** Calls answered by an engine other than the first one asked, and what those cost. */
  viaFallback: number;
  fallbackMicro: number;
}

export interface SpendTotal {
  calls: number;
  tokens: number;
  micro: number;
}

export interface SpendRow {
  feature: string;
  engine: string;
  model: string;
  billing: AiBilling;
  calls: number;
  failed: number;
  /** Calls the price table could not price; with no money beside them the cell says so instead of "$0". */
  unpriced: number;
  tokensIn: number;
  tokensOut: number;
  micro: number;
  medianMs: number | null;
  p90Ms: number | null;
}

export interface SpendView {
  totals: Record<AiBilling, SpendTotal>;
  rows: SpendRow[];
  /** Plain sentences, each true of this period: what dominates, what is not priced, what ended unheard. */
  notes: string[];
}

/** The groups as three totals, a table by money, and the sentences that go with it. */
export function spendView(groups: readonly SpendGroup[]): SpendView {
  const totals: Record<AiBilling, SpendTotal> = {
    billed: { calls: 0, tokens: 0, micro: 0 },
    plan: { calls: 0, tokens: 0, micro: 0 },
    local: { calls: 0, tokens: 0, micro: 0 },
  };
  for (const g of groups) {
    const t = totals[g.billing];
    t.calls += g.calls;
    t.tokens += g.tokensIn + g.tokensOut;
    t.micro += g.billing === 'local' ? 0 : g.micro;
  }
  const rows = groups
    .map(({ feature, engine, model, billing, calls, failed, unpriced, tokensIn, tokensOut, micro, medianMs, p90Ms }) => ({
      feature: featureName(feature),
      engine: AI_PROVIDER_LABELS[engine as AiProviderId] ?? engine,
      model,
      billing,
      calls,
      failed,
      unpriced,
      tokensIn,
      tokensOut,
      micro: billing === 'local' ? 0 : micro,
      medianMs,
      p90Ms,
    }))
    .sort((a, b) => b.micro - a.micro || b.calls - a.calls || a.feature.localeCompare(b.feature));
  return { totals, rows, notes: spendNotes(groups) };
}

/** One engine and model, with everything it did in the period. */
export interface ModelUsage {
  engine: string;
  model: string;
  billing: AiBilling;
  calls: number;
  failed: number;
  micro: number;
  /** What it did, the most calls first. */
  rows: SpendRow[];
}

/** The view's rows by the model that answered: which model does what, in how long, for how much. */
export function usageByModel(rows: readonly SpendRow[]): ModelUsage[] {
  const models = new Map<string, ModelUsage>();
  for (const row of rows) {
    const key = `${row.engine}\n${row.model}\n${row.billing}`;
    const m = models.get(key) ?? { engine: row.engine, model: row.model, billing: row.billing, calls: 0, failed: 0, micro: 0, rows: [] };
    m.calls += row.calls;
    m.failed += row.failed;
    m.micro += row.micro;
    m.rows.push(row);
    models.set(key, m);
  }
  for (const m of models.values()) m.rows.sort((a, b) => b.calls - a.calls || a.feature.localeCompare(b.feature));
  return [...models.values()].sort((a, b) => b.calls - a.calls || b.micro - a.micro || a.model.localeCompare(b.model));
}

function spendNotes(groups: readonly SpendGroup[]): string[] {
  const notes: string[] = [];
  // Where the money goes, against where the calls go — "what should I optimise",
  // answered inside ONE kind of money: a bill first, else what the plan covered.
  const kind: AiBilling | null = groups.some((g) => g.billing === 'billed' && g.micro > 0)
    ? 'billed'
    : groups.some((g) => g.billing === 'plan' && g.micro > 0)
      ? 'plan'
      : null;
  if (kind) {
    const of = groups.filter((g) => g.billing === kind);
    const totalMicro = of.reduce((n, g) => n + g.micro, 0);
    const totalCalls = of.reduce((n, g) => n + g.calls, 0);
    const byFeature = new Map<string, { calls: number; micro: number }>();
    for (const g of of) {
      const f = byFeature.get(g.feature) ?? { calls: 0, micro: 0 };
      f.calls += g.calls;
      f.micro += g.micro;
      byFeature.set(g.feature, f);
    }
    if (byFeature.size > 1) {
      const [feature, top] = [...byFeature.entries()].sort((a, b) => b[1].micro - a[1].micro)[0]!;
      const money = kind === 'billed' ? 'of the billed money' : 'of what your plans covered, at API prices';
      notes.push(`${featureName(feature)} is ${percent(top.calls, totalCalls)} of those calls and ${percent(top.micro, totalMicro)} ${money}.`);
    }
  }
  const unpriced = groups.filter((g) => g.unpriced > 0);
  const unpricedCalls = unpriced.reduce((n, g) => n + g.unpriced, 0);
  if (unpricedCalls > 0) {
    const models = [...new Set(unpriced.map((g) => g.model || 'the CLI default'))].join(', ');
    notes.push(
      `${plural(unpricedCalls, 'call')} on ${models} ${unpricedCalls === 1 ? 'is' : 'are'} not priced — the price table is from ${PRICES_AS_OF} and does not know ${unpriced.length === 1 && unpriced[0]!.model ? 'that model' : 'those models'}.`,
    );
  }
  const unheard = groups.reduce((n, g) => n + g.noUsage, 0);
  if (unheard > 0) {
    notes.push(
      `${plural(unheard, 'call')} ended with no usage reported (a timeout or an error). A timed-out call may still be on the vendor's bill.`,
    );
  }
  return notes;
}

function percent(part: number, whole: number): string {
  return `${whole > 0 ? Math.round((part / whole) * 100) : 0} %`;
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
}

/** Micro-dollars as money: cents from a cent up, four places below it. */
export function formatUsd(micro: number): string {
  const usd = micro / MICRO;
  if (usd === 0) return '$0';
  if (Math.abs(usd) < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const SPEND_PERIODS = ['7d', 'month', 'last-month', 'year'] as const;
export type SpendPeriod = (typeof SPEND_PERIODS)[number];

export function isSpendPeriod(value: unknown): value is SpendPeriod {
  return typeof value === 'string' && (SPEND_PERIODS as readonly string[]).includes(value);
}

/**
 * A period as a UTC range, `to` exclusive. UTC because the vendors' own
 * dashboards and reports bucket by UTC day, and a total meant to match
 * theirs has to cut the days where they do.
 */
export function periodRange(period: SpendPeriod, now: Date): { from: Date; to: Date; label: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = Date.UTC(y, m, now.getUTCDate());
  const DAY = 86_400_000;
  switch (period) {
    case '7d':
      return { from: new Date(today - 6 * DAY), to: new Date(today + DAY), label: 'Last 7 days' };
    case 'month':
      return { from: new Date(Date.UTC(y, m, 1)), to: new Date(Date.UTC(y, m + 1, 1)), label: 'This month' };
    case 'last-month':
      return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)), label: 'Last month' };
    case 'year':
      return { from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y + 1, 0, 1)), label: 'This year' };
  }
}

/** "2026-09" — the month a budget counts, in UTC like the vendors' invoices. */
export function budgetMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** The thresholds a budget warns at, in percent. */
const BUDGET_LEVELS = [80, 100] as const;

/**
 * The warning a month's billed money calls for, as the stored marker
 * ("2026-09:080", zero-padded so later markers sort after earlier ones), or
 * null when it is under 80 % or that warning was already sent. A warning,
 * never a stop: a missed match costs more than a cent (ADR 0055).
 */
export function budgetAlert(billedMicro: number, budgetCents: number, month: string, lastSent: string | null): string | null {
  if (budgetCents <= 0) return null;
  const share = (billedMicro / (budgetCents * 10_000)) * 100;
  const level = [...BUDGET_LEVELS].reverse().find((l) => share >= l);
  if (level === undefined) return null;
  const marker = `${month}:${String(level).padStart(3, '0')}`;
  return lastSent !== null && lastSent >= marker ? null : marker;
}

/** The line a budget warning sends, on the chat channels the alerts use. */
export function budgetAlertText(billedMicro: number, budgetCents: number): string {
  const share = Math.round((billedMicro / (budgetCents * 10_000)) * 100);
  return `AI spend: ${formatUsd(billedMicro)} billed this month, ${share} % of your ${formatUsd(budgetCents * 10_000)} monthly budget. Nothing is stopped — this is a warning. The AI usage page shows where it went.`;
}

/**
 * The trap a user pays twice through: a pay-per-token engine sits ahead of
 * one their plan covers, so the plan answers only when the key fails (N4).
 */
export function billingNotes(chain: readonly AiProviderId[], billing: (id: AiProviderId) => AiBilling): string[] {
  const firstPlan = chain.findIndex((id) => billing(id) === 'plan');
  if (firstPlan <= 0) return [];
  const billedAhead = chain.slice(0, firstPlan).filter((id) => billing(id) === 'billed');
  if (billedAhead.length === 0) return [];
  const names = billedAhead.map((id) => AI_PROVIDER_LABELS[id]).join(' and ');
  const plan = AI_PROVIDER_LABELS[chain[firstPlan]!];
  return [
    `Calls go to ${names} first and are billed per token; ${plan}, which your plan covers, answers only when ${billedAhead.length === 1 ? 'it fails' : 'they fail'}. Move ${plan} up to spend the plan first.`,
  ];
}

/** What each kind of money means, said on every engine card. */
export const BILLING_WORDS: Record<AiBilling, string> = {
  billed: 'Billed per token',
  plan: 'Covered by your plan',
  local: 'Local — free',
};

/** The middle of the recent costs of one kind of call: the estimate shown before the button. Null under three. */
export function typicalMicro(costs: readonly number[]): number | null {
  if (costs.length < 3) return null;
  const sorted = [...costs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * The line under an expensive button: what the same kind of call usually
 * costs here, on the kind of money it spends — a choice made before the
 * click, not a surprise after it. Null until there are three to go by.
 */
export function costHintText(typical: { micro: number; billing: AiBilling } | null): string | null {
  if (!typical) return null;
  if (typical.billing === 'local') return 'Runs on your local model: free.';
  const money = formatUsd(typical.micro);
  return typical.billing === 'plan'
    ? `Usually ≈ ${money} at API prices, which your plan covers (the middle of your recent calls).`
    : `Usually ${money} a call, billed per token (the middle of your recent calls).`;
}

/**
 * Before any call is on record: what kind of money the next one spends, from
 * the engine that answers first. No figure is guessed — an estimate made up
 * without a single measured call would be the number people quote back.
 */
export function billingHint(billing: AiBilling): string {
  if (billing === 'local') return 'Runs on your local model: free.';
  return billing === 'plan' ? 'Your plan covers it.' : 'Billed per token on your API key.';
}

/** "$0.12 billed · ≈ $0.30 covered by your plan" — the Details row on a posting; null when nothing was recorded for it. */
export function jobSpendText(spend: Partial<Record<AiBilling, number>> | null): string | null {
  if (!spend) return null;
  const parts = [
    ...(spend.billed !== undefined ? [`${formatUsd(spend.billed)} billed`] : []),
    ...(spend.plan !== undefined ? [`≈ ${formatUsd(spend.plan)} covered by your plan`] : []),
    ...(spend.local !== undefined ? ['local calls, free'] : []),
  ];
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** One UTC day of one engine and model, as the hand-run report prints it. */
export interface ReportRow {
  day: string;
  engine: string;
  model: string;
  billing: AiBilling;
  calls: number;
  /** Failed with no usage reported — the first suspects for a difference from the vendor. */
  aborted: number;
  input: number;
  cacheWrite: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
  searches: number;
  ourMicro: number;
  vendorMicro: number;
}

const REPORT_COLUMNS = ['day', 'engine', 'model', 'kind', 'calls', 'aborted', 'input', 'cache_write_5m', 'cache_write_1h', 'cache_read', 'output', 'searches', 'ours_usd', 'vendor_usd'];

/**
 * The ledger per UTC day, tab-separated for a spreadsheet beside the vendor's
 * own usage and cost report (`npm run spend:report`). The kinds of money get
 * a total each and no grand total — there is none (ADR 0055).
 */
export function spendReportLines(rows: readonly ReportRow[]): string[] {
  const usd = (micro: number) => (micro / MICRO).toFixed(6);
  const lines = [REPORT_COLUMNS.join('\t')];
  for (const r of rows) {
    lines.push(
      [r.day, r.engine, r.model || 'default', r.billing, r.calls, r.aborted, r.input, r.cacheWrite, r.cacheWrite1h, r.cacheRead, r.output, r.searches, usd(r.ourMicro), usd(r.vendorMicro)].join('\t'),
    );
  }
  for (const kind of AI_BILLING) {
    const of = rows.filter((r) => r.billing === kind);
    if (of.length === 0) continue;
    const sum = (f: (r: ReportRow) => number) => of.reduce((n, r) => n + f(r), 0);
    lines.push(
      `# ${kind}: ${sum((r) => r.calls)} calls, ${sum((r) => r.aborted)} aborted; ours ${formatUsd(sum((r) => r.ourMicro))}, vendor-reported ${formatUsd(sum((r) => r.vendorMicro))}`,
    );
  }
  return lines;
}
