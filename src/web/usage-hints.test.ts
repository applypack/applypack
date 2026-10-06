import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageHints, type HintFacts } from './usage-hints';
import type { SpendGroup } from '../ai-spend';
import { AI_TASKS } from '../ai-tasks';

const group = (over: Partial<SpendGroup>): SpendGroup => ({
  feature: 'classifier',
  engine: 'claude_code',
  model: 'claude-haiku-4-5-20251001',
  billing: 'plan',
  calls: 1,
  failed: 0,
  noUsage: 0,
  unpriced: 0,
  tokensIn: 0,
  tokensOut: 0,
  micro: 0,
  medianMs: 3_000,
  p90Ms: 4_000,
  rateLimited: 0,
  viaFallback: 0,
  fallbackMicro: 0,
  ...over,
});

type Engine = HintFacts['engines'][number];
const engine = (id: Engine['id'], billing: Engine['billing'], position: number, over: Partial<Engine> = {}): Engine => ({
  id,
  billing,
  ready: true,
  position,
  takes: id === 'local_api' ? AI_TASKS.filter((t) => t !== 'verify') : [...AI_TASKS],
  ...over,
});

const PLAN = engine('claude_code', 'plan', 0);
const LOCAL = engine('local_api', 'local', -1);
/** The key first, the plan behind it. */
const API_FIRST = [engine('anthropic_api', 'billed', 0), engine('claude_code', 'plan', 1)];

const facts = (over: Partial<HintFacts>): HintFacts => ({
  groups: [],
  period: 'in the last 7 days',
  engines: [PLAN],
  first: { scoring: 'claude_code', analysis: 'claude_code', letters: 'claude_code' },
  budgetCents: null,
  billedMonthMicro: 0,
  now: new Date('2026-10-10T12:00:00Z'),
  ...over,
});

const billedScoring = [group({ engine: 'anthropic_api', billing: 'billed', calls: 400, micro: 4_100_000 })];
const find = (hints: ReturnType<typeof usageHints>, pattern: RegExp) => hints.find((h) => pattern.test(h.text));

test('no calls, no hints; and an engine test is not usage', () => {
  assert.deepEqual(usageHints(facts({})), []);
  assert.deepEqual(usageHints(facts({ groups: [group({ feature: 'engine-test' })] })), []);
});

test('"nothing was billed" is said only when no call touched a billed engine', () => {
  const hints = usageHints(facts({ groups: [group({ calls: 12, micro: 40_000 })] }));
  assert.equal(hints.length, 1);
  assert.equal(hints[0]?.tone, 'ok');
  assert.match(hints[0]!.text, /^Nothing was billed in the last 7 days/);
  // A billed call the table cannot price, a failed one with no usage, an engine test: the Billed card may show money.
  const plan = group({ calls: 12 });
  assert.deepEqual(usageHints(facts({ groups: [plan, group({ engine: 'openai_api', model: 'mystery', billing: 'billed', unpriced: 1 })], budgetCents: 500 })), []);
  assert.deepEqual(usageHints(facts({ groups: [plan, group({ feature: 'engine-test', engine: 'anthropic_api', billing: 'billed', micro: 900 })] })), []);
});

test('the volume on a plan, with a model on this computer idle: no bill to cut, an allowance to spare, and no promise about quality', () => {
  const groups = [group({ calls: 395, micro: 1_600_000 }), group({ feature: 'resume-match', model: 'claude-sonnet-5', calls: 34, micro: 1_800_000 })];
  const [hint, ...rest] = usageHints(facts({ groups, engines: [PLAN, LOCAL] }));
  assert.equal(rest.length, 0);
  assert.equal(hint?.tone, 'neutral');
  assert.match(hint!.text, /^Scoring postings is 395 of 429 calls in the last 7 days \(92 %\), all on Claude Code CLI\. A plan covers them, so there is no bill to cut\./);
  assert.match(hint!.text, /Local model \(Ollama\) runs on this computer and can be given this task/);
  assert.match(hint!.text, /not measured here\.$/);
  // Without a local model ready, or once it answers the task, there is nothing to suggest.
  assert.equal(usageHints(facts({ groups }))[0]?.tone, 'ok');
  assert.equal(usageHints(facts({ groups, engines: [PLAN, LOCAL], first: { scoring: 'local_api' } }))[0]?.tone, 'ok');
  // A smaller share, or too few calls to call it the volume, is no pattern.
  assert.equal(usageHints(facts({ groups: [group({ calls: 60 })], engines: [PLAN, LOCAL] }))[0]?.tone, 'ok');
});

test('scoring spread over two plans names both, not the first it met', () => {
  const groups = [group({ calls: 60 }), group({ engine: 'codex_cli', model: '', calls: 240 })];
  const hint = usageHints(facts({ groups, engines: [PLAN, engine('codex_cli', 'plan', 1), LOCAL] }))[0];
  assert.match(hint!.text, /^Scoring postings is 300 of 300 calls in the last 7 days \(100 %\), all on Claude Code CLI and Codex CLI\./);
});

test('the task most of the bill went to, while a plan stands behind the key', () => {
  const groups = [...billedScoring, group({ feature: 'cover-letter', engine: 'anthropic_api', model: 'claude-opus-5', billing: 'billed', calls: 2, micro: 900_000 })];
  const first = { scoring: 'anthropic_api', letters: 'anthropic_api' } as const;
  const [hint] = usageHints(facts({ groups, engines: API_FIRST, first, budgetCents: 10_000 }));
  assert.equal(hint?.tone, 'warn');
  assert.equal(
    hint?.text,
    'Scoring postings was $4.10 of the $5.00 billed (82 %) in the last 7 days. Claude Code CLI is set up here and your plan covers it. Put it above Anthropic API: it then answers first, with Anthropic API as its fallback.',
  );
  assert.deepEqual(hint?.action, { href: '/settings?tab=ai', label: 'AI engines' });
  // The plan already answers scoring now: the bill is history.
  assert.ok(!find(usageHints(facts({ groups, engines: API_FIRST, first: { scoring: 'claude_code' }, budgetCents: 10_000 })), /was \$4\.10/));
});

test('the step it names is the one that is missing: the box, the order, or the engine itself', () => {
  const ask = (plan: Engine, first: Engine['id'] = 'anthropic_api', api = engine('anthropic_api', 'billed', 1)) =>
    find(usageHints(facts({ groups: billedScoring, engines: [api, plan], first: { scoring: first }, budgetCents: 10_000 })), /Scoring postings was/)?.text ?? null;
  // Above the key already, with the task unticked: moving it would change nothing.
  assert.match(ask(engine('claude_code', 'plan', 0, { takes: ['letters'] }))!, /covers it\. Tick Scoring postings on its card: it then answers first/);
  // Below the key and unticked: both.
  assert.match(ask(engine('claude_code', 'plan', 2, { takes: ['letters'] }))!, /Tick Scoring postings on its card and put it above Anthropic API:/);
  // Not in the list at all.
  assert.match(ask(engine('claude_code', 'plan', -1))!, /Enable it and put it above Anthropic API:/);
  // The engine it goes above is the one that answers now, not the period's biggest biller.
  const groups = [group({ engine: 'openai_api', model: 'gpt-5.1', billing: 'billed', calls: 400, micro: 4_100_000 })];
  const engines = [engine('anthropic_api', 'billed', 0), engine('openai_api', 'billed', 1), engine('claude_code', 'plan', 2)];
  const moved = find(usageHints(facts({ groups, engines, first: { scoring: 'anthropic_api' }, budgetCents: 10_000 })), /Scoring postings was/);
  assert.match(moved!.text, /Put it above Anthropic API: it then answers first, with Anthropic API as its fallback\./);
  // A plan engine that cannot run here is not offered.
  assert.equal(ask(engine('claude_code', 'plan', 2, { ready: false })), null);
});

test('with only a local model to offer, the hint says how to try it and what is not known', () => {
  const hint = find(usageHints(facts({ groups: billedScoring, engines: [engine('anthropic_api', 'billed', 0), LOCAL], first: { scoring: 'anthropic_api' }, budgetCents: 10_000 })), /Scoring postings was/);
  assert.match(hint!.text, /was \$4\.10 billed in the last 7 days\. Local model \(Ollama\) runs on this computer for free\. Enable it, leave only Scoring postings ticked on its card and put it above Anthropic API: it then answers first/);
  assert.match(hint!.text, /not measured here: compare a day of results before you rely on it\.$/);
});

test('a billed letter, analysis or web check is never offered to the model on this computer', () => {
  for (const [feature, task] of [['job-verify', 'verify'], ['cover-letter', 'letters'], ['resume-match', 'analysis']] as const) {
    const groups = [group({ feature, engine: 'anthropic_api', model: 'claude-sonnet-5', billing: 'billed', calls: 9, micro: 2_000_000 })];
    const hints = usageHints(facts({ groups, engines: [engine('anthropic_api', 'billed', 0), LOCAL], first: { [task]: 'anthropic_api' }, budgetCents: 10_000 }));
    assert.ok(!find(hints, /Local model/), feature);
  }
});

test('applicants are never steered onto a personal plan', () => {
  const groups = [group({ feature: 'screening', engine: 'anthropic_api', model: 'claude-sonnet-5', billing: 'billed', calls: 40, micro: 4_000_000 })];
  const hints = usageHints(facts({ groups, engines: API_FIRST, first: { screening: 'anthropic_api' }, budgetCents: 10_000 }));
  assert.deepEqual(hints, []);
});

test('billed attempts that were somebody else\'s fallback are counted apart, the web check left out', () => {
  const groups = [group({ engine: 'anthropic_api', billing: 'billed', calls: 40, micro: 500_000, viaFallback: 37, fallbackMicro: 460_000 })];
  const hint = find(usageHints(facts({ groups, engines: [PLAN, engine('anthropic_api', 'billed', 1)], budgetCents: 10_000 })), /fell over/);
  assert.equal(hint?.text, '37 calls fell over to Anthropic API in the last 7 days and were billed per token: $0.46. The engine ahead failed or ran out of its allowance.');
  // Before v2.44.0 a web check was a "fallback" whenever the first engine could not search.
  const verify = [group({ feature: 'job-verify', engine: 'anthropic_api', model: 'claude-sonnet-5', billing: 'billed', calls: 6, micro: 900_000, viaFallback: 6, fallbackMicro: 900_000 })];
  assert.ok(!find(usageHints(facts({ groups: verify, engines: [PLAN, engine('anthropic_api', 'billed', 1)], budgetCents: 10_000 })), /fell over/));
});

test('a failing model is named once it is a pattern, and a rate limit gets its own advice', () => {
  assert.ok(!find(usageHints(facts({ groups: [group({ feature: 'resume-match-fast', calls: 3, failed: 2 })] })), /did not answer/));
  const broken = find(usageHints(facts({ groups: [group({ feature: 'resume-match-fast', calls: 10, failed: 4 })] })), /did not answer/);
  assert.match(broken!.text, /^Quick check on Claude Code CLI · claude-haiku-4-5-20251001: 4 of 10 calls did not answer in the last 7 days\. Each is retried or handed to the next engine, which costs time\. Try another model/);
  const limited = find(usageHints(facts({ groups: [group({ calls: 100, failed: 30, rateLimited: 28 })], engines: [PLAN, LOCAL] })), /did not answer/);
  assert.match(limited!.text, /\(28 hit a rate limit\)/);
  assert.match(limited!.text, /Local model \(Ollama\) runs on this computer and has no limit to hit; giving it Scoring postings would take the volume off this engine\. How well a small model does this task is not measured here\.$/);
  // A small model is never offered the analysis, whatever the limit did to it.
  const analysis = find(usageHints(facts({ groups: [group({ feature: 'resume-match', model: 'claude-sonnet-5', calls: 20, failed: 9, rateLimited: 9 })], engines: [PLAN, LOCAL] })), /did not answer/);
  assert.match(analysis!.text, /Put a second engine behind it for this task, or lower AI_CONCURRENCY\.$/);
});

test('a failure with no reply is counted with the successes of its engine, not as a model of its own', () => {
  // The vendor answered 995 calls under its own id; five that never answered kept the id that was asked for.
  const groups = [
    group({ engine: 'openai_api', model: 'gpt-5.1-2026-08-07', billing: 'billed', calls: 995, micro: 2_000_000 }),
    group({ engine: 'openai_api', model: 'gpt-5.1', billing: 'billed', calls: 5, failed: 5, rateLimited: 5 }),
  ];
  const openai = [engine('openai_api', 'billed', 0)];
  assert.ok(!find(usageHints(facts({ groups, engines: openai, first: { scoring: 'openai_api' }, budgetCents: 10_000 })), /did not answer/));
  // When it is a pattern, the model named is the one that answers.
  const bad = [groups[0]!, { ...groups[1]!, calls: 400, failed: 400, rateLimited: 0 }];
  const hint = find(usageHints(facts({ groups: bad, engines: openai, first: { scoring: 'openai_api' }, budgetCents: 10_000 })), /did not answer/);
  assert.match(hint!.text, /^Scoring new postings on OpenAI-compatible API · gpt-5\.1-2026-08-07: 400 of 1,395 calls did not answer/);
});

test('the budget: a pace that overshoots is a warning from the third day, and no budget on a bill is a suggestion', () => {
  const groups = [group({ engine: 'anthropic_api', billing: 'billed', feature: 'cover-letter', calls: 4, micro: 4_000_000 })];
  const base = { groups, engines: [engine('anthropic_api', 'billed', 0)], first: { letters: 'anthropic_api' } as const };
  const pace = find(usageHints(facts({ ...base, budgetCents: 1_000, billedMonthMicro: 4_000_000 })), /pace/);
  assert.equal(pace?.text, "At the pace of its first 10 days, this month's billed calls reach about $12.40, over your $10.00 budget.");
  assert.ok(!find(usageHints(facts({ ...base, budgetCents: 1_000, billedMonthMicro: 4_000_000, now: new Date('2026-10-02T12:00:00Z') })), /pace/));
  assert.ok(!find(usageHints(facts({ ...base, budgetCents: 2_000, billedMonthMicro: 4_000_000 })), /pace/));
  assert.deepEqual(find(usageHints(facts(base)), /No monthly budget/)?.action, { href: '/settings?tab=ai#budget', label: 'Set a budget' });
});

test('scoring billed on an expensive model names the cheap one its engine offers, and says nothing about fitness', () => {
  const groups = [group({ engine: 'anthropic_api', model: 'claude-opus-5', billing: 'billed', calls: 60, micro: 9_000_000 })];
  const only = { engines: [engine('anthropic_api', 'billed', 0)], first: { scoring: 'anthropic_api' } as const, budgetCents: 100_000 };
  const hint = find(usageHints(facts({ groups, ...only })), /Scoring ran on/);
  assert.match(hint!.text, /^Scoring ran on claude-opus-5: 60 calls in the last 7 days\. claude-haiku-4-5-20251001 costs about \d+ times less per token \(prices of \d{4}-\d\d-\d\d\)\. The model is picked in the Classifier slot on the engine's card\.$/);
  assert.ok(!find(usageHints(facts({ groups: [group({ engine: 'anthropic_api', billing: 'billed', calls: 60, micro: 90_000 })], ...only })), /Scoring ran on/));
});

test('no sentence calls a model good enough, and warnings come first', () => {
  const groups = [group({ calls: 395 }), group({ feature: 'resume-match-fast', calls: 10, failed: 4 })];
  const hints = usageHints(facts({ groups, engines: [PLAN, LOCAL] }));
  assert.deepEqual(hints.map((h) => h.tone), ['warn', 'neutral']);
  for (const h of hints) assert.doesNotMatch(h.text, /good enough|meant for|well suited|can handle/);
});
