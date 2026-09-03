import { Hono } from 'hono';
import { z } from 'zod';
import { applyFacts } from '../../resume/facts';
import { readKeywords } from '../../resume/prompts';
import { deleteFact, rescoreMatchKeywords, upsertFact } from '../../resume/store';
import { flashRedirect, safeBack } from '../flash';

/*
 * "ask_user" answers. Confirming or denying a term stores a CandidateFact and
 * — when the comparison carries a v2 breakdown — flips the keyword and
 * recomputes the score deterministically, right now, with no AI call.
 */

const FactFormSchema = z.object({
  term: z.string().trim().min(1).max(100),
  decision: z.enum(['confirmed', 'denied']),
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
    if (outcome && outcome.detail.changed > 0) {
      if (outcome.scored) {
        return flashRedirect(
          back,
          'ok',
          `Saved "${fact.term}" — score ${outcome.before} → ${outcome.after}, no AI call needed.`,
        );
      }
      return flashRedirect(back, 'ok', `Saved "${fact.term}". Re-check to refresh this comparison.`);
    }
  }
  return flashRedirect(back, 'ok', `Saved "${fact.term}" — future comparisons will use it.`);
});

factsRoute.post('/facts/delete', async (c) => {
  const form = await c.req.parseBody();
  const term = typeof form.term === 'string' ? form.term : '';
  const back = safeBack(form.back, '/resumes');
  if (term.trim().length === 0) return c.text('Bad fact', 400);
  await deleteFact(term);
  return flashRedirect(back, 'ok', `Forgot "${term.trim().toLowerCase()}".`);
});
