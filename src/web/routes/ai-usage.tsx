/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { AI_PROVIDER_IDS, resolveAiEngine, type AiProviderId } from '../../ai-engine';
import { engineTroubles } from '../../ai-health';
import { billedThisMonth, loadPackSpend, loadRecentAttempts, loadSpendGroups } from '../../ai-ledger';
import { billingFacts, getAiEngineEnv, probeAiProviders } from '../../ai-runtime';
import { isSpendPeriod, packSpendText, periodRange, spendView, usageByModel, type SpendPeriod } from '../../ai-spend';
import { AI_TASKS } from '../../ai-tasks';
import { billingOf } from '../../ai-usage';
import type { MessageKey } from '../../i18n/catalog';
import { t } from '../../i18n/t';
import { getAiKeys, getSettings } from '../../settings';
import { aiPlanRows } from '../ai-plan';
import { currentTrials } from '../engine-trial-run';
import { clearFlashCookie, parseFlashCookie } from '../flash';
import { AiUsagePage } from '../pages/ai-usage';
import { usageHints } from '../usage-hints';

export const aiUsageRoute = new Hono();

/** The period as it reads inside a hint's sentence: "in the last 7 days", "this month". */
const PERIOD_WORDS = {
  '7d': 'usage.period.7d',
  month: 'usage.period.month',
  'last-month': 'usage.period.lastMonth',
  year: 'usage.period.year',
} as const satisfies Record<SpendPeriod, MessageKey>;

aiUsageRoute.get('/ai', async (c) => {
  const asked = c.req.query('period');
  const period: SpendPeriod = isSpendPeriod(asked) ? asked : '7d';
  const now = new Date();
  const range = periodRange(period, now);
  // The keys are read once and lent to the probe — both need them (ADR 0027).
  const keys = await getAiKeys();
  const [settings, statuses, groups, billedMonth, recent, packs] = await Promise.all([
    getSettings(),
    probeAiProviders(keys),
    loadSpendGroups(range.from, range.to),
    billedThisMonth(now),
    loadRecentAttempts(now),
    loadPackSpend(range.from, range.to),
  ]);
  const billing = billingFacts(keys, settings.openAiBaseUrl);
  const billingFor = (id: AiProviderId) => billingOf(id, billing);
  const engine = resolveAiEngine(settings.aiEngine, getAiEngineEnv(keys, settings.openAiBaseUrl));
  const plan = aiPlanRows(engine, billingFor, settings.employerMode);
  const view = spendView(groups);
  const trials = await currentTrials((id) => engine.modelFor(id, 'classifier'));
  return c.html(
    <AiUsagePage
      period={period}
      view={view}
      packs={packSpendText(packs)}
      models={usageByModel(view.rows)}
      hints={usageHints({
        groups,
        troubles: engineTroubles(recent),
        period: t(PERIOD_WORDS[period]),
        engines: AI_PROVIDER_IDS.map((id) => ({
          id,
          billing: billingFor(id),
          ready: statuses[id].ok,
          position: engine.order.indexOf(id),
          takes: AI_TASKS.filter((task) => engine.takes(id, task)),
        })),
        first: Object.fromEntries(plan.map((p) => [p.task, p.engines[0]?.id])),
        trials,
        budgetCents: settings.aiBudgetCents,
        billedMonthMicro: billedMonth,
        now,
      })}
      plan={plan}
      budget={{ cents: settings.aiBudgetCents, billedThisMonthMicro: billedMonth }}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});
