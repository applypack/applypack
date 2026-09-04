/**
 * Careers pages that changed during this tick (TASKS §17 stage C, ADR 0036).
 *
 * The same shape as `fetchers/conditional.ts`, and for the same reason: the
 * fetcher runs inside the ordinary walk — so it gets the polite delay, the
 * shuffle, the health row and the per-company interval for free — but a
 * fetcher must not send Telegram messages. It stages what it saw; the tick
 * takes the list afterwards and sends one grouped message.
 *
 * Nothing is written to the row here. `lastContentHash` advances only once
 * the alert is out (`jobs/page-change-alerts.ts`), so a change that could not
 * be delivered is still pending at the next check rather than swallowed.
 */

export interface PageChange {
  companyId: number;
  companyName: string;
  /** The page the user asked us to watch. */
  url: string;
  /** The hash to store once the alert is sent. */
  hash: string;
}

const staged: PageChange[] = [];

export function stagePageChange(change: PageChange): void {
  staged.push(change);
}

/** Everything staged this tick, cleared as it is handed over. */
export function takePageChanges(): PageChange[] {
  return staged.splice(0, staged.length);
}

/** Start of a tick: anything a previous run staged and never delivered is dropped. */
export function beginPageChangeTick(): void {
  staged.length = 0;
}
