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
  return costHintText(await typicalCost(feature)) ?? kindHint(feature);
}

/**
 * What kind of money the engine that answers this feature's task first
 * spends, with no figure. For a button behind which several calls of
 * different kinds run — an application pack: its calls are filed under the
 * features it reuses, so there is no measured cost of one pack to quote.
 */
export async function kindHint(feature: AiFeature): Promise<string> {
  const [settings, keys] = await Promise.all([getSettings(), getAiKeys()]);
  const first = resolveAiEngine(settings.aiEngine, getAiEngineEnv(keys, settings.openAiBaseUrl)).chainFor(taskOf(feature))[0];
  return first ? billingHint(billingOf(first, billingFacts(keys, settings.openAiBaseUrl))) : '';
}
