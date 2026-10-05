import { AI_PROVIDER_LABELS, PROVIDER_MODEL_OPTIONS, isAiProviderId, offeredTasks, type AiProviderId } from '../ai-engine';
import { PRICES_AS_OF, priceOf } from '../ai-prices';
import { formatUsd, type SpendGroup } from '../ai-spend';
import { AI_TASK_LABELS, taskOf, type AiTask } from '../ai-tasks';
import { featureName, type AiBilling, type AiFeature } from '../ai-usage';

/*
 * What the ledger suggests changing (the AI usage page). Pure, and every
 * sentence is arithmetic on recorded calls, the engines this install has and
 * the published prices: where the money went, what failed, what stands idle.
 * None of it says a model is good enough for a task — that was never
 * measured, and a hint that guessed it would be the one people act on.
 */

export interface UsageHint {
  tone: 'warn' | 'neutral' | 'ok';
  text: string;
  /** Where the hint is acted on, and what the link says. */
  action?: { href: string; label: string };
}

export interface HintFacts {
  groups: readonly SpendGroup[];
  /** The period as it reads inside a sentence: "in the last 7 days", "this month". */
  period: string;
  /** Every engine this install knows: whose money it spends, whether it can run here now, whether it is in the list. */
  engines: readonly { id: AiProviderId; billing: AiBilling; ready: boolean; enabled: boolean }[];
  /** The engine that answers each task first today (ai-engine.ts:taskPlans). */
  first: Partial<Record<AiTask, AiProviderId>>;
  /** The monthly ceiling on billed money, what the month has billed so far, and today. */
  budgetCents: number | null;
  billedMonthMicro: number;
  now: Date;
}

const ENGINES = { href: '/settings?tab=ai', label: 'AI engines' };
const BUDGET = { href: '/settings?tab=ai#budget', label: 'Set a budget' };

/** A failure rate is a pattern from this many calls up; under it, it is an anecdote. */
const MIN_CALLS = 5;
const FAILED_SHARE = 0.2;
/** A task is "the volume" when it is most of the calls and there are enough of them to matter. */
const VOLUME_SHARE = 0.6;
const VOLUME_CALLS = 100;
/** A month's pace is read from its third day: one busy first day is not a pace. */
const PACE_FROM_DAY = 3;
/** A cheaper model is worth a sentence when the scoring model costs at least this many times more. */
const PRICE_RATIO = 2;
const PRICED_CALLS = 50;
/**
 * The one task a hint offers to a model on this computer: the hourly volume,
 * in short replies. A hint never hands a small model the analysis or a letter.
 */
const LOCAL_TASK: AiTask = 'scoring';

const label = (id: string): string => (isAiProviderId(id) ? AI_PROVIDER_LABELS[id] : id);
const percent = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const calls = (n: number): string => `${n.toLocaleString('en-US')} call${n === 1 ? '' : 's'}`;
const taskOfGroup = (g: SpendGroup): AiTask | null => taskOf(g.feature as AiFeature) ?? null;

export function usageHints(facts: HintFacts): UsageHint[] {
  const groups = facts.groups.filter((g) => g.feature !== 'engine-test');
  if (groups.length === 0) return [];
  const hints = [budgetPace(facts, groups), billedTask(facts, groups), billedFallback(facts, groups), failures(facts, groups), priceyScoring(facts, groups), volumeOnPlan(facts, groups)].filter(
    (h): h is UsageHint => h !== null,
  );
  if (hints.length === 0 && !groups.some((g) => g.billing === 'billed' && g.micro > 0)) {
    hints.push({ tone: 'ok', text: `Nothing was billed ${facts.period}: every call ran on a plan or on this computer.` });
  }
  const rank = { warn: 0, neutral: 1, ok: 2 };
  return hints.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/** An engine that costs nothing more for a task and can run here now: a plan before a local model, one in the list before one outside it. */
function freeEngineFor(facts: HintFacts, task: AiTask, wanted: readonly AiBilling[]) {
  const kinds = wanted.filter((kind) => kind !== 'local' || task === LOCAL_TASK);
  return [...facts.engines]
    .filter((e) => kinds.includes(e.billing) && e.ready && offeredTasks(e.id).includes(task))
    .sort((a, b) => kinds.indexOf(a.billing) - kinds.indexOf(b.billing) || Number(b.enabled) - Number(a.enabled))[0];
}

function billingNow(facts: HintFacts, task: AiTask): AiBilling | null {
  const first = facts.first[task];
  return facts.engines.find((e) => e.id === first)?.billing ?? null;
}

/** The month's billed money against the budget, at the pace it has kept so far. */
function budgetPace(facts: HintFacts, groups: readonly SpendGroup[]): UsageHint | null {
  const billedInPeriod = groups.filter((g) => g.billing === 'billed').reduce((n, g) => n + g.micro, 0);
  if (!facts.budgetCents) {
    return billedInPeriod > 0
      ? { tone: 'neutral', text: 'No monthly budget is set for billed calls. With one, your alert chats hear at 80 % and at 100 % of it.', action: BUDGET }
      : null;
  }
  const budget = facts.budgetCents * 10_000;
  const day = facts.now.getUTCDate();
  if (facts.billedMonthMicro >= budget || day < PACE_FROM_DAY) return null;
  const days = new Date(Date.UTC(facts.now.getUTCFullYear(), facts.now.getUTCMonth() + 1, 0)).getUTCDate();
  const pace = Math.round((facts.billedMonthMicro / day) * days);
  if (pace <= budget) return null;
  return {
    tone: 'warn',
    text: `At the pace of its first ${day} days, this month's billed calls reach about ${formatUsd(pace)}, over your ${formatUsd(budget)} budget.`,
  };
}

/** The task most of the bill went to, when an engine that would not bill it stands ready. */
function billedTask(facts: HintFacts, groups: readonly SpendGroup[]): UsageHint | null {
  const billed = groups.filter((g) => g.billing === 'billed' && g.micro > 0);
  const total = billed.reduce((n, g) => n + g.micro, 0);
  const byTask = new Map<AiTask, { micro: number; top: SpendGroup }>();
  for (const g of billed) {
    const task = taskOfGroup(g);
    if (!task) continue;
    const t = byTask.get(task) ?? { micro: 0, top: g };
    t.micro += g.micro;
    if (g.micro > t.top.micro) t.top = g;
    byTask.set(task, t);
  }
  const [task, spent] = [...byTask.entries()].sort((a, b) => b[1].micro - a[1].micro)[0] ?? [];
  // Already answered by a plan or a local model: the bill is the period's history, not what happens next.
  if (!task || !spent || billingNow(facts, task) !== 'billed') return null;
  const free = freeEngineFor(facts, task, ['plan', 'local']);
  if (!free) return null;
  const name = AI_TASK_LABELS[task];
  const share = spent.micro === total ? `${formatUsd(spent.micro)} billed` : `${formatUsd(spent.micro)} of the ${formatUsd(total)} billed (${percent(spent.micro, total)} %)`;
  const step = `${free.enabled ? 'Put it' : 'Enable it and put it'} above ${label(spent.top.engine)}`;
  return {
    tone: 'warn',
    text:
      free.billing === 'plan'
        ? `${name} was ${share} ${facts.period}. ${label(free.id)} is set up here and your plan covers it. ${step}: it answers first, and ${label(spent.top.engine)} stays as its fallback.`
        : `${name} was ${share} ${facts.period}. ${label(free.id)} runs on this computer for free. ${step} with only ${name} ticked. How well a small model does this task is not measured here: compare a day of results before you rely on it.`,
    action: ENGINES,
  };
}

/** Calls a billed engine answered because the one ahead of it did not. */
function billedFallback(facts: HintFacts, groups: readonly SpendGroup[]): UsageHint | null {
  const fell = groups.filter((g) => g.billing === 'billed' && g.viaFallback > 0 && g.fallbackMicro > 0);
  if (fell.length === 0) return null;
  const count = fell.reduce((n, g) => n + g.viaFallback, 0);
  const micro = fell.reduce((n, g) => n + g.fallbackMicro, 0);
  const engines = [...new Set(fell.map((g) => label(g.engine)))].join(' and ');
  return {
    tone: 'warn',
    text: `${calls(count)} fell over to ${engines} ${facts.period} and ${count === 1 ? 'was' : 'were'} billed per token: ${formatUsd(micro)}. The engine ahead failed or ran out of its allowance.`,
    action: ENGINES,
  };
}

/** The feature on a model that fails most, once it is a pattern. */
function failures(facts: HintFacts, groups: readonly SpendGroup[]): UsageHint | null {
  const worst = groups
    .filter((g) => g.calls >= MIN_CALLS && g.failed / g.calls >= FAILED_SHARE)
    .sort((a, b) => b.failed - a.failed)[0];
  if (!worst) return null;
  const limited = worst.rateLimited * 2 >= worst.failed;
  const task = taskOfGroup(worst);
  const local = task ? freeEngineFor(facts, task, ['local']) : undefined;
  const advice = !limited
    ? 'Try another model in that slot, or press Test on the engine.'
    : local && task && facts.first[task] !== local.id
      ? `${label(local.id)} runs on this computer and has no limit to hit: it can take ${AI_TASK_LABELS[task]} off this engine.`
      : 'Put a second engine behind it for this task, or lower AI_CONCURRENCY.';
  return {
    tone: 'warn',
    text: `${featureName(worst.feature)} on ${label(worst.engine)} · ${worst.model || 'CLI default'}: ${worst.failed} of ${calls(worst.calls)} did not answer ${facts.period}${
      worst.rateLimited > 0 ? ` (${worst.rateLimited} hit a rate limit)` : ''
    }. Each is retried or handed to the next engine, which costs time${worst.billing === 'billed' ? ' and money' : ''}. ${advice}`,
    action: ENGINES,
  };
}

/** Scoring billed on a model several times the price of the cheapest one its engine offers. */
function priceyScoring(facts: HintFacts, groups: readonly SpendGroup[]): UsageHint | null {
  const scoring = groups
    .filter((g) => g.billing === 'billed' && taskOfGroup(g) === 'scoring' && g.calls >= PRICED_CALLS && isAiProviderId(g.engine))
    .sort((a, b) => b.micro - a.micro)[0];
  const used = scoring && priceOf(scoring.model);
  if (!scoring || !used) return null;
  const cheapest = PROVIDER_MODEL_OPTIONS[scoring.engine as AiProviderId]
    .map((model) => ({ model, price: priceOf(model) }))
    .filter((m): m is { model: string; price: NonNullable<ReturnType<typeof priceOf>> } => m.price !== null)
    .sort((a, b) => a.price.input - b.price.input)[0];
  if (!cheapest || used.input < cheapest.price.input * PRICE_RATIO) return null;
  return {
    tone: 'neutral',
    text: `Scoring ran on ${scoring.model}: ${calls(scoring.calls)} ${facts.period}. ${cheapest.model} costs about ${Math.round(used.input / cheapest.price.input)} times less per token (prices of ${PRICES_AS_OF}), and scoring is the task a cheap model is meant for. It is the Classifier model on the engine's card.`,
    action: ENGINES,
  };
}

/** Most of the calls are one task on a plan, and a model on this computer stands idle. */
function volumeOnPlan(facts: HintFacts, groups: readonly SpendGroup[]): UsageHint | null {
  const total = groups.reduce((n, g) => n + g.calls, 0);
  const byTask = new Map<AiTask, { calls: number; plan: number; engine: string }>();
  for (const g of groups) {
    const task = taskOfGroup(g);
    if (!task) continue;
    const t = byTask.get(task) ?? { calls: 0, plan: 0, engine: g.engine };
    t.calls += g.calls;
    if (g.billing === 'plan') t.plan += g.calls;
    byTask.set(task, t);
  }
  const [task, volume] = [...byTask.entries()].sort((a, b) => b[1].calls - a[1].calls)[0] ?? [];
  if (!task || !volume || volume.calls < VOLUME_CALLS || volume.calls < total * VOLUME_SHARE || volume.plan < volume.calls) return null;
  const local = freeEngineFor(facts, task, ['local']);
  if (!local || billingNow(facts, task) !== 'plan') return null;
  const name = AI_TASK_LABELS[task];
  return {
    tone: 'neutral',
    text: `${name} is ${volume.calls.toLocaleString('en-US')} of ${calls(total)} ${facts.period} (${percent(volume.calls, total)} %), all on ${label(volume.engine)}. Your plan covers them, so there is no bill to cut. They do use the plan's allowance: ${label(local.id)} runs on this computer and can take this task if you want to keep the allowance for the analysis and the letters. How well a small model does it is not measured here.`,
    action: ENGINES,
  };
}
