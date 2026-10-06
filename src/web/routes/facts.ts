import { Hono } from 'hono';
import { z } from 'zod';
import { applyFacts, FACT_ANSWERS } from '../../resume/facts';
import { readKeywords } from '../../resume/prompts';
import { deleteFact, rescoreMatchKeywords, upsertFact } from '../../resume/store';
import { flashRedirect, safeBack } from '../flash';
import { t } from '../../i18n/t';

/*
 * "ask_user" answers. Confirming or denying a term stores a CandidateFact and
 * — when the comparison carries a v2 breakdown — flips the keyword and
 * recomputes the score deterministically, right now, with no AI call.
 */

const FactFormSchema = z.object({
  term: z.string().trim().min(1).max(100),
  decision: z.enum(FACT_ANSWERS),
  note: z.string().optional().default(''),
  matchId: z.coerce.number().int().optional(),
  back: z.string().optional().default('/resumes'),
});

export const factsRoute = new Hono();

factsRoute.post('/facts', async (c) => {
  const parsed = FactFormSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) return c.text('Bad fact', 400);
  const f = parsed.data;
  const back = safeBack(f.back, '/resumes');
  const note = f.note.trim().slice(0, 300) || null;
  const fact = await upsertFact(f.term, f.decision, note);
  // "Not sure" moves no score and needs no number: it only stops the question.
  const unsure = f.decision === 'unknown';

  if (f.matchId) {
    // Under the row lock, like every other write to this JSON: an override
    // being saved in another tab must not lose this answer, or the other way
    // round. The re-score also runs through `effectiveKeywords` there, so a
    // confirmed fact can no longer quietly drop the user's own keyword edits
    // out of the number.
    const outcome = await rescoreMatchKeywords(f.matchId, (match) => {
      const { keywords, changed } = applyFacts(readKeywords(match.keywords), [fact]);
      return { keywords: changed > 0 ? keywords : null, detail: { changed } };
    });
    if (outcome && outcome.detail.changed > 0 && !unsure) {
      if (outcome.scored) {
        // A "no" moves nothing (an ask and a term without evidence both earn 0): say so, not "37 → 37".
        const moved = outcome.before === outcome.after ? 'no' : 'yes';
        return flashRedirect(back, 'ok', t('facts.flash.savedScored', { term: fact.term, moved, before: outcome.before, after: outcome.after }));
      }
      return flashRedirect(back, 'ok', t('facts.flash.savedRecheck', { term: fact.term }));
    }
  }
  if (unsure) {
    return flashRedirect(back, 'ok', t('facts.flash.unsure', { term: fact.term }));
  }
  return flashRedirect(back, 'ok', t('facts.flash.saved', { term: fact.term }));
});

factsRoute.post('/facts/delete', async (c) => {
  const form = await c.req.parseBody();
  const term = typeof form.term === 'string' ? form.term : '';
  const back = safeBack(form.back, '/resumes');
  if (term.trim().length === 0) return c.text('Bad fact', 400);
  await deleteFact(term);
  return flashRedirect(back, 'ok', t('facts.flash.forgot', { term: term.trim().toLowerCase() }));
});
