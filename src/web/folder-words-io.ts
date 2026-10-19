import { t } from '../i18n/t';
import { foldersToReadAgain } from '../jobs/source-file-store';

/**
 * The sentence a changed search or an unmute adds when folders of rows hold
 * files whose rows the old rules turned away: the next check reads them
 * again, and scores what the searches admit now (#448). '' when none does.
 */
export async function foldersReadAgainHint(): Promise<string> {
  const n = await foldersToReadAgain();
  return n === 0 ? '' : t('folders.flash.readAgain', { n });
}
