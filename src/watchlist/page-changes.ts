/**
 * Careers pages that changed during this tick (TASKS §17 stage C, ADR 0036).
 *
 * The same shape as `fetchers/conditional.ts`, and for the same reason: the
 * fetcher runs inside the ordinary walk — so it gets the polite delay, the
 * shuffle, the health row and the per-company interval for free — but a
 * fetcher must not send Telegram messages. It stages what it saw; the tick
 * takes the list afterwards and sends one grouped message.
 *
 * Nothing is written to the row here. After the walk the change becomes the
 * row's `pendingContentHash`, and `lastContentHash` advances only once the
 * notice is out (`jobs/page-change-alerts.ts`), so a change that could not be
 * delivered waits rather than being swallowed.
 */

/**
 * What one read of a watched page found, staged rather than written on the
 * spot so that a fetcher never touches the database — the rule every other
 * fetcher in this project follows.
 */
export type PageChange = {
  companyId: number;
  companyName: string;
  /** The page the user asked us to watch. */
  url: string;
} & (
  /**
   * `first`: there is no previous text to differ from, so the hash is stored
   * and nothing is said. `changed`: the hash waits on the row until the
   * notice is out.
   */
  | { kind: 'first' | 'changed'; hash: string }
  /**
   * Changed again less than a day after the last notice. Nothing is written,
   * so the next check after the day still sees it; staged only so the run can
   * say what it found (#533).
   */
  | { kind: 'held' }
);

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

/** What the walk found on the watched pages, as run stats: a count only where one happened (#533). */
export function pageStats(changes: readonly PageChange[]): { pagesFirstRead?: number; pageChangesFound?: number; pageChangesHeld?: number } {
  const count = (kind: PageChange['kind']): number => changes.filter((c) => c.kind === kind).length;
  const [first, changed, held] = [count('first'), count('changed'), count('held')];
  return { ...(first > 0 && { pagesFirstRead: first }), ...(changed > 0 && { pageChangesFound: changed }), ...(held > 0 && { pageChangesHeld: held }) };
}
