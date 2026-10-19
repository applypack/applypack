import { getAiProviderById } from '../ai-provider';
import {
  AI_PROVIDER_LABELS,
  missingCredentials,
  providerUnusable,
  resolveAiEngine,
  type AiProviderId,
} from '../ai-engine';
import { resolveAiKey } from '../ai-keys';
import { billingFacts, getAiEngineEnv, localAiBase, openAiBase } from '../ai-runtime';
import { DEFAULT_LOCAL_CONTEXT_TOKENS } from '../ai-provider-parse';
import { listOllamaModels, listServerModels, preferredModel } from '../server-models';
import { recordAiCall } from '../ai-ledger';
import { billingOf } from '../ai-usage';
import { getAiKeys, getSettings } from '../settings';
import { t } from '../i18n/t';
import { testReport, type EngineTestResult } from './ai-test-report';

const ENGINE_TEST_TIMEOUT_MS = 90_000;

/** One tiny live call through `provider` — the Test button on /settings and the wizard's step 1. */
export async function testAiEngine(provider: AiProviderId): Promise<EngineTestResult> {
  const label = AI_PROVIDER_LABELS[provider];
  let backend;
  try {
    backend = getAiProviderById(provider);
  } catch (err) {
    return {
      ok: false,
      text: err instanceof Error ? t('aiTest.failedConfig', { engine: label, reason: err.message }) : t('aiTest.notConfigured', { engine: label }),
    };
  }
  const [settings, keys] = await Promise.all([getSettings(), getAiKeys()]);
  const env = getAiEngineEnv(keys, settings.openAiBaseUrl);
  if (providerUnusable(provider, env)) {
    return { ok: false, text: missingCredentials(provider) };
  }
  const engine = resolveAiEngine(settings.aiEngine, env);
  let model = engine.modelFor(provider, 'classifier');
  // TASKS S3: an OpenAI-compatible server says what it runs before anything is
  // asked of it — a wrong address or a model never pulled is named, not guessed.
  const base = provider === 'local_api' ? localAiBase(settings.localAiUrl) : openAiBase(settings.openAiBaseUrl);
  let offered: string[] | null = null;
  // Not every compatible server lists its models; the call below is still the test.
  let unlistable = '';
  let pickedForTest = false;
  if (provider === 'openai_api' || provider === 'local_api') {
    const listed = provider === 'local_api' ? await listOllamaModels(base) : await listServerModels(base, resolveAiKey(provider, keys));
    if ('reason' in listed) {
      unlistable = t('aiTest.modelsUnlistable', { reason: listed.reason });
    } else {
      offered = listed.models;
      if (provider === 'openai_api') {
        // The list just taken is the one every call reads: an empty slot asks for the model a call would (#606).
        model = resolveAiEngine(settings.aiEngine, getAiEngineEnv(keys, settings.openAiBaseUrl)).modelFor(provider, 'classifier');
      } else {
        // The local engine with no model chosen runs nothing: the test borrows the first the server has.
        const first = preferredModel(offered);
        if (first !== null && model.trim() === '') {
          model = first;
          pickedForTest = true;
        }
      }
    }
  }
  const started = Date.now();
  // The reason a call failed is otherwise only in the logs: complete()
  // answers null so one bad job never stops a tick. A test button, though,
  // exists to name the cause — "credit balance too low" is not "see logs".
  let failure: string | null = null;
  const attempt = await backend.complete({
    system: 'You are a connectivity test. Reply with exactly: OK',
    user: 'Reply with exactly: OK',
    maxTokens: 20,
    label: 'engine-test',
    model,
    timeoutMs: ENGINE_TEST_TIMEOUT_MS,
    apiKey: resolveAiKey(provider, keys),
    ...((provider === 'openai_api' || provider === 'local_api') && { baseUrl: base }),
    ...(provider === 'local_api' && { contextTokens: settings.localContextTokens ?? DEFAULT_LOCAL_CONTEXT_TOKENS }),
    onError: (reason) => {
      failure = reason;
    },
  });
  const { durationMs, result } = testReport({ engine: label, model, attempt, elapsedMs: Date.now() - started, failure, offered, pickedForTest, unlistable });
  // A test is a real call on the user's money: it goes in the ledger like any other (ADR 0055).
  await recordAiCall({
    at: new Date(started),
    durationMs,
    engine: provider,
    model,
    feature: 'engine-test',
    outcome: attempt.outcome,
    spend: attempt.spend,
    viaFallback: false,
    billing: billingOf(provider, billingFacts(keys, settings.openAiBaseUrl)),
  });
  return result;
}
