import type { FilterProfile } from '../filter';

/*
 * Which stored-unscored jobs the wizard's "Score" pass spends AI on first.
 * The base filter only answers yes/no; this ranks the yeses so a batch of
 * ten is the ten most likely matches rather than the ten most recent, and
 * one posting listed by several feeds is one of the ten. Pure — tested in
 * score-pick.test.ts.
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

/** A row and the row it is a cross-listed copy of (ADR 0018), if any. */
export interface LinkedJob {
  id: number;
  crossListedOfJobId: number | null;
}

/**
 * The ids one press scores, best first (#529): a cross-listed copy of a
 * posting this batch already takes, or one already scored, waits behind every
 * other posting. Setup's "score the 10 best" spent 4 of its 10 calls on one
 * Lemon.io posting four feeds carried. A copy is not skipped: when nothing
 * else waits it is scored on its own merits, as the fetch scores it — ADR
 * 0018 never lets a copy inherit another row's verdict.
 *
 * `links` holds the rows whose links matter: the ranked ones and the scored
 * rows beside them, the ids in `scored`. A chain (a copy of a copy) is one
 * posting.
 */
export function pickBatch(
  ranked: readonly { id: number }[],
  links: readonly LinkedJob[],
  scored: ReadonlySet<number>,
  size: number,
): number[] {
  const postingOf = linkedRoots(links);
  const taken = new Set([...scored].map(postingOf));
  const first: number[] = [];
  const waiting: number[] = [];
  for (const { id } of ranked) {
    const posting = postingOf(id);
    if (taken.has(posting)) {
      waiting.push(id);
    } else {
      taken.add(posting);
      first.push(id);
    }
  }
  return [...first, ...waiting].slice(0, size);
}

/** The posting each id belongs to: a copy and what it copies share one root. */
function linkedRoots(links: readonly LinkedJob[]): (id: number) => number {
  const parent = new Map<number, number>();
  const root = (id: number): number => {
    let at = id;
    while (parent.has(at)) at = parent.get(at)!;
    return at;
  };
  for (const { id, crossListedOfJobId } of links) {
    if (crossListedOfJobId === null) continue;
    const a = root(id);
    const b = root(crossListedOfJobId);
    if (a !== b) parent.set(a, b);
  }
  return root;
}
