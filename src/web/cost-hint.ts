import { billingFacts, getAiEngineEnv } from '../ai-runtime';
import { resolveAiEngine, type AiProviderId } from '../ai-engine';
import { typicalCost } from '../ai-ledger';
import { billingHint, costHintText, formatUsd } from '../ai-spend';
import { taskOf } from '../ai-tasks';
import { billingOf, type AiBilling, type AiFeature } from '../ai-usage';
import { t } from '../i18n/t';
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

/**
 * The line under an engine trial's button (#412): free on a local model; else
 * the middle of the recent scoring calls on that engine and model, times the
 * postings a press reads — or, with none on record, the kind of money alone.
 */
export async function trialCostHint(engine: AiProviderId, model: string, billing: AiBilling, postings: number): Promise<string> {
  if (billing === 'local') return t('cost.local');
  const on = { engine, model };
  const typical = (await typicalCost('classifier', on)) ?? (await typicalCost('engine-trial', on));
  if (!typical || typical.billing !== billing) return billingHint(billing);
  return t(billing === 'plan' ? 'trial.cost.plan' : 'trial.cost.billed', { money: formatUsd(typical.micro * postings), n: postings });
}
