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
  /**
   * Every engine this install knows: whose money it spends, whether it can
   * run here now, where it stands in the list (-1 = not in it) and the tasks
   * its card has ticked.
   */
  engines: readonly { id: AiProviderId; billing: AiBilling; ready: boolean; position: number; takes: readonly AiTask[] }[];
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
/** Applicants' resumes are never steered onto a personal plan: employer mode warns against exactly that. */
const NO_PLAN_TASK: AiTask = 'screening';
const UNMEASURED = 'How well a small model does this task is not measured here';

const label = (id: string): string => (isAiProviderId(id) ? AI_PROVIDER_LABELS[id] : id);
const percent = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const calls = (n: number): string => `${n.toLocaleString('en-US')} call${n === 1 ? '' : 's'}`;
const taskOfGroup = (g: SpendGroup): AiTask | null => taskOf(g.feature as AiFeature) ?? null;
const sentence = (steps: readonly string[]): string => {
  const joined = steps.length <= 2 ? steps.join(' and ') : `${steps.slice(0, -1).join(', ')} and ${steps.at(-1)}`;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
};

export function usageHints(facts: HintFacts): UsageHint[] {
  const groups = facts.groups.filter((g) => g.feature !== 'engine-test');
  if (groups.length === 0) return [];
  const hints = [budgetPace(facts, groups), billedTask(facts, groups), billedFallback(facts, groups), failures(facts, groups), priceyScoring(facts, groups), volumeOnPlan(facts, groups)].filter(
    (h): h is UsageHint => h !== null,
  );
  // Any call on a billed engine — an engine test, one the table cannot price — and "nothing was billed" is not ours to say.
  if (hints.length === 0 && !facts.groups.some((g) => g.billing === 'billed')) {
    hints.push({ tone: 'ok', text: `Nothing was billed ${facts.period}: every call ran on a plan or on this computer.` });
  }
  const rank = { warn: 0, neutral: 1, ok: 2 };
  return hints.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

type Engine = HintFacts['engines'][number];

/** An engine that costs nothing more for a task and can run here now: a plan before a local model, one in the list before one outside it. */
function freeEngineFor(facts: HintFacts, task: AiTask, wanted: readonly AiBilling[]): Engine | undefined {
  const kinds = wanted.filter((kind) => (kind !== 'local' || task === LOCAL_TASK) && (kind !== 'plan' || task !== NO_PLAN_TASK));
  return [...facts.engines]
    .filter((e) => kinds.includes(e.billing) && e.ready && offeredTasks(e.id).includes(task))
    .sort((a, b) => kinds.indexOf(a.billing) - kinds.indexOf(b.billing) || Number(b.position !== -1) - Number(a.position !== -1))[0];
}

const engineOf = (facts: HintFacts, id: AiProviderId | undefined): Engine | undefined => facts.engines.find((e) => e.id === id);

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

/**
 * The task most of the bill went to, when an engine that would not bill it
 * stands ready — with the steps that make it answer first from where it
 * stands today: enabled or not, the task ticked or not, above or below.
 */
function billedTask(facts: HintFacts, groups: readonly SpendGroup[]): UsageHint | null {
  const billed = groups.filter((g) => g.billing === 'billed' && g.micro > 0);
  const total = billed.reduce((n, g) => n + g.micro, 0);
  const byTask = new Map<AiTask, number>();
  for (const g of billed) {
    const task = taskOfGroup(g);
    if (task) byTask.set(task, (byTask.get(task) ?? 0) + g.micro);
  }
  const [task, spent] = [...byTask.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  const first = task && engineOf(facts, facts.first[task]);
  // Already answered by a plan or a local model: the bill is the period's history, not what happens next.
  if (!task || !spent || !first || first.billing !== 'billed') return null;
  const free = freeEngineFor(facts, task, ['plan', 'local']);
  if (!free) return null;
  const name = AI_TASK_LABELS[task];
  const steps = [
    ...(free.position === -1 ? ['enable it'] : []),
    ...(free.billing === 'local' ? [`leave only ${name} ticked on its card`] : free.takes.includes(task) ? [] : [`tick ${name} on its card`]),
    // The engine that bills today may answer as a last resort from outside the list: anything in the list is ahead of it.
    ...(free.position === -1 || (first.position !== -1 && free.position > first.position) ? [`put it above ${label(first.id)}`] : []),
  ];
  if (steps.length === 0) return null;
  const share = spent === total ? `${formatUsd(spent)} billed` : `${formatUsd(spent)} of the ${formatUsd(total)} billed (${percent(spent, total)} %)`;
  const then = `${sentence(steps)}: it then answers first, with ${label(first.id)} as its fallback.`;
  return {
    tone: 'warn',
    text:
      free.billing === 'plan'
        ? `${name} was ${share} ${facts.period}. ${label(free.id)} is set up here and your plan covers it. ${then}`
        : `${name} was ${share} ${facts.period}. ${label(free.id)} runs on this computer for free. ${then} ${UNMEASURED}: compare a day of results before you rely on it.`,
    action: ENGINES,
  };
}

/**
 * Attempts a billed engine made because the one ahead of it did not answer.
 * The web check is left out: before v2.44.0 the ledger called it a fallback
 * whenever the first engine could not search, which is nobody failing.
 */
function billedFallback(facts: HintFacts, groups: readonly SpendGroup[]): UsageHint | null {
  const fell = groups.filter((g) => g.billing === 'billed' && g.feature !== 'job-verify' && g.viaFallback > 0 && g.fallbackMicro > 0);
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

/**
 * The feature on an engine that fails most, once it is a pattern. Counted per
 * engine, not per model: a call that failed with no reply has no resolved
 * model, and would sit apart from the successes it belongs with.
 */
function failures(facts: HintFacts, groups: readonly SpendGroup[]): UsageHint | null {
  const pairs = new Map<string, { feature: string; engine: string; billing: AiBilling; calls: number; failed: number; rateLimited: number; answered: Set<string>; asked: Set<string> }>();
  for (const g of groups) {
    const key = `${g.feature}\n${g.engine}\n${g.billing}`;
    const p = pairs.get(key) ?? { feature: g.feature, engine: g.engine, billing: g.billing, calls: 0, failed: 0, rateLimited: 0, answered: new Set<string>(), asked: new Set<string>() };
    p.calls += g.calls;
    p.failed += g.failed;
    p.rateLimited += g.rateLimited;
    p.asked.add(g.model);
    if (g.calls > g.failed) p.answered.add(g.model);
    pairs.set(key, p);
  }
  const worst = [...pairs.values()].filter((p) => p.calls >= MIN_CALLS && p.failed / p.calls >= FAILED_SHARE).sort((a, b) => b.failed - a.failed)[0];
  if (!worst) return null;
  // One model is named; several, and the engine alone is the subject.
  const models = worst.answered.size > 0 ? worst.answered : worst.asked;
  const model = models.size === 1 ? ` · ${[...models][0] || 'CLI default'}` : '';
  const limited = worst.rateLimited * 2 >= worst.failed;
  const task = taskOf(worst.feature as AiFeature) ?? null;
  const local = task ? freeEngineFor(facts, task, ['local']) : undefined;
  const advice = !limited
    ? 'Try another model in that slot, or press Test on the engine.'
    : local && task && facts.first[task] !== local.id
      ? `${label(local.id)} runs on this computer and has no limit to hit; giving it ${AI_TASK_LABELS[task]} would take the volume off this engine. ${UNMEASURED}.`
      : 'Put a second engine behind it for this task, or lower AI_CONCURRENCY.';
  return {
    tone: 'warn',
    text: `${featureName(worst.feature)} on ${label(worst.engine)}${model}: ${worst.failed} of ${calls(worst.calls)} did not answer ${facts.period}${
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
    text: `Scoring ran on ${scoring.model}: ${calls(scoring.calls)} ${facts.period}. ${cheapest.model} costs about ${Math.round(used.input / cheapest.price.input)} times less per token (prices of ${PRICES_AS_OF}). The model is picked in the Classifier slot on the engine's card.`,
    action: ENGINES,
  };
}

/** Most of the calls are scoring on a plan, and a model on this computer stands idle. */
function volumeOnPlan(facts: HintFacts, groups: readonly SpendGroup[]): UsageHint | null {
  const total = groups.reduce((n, g) => n + g.calls, 0);
  const volume = groups.filter((g) => taskOfGroup(g) === LOCAL_TASK);
  const count = volume.reduce((n, g) => n + g.calls, 0);
  if (count < VOLUME_CALLS || count < total * VOLUME_SHARE || volume.some((g) => g.billing !== 'plan')) return null;
  const local = freeEngineFor(facts, LOCAL_TASK, ['local']);
  if (!local || engineOf(facts, facts.first[LOCAL_TASK])?.billing !== 'plan') return null;
  const engines = [...new Set(volume.map((g) => label(g.engine)))];
  const name = AI_TASK_LABELS[LOCAL_TASK];
  return {
    tone: 'neutral',
    text: `${name} is ${count.toLocaleString('en-US')} of ${calls(total)} ${facts.period} (${percent(count, total)} %), all on ${engines.join(' and ')}. A plan covers them, so there is no bill to cut. They do use the plan's allowance: ${label(local.id)} runs on this computer and can be given this task if you want to keep that allowance for the analysis and the letters. ${UNMEASURED}.`,
    action: ENGINES,
  };
}
