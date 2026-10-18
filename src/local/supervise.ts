/*
 * The launcher's rules for the two processes it runs, no I/O (ADR 0054).
 */

import { NO_ANSWER, type ProcessLookup } from './postgres-setup';

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

/**
 * Who holds the data folder's lock, from a look at the process it names:
 * `launcher` — ApplyPack is running; `nobody` — the process is gone or is
 * something else, so the file is what a killed run left; `unsure` — the
 * process is alive and the look got no answer in time. `unsure` is never read
 * as `nobody`: stop asks it to stop anyway (the request is a file only a
 * launcher reads), and a start does not take the lock from under it.
 */
export type LockHolder = 'launcher' | 'nobody' | 'unsure';

export function lockHolder(lookup: ProcessLookup, alive: boolean): LockHolder {
  if (lookup === NO_ANSWER) return alive ? 'unsure' : 'nobody';
  return isLauncherCommand(lookup) ? 'launcher' : 'nobody';
}
