import type { CronStats } from '../jobs/cron-run';
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

/** Why a run did nothing, as a sentence. The codes are the ones src/jobs/* write into `reason`. */
const REASON: Record<string, MessageKey> = {
  'fetching-paused': 'runs.reason.fetchingPaused',
  overlap: 'runs.reason.overlap',
  'paused-mid-run': 'runs.reason.pausedMidRun',
  'outside-schedule': 'runs.reason.outsideSchedule',
  'no-active-profile': 'runs.reason.noActiveProfile',
  'discovery-disabled': 'runs.reason.discoveryDisabled',
  'parser-disabled': 'runs.reason.parserDisabled',
  'source-disabled': 'runs.reason.sourceDisabled',
  'tracking-disabled': 'runs.reason.trackingDisabled',
  'digest-disabled': 'runs.reason.digestDisabled',
  'alerts-off': 'runs.reason.alertsOff',
  'no-targets': 'runs.reason.noTargets',
};

/**
 * Known counts in reading order. `always` facts show at zero too — "0 new" is
 * the news of an uneventful tick; the rest speak only when they happened.
 */
const FACTS: { key: string; words: MessageKey; always?: true; job?: string }[] = [
  { key: 'fetched', words: 'runs.fact.fetched', always: true },
  { key: 'fetched', job: 'import', words: 'runs.fact.importRows', always: true },
  { key: 'persisted', words: 'runs.fact.persisted', always: true },
  { key: 'duplicate', words: 'runs.fact.duplicate' },
  { key: 'crossListed', words: 'runs.fact.crossListed' },
  { key: 'classified', words: 'runs.fact.classified' },
  { key: 'classifyFailed', words: 'runs.fact.classifyFailed' },
  { key: 'matched', words: 'runs.fact.matched' },
  { key: 'alerted', words: 'runs.fact.alerted' },
  { key: 'alertHeld', words: 'runs.fact.alertHeld' },
  { key: 'alertsOffHeld', words: 'runs.fact.alertsOffHeld' },
  { key: 'alertFailed', words: 'runs.fact.alertFailed' },
  { key: 'alertNoTarget', words: 'runs.fact.alertNoTarget' },
  { key: 'sourcesFailed', words: 'runs.fact.sourcesFailed' },
  // Bare words a second job could reuse for something else: worded for the job that writes them.
  { key: 'found', job: 'stale-applications', words: 'runs.fact.staleFound', always: true },
  { key: 'count', job: 'digest', words: 'runs.fact.digestCount', always: true },
  { key: 'unscored', job: 'digest', words: 'runs.fact.digestUnscored' },
  { key: 'deleted', job: 'cleanup', words: 'runs.fact.jobsDeleted', always: true },
  { key: 'screeningsDeleted', words: 'runs.fact.screeningsDeleted' },
  { key: 'runsDeleted', words: 'runs.fact.runsDeleted' },
  { key: 'aiCallsDeleted', words: 'runs.fact.aiCallsDeleted' },
  { key: 'candidates', words: 'runs.fact.candidates', always: true },
  { key: 'candidatesRecorded', words: 'runs.fact.candidatesRecorded' },
];

/**
 * Counts the sentence leaves to other places: the Duration column, the
 * by-source list, the reason — and the routine ones every tick carries (what
 * the base filter and the prefilter turned away, what the classifier
 * dismissed, and why), which are the pipeline working, not news. They stay
 * in the raw block, and the funnel card above the table sums them.
 */
const ELSEWHERE = new Set([
  'durationMs',
  'sources',
  'sourcesUnchanged',
  'skipped',
  'aborted',
  'filterRejected',
  'preFiltered',
  'dismissed',
  ...Object.values(FILTER_KEY),
  ...Object.values(DISMISS_KEY),
]);

/** A 0 / 1 flag a job raises, as the sentence it stands for. */
const FLAG: Record<string, MessageKey> = {
  skippedBlankProfile: 'runs.flag.skippedBlankProfile',
  abortedMidRun: 'runs.flag.abortedMidRun',
};

/** `priorityBoosted` → "priority boosted". */
function humanise(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

/**
 * The facts of one run, in order. A `reason` leads as a sentence; known counts
 * follow in their fixed order; a count this file has never heard of is
 * humanised rather than dropped, so a new stat shows up without an edit here.
 * An alert count rides along whenever something new was stored — "3 new,
 * 0 alerted" is a finding, "0 new, 0 alerted" is noise.
 */
export function summarizeRun(name: string, stats: CronStats): string[] {
  // A job's own wording for a count replaces the shared one ("3 rows read from the file", not "3 fetched").
  const facts = FACTS.filter((f) => f.job === name || (f.job === undefined && !FACTS.some((own) => own.job === name && own.key === f.key)));
  const out: string[] = [];
  const num = (key: string): number | null => (typeof stats[key] === 'number' ? (stats[key] as number) : null);

  if (typeof stats.reason === 'string') {
    const known = REASON[stats.reason];
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

  const known = new Set(facts.map((f) => f.key));
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value !== 'number' || value === 0 || known.has(key) || ELSEWHERE.has(key) || key in FLAG) continue;
    out.push(`${formatNumber(value)} ${humanise(key)}`);
  }
  return out;
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
  return runFailure(t('runs.failed', { name }), reason, t(AFTER_FAILURE[name] ?? 'runs.after.other'));
}
