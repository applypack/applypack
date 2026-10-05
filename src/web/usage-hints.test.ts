import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageHints, type HintFacts } from './usage-hints';
import type { SpendGroup } from '../ai-spend';

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

const PLAN = { id: 'claude_code', billing: 'plan', ready: true, enabled: true } as const;
const API = { id: 'anthropic_api', billing: 'billed', ready: true, enabled: true } as const;
const LOCAL = { id: 'local_api', billing: 'local', ready: true, enabled: false } as const;

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

test('no calls, no hints; and an engine test is not usage', () => {
  assert.deepEqual(usageHints(facts({})), []);
  assert.deepEqual(usageHints(facts({ groups: [group({ feature: 'engine-test' })] })), []);
});

test('a period with nothing billed and nothing to change says so, once', () => {
  const hints = usageHints(facts({ groups: [group({ calls: 12, micro: 40_000 })] }));
  assert.equal(hints.length, 1);
  assert.equal(hints[0]?.tone, 'ok');
  assert.match(hints[0]!.text, /^Nothing was billed in the last 7 days/);
});

test('the volume on a plan, with a model on this computer idle: no bill to cut, an allowance to spare, and no promise about quality', () => {
  const groups = [group({ calls: 395, micro: 1_600_000 }), group({ feature: 'resume-match', model: 'claude-sonnet-5', calls: 34, micro: 1_800_000 })];
  const [hint, ...rest] = usageHints(facts({ groups, engines: [PLAN, LOCAL] }));
  assert.equal(rest.length, 0);
  assert.equal(hint?.tone, 'neutral');
  assert.match(hint!.text, /^Scoring postings is 395 of 429 calls in the last 7 days \(92 %\), all on Claude Code CLI\./);
  assert.match(hint!.text, /no bill to cut/);
  assert.match(hint!.text, /Local model \(Ollama\) runs on this computer/);
  assert.match(hint!.text, /not measured here/);
  // Without a local model ready, or once it answers the task, there is nothing to suggest.
  assert.equal(usageHints(facts({ groups }))[0]?.tone, 'ok');
  assert.equal(usageHints(facts({ groups, engines: [PLAN, LOCAL], first: { scoring: 'local_api' } }))[0]?.tone, 'ok');
  // A smaller share, or too few calls to call it the volume, is no pattern.
  assert.equal(usageHints(facts({ groups: [group({ calls: 60 })], engines: [PLAN, LOCAL] }))[0]?.tone, 'ok');
});

test('the task most of the bill went to, while a plan stands behind the key', () => {
  const groups = [
    group({ engine: 'anthropic_api', billing: 'billed', calls: 400, micro: 4_100_000 }),
    group({ feature: 'cover-letter', engine: 'anthropic_api', model: 'claude-opus-5', billing: 'billed', calls: 2, micro: 900_000 }),
  ];
  const first = { scoring: 'anthropic_api', letters: 'anthropic_api' } as const;
  const [hint] = usageHints(facts({ groups, engines: [API, PLAN], first, budgetCents: 10_000 }));
  assert.equal(hint?.tone, 'warn');
  assert.equal(
    hint?.text,
    'Scoring postings was $4.10 of the $5.00 billed (82 %) in the last 7 days. Claude Code CLI is set up here and your plan covers it. Put it above Anthropic API: it answers first, and Anthropic API stays as its fallback.',
  );
  assert.deepEqual(hint?.action, { href: '/settings?tab=ai', label: 'AI engines' });
  // The plan already answers scoring now: the bill is history.
  assert.ok(!usageHints(facts({ groups, engines: [API, PLAN], first: { scoring: 'claude_code' }, budgetCents: 10_000 })).some((h) => /was \$4\.10/.test(h.text)));
});

test('with only a local model to offer, the hint says how to try it and what is not known', () => {
  const groups = [group({ engine: 'anthropic_api', billing: 'billed', calls: 400, micro: 4_100_000 })];
  const hint = usageHints(facts({ groups, engines: [API, LOCAL], first: { scoring: 'anthropic_api' }, budgetCents: 10_000 })).find((h) => /Scoring postings was/.test(h.text));
  assert.match(hint!.text, /was \$4\.10 billed in the last 7 days\. Local model \(Ollama\) runs on this computer for free\. Enable it and put it above Anthropic API with only Scoring postings ticked\./);
  assert.match(hint!.text, /not measured here: compare a day of results/);
});

test('a billed letter or web check is never offered to the model on this computer', () => {
  for (const [feature, task] of [['job-verify', 'verify'], ['cover-letter', 'letters'], ['resume-match', 'analysis']] as const) {
    const groups = [group({ feature, engine: 'anthropic_api', model: 'claude-sonnet-5', billing: 'billed', calls: 9, micro: 2_000_000 })];
    const hints = usageHints(facts({ groups, engines: [API, LOCAL], first: { [task]: 'anthropic_api' }, budgetCents: 10_000 }));
    assert.ok(!hints.some((h) => /Local model/.test(h.text)), feature);
  }
});

test('billed calls that were somebody else\'s fallback are counted apart', () => {
  const groups = [group({ engine: 'anthropic_api', billing: 'billed', calls: 40, micro: 500_000, viaFallback: 37, fallbackMicro: 460_000 })];
  const hint = usageHints(facts({ groups, engines: [PLAN, API], budgetCents: 10_000 })).find((h) => /fell over/.test(h.text));
  assert.equal(hint?.text, '37 calls fell over to Anthropic API in the last 7 days and were billed per token: $0.46. The engine ahead failed or ran out of its allowance.');
});

test('a failing model is named once it is a pattern, and a rate limit gets its own advice', () => {
  const quiet = usageHints(facts({ groups: [group({ feature: 'resume-match-fast', calls: 3, failed: 2 })] }));
  assert.ok(!quiet.some((h) => /did not answer/.test(h.text)));
  const broken = usageHints(facts({ groups: [group({ feature: 'resume-match-fast', calls: 10, failed: 4 })] })).find((h) => /did not answer/.test(h.text));
  assert.match(broken!.text, /^Quick check on Claude Code CLI · claude-haiku-4-5-20251001: 4 of 10 calls did not answer in the last 7 days\. Each is retried or handed to the next engine, which costs time\. Try another model/);
  const limited = usageHints(facts({ groups: [group({ calls: 100, failed: 30, rateLimited: 28 })], engines: [PLAN, LOCAL] })).find((h) => /did not answer/.test(h.text));
  assert.match(limited!.text, /\(28 hit a rate limit\)/);
  assert.match(limited!.text, /Local model \(Ollama\) runs on this computer and has no limit to hit: it can take Scoring postings off this engine\./);
  // A small model is never offered the analysis, whatever the limit did to it.
  const analysis = usageHints(facts({ groups: [group({ feature: 'resume-match', model: 'claude-sonnet-5', calls: 20, failed: 9, rateLimited: 9 })], engines: [PLAN, LOCAL] })).find((h) => /did not answer/.test(h.text));
  assert.match(analysis!.text, /Put a second engine behind it for this task/);
  const alone = usageHints(facts({ groups: [group({ calls: 100, failed: 30, rateLimited: 28 })] })).find((h) => /did not answer/.test(h.text));
  assert.match(alone!.text, /Put a second engine behind it for this task, or lower AI_CONCURRENCY\./);
});

test('the budget: a pace that overshoots is a warning from the third day, and no budget on a bill is a suggestion', () => {
  const groups = [group({ engine: 'anthropic_api', billing: 'billed', feature: 'cover-letter', calls: 4, micro: 4_000_000 })];
  const base = { groups, engines: [API], first: { letters: 'anthropic_api' } as const };
  const pace = usageHints(facts({ ...base, budgetCents: 1_000, billedMonthMicro: 4_000_000 })).find((h) => /pace/.test(h.text));
  assert.equal(pace?.text, "At the pace of its first 10 days, this month's billed calls reach about $12.40, over your $10.00 budget.");
  assert.ok(!usageHints(facts({ ...base, budgetCents: 1_000, billedMonthMicro: 4_000_000, now: new Date('2026-10-02T12:00:00Z') })).some((h) => /pace/.test(h.text)));
  assert.ok(!usageHints(facts({ ...base, budgetCents: 2_000, billedMonthMicro: 4_000_000 })).some((h) => /pace/.test(h.text)));
  const none = usageHints(facts(base)).find((h) => /No monthly budget/.test(h.text));
  assert.deepEqual(none?.action, { href: '/settings?tab=ai#budget', label: 'Set a budget' });
});

test('scoring billed on an expensive model names the cheap one its engine offers', () => {
  const groups = [group({ engine: 'anthropic_api', model: 'claude-opus-5', billing: 'billed', calls: 60, micro: 9_000_000 })];
  const hint = usageHints(facts({ groups, engines: [API], first: { scoring: 'anthropic_api' }, budgetCents: 100_000 })).find((h) => /Scoring ran on/.test(h.text));
  assert.match(hint!.text, /^Scoring ran on claude-opus-5: 60 calls in the last 7 days\. claude-haiku-4-5-20251001 costs about \d+ times less per token/);
  const cheap = usageHints(facts({ groups: [group({ engine: 'anthropic_api', billing: 'billed', calls: 60, micro: 90_000 })], engines: [API], first: { scoring: 'anthropic_api' }, budgetCents: 100_000 }));
  assert.ok(!cheap.some((h) => /Scoring ran on/.test(h.text)));
});

test('warnings come first', () => {
  const groups = [
    group({ calls: 395 }),
    group({ feature: 'resume-match-fast', calls: 10, failed: 4 }),
  ];
  const tones = usageHints(facts({ groups, engines: [PLAN, LOCAL] })).map((h) => h.tone);
  assert.deepEqual(tones, ['warn', 'neutral']);
});
