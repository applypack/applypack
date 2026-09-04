/**
 * When this install's crons run (docs/scale-plan.md §2). Pure — no clock, no
 * database, no node-cron.
 *
 * Every deployment ships the same `seed.ts`, so a schedule written in the
 * source file is the same instant on every install: ":05 in Europe/Warsaw"
 * is one moment shared by everyone in that zone, all asking the same free
 * board in the same second. The minute therefore comes from the install's
 * own `AppSettings.instanceId` instead — stable across restarts, different
 * per deployment.
 */

/**
 * The crons that talk to somebody else's server. `digest`,
 * `stale-applications` and `cleanup` are left alone: they touch only the
 * user's Telegram and database, and 09:00 means 09:00 because a human
 * picked it.
 */
const SHARED_SOURCE_JOBS: ReadonlySet<string> = new Set([
  'fetch',
  'hn-hiring',
  'discovery',
]);

const MINUTES_PER_HOUR = 60;
const CRON_FIELDS = 5;

/**
 * The job name is part of the hash, not just the instance: `fetch` runs
 * every hour and `discovery` on Sunday at 04:00, so one minute per install
 * would collide those two every Sunday on every install.
 */
export function cronMinute(instanceId: string, jobName: string): number {
  // Without an id every install hashes the same string and lands on the same
  // minute — the exact thing this exists to prevent, and silently. The column
  // is NOT NULL, so an empty value means a caller scheduled something before
  // reading it.
  if (instanceId === '') throw new Error('schedule: no instanceId — read it before registering crons');
  return hash32(`${instanceId}:${jobName}`) % MINUTES_PER_HOUR;
}

/**
 * The cron expression this install should use for `jobName`. Jobs that hit
 * nobody but us are returned untouched.
 */
export function spreadMinute(
  expression: string,
  instanceId: string,
  jobName: string,
): string {
  if (!SHARED_SOURCE_JOBS.has(jobName)) return expression;
  return withMinute(expression, cronMinute(instanceId, jobName));
}

/** Replaces the minute field of a five-field cron expression. */
export function withMinute(expression: string, minute: number): string {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== CRON_FIELDS) {
    throw new Error(`schedule: "${expression}" is not a five-field cron expression`);
  }
  return [String(minute), ...fields.slice(1)].join(' ');
}

/** FNV-1a, 32-bit. Spread is all we need; nothing here is a security boundary. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
