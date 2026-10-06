import type { CronStats } from '../jobs/cron-run';
import { DISMISS_KEY, FILTER_KEY } from '../funnel';
import { runFailure } from './run-failure';

/*
 * A finished run as a reader meets it on /runs: the facts worth a glance, in a
 * fixed order, instead of the stats JSON. Pure — tested in
 * runs-summary.test.ts. What is not a count (a profile name, a mode, the
 * per-source list) stays in the raw block the page folds under "Raw output".
 */

/** Why a run did nothing, as a sentence. The codes are the ones src/jobs/* write into `reason`. */
const REASON: Record<string, string> = {
  'fetching-paused': 'Fetching is paused',
  overlap: 'Another fetch was running; this one did nothing',
  'paused-mid-run': 'Fetching was paused mid-run; nothing stored',
  'outside-schedule': "Outside the schedule's hours",
  'no-active-profile': 'No running search',
  'discovery-disabled': 'Discovery is switched off',
  'parser-disabled': 'The HN parser is switched off',
  'source-disabled': 'The source is switched off on Settings → Sources',
  'tracking-disabled': 'Application tracking is switched off',
  'digest-disabled': 'The stale-applications digest is switched off',
  'alerts-off': 'Alerts are switched off; nothing sent',
  'no-targets': 'No chat to send to',
};

/**
 * Known counts in reading order. `always` facts show at zero too — "0 new" is
 * the news of an uneventful tick; the rest speak only when they happened.
 */
const FACTS: { key: string; one: string; many: string; always?: true; job?: string }[] = [
  { key: 'fetched', one: 'fetched', many: 'fetched', always: true },
  { key: 'fetched', job: 'import', one: 'row read from the file', many: 'rows read from the file', always: true },
  { key: 'persisted', one: 'new', many: 'new', always: true },
  { key: 'duplicate', one: 'duplicate', many: 'duplicates' },
  { key: 'crossListed', one: 'cross-listed', many: 'cross-listed' },
  { key: 'classified', one: 'classified', many: 'classified' },
  { key: 'classifyFailed', one: 'failed to classify', many: 'failed to classify' },
  { key: 'matched', one: 'match', many: 'matches' },
  { key: 'alerted', one: 'alerted', many: 'alerted' },
  { key: 'alertHeld', one: 'held for the alert window', many: 'held for the alert window' },
  { key: 'alertsOffHeld', one: 'held while Alerts are off', many: 'held while Alerts are off' },
  { key: 'alertFailed', one: 'alert failed to send, held for a retry', many: 'alerts failed to send, held for a retry' },
  { key: 'alertNoTarget', one: 'not alerted: no chat set up', many: 'not alerted: no chat set up' },
  { key: 'sourcesFailed', one: 'source failed', many: 'sources failed' },
  // Bare words a second job could reuse for something else: worded for the job that writes them.
  { key: 'found', job: 'stale-applications', one: 'stale application', many: 'stale applications', always: true },
  { key: 'count', job: 'digest', one: 'job in the digest', many: 'jobs in the digest', always: true },
  { key: 'deleted', job: 'cleanup', one: 'old job deleted', many: 'old jobs deleted', always: true },
  { key: 'screeningsDeleted', one: 'screening deleted', many: 'screenings deleted' },
  { key: 'runsDeleted', one: 'old run deleted', many: 'old runs deleted' },
  { key: 'aiCallsDeleted', one: 'old AI call record deleted', many: 'old AI call records deleted' },
  { key: 'candidates', one: 'candidate', many: 'candidates', always: true },
  { key: 'candidatesRecorded', one: 'candidate recorded', many: 'candidates recorded' },
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
const FLAG: Record<string, string> = {
  skippedBlankProfile: 'Every running search is empty; nothing scored',
  abortedMidRun: 'Paused mid-run; the rest was skipped',
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

  if (typeof stats.reason === 'string') out.push(REASON[stats.reason] ?? `Skipped: ${stats.reason.replace(/-/g, ' ')}`);
  for (const [key, sentence] of Object.entries(FLAG)) if (num(key) === 1) out.push(sentence);

  const stored = num('persisted') ?? 0;
  for (const f of facts) {
    const n = num(f.key);
    if (n === null) continue;
    if (n === 0 && !f.always && !(f.key === 'alerted' && stored > 0)) continue;
    out.push(`${n.toLocaleString('en-US')} ${n === 1 ? f.one : f.many}`);
  }

  const known = new Set(facts.map((f) => f.key));
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value !== 'number' || value === 0 || known.has(key) || ELSEWHERE.has(key) || key in FLAG) continue;
    out.push(`${value.toLocaleString('en-US')} ${humanise(key)}`);
  }
  return out;
}

/** What is safe after a failed run of each job, and what comes next — the second and third parts of the sentence. */
const AFTER_FAILURE: Record<string, string> = {
  fetch: 'What it stored before the failure stays, and the next tick tries again',
  'fetch-now': 'What it stored before the failure stays; press Fetch now again, or wait for the next tick',
  'folder-watch': 'What it stored before the failure stays, and the hourly check reads the folder again',
  'hn-hiring': 'What it stored before the failure stays, and the next run tries again',
  import: 'What it stored before the failure stays; import the same file again and only the rest is added',
  digest: 'Nothing was sent; the next digest hour tries again',
  'stale-applications': 'Nothing was sent; the next digest hour tries again',
  cleanup: 'Nothing past the failure was deleted, and tomorrow\'s run tries again',
  discovery: 'The next run tries again',
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
  return runFailure(`The ${name} run failed`, reason, `${AFTER_FAILURE[name] ?? 'The next scheduled run tries again'}.`);
}
