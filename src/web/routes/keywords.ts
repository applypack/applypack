import { Hono } from 'hono';
import { idParam } from '../params';
import { z } from 'zod';
import { prisma } from '../../db';
import { loadKeywordMatcher } from '../../resume/keyword-matcher';
import { addKeyword, editKeyword, type EditResult } from '../../resume/keyword-overrides';
import { readKeywords, type MatchKeyword } from '../../resume/prompts';
import { REQUIREMENT_LEVELS, type RequirementLevel } from '../../resume/score';
import { getMatch, rescoreMatchKeywords } from '../../resume/store';
import { flashRedirect, safeBack } from '../flash';
import type { MessageKey } from '../../i18n/catalog';
import { t } from '../../i18n/t';

/*
 * Per-keyword overrides (target-plan.md §5). Re-levelling, ignoring and adding
 * a term are the user's judgment, not the model's: the edit lands in the
 * comparison's own `keywords` JSON and the score is recomputed right here by
 * score.ts — the same free, instant path a confirmed ask_user fact takes
 * (routes/facts.ts). No AI call is made or needed.
 */

/** The level a keyword is added at when the form names none. */
const DEFAULT_LEVEL: RequirementLevel = 'preferred';

const KeywordFormSchema = z.object({
  op: z.enum(['level', 'ignore', 'restore', 'reset', 'add']),
  term: z.string().trim().min(1).max(100),
  requirement: z.enum(REQUIREMENT_LEVELS).optional(),
  back: z.string().optional(),
});

type KeywordOp = z.infer<typeof KeywordFormSchema>['op'];

/** The flash for each edit: what happened and what it did to the score, one sentence. */
const DONE = {
  add: 'keyword.flash.added',
  level: 'keyword.flash.levelled',
  ignore: 'keyword.flash.ignored',
  restore: 'keyword.flash.restored',
} as const satisfies Partial<Record<KeywordOp, MessageKey>>;

function doneFlash(
  op: KeywordOp,
  result: { term: string; removed: boolean },
  requirement: RequirementLevel | undefined,
  score: { before: number; after: number },
): string {
  // A reset of a keyword the user added takes it off the list; of any other, it gives the AI's verdict back.
  const key = op === 'reset' ? (result.removed ? 'keyword.flash.removed' : 'keyword.flash.reset') : DONE[op];
  return t(key, {
    term: result.term,
    level: requirement ? t(`keyword.level.${requirement}`) : '',
    moved: score.before === score.after ? 'no' : 'yes',
    before: score.before,
    after: score.after,
  });
}

export const keywordsRoute = new Hono();

keywordsRoute.post('/jobs/:id/matches/:matchId/keywords', async (c) => {
  const id = idParam(c.req.param('id'));
  const matchId = idParam(c.req.param('matchId'));
  if (!Number.isFinite(id) || !Number.isFinite(matchId)) return c.text(t('http.badId'), 400);
  const parsed = KeywordFormSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) return c.text(t('http.badKeywordEdit'), 400);
  const form = parsed.data;
  const back = safeBack(form.back, `/jobs/${id}?match=${matchId}#resume-match`);

  const existing = await getMatch(matchId);
  if (!existing || existing.jobId !== id) return c.text(t('http.notFound'), 404);

  // The edit itself is pure; everything it needs from the database is loaded
  // here, before the lock, so the row below is held for the length of a
  // function call and nothing else.
  let edit: (keywords: MatchKeyword[], resumeText: string) => EditResult;
  if (form.op === 'add') {
    const [job, matcher] = await Promise.all([
      prisma.job.findUnique({ where: { id }, select: { title: true, description: true } }),
      loadKeywordMatcher(),
    ]);
    if (!job) return c.text(t('http.notFound'), 404);
    const requirement = form.requirement ?? DEFAULT_LEVEL;
    // The same posting text the anchor pass reads, so "not in posting" means
    // the same thing whoever added the term.
    const posting = `${job.title}\n${job.description}`;
    edit = (keywords, resumeText) =>
      addKeyword(keywords, { term: form.term, requirement }, { resumeText, posting, matcher });
  } else {
    if (form.op === 'level' && !form.requirement) return c.text(t('http.badKeywordEdit'), 400);
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

  if (!outcome) return c.text(t('http.notFound'), 404);
  const result = outcome.detail;
  if (!result.ok) return flashRedirect(back, 'err', result.error);
  if (!outcome.scored) {
    return flashRedirect(back, 'warn', t('keyword.flash.predates'));
  }
  // An added keyword with no level on the form took the default one above.
  const level = form.op === 'add' ? (form.requirement ?? DEFAULT_LEVEL) : form.requirement;
  return flashRedirect(back, 'ok', doneFlash(form.op, result, level, outcome));
});
