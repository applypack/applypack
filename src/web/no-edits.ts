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
  if (!reach) return { text: 'No edits suggested.', offerRewrite: false };
  // Nothing editing can reach is worth applying on: say what the gap is made of
  // rather than sending the user off to reword their way to a 30.
  if (reach.ceiling < WORTH_CHASING) {
    return {
      text:
        `No edits suggested. Even saying everything this resume honestly could reaches only ` +
        `${reach.ceiling} here — the gap is experience this posting asks for and this resume does ` +
        'not show, which no wording fixes.',
      offerRewrite: false,
    };
  }
  if (reach.ceiling - reach.score >= ROOM) {
    return {
      text:
        `No edits suggested — but this resume could reach ${reach.ceiling} by saying what it already ` +
        'has more plainly, so the list is short for its own sake. Ask for it again with',
      offerRewrite: true,
    };
  }
  return {
    text: `No edits suggested — this resume is already saying what it can for this posting (${reach.score} of a reachable ${reach.ceiling}).`,
    offerRewrite: false,
  };
}
