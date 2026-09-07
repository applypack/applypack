import { canonicalTerm } from './facts';
import type { MatchKeyword, PostingBrief } from './prompts';

/*
 * Persist-time guard over the one model-written field the score folds on
 * (ADR 0044). `foldGroups` charges ONE must-weight for every keyword sharing a
 * group label, so a label the model invented — or copied onto a term the group
 * never listed — quietly halves the weight of two independent requirements.
 *
 * The brief decides what a group is; this pass keeps a keyword's label only
 * when the brief has that group AND names that term in it, and drops every
 * label when there is no brief, because nothing authorised one. Pure — the
 * brief comes in as an argument. Every keyword leaves with an explicit
 * `group`, null included, so a stored row never mixes "no group" with "written
 * before groups existed".
 */

export interface GroupReport {
  keywords: MatchKeyword[];
  /** Labels the reply carried that the brief does not back. */
  dropped: number;
}

export function reconcileGroups(keywords: MatchKeyword[], brief: PostingBrief | null | undefined): GroupReport {
  const groups = new Map<string, Set<string>>();
  for (const g of brief?.requirement_groups ?? []) {
    groups.set(g.label.trim().toLowerCase(), new Set(g.options.map(canonicalTerm)));
  }
  let dropped = 0;
  const next = keywords.map((k) => {
    const label = k.group?.trim().toLowerCase();
    if (!label) return { ...k, group: null };
    // An anchored term is spelled the way the POSTING spells it, which need
    // not be the brief's spelling of the same option (React ↔ React.js).
    const term = canonicalTerm(k.term);
    const options = groups.get(label);
    if (options && [...options].some((o) => sameThing(o, term))) return k;
    dropped++;
    return { ...k, group: null };
  });
  return { keywords: next, dropped };
}

/** One canonical term is the other with a suffix the ecosystem treats as noise ("react" ↔ "react.js"). */
function sameThing(a: string, b: string): boolean {
  const strip = (s: string) => s.replace(/(\.js|js|\.net)$/, '');
  return a === b || strip(a) === strip(b);
}
