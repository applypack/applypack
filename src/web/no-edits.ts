/*
 * What an empty suggestion list is allowed to say about itself. Pure, and in
 * its own file because a .ts test cannot render a .tsx component (gotcha 2).
 *
 * "No edits suggested." covers two situations the user cannot tell apart, and
 * they call for opposite reactions: the analysis found nothing worth changing,
 * or it found nothing at all when there was plenty. The ceiling separates them
 * — it is what honest editing could reach — so the sentence names which one
 * this is, and offers the retry only where a retry could help.
 */

import { t } from '../i18n/t';

/** How far the score sits below what editing could reach before the list looks suspect. */
const ROOM = 15;
/** A ceiling below this is not worth chasing — the same cutoff the score's own wording uses. */
const WORTH_CHASING = 50;

export interface Reach {
  score: number;
  ceiling: number;
}

export interface NoEditsLine {
  text: string;
  /** True when the honest answer is "ask again", not "there is nothing here". */
  offerRewrite: boolean;
}

export function noEditsLine(reach: Reach | null): NoEditsLine {
  if (!reach) return { text: t('match.noEdits.plain'), offerRewrite: false };
  // Nothing editing can reach is worth applying on: say what the gap is made of
  // rather than sending the user off to reword their way to a 30.
  if (reach.ceiling < WORTH_CHASING) {
    return { text: t('match.noEdits.outOfReach', { ceiling: reach.ceiling }), offerRewrite: false };
  }
  if (reach.ceiling - reach.score >= ROOM) {
    // The sentence ends in the button's name; the card renders the same message with that name in bold.
    return { text: t('match.noEdits.room', { ceiling: reach.ceiling }), offerRewrite: true };
  }
  return { text: t('match.noEdits.done', { score: reach.score, ceiling: reach.ceiling }), offerRewrite: false };
}
