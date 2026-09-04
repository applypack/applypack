import { createHash } from 'node:crypto';
import { stripHtml } from '../http';

/**
 * The change watch (TASKS §17 stage C, ADR 0036). Pure — the caller fetches.
 *
 * This is the last rung: a careers page that publishes no board, no feed and
 * nothing machine-readable. It never claims to know the jobs. It says the
 * page changed and hands over the link, which is exactly what a person
 * checking daily does, and it is honest about being no more than that.
 *
 * What the normalisation does and does not do was measured on 2026-09-04
 * across ten careers pages, each fetched three times ninety seconds apart, so
 * that any difference was noise (docs/company-watchlist.md):
 *
 * - **Raw HTML changed on 4 of 10** — a nonce, a build id or a session token.
 *   Every one of them lives in an attribute or a script block.
 * - **`stripHtml` changed on none of them**, because it keeps only the prose.
 * - **Masking digits, which the §17 plan proposed, would delete the signal.**
 *   No page in the sample carried a date, a relative timestamp or a
 *   countdown; the only digits in their text were Datadog's per-department
 *   counts ("92 positions"), PostHog's "0 Job" and Doist's "2024 Open roles".
 *   "92 positions" becoming "93 positions" is the event this rung exists to
 *   report.
 *
 * So: strip the markup, collapse the whitespace, and change nothing else. A
 * page that turns `Senior` into `Staff` has changed, and the reader decides
 * whether that matters.
 */

/** The text a hash is taken over. Exported so a test can read what changed. */
export function normalisePageText(html: string): string {
  return stripHtml(html).replace(/\s+/g, ' ').trim();
}

/** Short, stable, and never compared against anything but itself. */
export function pageHash(html: string): string {
  return createHash('sha256').update(normalisePageText(html)).digest('hex').slice(0, 32);
}

/**
 * Below this a "page" is a loading shell rather than something a hash can
 * watch: every render would differ, or none would. Measured against the ten
 * pages in the sample, the smallest real one (fly.io/jobs) strips to 2.4k
 * characters, so this leaves a wide margin.
 */
export const MIN_WATCHABLE_CHARS = 400;

/** How long a company must wait between two "this page changed" alerts. */
export const CHANGE_ALERT_GAP_MS = 24 * 60 * 60 * 1000;

/** The row's change-watch state, and nothing else. */
export interface WatchedPage {
  lastContentHash: string | null;
  lastContentAlertAt: Date | null;
}

export type ChangeDecision =
  /** First sight of this page: store the hash, say nothing. */
  | { kind: 'first'; hash: string }
  /** The text is what we last reported. */
  | { kind: 'unchanged' }
  /** Changed, and we may say so: alert, then store this hash. */
  | { kind: 'changed'; hash: string }
  /** Changed, but we said so less than a day ago — keep the OLD hash so the
   *  change is still pending at the next allowed check, rather than lost. */
  | { kind: 'held' };

/**
 * What to do about a page we just fetched. Pure, so the once-a-day rule is a
 * tested rule rather than a shape the persist path happens to have.
 */
export function decideChange(page: WatchedPage, html: string, now: Date): ChangeDecision {
  const hash = pageHash(html);
  if (page.lastContentHash === null) return { kind: 'first', hash };
  if (page.lastContentHash === hash) return { kind: 'unchanged' };
  const last = page.lastContentAlertAt;
  if (last !== null && now.getTime() - last.getTime() < CHANGE_ALERT_GAP_MS) return { kind: 'held' };
  return { kind: 'changed', hash };
}
