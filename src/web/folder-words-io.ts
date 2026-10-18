import { t } from '../i18n/t';
import { foldersReadOnce } from '../jobs/source-file-store';

/**
 * The sentence a changed search or an unmute adds when folders of rows were
 * read before it: a file is read once, and the way to have it judged again
 * is a button on its Files page. '' when no such folder is switched on.
 */
export async function foldersReadOnceHint(): Promise<string> {
  const n = await foldersReadOnce();
  return n === 0 ? '' : t('folders.flash.readOnce', { n });
}
