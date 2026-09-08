import { logger } from '../logger';
import { prisma } from '../db';
import { anchorStatuses } from '../resume/keyword-anchor';
import { loadKeywordMatcher, type KeywordMatcher } from '../resume/keyword-matcher';
import { readKeywords, type MatchKeyword } from '../resume/prompts';
import { readBreakdown } from '../resume/score';
import { rescoreMatchKeywords } from '../resume/store';

/*
 * One-shot backfill for ADR 0045: a stored comparison that calls a term
 * `cannot_claim` while its own text snapshot spells it gets that term set to
 * `present`, and is re-scored through the write path a keyword edit already
 * uses (`rescoreMatchKeywords`: row lock, countable flags, the breakdown's
 * markers kept). Only that flip — the one the ADR adds. Rows from before the
 * 0044 addendum were never anchored at all, and the present → add half of the
 * rule would move their scores retroactively for a reason that is not this
 * one, so they keep the statuses they were scored under. Rows from before the
 * deterministic score (ADR 0012) are left alone. No AI call, no other field
 * touched. Idempotent. --dry-run reads only.
 *
 * Usage: node dist/scripts/reanchor-matches.js [--dry-run]
 */

const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const matcher = await loadKeywordMatcher();
  const rows = await prisma.resumeMatch.findMany({
    select: { id: true, matchScore: true, keywords: true, resumeText: true, breakdown: true },
    orderBy: { id: 'asc' },
  });

  let changed = 0;
  for (const row of rows) {
    if (!readBreakdown(row.breakdown)) continue;
    const flipped = writtenCannotClaims(readKeywords(row.keywords), row.resumeText, matcher).map((k) => k.term);
    if (flipped.length === 0) continue;
    changed++;
    if (DRY_RUN) {
      logger.info({ matchId: row.id, score: row.matchScore, flipped }, 'reanchor-matches: would re-score');
      continue;
    }
    // The edit runs again inside the lock, on the row as it is then.
    const outcome = await rescoreMatchKeywords(row.id, (match) => {
      const keywords = readKeywords(match.keywords);
      const flips = new Set(writtenCannotClaims(keywords, match.resumeText, matcher));
      return { keywords: keywords.map((k) => (flips.has(k) ? { ...k, status: 'present' as const } : k)), detail: null };
    });
    logger.info(
      { matchId: row.id, before: outcome?.before, after: outcome?.after, flipped },
      'reanchor-matches: re-scored',
    );
  }

  logger.info({ matches: rows.length, changed, dryRun: DRY_RUN }, 'reanchor-matches: done');
}

/** The rows anchorStatuses would lift from `cannot_claim` — and nothing else it would move. */
function writtenCannotClaims(keywords: MatchKeyword[], resumeText: string, matcher: KeywordMatcher): MatchKeyword[] {
  const anchored = anchorStatuses(keywords, resumeText, matcher).keywords;
  return keywords.filter((k, i) => k.status === 'cannot_claim' && anchored[i]?.status === 'present');
}

main()
  .catch((err) => {
    logger.error({ err }, 'reanchor-matches: failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
