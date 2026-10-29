/**
 * How a resolution reads on screen (TASKS §17 stage A). Pure.
 *
 * One implementation because there are two renderings: the progress page
 * narrates each URL as it is answered, and the preview shows a badge with the
 * reason beside it. They said the same thing in two files until they didn't.
 */
import { t } from '../i18n/t';
import { sourceLabel } from '../web/source-names';
import type { Resolution } from './resolve';

/** What was found, in the user's words. */
export function verdictLabel(r: Resolution): string {
  switch (r.kind) {
    case 'ats':
      return t('watchlist.verdict.ats', { vendor: sourceLabel(r.atsType), n: r.jobs });
    case 'feed':
      return t('watchlist.verdict.feed', { n: r.items });
    case 'changeWatch':
      return t('watchlist.verdict.changeWatch');
    case 'needsBrowser':
      return t('watchlist.verdict.needsBrowser');
    case 'watchOnly':
      return t('watchlist.verdict.watchOnly');
    case 'refused':
      return t('watchlist.verdict.refused');
  }
}

/**
 * What the first check of a batch scores on "Every posting": the postings its
 * boards and feeds list right now, and on how many of them (#681). The change
 * watch and a page drawn in the browser score nothing.
 */
export function firstCheckSize(resolutions: Resolution[]): { boards: number; postings: number } {
  let boards = 0;
  let postings = 0;
  for (const r of resolutions) {
    if (r.kind !== 'ats' && r.kind !== 'feed') continue;
    boards += 1;
    postings += r.kind === 'ats' ? r.jobs : r.items;
  }
  return { boards, postings };
}

/** One line for the progress list: what was found, or why nothing was. */
export function verdictLine(r: Resolution): string {
  if (r.kind === 'ats' || r.kind === 'feed') return verdictLabel(r);
  if (r.kind === 'changeWatch') return t('watchlist.verdict.changeWatchLine');
  if (r.kind === 'needsBrowser') return t('watchlist.verdict.needsBrowserLine');
  return r.reason;
}

/** "That is an Ashby board, but the public posting API does not serve …" */
export function boardMissReason(hit: { atsType: string; atsToken: string }): string {
  const vendor = sourceLabel(hit.atsType);
  // English takes "an" before a vowel; the sentence is a message of its own for each article.
  return t(/^[AEIOU]/i.test(vendor) ? 'watchlist.boardMissVowel' : 'watchlist.boardMiss', { vendor, token: hit.atsToken });
}
