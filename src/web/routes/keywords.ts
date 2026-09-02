import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../../db';
import { loadKeywordMatcher } from '../../resume/keyword-matcher';
import {
  addKeyword,
  editKeyword,
  effectiveKeywords,
  type EditResult,
} from '../../resume/keyword-overrides';
import { readFrameReason } from '../../resume/keyword-frame';
import { readMatchMode } from '../../resume/match-mode';
import { readPromptVersion } from '../../resume/match-reuse';
import { readKeywords } from '../../resume/prompts';
import { readBreakdown, REQUIREMENT_LEVELS, scoreMatch } from '../../resume/score';
import { getMatch, updateMatchScoring } from '../../resume/store';
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

  const match = await getMatch(matchId);
  if (!match || match.jobId !== id) return c.text('Not found', 404);
  const breakdown = readBreakdown(match.breakdown);
  if (!breakdown) {
    return flashRedirect(back, 'warn', 'This comparison predates the deterministic score — run Compare again to edit its keywords.');
  }

  const keywords = readKeywords(match.keywords);
  let result: EditResult;
  if (form.op === 'add') {
    const [job, matcher] = await Promise.all([
      prisma.job.findUnique({ where: { id }, select: { title: true, description: true } }),
      loadKeywordMatcher(),
    ]);
    if (!job) return c.text('Not found', 404);
    const requirement = form.requirement ?? 'preferred';
    result = addKeyword(
      keywords,
      { term: form.term, requirement },
      // The same posting text the anchor pass reads, so "not in posting" means
      // the same thing whoever added the term.
      { resumeText: match.resumeText, posting: `${job.title}\n${job.description}`, matcher },
    );
  } else {
    if (form.op === 'level' && !form.requirement) return c.text('Bad keyword edit', 400);
    result = editKeyword(keywords, { op: form.op, term: form.term, requirement: form.requirement });
  }
  if (!result.ok) return flashRedirect(back, 'err', result.error);

  const next = scoreMatch(effectiveKeywords(result.keywords), breakdown.alignment, match.redFlags.length);
  await updateMatchScoring(match.id, {
    keywords: result.keywords,
    breakdown: next,
    promptVersion: readPromptVersion(match.breakdown),
    mode: readMatchMode(match.breakdown),
    frame: readFrameReason(match.breakdown),
  });
  const score =
    next.score === match.matchScore ? `score stays ${next.score}` : `score ${match.matchScore} → ${next.score}`;
  return flashRedirect(back, 'ok', `${describe(form.op, result, form.requirement)} — ${score}, no AI call.`);
});
