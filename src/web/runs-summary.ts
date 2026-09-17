import type { CronStats } from '../jobs/cron-run';

/*
 * A finished run as a reader meets it on /runs: the facts worth a glance, in a
 * fixed order, instead of the stats JSON. Pure — tested in
 * runs-summary.test.ts. What is not a count (a profile name, a mode, the
 * per-source list) stays in the raw block the page folds under "Raw output".
 */

/** Why a run did nothing, as a sentence. The codes are the ones src/jobs/* write into `reason`. */
const REASON: Record<string, string> = {
  'fetching-paused': 'Fetching is paused',
  'paused-mid-run': 'Fetching was paused mid-run; nothing stored',
  'outside-schedule': "Outside the schedule's hours",
  'no-active-profile': 'No running search',
  'discovery-disabled': 'Discovery is switched off',
  'parser-disabled': 'The HN parser is switched off',
  'tracking-disabled': 'Application tracking is switched off',
  'digest-disabled': 'The stale-applications digest is switched off',
};

/**
 * Known counts in reading order. `always` facts show at zero too — "0 new" is
 * the news of an uneventful tick; the rest speak only when they happened.
 */
const FACTS: { key: string; one: string; many: string; always?: true; job?: string }[] = [
  { key: 'fetched', one: 'fetched', many: 'fetched', always: true },
  { key: 'persisted', one: 'new', many: 'new', always: true },
  { key: 'duplicate', one: 'duplicate', many: 'duplicates' },
  { key: 'crossListed', one: 'cross-listed', many: 'cross-listed' },
  { key: 'classified', one: 'classified', many: 'classified' },
  { key: 'classifyFailed', one: 'failed to classify', many: 'failed to classify' },
  { key: 'alerted', one: 'alerted', many: 'alerted' },
  { key: 'alertHeld', one: 'held for the alert window', many: 'held for the alert window' },
  { key: 'alertFailed', one: 'alert failed to send', many: 'alerts failed to send' },
  { key: 'sourcesFailed', one: 'source failed', many: 'sources failed' },
  // Bare words a second job could reuse for something else: worded for the job that writes them.
  { key: 'found', job: 'stale-applications', one: 'stale application', many: 'stale applications', always: true },
  { key: 'count', job: 'digest', one: 'job in the digest', many: 'jobs in the digest', always: true },
  { key: 'deleted', job: 'cleanup', one: 'old job deleted', many: 'old jobs deleted', always: true },
  { key: 'screeningsDeleted', one: 'screening deleted', many: 'screenings deleted' },
  { key: 'candidates', one: 'candidate', many: 'candidates', always: true },
  { key: 'candidatesRecorded', one: 'candidate recorded', many: 'candidates recorded' },
];

/**
 * Counts the sentence leaves to other places: the Duration column, the
 * by-source list, the reason — and the routine ones every tick carries (what
 * the base filter and the prefilter turned away, what the classifier
 * dismissed), which are the pipeline working, not news. They stay in the raw
 * block.
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
  const facts = FACTS.filter((f) => f.job === undefined || f.job === name);
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
