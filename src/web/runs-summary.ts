import type { CronStats, RunName } from '../jobs/cron-run';
import { DISMISS_KEY, FILTER_KEY } from '../funnel';
import { runFailure } from './run-failure';
import type { MessageKey } from '../i18n/catalog';
import { formatNumber } from '../i18n/format';
import { t } from '../i18n/t';

/*
 * A finished run as a reader meets it on /runs: the facts worth a glance, in a
 * fixed order, instead of the stats JSON. Pure — tested in
 * runs-summary.test.ts. What is not a count (a profile name, a mode, the
 * per-source list) stays in the raw block the page folds under "Raw output".
 */

/** What each job is called on /runs and the Overview: the stored name is a code, in every language (#568). */
const RUN_NAME = {
  fetch: 'runs.name.fetch',
  'fetch-now': 'runs.name.fetchNow',
  'folder-watch': 'runs.name.folderWatch',
  'hn-hiring': 'runs.name.hnHiring',
  import: 'runs.name.import',
  digest: 'runs.name.digest',
  'stale-applications': 'runs.name.staleApplications',
  cleanup: 'runs.name.cleanup',
  discovery: 'runs.name.discovery',
  pack: 'runs.name.pack',
  'reclassify-all': 'runs.name.reclassifyAll',
  'score-unscored': 'runs.name.scoreUnscored',
} as const satisfies Record<RunName, MessageKey>;

/** A run's job as a reader says it; a name no release writes any more is shown as stored. */
export function runName(name: string): string {
  return Object.hasOwn(RUN_NAME, name) ? t(RUN_NAME[name as RunName]) : name;
}

/** Why a run did nothing, as a sentence. The codes are the ones src/jobs/* write into `reason`. */
const REASON: Record<string, MessageKey> = {
  'fetching-paused': 'runs.reason.fetchingPaused',
  overlap: 'runs.reason.overlap',
  'paused-mid-run': 'runs.reason.pausedMidRun',
  'outside-schedule': 'runs.reason.outsideSchedule',
  'no-active-profile': 'runs.reason.noActiveProfile',
  'no-sources': 'runs.reason.noSources',
  'none-due': 'runs.reason.noneDue',
  'discovery-disabled': 'runs.reason.discoveryDisabled',
  'parser-disabled': 'runs.reason.parserDisabled',
  'source-disabled': 'runs.reason.sourceDisabled',
  'tracking-disabled': 'runs.reason.trackingDisabled',
  'digest-disabled': 'runs.reason.digestDisabled',
  'alerts-off': 'runs.reason.alertsOff',
  'no-targets': 'runs.reason.noTargets',
};

/** A code two jobs share that means something else for one of them: a pack run stands down for a pack run, not for a fetch. */
const REASON_FOR: Record<string, Record<string, MessageKey>> = {
  pack: { overlap: 'runs.reason.packOverlap' },
};

/** One count's words: for every job, or for the one job whose count it is. */
interface FactRow {
  key: string;
  words: MessageKey;
  always?: true;
  job?: RunName;
}

/**
 * Known counts in reading order. `always` facts show at zero too — "0 new" is
 * the news of an uneventful tick; the rest speak only when they happened.
 */
const FACTS = [
  { key: 'fetched', words: 'runs.fact.fetched', always: true },
  { key: 'fetched', job: 'import', words: 'runs.fact.importRows', always: true },
  { key: 'persisted', words: 'runs.fact.persisted', always: true },
  { key: 'duplicate', words: 'runs.fact.duplicate' },
  { key: 'crossListed', words: 'runs.fact.crossListed' },
  { key: 'classified', words: 'runs.fact.classified' },
  { key: 'classifyFailed', words: 'runs.fact.classifyFailed' },
  { key: 'skippedByPause', words: 'runs.fact.skippedByPause' },
  // A re-score (Save & re-classify) and the wizard's first scoring of stored postings.
  { key: 'reclassified', words: 'runs.fact.rescored' },
  { key: 'matched', words: 'runs.fact.matched' },
  { key: 'watchedKept', words: 'runs.fact.watchedKept' },
  { key: 'promoted', words: 'runs.fact.promoted' },
  { key: 'demoted', words: 'runs.fact.demoted' },
  { key: 'keptSaved', words: 'runs.fact.keptSaved' },
  { key: 'failed', job: 'reclassify-all', words: 'runs.fact.scoreFailed' },
  { key: 'failed', job: 'score-unscored', words: 'runs.fact.scoreFailed' },
  { key: 'filterDismissed', words: 'runs.fact.filterDismissed' },
  { key: 'remaining', job: 'score-unscored', words: 'runs.fact.remaining' },
  { key: 'priorityBoosted', words: 'runs.fact.priorityBoosted' },
  { key: 'alerted', words: 'runs.fact.alerted' },
  { key: 'alertHeld', words: 'runs.fact.alertHeld' },
  { key: 'alertsOffHeld', words: 'runs.fact.alertsOffHeld' },
  { key: 'alertFailed', words: 'runs.fact.alertFailed' },
  { key: 'alertNoTarget', words: 'runs.fact.alertNoTarget' },
  { key: 'alertSourceOff', words: 'runs.fact.alertSourceOff' },
  { key: 'alertCounted', words: 'runs.fact.alertCounted' },
  // What the top of a fetch tick sent before it searched: matches held for the alert window, careers pages that changed.
  { key: 'heldDelivered', words: 'runs.fact.heldDelivered' },
  { key: 'pagesChanged', words: 'runs.fact.pagesChanged' },
  { key: 'sourcesFailed', words: 'runs.fact.sourcesFailed' },
  // France Travail's daily re-check of the offers it stored (ADR 0034 rule 5).
  { key: 'ftChecked', words: 'runs.fact.ftChecked' },
  { key: 'ftDeleted', words: 'runs.fact.ftDeleted' },
  { key: 'ftAnonymised', words: 'runs.fact.ftAnonymised' },
  { key: 'ftExpired', words: 'runs.fact.ftExpired' },
  // Bare words a second job could reuse for something else: worded for the job that writes them.
  { key: 'found', job: 'stale-applications', words: 'runs.fact.staleFound', always: true },
  { key: 'count', job: 'digest', words: 'runs.fact.digestCount', always: true },
  // The application-pack runner (ADR 0063), and the tick that queued one for it.
  { key: 'packsQueued', words: 'runs.fact.packsQueued' },
  { key: 'ready', job: 'pack', words: 'runs.fact.packReady' },
  { key: 'stopped', job: 'pack', words: 'runs.fact.packStopped' },
  { key: 'failed', job: 'pack', words: 'runs.fact.packFailed' },
  { key: 'requeued', job: 'pack', words: 'runs.fact.packRequeued' },
  { key: 'dropped', job: 'pack', words: 'runs.fact.packDropped' },
  { key: 'notified', job: 'pack', words: 'runs.fact.packNotified' },
  { key: 'unscored', job: 'digest', words: 'runs.fact.digestUnscored' },
  { key: 'deleted', job: 'cleanup', words: 'runs.fact.jobsDeleted', always: true },
  { key: 'dismissalsForgotten', words: 'runs.fact.dismissalsForgotten' },
  { key: 'screeningsDeleted', words: 'runs.fact.screeningsDeleted' },
  { key: 'runsDeleted', words: 'runs.fact.runsDeleted' },
  { key: 'aiCallsDeleted', words: 'runs.fact.aiCallsDeleted' },
  { key: 'candidates', words: 'runs.fact.candidates', always: true },
  { key: 'candidatesRecorded', words: 'runs.fact.candidatesRecorded' },
  // What a discovery run leaves for review: the number /discovery shows beside "Pending review" (#542).
  { key: 'pending', job: 'discovery', words: 'runs.fact.discoveryPending', always: true },
  { key: 'probed', job: 'discovery', words: 'runs.fact.discoveryProbed' },
  { key: 'alive', job: 'discovery', words: 'runs.fact.discoveryAlive' },
  { key: 'dead', job: 'discovery', words: 'runs.fact.discoveryDead' },
  { key: 'jobsCountUpdated', job: 'discovery', words: 'runs.fact.discoveryJobsUpdated' },
] as const satisfies readonly FactRow[];

/**
 * Counts the sentence leaves to other places: the Duration column, the
 * by-source list, the reason — and the routine ones every tick carries (what
 * the base filter and the prefilter turned away, what the classifier
 * dismissed, and why), which are the pipeline working, not news. They stay
 * in the raw block, and the funnel card above the table sums them.
 */
const ELSEWHERE_KEYS = [
  'durationMs',
  // A re-score's machinery: how wide it ran, what it read, what stayed as it was.
  'concurrency',
  'scanned',
  'unchanged',
  'unscored',
  'sources',
  'sourcesUnchanged',
  // How many messages carried the held matches: the count of matches says the news.
  'heldMessages',
  'skipped',
  'aborted',
  'filterRejected',
  'preFiltered',
  'dismissed',
  // What a read of a watched careers page found: a Check now's flash says it (#533).
  'pagesFirstRead',
  'pageChangesFound',
  'pageChangesHeld',
  ...Object.values(FILTER_KEY),
  ...Object.values(DISMISS_KEY),
] as const;
const ELSEWHERE = new Set<string>(ELSEWHERE_KEYS);

/** A 0 / 1 flag a job raises, as the sentence it stands for. */
const FLAG = {
  skippedBlankProfile: 'runs.flag.skippedBlankProfile',
  abortedMidRun: 'runs.flag.abortedMidRun',
} as const satisfies Record<string, MessageKey>;

type Fact = (typeof FACTS)[number];
/**
 * The counts /runs has words for in one job's row — its own facts and the
 * shared ones — or leaves to the raw block on purpose. runs-summary.test.ts
 * holds every count each job writes to it, so a new one fails `tsc` until it
 * is worded here (#606).
 */
export type WordedCount<J extends RunName> =
  | Extract<Fact, { job: J }>['key']
  | Exclude<Fact, { job: string }>['key']
  | (typeof ELSEWHERE_KEYS)[number]
  | keyof typeof FLAG;

/** `priorityBoosted` → "priority boosted". */
function humanise(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

/**
 * The facts of one run, in order. A `reason` leads as a sentence; known counts
 * follow in their fixed order; a count this file has never heard of — one an
 * older release stored — is humanised rather than dropped. A count a job
 * writes today is never one: `WordedCount` holds them to the tables above.
 * An alert count rides along whenever something new was stored — "3 new,
 * 0 alerted" is a finding, "0 new, 0 alerted" is noise.
 */
export function summarizeRun(name: string, stats: CronStats): string[] {
  // A job's own wording for a count replaces the shared one ("3 rows read from the file", not "3 fetched").
  const rows: readonly FactRow[] = FACTS;
  const facts = rows.filter((f) => f.job === name || (f.job === undefined && !rows.some((own) => own.job === name && own.key === f.key)));
  const out: string[] = [];
  const num = (key: string): number | null => (typeof stats[key] === 'number' ? (stats[key] as number) : null);

  if (typeof stats.reason === 'string') {
    const known = REASON_FOR[name]?.[stats.reason] ?? REASON[stats.reason];
    // A code this file has never heard of is shown as its own words, never dropped.
    out.push(known ? t(known) : t('runs.reason.other', { reason: stats.reason.replace(/-/g, ' ') }));
  }
  for (const [key, sentence] of Object.entries(FLAG)) if (num(key) === 1) out.push(t(sentence));

  const stored = num('persisted') ?? 0;
  for (const f of facts) {
    const n = num(f.key);
    if (n === null) continue;
    if (n === 0 && !f.always && !(f.key === 'alerted' && stored > 0)) continue;
    out.push(t(f.words, { n }));
  }

  const known = new Set<string>(facts.map((f) => f.key));
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value !== 'number' || value === 0 || known.has(key) || ELSEWHERE.has(key) || key in FLAG) continue;
    out.push(`${formatNumber(value)} ${humanise(key)}`);
  }
  return out;
}

/** A finished run in one line, for the terminal of the once-script that ran it (#571): what /runs says of it. */
export function runSummaryLine(name: string, stats: CronStats | null): string {
  const facts = summarizeRun(name, stats ?? {});
  return `${name}: ${facts.length > 0 ? facts.join(' · ') : t('run.status.ok')}`;
}

/**
 * A run that finished and scored nothing it tried to (#366): postings reached
 * the classifier, and not one came back with a verdict — neither scored nor
 * set aside by the prefilter. The run itself did not fail, so its status is
 * OK, and a row of green badges is how a dead engine stayed out of sight for
 * a night. A run where some were scored is the engine having a bad moment,
 * and its "N failed to classify" says so already.
 */
export function unscoredRun(status: string, stats: unknown): boolean {
  if (status !== 'OK' || typeof stats !== 'object' || stats === null) return false;
  const n = (key: string): number => {
    const value = (stats as Record<string, unknown>)[key];
    return typeof value === 'number' ? value : 0;
  };
  return n('classifyFailed') > 0 && n('classified') === 0 && n('preFiltered') === 0;
}

/** What is safe after a failed run of each job, and what comes next — the second and third parts of the sentence. */
const AFTER_FAILURE: Record<string, MessageKey> = {
  fetch: 'runs.after.fetch',
  'fetch-now': 'runs.after.fetchNow',
  'folder-watch': 'runs.after.folderWatch',
  'hn-hiring': 'runs.after.hnHiring',
  import: 'runs.after.import',
  digest: 'runs.after.digest',
  'stale-applications': 'runs.after.digest',
  cleanup: 'runs.after.cleanup',
  discovery: 'runs.after.discovery',
};
/** A reason is its first line, and one sentence of it — the rest folds behind Details. */
const REASON_MAX_CHARS = 160;

/**
 * A failed run as a sentence (TASKS U6): what failed, why in one line, what is
 * safe and what comes next — the raw error goes under Details, not in place of
 * the explanation.
 */
export function failedRunLine(name: string, error: string): string {
  const first = error.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const reason = first.length > REASON_MAX_CHARS ? `${first.slice(0, REASON_MAX_CHARS - 1)}…` : first.replace(/[.\s]+$/, '');
  return runFailure(t('runs.failed', { name: runName(name) }), reason, t(AFTER_FAILURE[name] ?? 'runs.after.other'));
}
