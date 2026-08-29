import { Hono } from 'hono';
import { z } from 'zod';
import { applyFacts } from '../../resume/facts';
import { readKeywords } from '../../resume/prompts';
import { readBreakdown, scoreMatch } from '../../resume/score';
import { deleteFact, getMatch, updateMatchScoring, upsertFact } from '../../resume/store';
import { flashRedirect } from '../flash';

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

/** Local paths only — no open redirects. */
function safeBack(back: string): string {
  return back.startsWith('/') && !back.startsWith('//') ? back : '/resumes';
}

export const factsRoute = new Hono();

factsRoute.post('/facts', async (c) => {
  const parsed = FactFormSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) return c.text('Bad fact', 400);
  const f = parsed.data;
  const back = safeBack(f.back);
  const note = f.note.trim().slice(0, 300) || null;
  const fact = await upsertFact(f.term, f.decision, note);

  if (f.matchId) {
    const match = await getMatch(f.matchId);
    if (match) {
      const keywords = readKeywords(match.keywords);
      const { keywords: next, changed } = applyFacts(keywords, [fact]);
      const bd = readBreakdown(match.breakdown);
      if (changed > 0 && bd) {
        const newBd = scoreMatch(next, bd.alignment, match.redFlags.length);
        await updateMatchScoring(match.id, { keywords: next, breakdown: newBd });
        return flashRedirect(
          back,
          'ok',
          `Saved "${fact.term}" — score ${bd.score} → ${newBd.score}, no AI call needed.`,
        );
      }
      if (changed > 0) {
        return flashRedirect(back, 'ok', `Saved "${fact.term}". Re-analyze to refresh this comparison.`);
      }
    }
  }
  return flashRedirect(back, 'ok', `Saved "${fact.term}" — future comparisons will use it.`);
});

factsRoute.post('/facts/delete', async (c) => {
  const form = await c.req.parseBody();
  const term = typeof form.term === 'string' ? form.term : '';
  const back = safeBack(typeof form.back === 'string' ? form.back : '/resumes');
  if (term.trim().length === 0) return c.text('Bad fact', 400);
  await deleteFact(term);
  return flashRedirect(back, 'ok', `Forgot "${term.trim().toLowerCase()}".`);
});
