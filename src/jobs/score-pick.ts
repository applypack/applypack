import type { FilterProfile } from '../filter';

/*
 * Which stored-unscored jobs the wizard's "Score" pass spends AI on first.
 * The base filter only answers yes/no; this ranks the yeses so a batch of
 * ten is the ten most likely matches rather than the ten most recent. Pure
 * — tested in score-pick.test.ts.
 */

/** One press of "Score the jobs we found" — small on purpose: a CLI engine
 *  needs ~15-30 s per job, so ten is a coffee, a hundred is an afternoon. */
export const SCORE_BATCH = 10;

export interface ScorableJob {
  id: number;
  title: string;
  description: string;
  fetchedAt: Date;
}

export interface RankedJob {
  id: number;
  /** Distinct profile terms found; higher is scored first. */
  hits: number;
}

/** Word-boundary match that survives "Node.js", "C++" and "full-stack". */
function mentions(haystack: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (t.length === 0) return false;
  const i = haystack.indexOf(t);
  if (i === -1) return false;
  const before = haystack[i - 1];
  const after = haystack[i + t.length];
  const isWord = (ch: string | undefined): boolean => ch !== undefined && /[a-z0-9]/.test(ch);
  return !isWord(before) && !isWord(after);
}

/**
 * Ranks by how much of the profile the posting actually mentions: a title
 * hit counts double (that is what the base filter gates on), description
 * hits count once, and required stack outweighs role words. Ties keep the
 * newer posting.
 */
export function rankByProfileFit(
  jobs: readonly ScorableJob[],
  profile: Pick<FilterProfile, 'stackRequired' | 'roleTypes'> & { stackNiceToHave?: string[] },
): RankedJob[] {
  const weighted: { terms: string[]; weight: number }[] = [
    { terms: profile.stackRequired, weight: 3 },
    { terms: profile.roleTypes, weight: 2 },
    { terms: profile.stackNiceToHave ?? [], weight: 1 },
  ];
  return jobs
    .map((job) => {
      const title = job.title.toLowerCase();
      const body = job.description.toLowerCase();
      let hits = 0;
      for (const { terms, weight } of weighted) {
        for (const term of terms) {
          if (mentions(title, term)) hits += weight * 2;
          else if (mentions(body, term)) hits += weight;
        }
      }
      return { id: job.id, hits, fetchedAt: job.fetchedAt.getTime() };
    })
    .sort((a, b) => b.hits - a.hits || b.fetchedAt - a.fetchedAt || b.id - a.id)
    .map(({ id, hits }) => ({ id, hits }));
}
