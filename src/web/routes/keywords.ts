import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../../db';
import { loadKeywordMatcher } from '../../resume/keyword-matcher';
import { addKeyword, editKeyword, type EditResult } from '../../resume/keyword-overrides';
import { readKeywords, type MatchKeyword } from '../../resume/prompts';
import { REQUIREMENT_LEVELS } from '../../resume/score';
import { getMatch, rescoreMatchKeywords } from '../../resume/store';
import { flashRedirect, safeBack } from '../flash';

/*
 * Per-keyword overrides (target-plan.md §5). Re-levelling, ignoring and adding
 * a term are the user's judgment, not the model's: the edit lands in the
 * comparison's own `keywords` JSON and the score is recomputed right here by
 * score.ts — the same free, instant path a confirmed ask_user fact takes
 * (routes/facts.ts). No AI call is made or needed.
 */

const KeywordFormSchema = z.object({
  op: z.enum(['level', 'ignore', 'restore', 'reset', 'add']),
  term: z.string().trim().min(1).max(100),
  requirement: z.enum(REQUIREMENT_LEVELS).optional(),
  back: z.string().optional(),
});

/** What the flash says happened, before the score half of the sentence. */
function describe(
  op: z.infer<typeof KeywordFormSchema>['op'],
  result: { term: string; removed: boolean },
  requirement: string | undefined,
): string {
  const term = result.term;
  switch (op) {
    case 'add':
      return `Added "${term}" as ${requirement}`;
    case 'level':
      return `"${term}" is now ${requirement}`;
    case 'ignore':
      return `Ignoring "${term}"`;
    case 'restore':
      return `"${term}" counts again`;
    default:
      return result.removed ? `Removed "${term}"` : `"${term}" back to the AI's own verdict`;
  }
}

export const keywordsRoute = new Hono();

keywordsRoute.post('/jobs/:id/matches/:matchId/keywords', async (c) => {
  const id = Number(c.req.param('id'));
  const matchId = Number(c.req.param('matchId'));
  if (!Number.isFinite(id) || !Number.isFinite(matchId)) return c.text('Bad id', 400);
  const parsed = KeywordFormSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) return c.text('Bad keyword edit', 400);
  const form = parsed.data;
  const back = safeBack(form.back, `/jobs/${id}?match=${matchId}#resume-match`);

  const existing = await getMatch(matchId);
  if (!existing || existing.jobId !== id) return c.text('Not found', 404);

  // The edit itself is pure; everything it needs from the database is loaded
  // here, before the lock, so the row below is held for the length of a
  // function call and nothing else.
  let edit: (keywords: MatchKeyword[], resumeText: string) => EditResult;
  if (form.op === 'add') {
    const [job, matcher] = await Promise.all([
      prisma.job.findUnique({ where: { id }, select: { title: true, description: true } }),
      loadKeywordMatcher(),
    ]);
    if (!job) return c.text('Not found', 404);
    const requirement = form.requirement ?? 'preferred';
    // The same posting text the anchor pass reads, so "not in posting" means
    // the same thing whoever added the term.
    const posting = `${job.title}\n${job.description}`;
    edit = (keywords, resumeText) =>
      addKeyword(keywords, { term: form.term, requirement }, { resumeText, posting, matcher });
  } else {
    if (form.op === 'level' && !form.requirement) return c.text('Bad keyword edit', 400);
    const op = form.op;
    edit = (keywords) => editKeyword(keywords, { op, term: form.term, requirement: form.requirement });
  }

  // Read, edit and write under one row lock: the same JSON is rewritten by
  // /facts and by the next re-run, and the loser of an unlocked race lost an
  // edit outright.
  const outcome = await rescoreMatchKeywords<EditResult>(matchId, (match) => {
    const result = edit(readKeywords(match.keywords), match.resumeText);
    return { keywords: result.ok ? result.keywords : null, detail: result };
  });

  if (!outcome) return c.text('Not found', 404);
  const result = outcome.detail;
  if (!result.ok) return flashRedirect(back, 'err', result.error);
  if (!outcome.scored) {
    return flashRedirect(back, 'warn', 'This comparison predates the deterministic score — run Compare again to edit its keywords.');
  }
  const score =
    outcome.after === outcome.before
      ? `score stays ${outcome.after}`
      : `score ${outcome.before} → ${outcome.after}`;
  return flashRedirect(back, 'ok', `${describe(form.op, result, form.requirement)} — ${score}, no AI call.`);
});
