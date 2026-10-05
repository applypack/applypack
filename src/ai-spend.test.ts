import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingNotes,
  budgetAlert,
  budgetAlertText,
  billingHint,
  costHintText,
  jobSpendText,
  formatUsd,
  ledgerRow,
  periodRange,
  spendReportLines,
  spendView,
  usageByModel,
  typicalMicro,
  type LedgerInput,
  type SpendGroup,
} from './ai-spend';
import { NO_USAGE, type AiBilling } from './ai-usage';
import { PRICES_AS_OF } from './ai-prices';

const attempt = (over: Partial<LedgerInput> = {}): LedgerInput => ({
  at: new Date('2026-09-28T10:00:00Z'),
  durationMs: 1_234.6,
  engine: 'anthropic_api',
  model: 'claude-opus-5',
  feature: 'resume-match',
  outcome: 'ok',
  spend: { usage: { ...NO_USAGE, inputTokens: 50_000, outputTokens: 15_000 }, model: 'claude-opus-5-20260101', reportedUsd: null },
  viaFallback: false,
  billing: 'billed',
  ...over,
});

test('a row carries the usage as reported, priced by the resolved model and dated', () => {
  const row = ledgerRow(attempt({ jobId: 7, resumeId: 2 }));
  assert.equal(row.costMicroUsd, 625_000);
  assert.equal(row.priceAsOf, PRICES_AS_OF);
  assert.equal(row.resolvedModel, 'claude-opus-5-20260101');
  assert.equal(row.durationMs, 1_235);
  assert.equal(row.cacheReadTokens, null);
  assert.deepEqual([row.jobId, row.resumeId], [7, 2]);
});

test('a timeout has no usage and no cost; the vendor\'s own figure is kept beside ours', () => {
  const timeout = ledgerRow(attempt({ outcome: 'timeout', spend: null }));
  assert.equal(timeout.inputTokens, null);
  assert.equal(timeout.costMicroUsd, null);
  assert.equal(timeout.priceAsOf, null);
  const cli = ledgerRow(
    attempt({ engine: 'claude_code', billing: 'plan', spend: { usage: { ...NO_USAGE, outputTokens: 100 }, model: 'claude-haiku-4-5', reportedUsd: 0.0123456 } }),
  );
  assert.equal(cli.costMicroUsd, 500);
  assert.equal(cli.reportedMicroUsd, 12_346);
});

test('a local call is free: no cost is claimed for it, whatever the model is called', () => {
  const row = ledgerRow(attempt({ engine: 'openai_api', billing: 'local', model: 'gpt-4o', spend: { usage: { ...NO_USAGE, inputTokens: 10 }, model: 'gpt-4o', reportedUsd: null } }));
  assert.equal(row.costMicroUsd, null);
});

const group = (over: Partial<SpendGroup>): SpendGroup => ({
  feature: 'classifier',
  engine: 'anthropic_api',
  model: 'claude-haiku-4-5-20251001',
  billing: 'billed',
  calls: 1,
  failed: 0,
  noUsage: 0,
  unpriced: 0,
  tokensIn: 0,
  tokensOut: 0,
  micro: 0,
  medianMs: null,
  p90Ms: null,
  rateLimited: 0,
  viaFallback: 0,
  fallbackMicro: 0,
  ...over,
});

test('the three kinds of money are three totals, never one', () => {
  const view = spendView([
    group({ calls: 90, micro: 110_000, tokensIn: 900_000, tokensOut: 9_000 }),
    group({ feature: 'resume-match', engine: 'claude_code', model: 'claude-sonnet-5', billing: 'plan', calls: 4, micro: 900_000 }),
    group({ feature: 'cover-letter', engine: 'openai_api', model: 'qwen2.5:14b', billing: 'local', calls: 6, micro: 999, tokensIn: 5_000 }),
  ]);
  assert.deepEqual(view.totals.billed, { calls: 90, tokens: 909_000, micro: 110_000 });
  assert.deepEqual(view.totals.plan, { calls: 4, tokens: 0, micro: 900_000 });
  assert.deepEqual(view.totals.local, { calls: 6, tokens: 5_000, micro: 0 });
  // Largest money first; a local row never shows money.
  assert.deepEqual(view.rows.map((r) => [r.feature, r.micro]), [
    ['Full analysis', 900_000],
    ['Scoring new postings', 110_000],
    ['Writing cover letters', 0],
  ]);
});

test('the notes say where the money goes, what is not priced and what ended unheard', () => {
  const view = spendView([
    group({ calls: 92, micro: 11_000 }),
    group({ feature: 'resume-match', calls: 8, micro: 89_000, failed: 1, noUsage: 1 }),
    group({ feature: 'resume-scan', engine: 'openai_api', model: 'anthropic/claude-sonnet-5', calls: 3, unpriced: 3 }),
  ]);
  // A row the table could not price carries the count, so its cell never reads "$0".
  assert.equal(view.rows.find((r) => r.feature === 'Resume scan')?.unpriced, 3);
  assert.deepEqual(view.notes, [
    'Full analysis is 8 % of those calls and 89 % of the billed money.',
    `3 calls on anthropic/claude-sonnet-5 are not priced — the price table is from ${PRICES_AS_OF} and does not know that model.`,
    "1 call ended with no usage reported (a timeout or an error). A timed-out call may still be on the vendor's bill.",
  ]);
  assert.deepEqual(spendView([]).notes, []);
  // With no bill, the plan's estimate is the money the sentence reads — never the two added.
  assert.deepEqual(
    spendView([
      group({ billing: 'plan', calls: 50, micro: 10_000 }),
      group({ feature: 'cover-letter', billing: 'plan', calls: 2, micro: 30_000 }),
      group({ feature: 'resume-scan', billing: 'local', calls: 9 }),
    ]).notes,
    ['Writing cover letters is 4 % of those calls and 75 % of what your plans covered, at API prices.'],
  );
});

test('periods are UTC ranges, the end exclusive, across month and year edges', () => {
  const now = new Date('2026-01-03T23:30:00Z');
  const iso = (r: { from: Date; to: Date }) => [r.from.toISOString().slice(0, 10), r.to.toISOString().slice(0, 10)];
  assert.deepEqual(iso(periodRange('7d', now)), ['2025-12-28', '2026-01-04']);
  assert.deepEqual(iso(periodRange('month', now)), ['2026-01-01', '2026-02-01']);
  assert.deepEqual(iso(periodRange('last-month', now)), ['2025-12-01', '2026-01-01']);
  assert.deepEqual(iso(periodRange('year', now)), ['2026-01-01', '2027-01-01']);
});

test('the budget warns once at 80 % and once at 100 % a month, and a new month starts over', () => {
  const cents = 1_000; // $10
  assert.equal(budgetAlert(7_990_000, cents, '2026-09', null), null);
  assert.equal(budgetAlert(8_000_000, cents, '2026-09', null), '2026-09:080');
  assert.equal(budgetAlert(9_000_000, cents, '2026-09', '2026-09:080'), null);
  assert.equal(budgetAlert(10_000_000, cents, '2026-09', '2026-09:080'), '2026-09:100');
  // Straight past both in one call: the higher warning, once.
  assert.equal(budgetAlert(12_000_000, cents, '2026-09', null), '2026-09:100');
  assert.equal(budgetAlert(12_000_000, cents, '2026-09', '2026-09:100'), null);
  assert.equal(budgetAlert(8_500_000, cents, '2026-10', '2026-09:100'), '2026-10:080');
  assert.equal(budgetAlert(1, 0, '2026-10', null), null);
  assert.match(budgetAlertText(8_000_000, cents), /\$8\.00 billed this month, 80 % of your \$10\.00 monthly budget\. Nothing is stopped/);
});

test('a billed engine ahead of one a plan covers is named, with the move that fixes it', () => {
  const API = { label: 'Anthropic API', billing: 'billed' as const };
  const OPENAI = { label: 'OpenAI-compatible API', billing: 'billed' as const };
  const CLI = { label: 'Claude Code CLI', billing: 'plan' as const };
  const rows = (...engines: { label: string; billing: AiBilling }[][]) =>
    engines.map((list, i) => ({ task: ['scoring', 'analysis', 'letters'][i]!, label: ['Scoring postings', 'Resume analysis', 'Cover letters'][i]!, engines: list }));
  assert.deepEqual(billingNotes(rows([API, CLI], [API, CLI], [API, CLI])), [
    'Calls go to Anthropic API first and are billed per token; Claude Code CLI, which your plan covers, answers only when it fails. Move Claude Code CLI up to spend the plan first.',
  ]);
  assert.deepEqual(billingNotes(rows([CLI, API], [CLI, API], [CLI, API])), []);
  assert.deepEqual(billingNotes(rows([API, OPENAI], [API, OPENAI], [API])), []);
  // ADR 0060: a billed engine narrowed to the letters is ahead of the plan for the letters only.
  assert.deepEqual(billingNotes(rows([CLI], [CLI], [API, CLI])), [
    'For Cover letters, calls go to Anthropic API first and are billed per token; Claude Code CLI, which your plan covers, answers only when it fails. Move Claude Code CLI up to spend the plan first.',
  ]);
  // Applicants' resumes are not steered onto a personal plan.
  assert.deepEqual(billingNotes([{ task: 'screening', label: 'Screening applicants', engines: [API, CLI] }]), []);
});

test('an estimate is the middle of at least three, and money reads as money', () => {
  assert.equal(typicalMicro([1, 2]), null);
  assert.equal(typicalMicro([40_000, 10_000, 90_000]), 40_000);
  assert.equal(typicalMicro([1, 2, 3, 4]), 3);
  assert.equal(formatUsd(0), '$0');
  assert.equal(formatUsd(4_321), '$0.0043');
  assert.equal(formatUsd(625_000), '$0.63');
  assert.equal(formatUsd(1_234_560_000), '$1,234.56');
});

test('the hint under a button, and the line about one posting', () => {
  assert.equal(costHintText(null), null);
  assert.equal(costHintText({ micro: 40_000, billing: 'billed' }), 'Usually $0.04 a call, billed per token (the middle of your recent calls).');
  assert.equal(costHintText({ micro: 40_000, billing: 'plan' }), 'Usually ≈ $0.04 at API prices, which your plan covers (the middle of your recent calls).');
  assert.equal(costHintText({ micro: 0, billing: 'local' }), 'Runs on your local model: free.');
  assert.equal(jobSpendText(null), null);
  assert.equal(jobSpendText({ billed: 120_000, plan: 300_000 }), '$0.12 billed · ≈ $0.30 covered by your plan');
});

test('the report is one tab-separated row per UTC day, engine and model, and a total per kind', () => {
  const row = { day: '2026-09-27', engine: 'anthropic_api', model: 'claude-haiku-4-5', billing: 'billed' as const, calls: 40, aborted: 1, input: 40_000, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 8_000, searches: 0, ourMicro: 80_000, vendorMicro: 0 };
  const lines = spendReportLines([row, { ...row, engine: 'claude_code', model: '', billing: 'plan', ourMicro: 10_000, vendorMicro: 11_000 }]);
  assert.equal(lines[0]!.split('\t').length, 14);
  assert.equal(lines[1], '2026-09-27\tanthropic_api\tclaude-haiku-4-5\tbilled\t40\t1\t40000\t0\t0\t0\t8000\t0\t0.080000\t0.000000');
  assert.equal(lines[2]!.split('\t')[2], 'default');
  assert.deepEqual(lines.slice(3), [
    '# billed: 40 calls, 1 aborted; ours $0.08, vendor-reported $0',
    '# plan: 40 calls, 1 aborted; ours $0.01, vendor-reported $0.01',
  ]);
});

test('before any call is on record, the hint says what kind of money and no figure', () => {
  assert.equal(billingHint('billed'), 'Billed per token on your API key.');
  assert.equal(billingHint('plan'), 'Your plan covers it.');
  assert.equal(billingHint('local'), 'Runs on your local model: free.');
});

test('the rows by the model that answered: the busiest model first, and inside it the busiest task', () => {
  const view = spendView([
    group({ engine: 'claude_code', billing: 'plan', calls: 395, micro: 1_600_000, medianMs: 3_374, p90Ms: 3_836 }),
    group({ feature: 'posting-extract', engine: 'claude_code', billing: 'plan', calls: 3, failed: 1, micro: 10_000 }),
    group({ feature: 'resume-match', engine: 'claude_code', model: 'claude-sonnet-5', billing: 'plan', calls: 15, micro: 1_190_000, medianMs: 29_427, p90Ms: 34_361 }),
    group({ feature: 'classifier', engine: 'local_api', model: 'gemma4:e4b', billing: 'local', calls: 40, micro: 0 }),
  ]);
  const models = usageByModel(view.rows);
  assert.deepEqual(models.map((m) => [m.engine, m.model, m.calls, m.failed, m.micro]), [
    ['Claude Code CLI', 'claude-haiku-4-5-20251001', 398, 1, 1_610_000],
    ['Local model (Ollama)', 'gemma4:e4b', 40, 0, 0],
    ['Claude Code CLI', 'claude-sonnet-5', 15, 0, 1_190_000],
  ]);
  assert.deepEqual(models[0]?.rows.map((r) => [r.feature, r.calls, r.medianMs, r.p90Ms]), [
    ['Scoring new postings', 395, 3_374, 3_836],
    ['Reading a pasted posting', 3, null, null],
  ]);
});

