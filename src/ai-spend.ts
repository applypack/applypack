import { AI_PROVIDER_LABELS, type AiProviderId } from './ai-engine';
import { costMicroUsd, PRICES_AS_OF } from './ai-prices';
import { AI_BILLING, type AiBilling, type AiFeature, type AiOutcome, type AiSpend } from './ai-usage';
import type { MessageKey } from './i18n/catalog';
import { formatNumber } from './i18n/format';
import { t } from './i18n/t';

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
  /** The application pack whose preparation made the call (ai-subject.ts). */
  packId?: number;
}

/**
 * The `ai_call` columns for one attempt. A local call is free and carries no
 * cost at all. The tokens are the answering model's; the cost counts every
 * model the call ran, and is "not priced" when one of them is.
 */
export function ledgerRow(i: LedgerInput) {
  const usage = i.spend?.usage ?? null;
  const parts = usage && i.billing !== 'local' ? [{ model: i.spend?.model ?? (i.model || null), usage }, ...(i.spend?.alongside ?? [])] : [];
  const costs = parts.map((p) => costMicroUsd(p.model, p.usage));
  const priced = costs.length > 0 && costs.every((c): c is number => c !== null) ? costs.reduce((a, b) => a + b, 0) : null;
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
    packId: i.packId ?? null,
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
  /** Of those, the ones that answered with a reply the caller could not read (#463) — a reply, so never worded "did not answer". */
  unparsed: number;
  /** How most of the failed ones ended (`AiOutcome`, as stored); absent when none failed, or on a group built by hand. */
  failedAs?: string | null;
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
  /** Attempts on an engine other than the first one asked — answered or not — and what those attempts cost. */
  viaFallback: number;
  fallbackMicro: number;
}

/** How long one feature's last answered calls took on one engine and model (ai-ledger.ts:loadAnswerTimes). */
export interface AnswerTimes {
  feature: string;
  engine: string;
  /** The model asked for — '' = a CLI's default — since that is what the next call will ask for. */
  model: string;
  answered: number;
  medianMs: number;
  p90Ms: number;
}

/** A time is stated from this many answered calls: "9 in 10" from two was the slower one, interpolated (#415). */
export const TIMED_FROM = 10;
/** The slow tail gets a figure of its own once it is this far from the middle; under it the two say the same. */
const SLOW_TAIL = 1.1;

/**
 * The calls that failed, as the table words them: those with no answer, and
 * apart from them those that answered with a reply that could not be read —
 * "did not answer" would be untrue of those (#463).
 */
export function failureWords(failed: number, unparsed: number): string[] {
  return [
    ...(failed > unparsed ? [t('ai.didNotAnswer', { n: failed - unparsed })] : []),
    ...(unparsed > 0 ? [t('ai.unreadable', { n: unparsed })] : []),
  ];
}

/** The "9 in 10 under" time, when there are enough answers for it and the tail is slower than the middle. */
export function slowTail(answered: number, medianMs: number | null, p90Ms: number | null): number | null {
  return answered >= TIMED_FROM && medianMs !== null && p90Ms !== null && p90Ms > medianMs * SLOW_TAIL ? p90Ms : null;
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
  /** Of the failed, the ones that answered with a reply that could not be read. */
  unparsed: number;
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
    const total = totals[g.billing];
    total.calls += g.calls;
    total.tokens += g.tokensIn + g.tokensOut;
    total.micro += g.billing === 'local' ? 0 : g.micro;
  }
  const rows = groups
    .map(({ feature, engine, model, billing, calls, failed, unparsed, unpriced, tokensIn, tokensOut, micro, medianMs, p90Ms }) => ({
      feature: featureLabel(feature),
      engine: AI_PROVIDER_LABELS[engine as AiProviderId] ?? engine,
      model,
      billing,
      calls,
      failed,
      unparsed,
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
      notes.push(
        t(kind === 'billed' ? 'spend.note.topBilled' : 'spend.note.topPlan', {
          feature: featureLabel(feature),
          calls: percent(top.calls, totalCalls),
          money: percent(top.micro, totalMicro),
        }),
      );
    }
  }
  const unpriced = groups.filter((g) => g.unpriced > 0);
  const unpricedCalls = unpriced.reduce((n, g) => n + g.unpriced, 0);
  if (unpricedCalls > 0) {
    const models = [...new Set(unpriced.map((g) => g.model || t('spend.theCliDefault')))].join(', ');
    const oneModel = unpriced.length === 1 && unpriced[0]!.model;
    notes.push(t(oneModel ? 'spend.note.unpricedModel' : 'spend.note.unpricedModels', { n: unpricedCalls, models, asOf: PRICES_AS_OF }));
  }
  const unheard = groups.reduce((n, g) => n + g.noUsage, 0);
  if (unheard > 0) notes.push(t('spend.note.unheard', { n: unheard }));
  return notes;
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** What the user reads for each feature the ledger stores, each one a singular subject ("… is 4 % of those calls"). */
const FEATURE_LABEL = {
  classifier: 'spend.feature.classifier',
  prefilter: 'spend.feature.prefilter',
  'posting-extract': 'spend.feature.postingExtract',
  'posting-brief': 'spend.feature.postingBrief',
  'resume-scan': 'spend.feature.resumeScan',
  'resume-structure': 'spend.feature.resumeStructure',
  'resume-match': 'spend.feature.resumeMatch',
  'resume-match-fast': 'spend.feature.resumeMatchFast',
  'resume-suggestions': 'spend.feature.resumeSuggestions',
  'resume-rewrite': 'spend.feature.resumeRewrite',
  'resume-review': 'spend.feature.resumeReview',
  'cover-letter': 'spend.feature.coverLetter',
  'job-verify': 'spend.feature.jobVerify',
  screening: 'spend.feature.screening',
  'screening-compare': 'spend.feature.screeningCompare',
  'screening-bench': 'spend.feature.screeningBench',
  'engine-test': 'spend.feature.engineTest',
  'engine-trial': 'spend.feature.engineTrial',
} as const satisfies Record<AiFeature, MessageKey>;

/** A stored feature as words; one this version does not know reads as itself. */
export function featureLabel(feature: string): string {
  const key = (FEATURE_LABEL as Record<string, MessageKey>)[feature];
  return key ? t(key) : feature;
}

/**
 * Names in a row, "A and B": joined pair by pair, as the English always was,
 * with the word between them in the reader's language.
 */
export function joinNames(names: readonly string[]): string {
  return names.slice(1).reduce((joined, name) => t('spend.and', { a: joined, b: name }), names[0] ?? '');
}

/**
 * Micro-dollars as money: cents from a cent up, four places below it, written
 * the reader's way ("$8.00", "8,00 USD"). Outside a request or a tick — the
 * spend report a script prints — it is English.
 */
export function formatUsd(micro: number): string {
  const usd = micro / MICRO;
  const places = usd === 0 ? 0 : Math.abs(usd) < 0.01 ? 4 : 2;
  return formatNumber(usd, { style: 'currency', currency: 'USD', minimumFractionDigits: places, maximumFractionDigits: places });
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
      return { from: new Date(today - 6 * DAY), to: new Date(today + DAY), label: t('ai.period.7d') };
    case 'month':
      return { from: new Date(Date.UTC(y, m, 1)), to: new Date(Date.UTC(y, m + 1, 1)), label: t('ai.period.month') };
    case 'last-month':
      return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)), label: t('ai.period.lastMonth') };
    case 'year':
      return { from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y + 1, 0, 1)), label: t('ai.period.year') };
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

/** The line a budget warning sends, on the chat channels the alerts use, in the language of the run. */
export function budgetAlertText(billedMicro: number, budgetCents: number): string {
  const share = Math.round((billedMicro / (budgetCents * 10_000)) * 100);
  return t('spend.budgetAlert', { billed: formatUsd(billedMicro), share, budget: formatUsd(budgetCents * 10_000) });
}

/**
 * The trap a user pays twice through: a pay-per-token engine answers a task
 * ahead of one their plan covers, so the plan answers only when the key
 * fails (N4). Read per task (ADR 0060): an engine narrowed to other tasks is
 * not ahead of anything here. Screening is left out — moving applicants'
 * resumes onto a personal plan is what employer mode warns against.
 */
export function billingNotes(
  plan: readonly { task: string; label: string; engines: readonly { label: string; billing: AiBilling }[] }[],
): string[] {
  const rows = plan.filter((row) => row.task !== 'screening');
  const traps = new Map<string, { billed: string[]; plan: string; tasks: string[] }>();
  for (const row of rows) {
    const firstPlan = row.engines.findIndex((e) => e.billing === 'plan');
    const billedAhead = row.engines.slice(0, Math.max(firstPlan, 0)).filter((e) => e.billing === 'billed');
    if (billedAhead.length === 0) continue;
    const billed = billedAhead.map((e) => e.label);
    const covered = row.engines[firstPlan]!.label;
    const key = `${billed.join('|')}>${covered}`;
    const trap = traps.get(key) ?? { billed, plan: covered, tasks: [] };
    trap.tasks.push(row.label);
    traps.set(key, trap);
  }
  return [...traps.values()].map((trap) => {
    const said = { billed: joinNames(trap.billed), plan: trap.plan, count: trap.billed.length };
    return trap.tasks.length === rows.length
      ? t('spend.trap.everyTask', said)
      : t('spend.trap.tasks', { ...said, tasks: trap.tasks.join(', ') });
  });
}

const BILLING_LABEL = {
  billed: 'spend.billing.billed',
  plan: 'spend.billing.plan',
  local: 'spend.billing.local',
} as const satisfies Record<AiBilling, MessageKey>;

/** What each kind of money means, said on every engine card. */
export function billingWords(billing: AiBilling): string {
  return t(BILLING_LABEL[billing]);
}

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
  if (typical.billing === 'local') return t('cost.local');
  return t(typical.billing === 'plan' ? 'cost.usual.plan' : 'cost.usual.billed', { money: formatUsd(typical.micro) });
}

/**
 * Before any call is on record: what kind of money the next one spends, from
 * the engine that answers first. No figure is guessed — an estimate made up
 * without a single measured call would be the number people quote back.
 */
export function billingHint(billing: AiBilling): string {
  if (billing === 'local') return t('cost.local');
  return t(billing === 'plan' ? 'cost.kind.plan' : 'cost.kind.billed');
}

/** "$0.12 billed · ≈ $0.30 covered by your plan" — the Details row on a posting; null when nothing was recorded for it. */
export function jobSpendText(spend: Partial<Record<AiBilling, number>> | null): string | null {
  if (!spend) return null;
  const parts = [
    ...(spend.billed !== undefined ? [t('spend.job.billed', { money: formatUsd(spend.billed) })] : []),
    ...(spend.plan !== undefined ? [t('spend.job.plan', { money: formatUsd(spend.plan) })] : []),
    ...(spend.local !== undefined ? [t('spend.job.local')] : []),
  ];
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** What the application packs' own calls came to in a period (#487): how many packs, how many calls, the money by kind. */
export interface PackSpend {
  packs: number;
  calls: number;
  spend: Partial<Record<AiBilling, number>>;
}

/** "Application packs: 3 packs, 14 calls — $0.40 billed · ≈ $1.20 covered by your plan"; null when no pack spent anything. */
export function packSpendText(packs: PackSpend): string | null {
  const money = packs.calls > 0 ? jobSpendText(packs.spend) : null;
  return money && t('ai.packs', { packs: packs.packs, calls: packs.calls, money });
}

/**
 * The middle pack of the last few, by kind of money — never one sum, as
 * everywhere else (ADR 0055). A kind most packs never spent is left out, so a
 * single fallback onto a billed key does not read as what a pack costs. Null
 * under three packs, as for a single call (`typicalMicro`).
 */
export function typicalPackSpend(packs: readonly Partial<Record<AiBilling, number>>[]): Partial<Record<AiBilling, number>> | null {
  const typical: Partial<Record<AiBilling, number>> = {};
  for (const kind of AI_BILLING) {
    const spent = packs.filter((p) => p[kind] !== undefined).length;
    if (spent * 2 < packs.length) continue;
    const micro = typicalMicro(packs.map((p) => p[kind] ?? 0));
    if (micro === null) return null;
    typical[kind] = micro;
  }
  return Object.keys(typical).length > 0 ? typical : null;
}

/** The line under Prepare the pack once the ledger has packs to go by; null until it has three. */
export function packCostHint(packs: readonly Partial<Record<AiBilling, number>>[]): string | null {
  const typical = typicalPackSpend(packs);
  const money = typical && jobSpendText(typical);
  return money && t('pack.card.costUsual', { money, n: packs.length });
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
