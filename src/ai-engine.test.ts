import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiCrawlerTokens,
  aiEngineCard,
  aiEngineOrder,
  bindingProviders,
  isAiProviderId,
  modelFitsProvider,
  parseAiEngineConfig,
  providerUnusable,
  resolveAiEngine,
  toggleAiEngine,
  withEngineFirst,
  type AiEngineEnv,
} from './ai-engine';

const ENV: AiEngineEnv = {
  provider: 'claude_code',
  hasAnthropicKey: false,
  hasOpenAiKey: false,
  openAiLocal: false,
  geminiUsable: true,
  agyUsable: true,
  codexUsable: false,
  classifierModel: 'claude-haiku-4-5-20251001',
  resumeModel: 'claude-opus-5',
  coverModel: '',
  openAiModel: '',
  localModel: '',
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

describe('aiEngineOrder / aiEngineCard / toggleAiEngine', () => {
  it('is the stored order, or the .env engine alone while nothing is stored', () => {
    assert.deepEqual(aiEngineOrder({ order: ['gemini_cli', 'claude_code'], models: {} }, 'anthropic_api'), ['gemini_cli', 'claude_code']);
    assert.deepEqual(aiEngineOrder({ order: [], models: {} }, 'anthropic_api'), ['anthropic_api']);
  });

  it('a card reads the list its button edits: the last resort says Enable, and Enable adds it', () => {
    const engine = resolveAiEngine(null, { ...ENV, provider: 'anthropic_api' });
    assert.deepEqual(aiEngineCard(engine, 'claude_code', 'anthropic_api'), { enabled: false, position: -1, lastResort: true, canToggle: true });
    assert.deepEqual(toggleAiEngine(engine.order, 'claude_code', 'anthropic_api'), ['anthropic_api', 'claude_code']);
    assert.deepEqual(aiEngineCard(engine, 'anthropic_api', 'anthropic_api'), { enabled: true, position: 0, lastResort: false, canToggle: false });
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
    assert.equal(modelFitsProvider('gemini-3.8-flash-high', 'agy_cli'), true);
    assert.equal(modelFitsProvider('claude-sonnet-4-6', 'agy_cli'), true);
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
    assert.equal(providerUnusable('agy_cli', ENV), false);
    assert.equal(providerUnusable('agy_cli', { ...ENV, agyUsable: false }), true);
    assert.equal(providerUnusable('codex_cli', ENV), true);
    assert.equal(providerUnusable('claude_code', ENV), false);
  });

  it('takes no key for a server on this machine', () => {
    assert.equal(providerUnusable('openai_api', { ...ENV, openAiLocal: true }), false);
    assert.equal(providerUnusable('openai_api', { ...ENV, hasOpenAiKey: true }), false);
  });

  it('accepts the five known ids and nothing else', () => {
    assert.equal(isAiProviderId('codex_cli'), true);
    assert.equal(isAiProviderId('agy_cli'), true);
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
    openAiLocal: false,
    geminiUsable: true,
    agyUsable: true,
    codexUsable: false,
    classifierModel: 'claude-haiku-4-5-20251001',
    resumeModel: 'claude-opus-5',
    coverModel: '',
    openAiModel: '',
    localModel: '',
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

// ADR 0036: a robots.txt binds this install through the engine that reads what we fetch.
describe('bindingProviders', () => {
  it('binds the last resort: Gemini CLI in .env with no login means Claude Code CLI reads everything', () => {
    const env: AiEngineEnv = { ...ENV, provider: 'gemini_cli', geminiUsable: false };
    const providers = bindingProviders(resolveAiEngine(null, env), env.provider);
    assert.deepEqual(providers, ['claude_code', 'gemini_cli']);
    assert.ok(aiCrawlerTokens(providers).includes('claudebot'));

    const stored = resolveAiEngine({ order: ['openai_api'], models: {} }, env);
    assert.deepEqual(bindingProviders(stored, env.provider), ['claude_code', 'openai_api', 'gemini_cli']);
  });

  it('adds no last resort while the list runs, and still counts its skipped engines and the .env engine', () => {
    const gemini: AiEngineEnv = { ...ENV, provider: 'gemini_cli' };
    const providers = bindingProviders(resolveAiEngine(null, gemini), gemini.provider);
    assert.deepEqual(providers, ['gemini_cli']);
    assert.ok(!aiCrawlerTokens(providers).includes('claudebot'));

    const env: AiEngineEnv = { ...ENV, provider: 'anthropic_api' };
    const engine = resolveAiEngine({ order: ['codex_cli', 'gemini_cli'], models: {} }, env);
    assert.deepEqual(bindingProviders(engine, env.provider), ['gemini_cli', 'codex_cli', 'anthropic_api']);
  });
});

// ADR 0036 addendum 2026-09-28: a model on this machine is nobody's crawler.
describe('a local OpenAI-compatible server', () => {
  const local: AiEngineEnv = { ...ENV, provider: 'anthropic_api', openAiLocal: true };

  it('binds nothing on an install whose every engine it is', () => {
    const engine = resolveAiEngine({ order: ['openai_api'], models: {} }, local);
    assert.deepEqual(bindingProviders(engine, local.provider, local), []);
    assert.deepEqual(aiCrawlerTokens(bindingProviders(engine, local.provider, local), local), []);
  });

  it('keeps the rule for everything around it: a skipped engine, a second engine, a remote server', () => {
    const skipped = resolveAiEngine({ order: ['openai_api', 'anthropic_api'], models: {} }, local);
    assert.deepEqual(aiCrawlerTokens(bindingProviders(skipped, local.provider, local), local), aiCrawlerTokens(['anthropic_api']));

    const withCli = resolveAiEngine({ order: ['openai_api', 'claude_code'], models: {} }, local);
    const tokens = aiCrawlerTokens(bindingProviders(withCli, local.provider, local), local);
    assert.ok(tokens.includes('claudebot'));
    assert.ok(!tokens.includes('gptbot'));

    const remote: AiEngineEnv = { ...local, openAiLocal: false, hasOpenAiKey: true };
    const openai = resolveAiEngine({ order: ['openai_api'], models: {} }, remote);
    assert.ok(aiCrawlerTokens(bindingProviders(openai, remote.provider, remote), remote).includes('gptbot'));
  });

  it('goes first on "Use it", with the stored list behind it and one model in every slot', () => {
    const stored = { order: ['claude_code' as const, 'openai_api' as const], models: { claude_code: { resume: 'claude-sonnet-5' } } };
    assert.deepEqual(withEngineFirst(stored, 'openai_api', local, 'llama3.1:8b'), {
      order: ['openai_api', 'claude_code'],
      models: {
        claude_code: { resume: 'claude-sonnet-5' },
        openai_api: { classifier: 'llama3.1:8b', resume: 'llama3.1:8b', cover: 'llama3.1:8b' },
      },
    });
  });

  it('keeps the .env engine behind it only when that engine can run here', () => {
    const none = { order: [], models: {} };
    assert.deepEqual(withEngineFirst(none, 'openai_api', local, 'm').order, ['openai_api']);
    assert.deepEqual(withEngineFirst(none, 'openai_api', { ...local, hasAnthropicKey: true }, 'm').order, ['openai_api', 'anthropic_api']);
  });
});

// ADR 0057: a model on this machine through Ollama's own API.
describe('the local engine', () => {
  it('takes no key, any model id, LOCAL_MODEL for an empty slot, and binds no robots token', () => {
    assert.equal(providerUnusable('local_api', ENV), false);
    assert.equal(modelFitsProvider('qwen2.5:14b', 'local_api'), true);
    assert.equal(modelFitsProvider('', 'local_api'), false);
    const engine = resolveAiEngine({ order: ['local_api'], models: {} }, { ...ENV, localModel: 'llama3.1:8b' });
    assert.equal(engine.modelFor('local_api', 'resume'), 'llama3.1:8b');
    assert.deepEqual(bindingProviders(engine, 'anthropic_api'), []);
    assert.deepEqual(aiCrawlerTokens(['local_api']), []);
  });

  it('beside a vendor engine, only the vendor binds', () => {
    const engine = resolveAiEngine({ order: ['local_api', 'gemini_cli'], models: {} }, ENV);
    assert.deepEqual(aiCrawlerTokens(bindingProviders(engine, 'claude_code')), ['google-extended', 'claudebot', 'claude-user', 'claude-searchbot', 'claude-web', 'anthropic-ai']);
  });

  it('goes first on "Use it" like the OpenAI-compatible one', () => {
    assert.deepEqual(withEngineFirst({ order: ['claude_code'], models: {} }, 'local_api', ENV, 'm').order, ['local_api', 'claude_code']);
  });
});
