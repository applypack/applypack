import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiCrawlerTokens,
  aiEngineCard,
  aiEngineOrder,
  bindingProviders,
  isAiProviderId,
  modelFitsProvider,
  offeredTasks,
  parseAiEngineConfig,
  providerUnusable,
  resolveAiEngine,
  taskPlans,
  toggleAiEngine,
  withEngineFirst,
  firstForEveryTask,
  missingCredentials,
  adoptFoundEngine,
  withEngineTasks,
  OPENAI_DEFAULT_MODEL,
  type AiEngineEnv,
  type AiProviderId,
} from './ai-engine';
import { AI_TASKS } from './ai-tasks';

const ENV: AiEngineEnv = {
  provider: 'claude_code',
  hasAnthropicKey: false,
  hasOpenAiKey: false,
  openAiLocal: false,
  geminiUsable: true,
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

  it('an empty openai slot asks for one model, whoever asks: OPENAI_MODEL, a local server\'s own, else gpt-5-mini (#606)', () => {
    const empty = { order: ['openai_api'], models: {} } as const;
    const local = { ...ENV, openAiLocal: true, openAiServerModel: 'qwen2.5-14b-instruct' };
    // A server on this machine has no gpt-5-mini: the call and the Test both take the first chat model it lists.
    assert.equal(resolveAiEngine(empty, local).modelFor('openai_api', 'classifier'), 'qwen2.5-14b-instruct');
    assert.equal(resolveAiEngine(empty, { ...local, openAiModel: 'llama-3.3-70b' }).modelFor('openai_api', 'cover'), 'llama-3.3-70b');
    // A server on the internet, or a local one not asked yet: the engine's own default — never '' and a CLI's words.
    assert.equal(resolveAiEngine(empty, { ...ENV, hasOpenAiKey: true }).modelFor('openai_api', 'resume'), OPENAI_DEFAULT_MODEL);
    assert.equal(resolveAiEngine(empty, { ...local, openAiServerModel: null }).modelFor('openai_api', 'resume'), 'gpt-5-mini');
    // A slot the user filled wins over all of it.
    assert.equal(resolveAiEngine({ ...empty, models: { openai_api: { classifier: 'phi-4' } } }, local).modelFor('openai_api', 'classifier'), 'phi-4');
  });
});

describe('aiEngineOrder / aiEngineCard / toggleAiEngine', () => {
  it('is the stored order, or the .env engine alone while nothing is stored', () => {
    assert.deepEqual(aiEngineOrder({ order: ['gemini_cli', 'claude_code'], models: {}, tasks: {} }, 'anthropic_api'), ['gemini_cli', 'claude_code']);
    assert.deepEqual(aiEngineOrder({ order: [], models: {}, tasks: {} }, 'anthropic_api'), ['anthropic_api']);
  });

  const stored = (...order: AiProviderId[]) => ({ order, models: {}, tasks: {} });
  // No .env, no key: the Anthropic API is the default engine and cannot run.
  const BARE = { ...ENV, provider: 'anthropic_api' as const };

  it('a card reads the list its button edits: the last resort says Enable, and Enable adds it', () => {
    assert.deepEqual(aiEngineCard(stored(), 'claude_code', BARE), { enabled: false, position: -1, lastResort: true, canToggle: true });
    assert.deepEqual(aiEngineCard(stored(), 'anthropic_api', BARE), { enabled: true, position: 0, lastResort: false, canToggle: false });
    const keyed = { ...BARE, hasAnthropicKey: true };
    assert.deepEqual(toggleAiEngine(stored(), 'claude_code', keyed), ['anthropic_api', 'claude_code'], 'a .env engine that runs keeps its place');
  });

  it('Enable never stores a .env engine nobody chose that cannot run here in front of it (#647)', () => {
    assert.deepEqual(toggleAiEngine(stored(), 'claude_code', BARE), ['claude_code']);
    assert.deepEqual(toggleAiEngine(stored('gemini_cli'), 'claude_code', BARE), ['gemini_cli', 'claude_code'], 'a stored list is the person\'s');
  });

  it('removes an enabled engine, but not the .env engine alone in the list — an empty list seeds it back', () => {
    assert.deepEqual(toggleAiEngine(stored('anthropic_api', 'claude_code'), 'anthropic_api', BARE), ['claude_code']);
    assert.deepEqual(toggleAiEngine(stored('gemini_cli'), 'gemini_cli', BARE), []);
    assert.equal(toggleAiEngine(stored('anthropic_api'), 'anthropic_api', BARE), null);
  });

  it('Disable is refused for an engine that would answer every call as the last resort the moment it left (#647)', () => {
    assert.equal(toggleAiEngine(stored('claude_code'), 'claude_code', BARE), null);
    assert.equal(aiEngineCard(stored('claude_code'), 'claude_code', BARE).canToggle, false);
    assert.equal(toggleAiEngine(stored('codex_cli', 'claude_code'), 'claude_code', BARE), null, 'Codex is signed out: nothing else runs');
    // Something else that runs takes over, or the .env engine can: then it goes.
    assert.deepEqual(toggleAiEngine(stored('gemini_cli', 'claude_code'), 'claude_code', BARE), ['gemini_cli']);
    assert.deepEqual(toggleAiEngine(stored('claude_code'), 'claude_code', { ...BARE, hasAnthropicKey: true }), []);
    // One that stands down for the last resort goes, and the last resort is somebody else.
    assert.deepEqual(toggleAiEngine(stored('gemini_cli'), 'gemini_cli', BARE), []);
    assert.equal(resolveAiEngine(stored(), BARE).lastResort, 'claude_code');
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
    assert.deepEqual(parseAiEngineConfig('nope'), { order: [], models: {}, tasks: {} });
    assert.deepEqual(parseAiEngineConfig(null), { order: [], models: {}, tasks: {} });
    assert.deepEqual(parseAiEngineConfig({ order: 42 }), { order: [], models: {}, tasks: {} });
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
    assert.equal(providerUnusable('codex_cli', ENV), true);
    assert.equal(providerUnusable('claude_code', ENV), false);
  });

  it('takes no key for a server on this machine', () => {
    assert.equal(providerUnusable('openai_api', { ...ENV, openAiLocal: true }), false);
    assert.equal(providerUnusable('openai_api', { ...ENV, hasOpenAiKey: true }), false);
  });

  it('accepts the known provider ids and nothing else', () => {
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
    const stored = { order: ['claude_code' as const, 'openai_api' as const], models: { claude_code: { resume: 'claude-sonnet-5' } }, tasks: {} };
    assert.deepEqual(withEngineFirst(stored, 'openai_api', local, 'llama3.1:8b'), {
      order: ['openai_api', 'claude_code'],
      models: {
        claude_code: { resume: 'claude-sonnet-5' },
        openai_api: { classifier: 'llama3.1:8b', resume: 'llama3.1:8b', cover: 'llama3.1:8b' },
      },
      tasks: { openai_api: ['scoring'] },
    });
  });

  it('keeps the .env engine behind it only when that engine can run here', () => {
    const none = { order: [], models: {}, tasks: {} };
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
    assert.deepEqual(withEngineFirst({ order: ['claude_code'], models: {}, tasks: {} }, 'local_api', ENV, 'm').order, ['local_api', 'claude_code']);
  });
});

// ADR 0060: an engine takes the tasks it is given, and the order decides among those that take one.
describe('tasks per engine', () => {
  const env = { ...ENV, localModel: 'gemma4:e4b' };
  const both = { order: ['local_api', 'claude_code'], models: {} };

  it('an engine with no list takes every task it can be given, so a stored chain from before reads as it did', () => {
    const engine = resolveAiEngine(both, env);
    for (const task of AI_TASKS.filter((t) => t !== 'verify')) assert.deepEqual(engine.chainFor(task), ['local_api', 'claude_code']);
    assert.deepEqual(engine.chainFor(null), ['local_api', 'claude_code']);
    // The web check was never the local engine's to take: it goes where it went before, to the engine that can search.
    assert.deepEqual(engine.chainFor('verify'), ['claude_code']);
    assert.equal(engine.takes('local_api', 'verify'), false);
  });

  it('the web check unticked on the one engine that can search is unclaimed, not the local model\'s alone', () => {
    const engine = resolveAiEngine({ ...both, tasks: { claude_code: ['scoring', 'analysis'] } }, env);
    const verify = taskPlans(engine).find((p) => p.task === 'verify');
    assert.deepEqual(engine.chainFor('verify'), ['local_api', 'claude_code']);
    assert.deepEqual(verify?.engines, ['claude_code']);
    assert.equal(verify?.unclaimed, true);
  });

  it('an install with no engine that can search has nobody to tick the web check on, and is not told to', () => {
    const engine = resolveAiEngine({ order: ['local_api'], models: {} }, env);
    const verify = taskPlans(engine).find((p) => p.task === 'verify');
    assert.deepEqual(verify?.engines, ['local_api']);
    assert.equal(verify?.unclaimed, false);
  });

  it('a narrowed engine is asked for its tasks only, and stays out of the fallback for the rest', () => {
    const engine = resolveAiEngine({ ...both, tasks: { local_api: ['scoring'] } }, env);
    assert.deepEqual(engine.chainFor('scoring'), ['local_api', 'claude_code']);
    assert.deepEqual(engine.chainFor('letters'), ['claude_code']);
    assert.equal(engine.takes('local_api', 'letters'), false);
    assert.equal(engine.takes('claude_code', 'letters'), true);
  });

  it('a task nobody usable takes is answered by the whole chain, and the plan says so', () => {
    const engine = resolveAiEngine({ ...both, tasks: { local_api: ['scoring'], claude_code: ['analysis'] } }, env);
    assert.deepEqual(engine.chainFor('letters'), ['local_api', 'claude_code']);
    const plans = taskPlans(engine);
    assert.equal(plans.find((p) => p.task === 'letters')?.unclaimed, true);
    assert.equal(plans.find((p) => p.task === 'scoring')?.unclaimed, false);
    // The one taker cannot run here (no key): its task is as unclaimed as if nobody had ticked it.
    const keyless = resolveAiEngine({ order: ['anthropic_api', 'claude_code'], models: {}, tasks: { claude_code: ['scoring'] } }, env);
    assert.deepEqual(keyless.chainFor('letters'), ['claude_code']);
    assert.equal(taskPlans(keyless).find((p) => p.task === 'letters')?.unclaimed, true);
  });

  it('the plan sends the web check to an engine that can search, whoever stands first', () => {
    const verify = taskPlans(resolveAiEngine(both, env)).find((p) => p.task === 'verify');
    assert.deepEqual(verify?.engines, ['claude_code']);
  });

  it('never offers the web check to an engine that cannot search', () => {
    assert.ok(!offeredTasks('local_api').includes('verify'));
    assert.deepEqual(offeredTasks('claude_code'), [...AI_TASKS]);
  });

  it('stores a full set of boxes as no list, and a narrower one as picked', () => {
    const config = parseAiEngineConfig(both);
    assert.deepEqual(withEngineTasks(config, 'local_api', ['scoring', 'verify']).tasks, { local_api: ['scoring'] });
    const narrowed = withEngineTasks(config, 'claude_code', ['letters']);
    assert.deepEqual(narrowed.tasks, { claude_code: ['letters'] });
    assert.deepEqual(withEngineTasks(narrowed, 'claude_code', [...AI_TASKS]).tasks, {});
    assert.deepEqual(withEngineTasks(config, 'local_api', offeredTasks('local_api')).tasks, {});
    assert.deepEqual(withEngineTasks(config, 'local_api', []).tasks, { local_api: [] });
  });

  it('reads a stored list tolerantly: unknown engines and tasks dropped, in the tasks\' own order', () => {
    const out = parseAiEngineConfig({ order: ['claude_code'], tasks: { claude_code: ['letters', 'nope', 'scoring'], openai: ['scoring'], gemini_cli: 'all' } });
    assert.deepEqual(out, { order: ['claude_code'], models: {}, tasks: { claude_code: ['scoring', 'letters'] } });
    assert.deepEqual(parseAiEngineConfig({ order: ['claude_code'], tasks: 'everything' }), { order: ['claude_code'], models: {}, tasks: {} });
  });

  it('"Use it" gives a local model scoring alone, whatever its list was, and leaves the other lists as they were', () => {
    const stored = parseAiEngineConfig({ order: ['claude_code', 'local_api'], tasks: { local_api: ['letters', 'analysis'], claude_code: ['letters'] } });
    assert.deepEqual(withEngineFirst(stored, 'local_api', env, 'gemma4:e4b').tasks, { local_api: ['scoring'], claude_code: ['letters'] });
    assert.deepEqual(withEngineFirst(parseAiEngineConfig(both), 'local_api', env, 'gemma4:e4b').tasks, { local_api: ['scoring'] });
  });

  it('after "Use it" the engine behind takes every other task, and a local model alone still answers them all', () => {
    const behind = resolveAiEngine(withEngineFirst(parseAiEngineConfig({ order: ['claude_code'] }), 'local_api', env, 'gemma4:e4b'), env);
    assert.deepEqual(behind.chainFor('scoring'), ['local_api', 'claude_code']);
    for (const task of AI_TASKS.filter((t) => t !== 'scoring')) assert.deepEqual(behind.chainFor(task), ['claude_code']);
    // Nothing else in the list: nobody takes the other tasks, so the whole chain — the local model — answers them as before.
    const alone = resolveAiEngine(withEngineFirst(parseAiEngineConfig({ order: [] }), 'local_api', { ...env, provider: 'local_api' }, 'gemma4:e4b'), env);
    assert.deepEqual(alone.order, ['local_api']);
    for (const task of AI_TASKS) assert.deepEqual(alone.chainFor(task), ['local_api']);
    // The same when the engines behind it cannot run here (no key).
    const keyless = resolveAiEngine(withEngineFirst(parseAiEngineConfig({ order: ['anthropic_api'] }), 'local_api', env, 'gemma4:e4b'), env);
    assert.deepEqual(keyless.chainFor('letters'), ['local_api']);
  });

  it('says whether the engine "Use it" put first answers every task (#527)', () => {
    const behind = resolveAiEngine(withEngineFirst(parseAiEngineConfig({ order: ['claude_code'] }), 'local_api', env, 'gemma4:e4b'), env);
    assert.equal(firstForEveryTask(behind, 'local_api'), false);
    const keyless = resolveAiEngine(withEngineFirst(parseAiEngineConfig({ order: ['anthropic_api'] }), 'local_api', env, 'gemma4:e4b'), env);
    assert.equal(firstForEveryTask(keyless, 'local_api'), true);
    assert.equal(firstForEveryTask(keyless, 'anthropic_api'), false);
  });
});

describe('missingCredentials', () => {
  it('names what an engine that cannot run is missing, as its card does (#563)', () => {
    assert.equal(missingCredentials('gemini_cli'), 'Gemini CLI has no credentials yet — paste an API key, or log in once with `gemini`.');
    assert.equal(missingCredentials('codex_cli'), 'Codex CLI has no credentials yet — run `codex login` once.');
    assert.equal(missingCredentials('anthropic_api'), 'Anthropic API has no credentials yet — paste a key, or set it in .env.');
  });
});

describe("setup's Continue", () => {
  // A fresh install: the .env default is the API with no key, and the Claude CLI answered on this machine.
  const fresh: AiEngineEnv = { ...ENV, provider: 'anthropic_api' };
  const none = { order: [], models: {}, tasks: {} };

  it('makes the engine found here the chosen one when nothing in the list can run', () => {
    assert.deepEqual(adoptFoundEngine(none, fresh, ['claude_code']), { ...none, order: ['claude_code'] });
    assert.deepEqual(adoptFoundEngine({ order: ['anthropic_api'], models: {}, tasks: {} }, fresh, ['claude_code'])?.order, ['claude_code']);
  });

  it('leaves a list that runs, and adopts nothing that cannot run or was not found', () => {
    assert.equal(adoptFoundEngine(none, { ...fresh, hasAnthropicKey: true }, ['claude_code']), null);
    assert.equal(adoptFoundEngine({ order: ['gemini_cli'], models: {}, tasks: {} }, fresh, ['claude_code']), null);
    assert.equal(adoptFoundEngine(none, fresh, []), null);
    assert.equal(adoptFoundEngine(none, fresh, ['codex_cli']), null);
  });
});
