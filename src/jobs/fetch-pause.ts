import { makeLatchingProbe } from '../cancellation';
import { getSettings } from '../settings';

/** How often a long-running tick re-reads the pause flag from the DB. */
export const PAUSE_RECHECK_MS = 5_000;

/**
 * Probe for "did the user pause fetching while this tick was running?".
 * The /settings toggle writes fetchingEnabled immediately (gotcha 9); the
 * jobs pass this probe into every long phase so a pause takes effect
 * within seconds instead of at the next tick.
 */
export function makeFetchPauseProbe(): () => Promise<boolean> {
  return makeLatchingProbe(
    async () => !(await getSettings()).fetchingEnabled,
    PAUSE_RECHECK_MS,
  );
}
