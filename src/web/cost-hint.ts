import { billingFacts, getAiEngineEnv } from '../ai-runtime';
import { resolveAiEngine } from '../ai-engine';
import { typicalCost } from '../ai-ledger';
import { billingHint, costHintText } from '../ai-spend';
import { taskOf } from '../ai-tasks';
import { billingOf, type AiFeature } from '../ai-usage';
import { getAiKeys, getSettings } from '../settings';

/**
 * The sentence under a button that spends AI (ADR 0055): the middle of the
 * recent calls for this feature when there are any, else what kind of money
 * the engine that answers this task first spends. The wizard is where the second case
 * lives — a fresh install has nothing on record.
 */
export async function spendHint(feature: AiFeature): Promise<string> {
  const typical = costHintText(await typicalCost(feature));
  if (typical) return typical;
  const [settings, keys] = await Promise.all([getSettings(), getAiKeys()]);
  const first = resolveAiEngine(settings.aiEngine, getAiEngineEnv(keys, settings.openAiBaseUrl)).chainFor(taskOf(feature))[0];
  return first ? billingHint(billingOf(first, billingFacts(keys, settings.openAiBaseUrl))) : '';
}
