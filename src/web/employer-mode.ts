import type { MiddlewareHandler } from 'hono';
import { getSettings } from '../settings';
import { flashRedirect } from './flash';

/*
 * The one switch the Screening section hangs on (ADR 0049). Cached in the
 * web process because the sidebar reads it on every page and the only
 * writer is this same process's settings route — gotcha 9 is about the
 * WORKER caching what the dashboard writes, and the worker never reads
 * this. A change made with psql shows after a restart.
 */

let enabled: boolean | null = null;

/** Sync, for the sidebar: false until the first request has loaded it. */
export function isEmployerMode(): boolean {
  return enabled === true;
}

export async function ensureEmployerMode(): Promise<boolean> {
  if (enabled === null) enabled = (await getSettings()).employerMode;
  return enabled;
}

export function setEmployerModeCache(value: boolean): void {
  enabled = value;
}

export const SCREENING_SETTINGS_URL = '/settings?tab=screening';

/** Every /screen route: with the mode off the section does not exist, and the settings tab says why. */
export const requireEmployerMode: MiddlewareHandler = async (c, next) => {
  if (!(await ensureEmployerMode())) {
    return flashRedirect(SCREENING_SETTINGS_URL, 'warn', 'Screening is part of employer mode, which is off. Turn it on here to use it.');
  }
  await next();
};
