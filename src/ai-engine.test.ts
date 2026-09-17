import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiEngineOrder,
  isAiProviderId,
  modelFitsProvider,
  parseAiEngineConfig,
  providerUnusable,
  resolveAiEngine,
  summarizeAiUsage,
  toggleAiEngine,
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
  coverModel: '',
  openAiModel: '',
};

describe('resolveAiEngine', () => {
  it('an empty .env resume model takes the backend default: Sonnet on the CLI, Haiku on the API; cover Opus', () => {
    const out = resolveAiEngine({ order: ['claude_code', 'anthropic_api'], models: {} }, { ...ENV, resumeModel: '', hasAnthropicKey: true });
    assert.equal(out.modelFor('claude_code', 'resume'), 'claude-sonnet-5');
    assert.equal(out.modelFor('anthropic_api', 'resume'), 'claude-haiku-4-5-20251001');
    assert.equal(out.modelFor('claude_code', 'cover'), 'claude-opus-5');
    assert.equal(out.modelFor('anthropic_api', 'classifier'), ENV.classifierModel);
  });

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
    assert.equal(out.lastResort, 'claude_code');
  });

  it('reports the last resort apart from the list it stands in for', () => {
    // AI_PROVIDER=anthropic_api, no key, nothing stored — the install this bug was found on.
    const seeded = resolveAiEngine(null, { ...ENV, provider: 'anthropic_api' });
    assert.deepEqual(seeded.order, ['anthropic_api']);
    assert.deepEqual(seeded.skipped, ['anthropic_api']);
    assert.deepEqual(seeded.chain, ['claude_code']);
    assert.equal(seeded.lastResort, 'claude_code');

    // A usable .env engine outside the stored list is the last resort before claude_code.
    const stored = resolveAiEngine({ order: ['openai_api'], models: {} }, { ...ENV, provider: 'gemini_cli' });
    assert.deepEqual(stored.order, ['openai_api']);
    assert.deepEqual(stored.chain, ['gemini_cli']);
    assert.equal(stored.lastResort, 'gemini_cli');

    assert.equal(resolveAiEngine(null, ENV).lastResort, null);
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

describe('aiEngineOrder / toggleAiEngine', () => {
  it('is the stored order, or the .env engine alone while nothing is stored', () => {
    assert.deepEqual(aiEngineOrder({ order: ['gemini_cli', 'claude_code'], models: {} }, 'anthropic_api'), ['gemini_cli', 'claude_code']);
    assert.deepEqual(aiEngineOrder({ order: [], models: {} }, 'anthropic_api'), ['anthropic_api']);
  });

  it('pressing the last resort adds it behind the list, not removes it', () => {
    const { order, lastResort } = resolveAiEngine(null, { ...ENV, provider: 'anthropic_api' });
    assert.deepEqual(toggleAiEngine(order, lastResort!, 'anthropic_api'), ['anthropic_api', 'claude_code']);
  });

  it('removes an enabled engine, but not the .env engine alone in the list — an empty list seeds it back', () => {
    assert.deepEqual(toggleAiEngine(['anthropic_api', 'claude_code'], 'anthropic_api', 'anthropic_api'), ['claude_code']);
    assert.deepEqual(toggleAiEngine(['gemini_cli'], 'gemini_cli', 'anthropic_api'), []);
    assert.equal(toggleAiEngine(['anthropic_api'], 'anthropic_api', 'anthropic_api'), null);
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

describe('summarizeAiUsage', () => {
  const today = new Date('2026-08-30T12:00:00Z');

  it('sums the window, drops old days and unknown providers', () => {
    const raw = {
      '2026-08-30': { claude_code: { classifier: 5, resume: 1, cover: 2 } },
      '2026-08-28': { claude_code: { classifier: 2 }, gemini_cli: { resume: 3 } },
      '2026-08-01': { claude_code: { classifier: 99 } },
      '2026-08-29': { openai: { classifier: 7 } },
    };
    const rows = summarizeAiUsage(raw, 7, today);
    assert.deepEqual(rows, [
      { id: 'claude_code', classifier: 7, resume: 1, cover: 2 },
      { id: 'gemini_cli', classifier: 0, resume: 3, cover: 0 },
    ]);
  });

  it('is tolerant of garbage and empty input', () => {
    assert.deepEqual(summarizeAiUsage(null, 7, today), []);
    assert.deepEqual(summarizeAiUsage('nope', 7, today), []);
    assert.deepEqual(summarizeAiUsage({ '2026-08-30': { claude_code: {} } }, 7, today), []);
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

describe('cover role', () => {
  const env = {
    provider: 'claude_code' as const,
    hasAnthropicKey: true,
    hasOpenAiKey: false,
    geminiUsable: true,
    codexUsable: false,
    classifierModel: 'claude-haiku-4-5-20251001',
    resumeModel: 'claude-opus-5',
    coverModel: '',
    openAiModel: '',
  };

  it('takes the writer by default, whatever the resume slot says, until it is set explicitly', () => {
    const bare = resolveAiEngine({ order: ['claude_code'], models: {} }, env);
    assert.equal(bare.modelFor('claude_code', 'cover'), 'claude-opus-5');

    const viaResume = resolveAiEngine(
      { order: ['claude_code'], models: { claude_code: { resume: 'claude-sonnet-5' } } },
      env,
    );
    assert.equal(viaResume.modelFor('claude_code', 'cover'), 'claude-opus-5');

    const explicit = resolveAiEngine(
      { order: ['claude_code'], models: { claude_code: { resume: 'claude-sonnet-5', cover: 'claude-opus-5' } } },
      env,
    );
    assert.equal(explicit.modelFor('claude_code', 'cover'), 'claude-opus-5');
    assert.equal(explicit.modelFor('claude_code', 'resume'), 'claude-sonnet-5');
  });

  it('ignores a wrong-family cover id the same way as the other roles', () => {
    const wrong = resolveAiEngine(
      { order: ['gemini_cli'], models: { gemini_cli: { cover: 'claude-opus-5' } } },
      env,
    );
    assert.equal(wrong.modelFor('gemini_cli', 'cover'), 'gemini-2.5-pro');
  });
});
