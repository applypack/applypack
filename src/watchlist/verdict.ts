/**
 * How a resolution reads on screen (TASKS §17 stage A). Pure.
 *
 * One implementation because there are two renderings: the progress page
 * narrates each URL as it is answered, and the preview shows a badge with the
 * reason beside it. They said the same thing in two files until they didn't.
 */
import { sourceLabel } from '../web/source-names';
import type { Resolution } from './resolve';

/** What was found, in the user's words. */
export function verdictLabel(r: Resolution): string {
  switch (r.kind) {
    case 'ats':
      return `${sourceLabel(r.atsType)} · ${plural(r.jobs, 'posting')}`;
    case 'feed':
      return `RSS feed · ${r.items} ${r.items === 1 ? 'entry' : 'entries'}`;
    case 'changeWatch':
      return 'Change watch';
    case 'watchOnly':
      return 'Nothing machine-readable';
    case 'refused':
      return 'Refused';
  }
}

/** One line for the progress list: what was found, or why nothing was. */
export function verdictLine(r: Resolution): string {
  if (r.kind === 'ats' || r.kind === 'feed') return verdictLabel(r);
  if (r.kind === 'changeWatch') return 'no board or feed — watching the page for changes';
  return r.reason;
}

/** "That is an Ashby board, but the public posting API does not serve …" */
export function boardMissReason(hit: { atsType: string; atsToken: string }): string {
  const vendor = sourceLabel(hit.atsType);
  return `That is ${/^[AEIOU]/i.test(vendor) ? 'an' : 'a'} ${vendor} board, but the public posting API does not serve "${hit.atsToken}" — the board is probably embed-only.`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
