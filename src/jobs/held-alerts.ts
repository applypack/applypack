import type { AlertJob } from '../types';

/**
 * Grouping for the held-alert delivery (TASKS §16). Pure — the rows arrive
 * as arguments and the Telegram calls happen in jobs/alert-delivery.ts.
 */

/** The header a delivery carries, so a reader can tell it from the daily recap. */
export const HELD_TITLE = 'While you were away';

export interface HeldRow {
  id: number;
  /**
   * The winning search's chat, or null to broadcast — the same routing an
   * instant alert would have taken, recomputed from the stored verdicts so a
   * held match does not land somewhere else than a sent one.
   */
  targetId: number | null;
  alert: AlertJob;
}

export interface HeldGroup {
  targetId: number | null;
  ids: number[];
  alerts: AlertJob[];
}

/**
 * One message per chat, in the order the rows came in. A broadcast group
 * (targetId null) is kept apart from the routed ones: merging it into a
 * chat's message would send that chat somebody else's search twice.
 */
export function groupHeldByTarget(rows: readonly HeldRow[]): HeldGroup[] {
  const groups = new Map<number | null, HeldGroup>();
  for (const row of rows) {
    const group = groups.get(row.targetId) ?? { targetId: row.targetId, ids: [], alerts: [] };
    group.ids.push(row.id);
    group.alerts.push(row.alert);
    groups.set(row.targetId, group);
  }
  return [...groups.values()];
}
