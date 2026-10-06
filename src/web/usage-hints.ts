import { AI_PROVIDER_LABELS, PROVIDER_MODEL_OPTIONS, isAiProviderId, offeredTasks, type AiProviderId } from '../ai-engine';
import { PRICES_AS_OF, priceOf } from '../ai-prices';
import { featureLabel, formatUsd, joinNames, type SpendGroup } from '../ai-spend';
import { taskLabel, taskOf, type AiTask } from '../ai-tasks';
import type { AiBilling, AiFeature } from '../ai-usage';
import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';

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

const enginesLink = () => ({ href: '/settings?tab=ai', label: t('ai.aiEngines') });
const budgetLink = () => ({ href: '/settings?tab=ai#budget', label: t('ai.setABudget') });

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

/**
 * What makes the free engine answer first, one whole sentence per combination
 * of steps: the box on its card (tick it, leave only it ticked, or nothing to
 * do), then its place (enable it, which also means above; move it above; or
 * stay where it is).
 */
const STEPS: Record<'tick' | 'only' | 'none', Partial<Record<'enable' | 'above' | 'stay', MessageKey>>> = {
  tick: { enable: 'usage.steps.enableTickAbove', above: 'usage.steps.tickAbove', stay: 'usage.steps.tick' },
  only: { enable: 'usage.steps.enableOnlyAbove', above: 'usage.steps.onlyAbove', stay: 'usage.steps.only' },
  none: { enable: 'usage.steps.enableAbove', above: 'usage.steps.above' },
};

const label = (id: string): string => (isAiProviderId(id) ? AI_PROVIDER_LABELS[id] : id);
const percent = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const taskOfGroup = (g: SpendGroup): AiTask | null => taskOf(g.feature as AiFeature) ?? null;

export function usageHints(facts: HintFacts): UsageHint[] {
  const groups = facts.groups.filter((g) => g.feature !== 'engine-test');
  if (groups.length === 0) return [];
  const hints = [budgetPace(facts, groups), billedTask(facts, groups), billedFallback(facts, groups), failures(facts, groups), priceyScoring(facts, groups), volumeOnPlan(facts, groups)].filter(
    (h): h is UsageHint => h !== null,
  );
  // Any call on a billed engine — an engine test, one the table cannot price — and "nothing was billed" is not ours to say.
  if (hints.length === 0 && !facts.groups.some((g) => g.billing === 'billed')) {
    hints.push({ tone: 'ok', text: t('usage.nothingBilled', { period: facts.period }) });
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
      ? { tone: 'neutral', text: t('usage.noBudget'), action: budgetLink() }
      : null;
  }
  const budget = facts.budgetCents * 10_000;
  const day = facts.now.getUTCDate();
  if (facts.billedMonthMicro >= budget || day < PACE_FROM_DAY) return null;
  const days = new Date(Date.UTC(facts.now.getUTCFullYear(), facts.now.getUTCMonth() + 1, 0)).getUTCDate();
  const pace = Math.round((facts.billedMonthMicro / day) * days);
  if (pace <= budget) return null;
  return { tone: 'warn', text: t('usage.pace', { day, pace: formatUsd(pace), budget: formatUsd(budget) }) };
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
  const box = free.billing === 'local' ? 'only' : free.takes.includes(task) ? 'none' : 'tick';
  // The engine that bills today may answer as a last resort from outside the list: anything in the list is ahead of it.
  const place = free.position === -1 ? 'enable' : first.position !== -1 && free.position > first.position ? 'above' : 'stay';
  const steps = STEPS[box][place];
  if (!steps) return null;
  const name = taskLabel(task);
  const share = { task: name, period: facts.period, spent: formatUsd(spent), total: formatUsd(total), percent: percent(spent, total) };
  const sentences = [
    t(spent === total ? 'usage.billedTask.all' : 'usage.billedTask.part', share),
    t(free.billing === 'plan' ? 'usage.billedTask.plan' : 'usage.billedTask.local', { engine: label(free.id) }),
    t(steps, { task: name, first: label(first.id) }),
    ...(free.billing === 'plan' ? [] : [t('usage.unmeasured.compare')]),
  ];
  return { tone: 'warn', text: sentences.join(' '), action: enginesLink() };
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
  const engines = joinNames([...new Set(fell.map((g) => label(g.engine)))]);
  return { tone: 'warn', text: t('usage.fellOver', { n: count, engines, period: facts.period, money: formatUsd(micro) }), action: enginesLink() };
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
  const model = models.size === 1 ? ` · ${[...models][0] || t('ai.cliDefault')}` : '';
  const limited = worst.rateLimited * 2 >= worst.failed;
  const task = taskOf(worst.feature as AiFeature) ?? null;
  const local = task ? freeEngineFor(facts, task, ['local']) : undefined;
  const advice = !limited
    ? t('usage.failed.tryModel')
    : local && task && facts.first[task] !== local.id
      ? `${t('usage.failed.giveLocal', { local: label(local.id), task: taskLabel(task) })} ${t('usage.unmeasured')}`
      : t('usage.failed.secondEngine');
  const said = {
    feature: featureLabel(worst.feature),
    engine: `${label(worst.engine)}${model}`,
    failed: worst.failed,
    calls: worst.calls,
    period: facts.period,
    limited: worst.rateLimited,
  };
  const sentences = [
    t(worst.rateLimited > 0 ? 'usage.failed.limited' : 'usage.failed', said),
    t(worst.billing === 'billed' ? 'usage.failed.costsTimeMoney' : 'usage.failed.costsTime'),
    advice,
  ];
  return { tone: 'warn', text: sentences.join(' '), action: enginesLink() };
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
    text: t('usage.pricey', {
      model: scoring.model,
      n: scoring.calls,
      period: facts.period,
      cheapest: cheapest.model,
      times: Math.round(used.input / cheapest.price.input),
      asOf: PRICES_AS_OF,
    }),
    action: enginesLink(),
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
  const share = {
    task: taskLabel(LOCAL_TASK),
    count,
    total,
    period: facts.period,
    percent: percent(count, total),
    engines: joinNames([...new Set(volume.map((g) => label(g.engine)))]),
    local: label(local.id),
  };
  return { tone: 'neutral', text: `${t('usage.volume', share)} ${t('usage.unmeasured')}`, action: enginesLink() };
}
