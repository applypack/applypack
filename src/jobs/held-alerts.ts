import type { AlertChannel } from '../notifier';
import type { AlertMode } from '../user-schedule';
import type { AlertJob } from '../types';

/**
 * Grouping for the held-alert delivery (TASKS §16). Pure — the rows arrive
 * as arguments and the Telegram calls happen in jobs/alert-delivery.ts.
 */

/** The header a delivery carries, so a reader can tell it from the daily recap. */
export const HELD_TITLE = 'While you were away';

/**
 * The most matches one delivery lists in full, per chat. A night outside the
 * window holds a handful; Alerts switched off for a fortnight can hold a
 * hundred, and listing them all would be a burst of messages past what a
 * chat accepts before it answers "too many requests". The header counts
 * every match; the rest stay New on the dashboard. A match is about 470
 * characters, so twenty is three Telegram messages, or five on Discord.
 */
export const HELD_LIST_MAX = 20;

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
  /** Listed in the message, and marked ALERTED once it is out. */
  ids: number[];
  alerts: AlertJob[];
  /** Counted in the header, not listed: released from the hold and left New. */
  unlisted: number[];
}

/**
 * One message per chat, in the order the rows came in (best first — the
 * caller reads them by fit), the first `max` listed. A broadcast group
 * (targetId null) is kept apart from the routed ones: merging it into a
 * chat's message would send that chat somebody else's search twice.
 */
export function groupHeldByTarget(rows: readonly HeldRow[], max = HELD_LIST_MAX): HeldGroup[] {
  const groups = new Map<number | null, HeldGroup>();
  for (const row of rows) {
    const group = groups.get(row.targetId) ?? { targetId: row.targetId, ids: [], alerts: [], unlisted: [] };
    if (group.ids.length < max) {
      group.ids.push(row.id);
      group.alerts.push(row.alert);
    } else {
      group.unlisted.push(row.id);
    }
    groups.set(row.targetId, group);
  }
  return [...groups.values()];
}

/** Why held matches are still waiting — the line on Overview and on the Schedule card says it. */
export type HeldReason = 'alerts-off' | 'no-targets' | 'next-check' | 'window';

/**
 * The first thing that keeps them: no chat, then the switch, then the
 * schedule. With alerts sent the moment a match is scored, nothing waits for
 * a window: a held match is a send every chat refused, or one left from an
 * earlier setting, and the next heartbeat sends it.
 */
export function heldReason(channel: AlertChannel, mode: AlertMode): HeldReason {
  if (channel !== 'open') return channel;
  return mode === 'instant' ? 'next-check' : 'window';
}
