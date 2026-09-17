/*
 * The launcher's rules for the two processes it runs, no I/O (ADR 0054).
 */

/** A process that keeps crashing is a bug to report, not a thing to retry forever. */
export const MAX_RESTARTS = 5;
export const RESTART_WINDOW_MS = 120_000;
const FIRST_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/** Messages between `npm start` and the worker and dashboard it runs. */
export type LauncherMessage = { type: 'ready' } | { type: 'shutdown' };

export function isLauncherMessage(value: unknown, type: LauncherMessage['type']): boolean {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === type;
}

/** Restart a crashed process after a growing delay, unless it crashed too often lately. */
export function restartDecision(crashTimes: number[], now: number): { restart: boolean; delayMs: number } {
  const recent = crashTimes.filter((t) => now - t < RESTART_WINDOW_MS).length;
  if (recent >= MAX_RESTARTS) return { restart: false, delayMs: 0 };
  return { restart: true, delayMs: Math.min(FIRST_DELAY_MS * 2 ** recent, MAX_DELAY_MS) };
}

/** Whether a lock file's PID is a live launcher, judged by its command line. */
export function isLauncherCommand(commandLine: string | null): boolean {
  return commandLine !== null && /local[\\/]launcher\.js/.test(commandLine);
}
