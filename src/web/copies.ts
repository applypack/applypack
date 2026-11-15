/*
 * One posting listed by several sources is stored once per source and linked
 * by `Job.crossListedOfJobId` (ADR 0018). A short list of matches (the
 * Overview's Recent matches, setup's Top of the list) shows such a posting
 * once (#529). Pure.
 *
 * A link alone is not proof: two different roles at one company can share
 * enough boilerplate to be linked, so a copy is folded only when its title
 * reads as its original's.
 */

interface MaybeCopy {
  id: number;
  title: string;
  crossListedOfJobId: number | null;
  crossListedOf: { title: string } | null;
}

function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** The posting a row stands for: its original when it is a copy under the same title, else itself. */
function postingOf(row: MaybeCopy): number {
  return row.crossListedOfJobId !== null && row.crossListedOf !== null && titleKey(row.crossListedOf.title) === titleKey(row.title)
    ? row.crossListedOfJobId
    : row.id;
}

/**
 * The first `limit` postings of `rows`, each once, in the rows' own order. A
 * posting is shown as its original when the rows hold it, else as the first
 * copy met.
 */
export function withoutCopies<T extends MaybeCopy>(rows: readonly T[], limit: number): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const seen = new Set<number>();
  const out: T[] = [];
  for (const row of rows) {
    const posting = postingOf(row);
    if (seen.has(posting)) continue;
    seen.add(posting);
    out.push(byId.get(posting) ?? row);
    if (out.length === limit) break;
  }
  return out;
}

/** How many rows to read for a list of `limit` postings, so folding copies still fills it. */
export function rowsToRead(limit: number): number {
  return limit * COPY_ALLOWANCE;
}

/** Measured in #529: one posting came through four sources. */
const COPY_ALLOWANCE = 4;
