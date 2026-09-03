import { getAiProviderById } from '../ai-provider';
import {
  AI_PROVIDER_LABELS,
  providerUnusable,
  resolveAiEngine,
  type AiProviderId,
} from '../ai-engine';
import { resolveAiKey } from '../ai-keys';
import { getAiEngineEnv } from '../ai-runtime';
import { getAiKeys, getSettings } from '../settings';

const ENGINE_TEST_TIMEOUT_MS = 90_000;

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
      text: `${label} test failed: ${err instanceof Error ? err.message : 'not configured'}.`,
    };
  }
  const [settings, keys] = await Promise.all([getSettings(), getAiKeys()]);
  const env = getAiEngineEnv(keys);
  if (providerUnusable(provider, env)) {
    return { ok: false, text: `${label} has no credentials yet — paste a key, or set it in .env.` };
  }
  const engine = resolveAiEngine(settings.aiEngine, env);
  const model = engine.modelFor(provider, 'classifier');
  const started = Date.now();
  const text = await backend.complete({
    system: 'You are a connectivity test. Reply with exactly: OK',
    user: 'Reply with exactly: OK',
    maxTokens: 20,
    label: 'engine-test',
    model,
    timeoutMs: ENGINE_TEST_TIMEOUT_MS,
    apiKey: resolveAiKey(provider, keys),
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (text !== null) {
    return { ok: true, text: `${label} works — replied in ${seconds}s (model ${model || 'CLI default'}).` };
  }
  return {
    ok: false,
    text: `${label} test failed after ${seconds}s — see the web container logs for the reason.`,
  };
}
