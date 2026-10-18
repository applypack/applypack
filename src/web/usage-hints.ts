import { AI_PROVIDER_LABELS, PROVIDER_MODEL_OPTIONS, isAiProviderId, offeredTasks, type AiProviderId } from '../ai-engine';
import type { EngineTrouble, TroubleKind } from '../ai-health';
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
  /** Engines whose last attempts all failed, whatever the period shown (ai-health.ts). Absent = not read. */
  troubles?: readonly EngineTrouble[];
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
/** The advice for failures that have a cause of their own; every other ending gets "try another model, or press Test". */
const FAILED_ADVICE: Record<string, MessageKey> = {
  unauthorized: 'usage.failed.signIn',
  unreachable: 'usage.failed.unreachable',
  too_large: 'usage.failed.window',
  // Test asks for one word, which such a model writes: pressing it would say the engine works (#463).
  unparsed: 'usage.failed.unparsed',
};
const percent = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const taskOfGroup = (g: SpendGroup): AiTask | null => taskOf(g.feature as AiFeature) ?? null;

const TROUBLE_WORDS = {
  signin: 'usage.trouble.signIn',
  unreachable: 'usage.trouble.unreachable',
  window: 'usage.trouble.window',
  limited: 'usage.trouble.limited',
  unparsed: 'usage.trouble.unparsed',
  failing: 'usage.trouble.failing',
} as const satisfies Record<TroubleKind, MessageKey>;

/** What is wrong with an engine that is failing now, and what to do about that — never "try another model" for a closed port. */
export function troubleLine(trouble: EngineTrouble): string {
  return t(TROUBLE_WORDS[trouble.kind], { engine: label(trouble.engine), n: trouble.failed });
}

/**
 * An engine in trouble that calls still go to: one in the list, or the one
 * that answers a task first today (a last resort is not in the list). An
 * engine the person has since disabled is no longer theirs to fix.
 */
function troubled(facts: HintFacts): UsageHint[] {
  const asked = new Set<string>([...facts.engines.filter((e) => e.position !== -1).map((e) => e.id), ...Object.values(facts.first)]);
  return (facts.troubles ?? []).filter((trouble) => asked.has(trouble.engine)).map((trouble) => ({ tone: 'warn', text: troubleLine(trouble), action: enginesLink() }));
}

export function usageHints(facts: HintFacts): UsageHint[] {
  // Said first and whatever the period holds: a week of answers must not bury an engine that fails every call today (#413).
  const failing = troubled(facts);
  const groups = facts.groups.filter((g) => g.feature !== 'engine-test');
  if (groups.length === 0) return failing;
  const hints = [...failing, budgetPace(facts, groups), billedTask(facts, groups), billedFallback(facts, groups), failures(facts, groups), priceyScoring(facts, groups), volumeOnPlan(facts, groups)].filter(
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
  const pairs = new Map<
    string,
    {
      feature: string;
      engine: string;
      billing: AiBilling;
      calls: number;
      failed: number;
      unparsed: number;
      rateLimited: number;
      answered: Set<string>;
      asked: Set<string>;
      endings: Map<string, number>;
    }
  >();
  for (const g of groups) {
    const key = `${g.feature}\n${g.engine}\n${g.billing}`;
    const p = pairs.get(key) ?? {
      feature: g.feature,
      engine: g.engine,
      billing: g.billing,
      calls: 0,
      failed: 0,
      unparsed: 0,
      rateLimited: 0,
      answered: new Set<string>(),
      asked: new Set<string>(),
      endings: new Map<string, number>(),
    };
    p.calls += g.calls;
    p.failed += g.failed;
    p.unparsed += g.unparsed;
    p.rateLimited += g.rateLimited;
    if (g.failedAs) p.endings.set(g.failedAs, (p.endings.get(g.failedAs) ?? 0) + g.failed);
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
  // How most of them ended decides the advice: a closed port or a prompt too large is not the model's doing (#413).
  const ending = [...worst.endings].sort((a, b) => b[1] - a[1])[0]?.[0];
  const advice = !limited
    ? t(FAILED_ADVICE[ending ?? ''] ?? 'usage.failed.tryModel')
    : local && task && facts.first[task] !== local.id
      ? `${t('usage.failed.giveLocal', { local: label(local.id), task: taskLabel(task) })} ${t('usage.unmeasured')}`
      : t('usage.failed.secondEngine');
  // A reply that could not be read was an answer: counted apart from the calls that got none (#463).
  const unanswered = worst.failed - worst.unparsed;
  const said = {
    feature: featureLabel(worst.feature),
    engine: `${label(worst.engine)}${model}`,
    failed: unanswered,
    calls: worst.calls,
    period: facts.period,
    limited: worst.rateLimited,
  };
  const counted =
    unanswered === 0
      ? [t('usage.failed.unread', { ...said, unread: worst.unparsed })]
      : [
          t(worst.rateLimited > 0 ? 'usage.failed.limited' : 'usage.failed', said),
          ...(worst.unparsed > 0 ? [t('usage.failed.alsoUnread', { n: worst.unparsed })] : []),
        ];
  const sentences = [...counted, t(worst.billing === 'billed' ? 'usage.failed.costsTimeMoney' : 'usage.failed.costsTime'), advice];
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
  const first = engineOf(facts, facts.first[LOCAL_TASK]);
  if (!local || first?.billing !== 'plan') return null;
  // The steps from where the local engine stands today, as the billed-task hint names them: "can be given
  // this task" said nothing of an engine that is not enabled, or stands below the plan (#415).
  const place = local.position === -1 ? 'enable' : first.position !== -1 && local.position > first.position ? 'above' : 'stay';
  const steps = STEPS.only[place];
  const share = {
    task: taskLabel(LOCAL_TASK),
    count,
    total,
    period: facts.period,
    percent: percent(count, total),
    engines: joinNames([...new Set(volume.map((g) => label(g.engine)))]),
    local: label(local.id),
  };
  const sentences = [t('usage.volume', share), ...(steps ? [t(steps, { task: share.task, first: label(first.id) })] : []), t('usage.unmeasured')];
  return { tone: 'neutral', text: sentences.join(' '), action: enginesLink() };
}
