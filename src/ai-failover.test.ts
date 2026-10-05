import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, type ChainContext, type ChainDeps } from './ai-failover';
import { createCooldownTracker } from './ai-cooldown';
import { resolveAiEngine, type AiEngineEnv, type AiProviderId } from './ai-engine';
import type { AiAttempt, AiProvider, AiRequest } from './ai-provider';
import type { AiCallRequest } from './ai-runtime';
import type { LedgerInput } from './ai-spend';
import type { AiOutcome } from './ai-usage';

// H45: the failover loop on recorded answers — no backend, no ledger, no clock of its own.

const ENV: AiEngineEnv = {
  provider: 'anthropic_api',
  hasAnthropicKey: true,
  hasOpenAiKey: true,
  openAiLocal: false,
  geminiUsable: true,
  codexUsable: true,
  classifierModel: 'claude-haiku-4-5-20251001',
  resumeModel: 'claude-opus-5',
  coverModel: '',
  openAiModel: '',
  localModel: '',
};

const REQ: AiCallRequest = { system: 'S', user: 'U', maxTokens: 100, label: 'classifier', role: 'classifier', timeoutMs: 60_000 };

const answer = (text: string): AiAttempt => ({ text, outcome: 'ok', spend: null });
const failure = (outcome: AiOutcome): AiAttempt => ({ text: null, outcome, spend: null });

/** Backends that answer from a script, one entry per call, and remember what they were asked. */
function harness(script: Partial<Record<AiProviderId, AiAttempt[]>>, opts: { now?: () => number; keys?: Partial<Record<AiProviderId, string>> } = {}) {
  const asked: { id: AiProviderId; req: AiRequest }[] = [];
  const rows: LedgerInput[] = [];
  const cooldowns = createCooldownTracker({ threshold: 3, cooldownMs: 60_000, refusedMs: 600_000, now: opts.now ?? (() => 0) });
  const deps: ChainDeps = {
    providerFor: (id): AiProvider => ({
      name: id,
      complete: async (req) => {
        asked.push({ id, req });
        return script[id]?.shift() ?? failure('error');
      },
    }),
    record: async (row) => {
      rows.push(row);
    },
    cooldowns,
    now: opts.now ?? (() => 0),
  };
  const ctx: ChainContext = {
    keyFor: (id) => opts.keys?.[id],
    openAiBase: 'http://127.0.0.1:11434/v1',
    localBase: 'http://127.0.0.1:11434',
    localContextTokens: 16_384,
    billingOf: (id) => (id === 'claude_code' ? 'plan' : 'billed'),
  };
  return { asked, rows, deps, ctx, cooldowns };
}

test('the first engine that answers wins, and every attempt is on the ledger', async () => {
  const engine = resolveAiEngine({ order: ['anthropic_api', 'claude_code'], models: {} }, ENV);
  const h = harness({ anthropic_api: [failure('timeout')], claude_code: [answer('{"ok":true}')] });
  const out = await runChain(engine, REQ, h.ctx, h.deps);
  assert.deepEqual(out && { text: out.text, providerId: out.providerId, viaFallback: out.viaFallback }, {
    text: '{"ok":true}',
    providerId: 'claude_code',
    viaFallback: true,
  });
  assert.deepEqual(h.rows.map((r) => [r.engine, r.outcome, r.billing, r.viaFallback]), [
    ['anthropic_api', 'timeout', 'billed', false],
    ['claude_code', 'ok', 'plan', true],
  ]);
});

test('each engine gets its own key and model, and the OpenAI-compatible one its server', async () => {
  const engine = resolveAiEngine({ order: ['openai_api'], models: { openai_api: { classifier: 'llama3.1:8b' } } }, ENV);
  const h = harness({ openai_api: [answer('x')] }, { keys: { openai_api: 'sk-local' } });
  await runChain(engine, REQ, h.ctx, h.deps);
  const [call] = h.asked;
  assert.equal(call?.req.apiKey, 'sk-local');
  assert.equal(call?.req.model, 'llama3.1:8b');
  assert.equal(call?.req.baseUrl, 'http://127.0.0.1:11434/v1');
});

test('a refused key is left alone on the next call, and tried again once it changes (H40)', async () => {
  const engine = resolveAiEngine({ order: ['anthropic_api', 'claude_code'], models: {} }, ENV);
  const keys: Partial<Record<AiProviderId, string>> = { anthropic_api: 'sk-ant-old' };
  const h = harness(
    { anthropic_api: [failure('unauthorized'), answer('from the new key')], claude_code: [answer('a'), answer('b')] },
    { keys },
  );
  await runChain(engine, REQ, h.ctx, h.deps);
  await runChain(engine, REQ, h.ctx, h.deps);
  assert.deepEqual(h.asked.map((a) => a.id), ['anthropic_api', 'claude_code', 'claude_code']);
  keys.anthropic_api = 'sk-ant-new';
  const out = await runChain(engine, REQ, h.ctx, h.deps);
  assert.equal(out?.text, 'from the new key');
});

test('an engine in cooldown is skipped, unless nothing else is left to try', async () => {
  const engine = resolveAiEngine({ order: ['anthropic_api', 'claude_code'], models: {} }, ENV);
  const h = harness({ claude_code: [answer('one'), answer('two')] });
  for (let i = 0; i < 3; i++) h.cooldowns.failure('anthropic_api');
  await runChain(engine, REQ, h.ctx, h.deps);
  assert.deepEqual(h.asked.map((a) => a.id), ['claude_code']);

  const alone = resolveAiEngine({ order: ['anthropic_api'], models: {} }, ENV);
  await runChain(alone, REQ, h.ctx, h.deps);
  assert.deepEqual(h.asked.map((a) => a.id), ['claude_code', 'anthropic_api']);
});

test('a web-tools call goes to an engine that has the tools first', async () => {
  const engine = resolveAiEngine({ order: ['openai_api', 'claude_code'], models: {} }, ENV);
  const h = harness({ claude_code: [answer('researched')] });
  await runChain(engine, { ...REQ, webTools: true }, h.ctx, h.deps);
  assert.deepEqual(h.asked.map((a) => a.id), ['claude_code']);
  assert.equal(h.asked[0]?.req.webTools, true);
});

test('the chain stops at its deadline, and an attempt never gets more than the time left', async () => {
  let clock = 0;
  const engine = resolveAiEngine({ order: ['anthropic_api', 'claude_code', 'gemini_cli'], models: {} }, ENV);
  const h = harness({}, { now: () => clock });
  // Each failure takes 50 s of a 120 s chain (2 × 60 s).
  h.deps.providerFor = (id) => ({
    name: id,
    complete: async (req) => {
      h.asked.push({ id, req });
      clock += 50_000;
      return failure('timeout');
    },
  });
  const out = await runChain(engine, REQ, h.ctx, h.deps);
  assert.equal(out, null);
  assert.deepEqual(h.asked.map((a) => [a.id, a.req.timeoutMs]), [
    ['anthropic_api', 60_000],
    ['claude_code', 60_000],
    ['gemini_cli', 20_000],
  ]);
});

test('an engine that cannot be built is passed over, not fatal', async () => {
  const engine = resolveAiEngine({ order: ['codex_cli', 'claude_code'], models: {} }, ENV);
  const h = harness({ claude_code: [answer('ok')] });
  const build = h.deps.providerFor;
  h.deps.providerFor = (id) => {
    if (id === 'codex_cli') throw new Error('not on this host');
    return build(id);
  };
  const out = await runChain(engine, REQ, h.ctx, h.deps);
  assert.equal(out?.providerId, 'claude_code');
  assert.deepEqual(h.rows.map((r) => r.engine), ['claude_code']);
});

test('the local engine gets its server, its window, JSON, and three times the clock (ADR 0057)', async () => {
  let clock = 0;
  const engine = resolveAiEngine({ order: ['local_api', 'claude_code'], models: { local_api: { classifier: 'llama3.1:8b' } } }, ENV);
  const h = harness({}, { now: () => clock });
  h.deps.providerFor = (id) => ({
    name: id,
    complete: async (req) => {
      h.asked.push({ id, req });
      clock += req.timeoutMs ?? 0;
      return id === 'claude_code' ? answer('ok') : failure('timeout');
    },
  });
  const out = await runChain(engine, { ...REQ, json: true }, h.ctx, h.deps);
  assert.equal(out?.providerId, 'claude_code');
  const [local, cloud] = h.asked;
  assert.equal(local?.req.baseUrl, 'http://127.0.0.1:11434');
  assert.equal(local?.req.contextTokens, 16_384);
  assert.equal(local?.req.json, true);
  assert.equal(local?.req.timeoutMs, 180_000);
  // The chain's deadline grew with it: the engine behind still gets its own minute.
  assert.equal(cloud?.req.timeoutMs, 60_000);
  assert.equal(cloud?.req.contextTokens, undefined);
});

test('a call goes to the engines that take its task, and "fallback" is read against the first of those (ADR 0060)', async () => {
  const engine = resolveAiEngine({ order: ['openai_api', 'claude_code'], models: {}, tasks: { openai_api: ['scoring'] } }, ENV);
  const letter = harness({ claude_code: [answer('Dear team')] });
  const out = await runChain(engine, { ...REQ, label: 'cover-letter', role: 'cover' }, letter.ctx, letter.deps);
  assert.deepEqual(letter.asked.map((a) => a.id), ['claude_code']);
  assert.equal(out?.viaFallback, false);
  assert.equal(letter.rows[0]?.viaFallback, false);
  const score = harness({ openai_api: [failure('error')], claude_code: [answer('{}')] });
  const scored = await runChain(engine, REQ, score.ctx, score.deps);
  assert.deepEqual(score.asked.map((a) => a.id), ['openai_api', 'claude_code']);
  assert.equal(scored?.viaFallback, true);
});

test('a task no engine takes still gets an answer from the chain', async () => {
  const engine = resolveAiEngine({ order: ['openai_api', 'claude_code'], models: {}, tasks: { openai_api: ['scoring'], claude_code: ['scoring'] } }, ENV);
  const h = harness({ openai_api: [answer('Dear team')] });
  await runChain(engine, { ...REQ, label: 'cover-letter', role: 'cover' }, h.ctx, h.deps);
  assert.deepEqual(h.asked.map((a) => a.id), ['openai_api']);
});
