import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAiProviderId,
  modelFitsProvider,
  parseAiEngineConfig,
  providerUnusable,
  resolveAiEngine,
  type AiEngineEnv,
} from './ai-engine';

const ENV: AiEngineEnv = {
  provider: 'claude_code',
  hasAnthropicKey: false,
  hasOpenAiKey: false,
  geminiUsable: true,
  codexUsable: false,
  classifierModel: 'claude-haiku-4-5-20251001',
  resumeModel: 'claude-opus-5',
  openAiModel: '',
};

describe('resolveAiEngine', () => {
  it('seeds a one-engine chain from .env when nothing is stored', () => {
    const out = resolveAiEngine(null, ENV);
    assert.deepEqual(out.chain, ['claude_code']);
    assert.deepEqual(out.skipped, []);
    assert.equal(out.modelFor('claude_code', 'classifier'), ENV.classifierModel);
    assert.equal(out.modelFor('claude_code', 'resume'), ENV.resumeModel);
  });

  it('keeps the stored priority order', () => {
    const out = resolveAiEngine({ order: ['gemini_cli', 'claude_code'], models: {} }, ENV);
    assert.deepEqual(out.chain, ['gemini_cli', 'claude_code']);
    assert.equal(out.modelFor('gemini_cli', 'classifier'), 'gemini-2.5-flash');
    assert.equal(out.modelFor('gemini_cli', 'resume'), 'gemini-2.5-pro');
  });

  it('honours stored per-engine models and drops wrong-family ones', () => {
    const out = resolveAiEngine(
      {
        order: ['gemini_cli'],
        models: {
          gemini_cli: { classifier: 'gemini-2.5-pro', resume: 'claude-opus-5' },
        },
      },
      ENV,
    );
    assert.equal(out.modelFor('gemini_cli', 'classifier'), 'gemini-2.5-pro');
    assert.equal(out.modelFor('gemini_cli', 'resume'), 'gemini-2.5-pro');
  });

  it('skips engines the host cannot run and reports them', () => {
    const out = resolveAiEngine(
      { order: ['anthropic_api', 'openai_api', 'claude_code'], models: {} },
      ENV,
    );
    assert.deepEqual(out.chain, ['claude_code']);
    assert.deepEqual(out.skipped, ['anthropic_api', 'openai_api']);
  });

  it('falls back to claude_code when everything is unusable', () => {
    const out = resolveAiEngine(
      { order: ['openai_api'], models: {} },
      { ...ENV, provider: 'gemini_cli', geminiUsable: false },
    );
    assert.deepEqual(out.chain, ['claude_code']);
  });

  it('codex defaults to the CLI-configured model (empty id)', () => {
    const out = resolveAiEngine(
      { order: ['codex_cli'], models: {} },
      { ...ENV, codexUsable: true },
    );
    assert.equal(out.modelFor('codex_cli', 'classifier'), '');
  });

  it('openai model comes from OPENAI_MODEL when the slot is empty', () => {
    const out = resolveAiEngine(
      { order: ['openai_api'], models: {} },
      { ...ENV, hasOpenAiKey: true, openAiModel: 'llama-3.3-70b' },
    );
    assert.deepEqual(out.chain, ['openai_api']);
    assert.equal(out.modelFor('openai_api', 'resume'), 'llama-3.3-70b');
  });
});

describe('parseAiEngineConfig', () => {
  it('drops unknown ids and de-duplicates the order', () => {
    const out = parseAiEngineConfig({
      order: ['claude_code', 'openai', 'claude_code', 'gemini_cli'],
      models: { openai: { classifier: 'x' }, gemini_cli: { classifier: 'gemini-2.5-pro' } },
    });
    assert.deepEqual(out.order, ['claude_code', 'gemini_cli']);
    assert.deepEqual(Object.keys(out.models), ['gemini_cli']);
  });

  it('never throws on garbage', () => {
    assert.deepEqual(parseAiEngineConfig('nope'), { order: [], models: {} });
    assert.deepEqual(parseAiEngineConfig(null), { order: [], models: {} });
    assert.deepEqual(parseAiEngineConfig({ order: 42 }), { order: [], models: {} });
  });
});

describe('modelFitsProvider', () => {
  it('checks family prefixes per provider', () => {
    assert.equal(modelFitsProvider('gemini-2.5-flash', 'gemini_cli'), true);
    assert.equal(modelFitsProvider('claude-opus-5', 'gemini_cli'), false);
    assert.equal(modelFitsProvider('haiku', 'claude_code'), true);
    assert.equal(modelFitsProvider('haiku', 'anthropic_api'), false);
    assert.equal(modelFitsProvider('gpt-5.1', 'codex_cli'), true);
    assert.equal(modelFitsProvider('o3', 'codex_cli'), true);
    assert.equal(modelFitsProvider('claude-opus-5', 'codex_cli'), false);
  });

  it('openai_api accepts any non-empty id (base-URL providers)', () => {
    assert.equal(modelFitsProvider('meta-llama/llama-3.3-70b-instruct', 'openai_api'), true);
    assert.equal(modelFitsProvider('', 'openai_api'), false);
  });
});

describe('providerUnusable / isAiProviderId', () => {
  it('flags key-less APIs and unauthenticated CLIs', () => {
    assert.equal(providerUnusable('anthropic_api', ENV), true);
    assert.equal(providerUnusable('openai_api', ENV), true);
    assert.equal(providerUnusable('gemini_cli', ENV), false);
    assert.equal(providerUnusable('codex_cli', ENV), true);
    assert.equal(providerUnusable('claude_code', ENV), false);
  });

  it('accepts the five known ids and nothing else', () => {
    assert.equal(isAiProviderId('codex_cli'), true);
    assert.equal(isAiProviderId('openai_api'), true);
    assert.equal(isAiProviderId('openai'), false);
    assert.equal(isAiProviderId(null), false);
  });
});
