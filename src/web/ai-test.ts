import { getAiProviderById } from '../ai-provider';
import {
  AI_PROVIDER_LABELS,
  providerUnusable,
  resolveAiEngine,
  type AiProviderId,
} from '../ai-engine';
import { resolveAiKey } from '../ai-keys';
import { billingFacts, getAiEngineEnv, localAiBase, openAiBase } from '../ai-runtime';
import { DEFAULT_LOCAL_CONTEXT_TOKENS } from '../ai-provider-parse';
import { listOllamaModels, listServerModels, listsModel, preferredModel } from '../server-models';
import { recordAiCall } from '../ai-ledger';
import { billingOf } from '../ai-usage';
import { getAiKeys, getSettings } from '../settings';
import { formatNumber } from '../i18n/format';
import { t } from '../i18n/t';

const ENGINE_TEST_TIMEOUT_MS = 90_000;
/** How many of the server's models the sentence names before it trails off. */
const OFFERED_SHOWN = 5;
/** Seconds as `toFixed(1)` writes them, with the reader's decimal mark: "1.5" in English, "1,5" in Ukrainian. */
const SECONDS_FORMAT = { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false } as const;

export interface EngineTestResult {
  ok: boolean;
  text: string;
}

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
    return { ok: false, text: t('aiTest.noCredentials', { engine: label }) };
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
      // No slot filled and nothing in .env: the provider would ask for a model no local server has.
      const first = preferredModel(offered);
      if (first !== null && model.trim() === '') {
        model = first;
        pickedForTest = true;
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
  // A test is a real call on the user's money: it goes in the ledger like any other (ADR 0055).
  await recordAiCall({
    at: new Date(started),
    durationMs: Date.now() - started,
    engine: provider,
    model,
    feature: 'engine-test',
    outcome: attempt.outcome,
    spend: attempt.spend,
    viaFallback: false,
    billing: billingOf(provider, billingFacts(keys, settings.openAiBaseUrl)),
  });
  const seconds = formatNumber(Number(((Date.now() - started) / 1000).toFixed(1)), SECONDS_FORMAT);
  const offer =
    offered === null
      ? ''
      : offered.length === 0
        ? t('aiTest.offersNone')
        : t('aiTest.offers', { n: offered.length, models: `${offered.slice(0, OFFERED_SHOWN).join(', ')}${offered.length > OFFERED_SHOWN ? ', …' : ''}` });
  if (attempt.text !== null) {
    const worked = model ? t('aiTest.works', { engine: label, seconds, model }) : t('aiTest.worksCliDefault', { engine: label, seconds });
    return { ok: true, text: sentences(worked, pickedForTest ? t('aiTest.pickedForTest') : '', offer) };
  }
  // A model the server never pulled is the likeliest cause on a local server; the list says so.
  const unlisted = offered !== null && offered.length > 0 && model !== '' && !listsModel(offered, model) ? t('aiTest.unlisted', { model }) : '';
  // Read through its declared type: the compiler does not follow the callback that sets it.
  const reason = failure as string | null;
  const failed = reason === null ? t('aiTest.failedNoReason', { engine: label, seconds }) : t('aiTest.failed', { engine: label, seconds, reason });
  return { ok: false, text: sentences(failed, unlisted, offer, unlistable) };
}

/** Whole sentences side by side; the ones that do not apply are empty. */
function sentences(...parts: string[]): string {
  return parts.filter((part) => part !== '').join(' ');
}
