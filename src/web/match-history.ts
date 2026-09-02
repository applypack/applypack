/*
 * Comparisons on a resume page, grouped by the posting they were run against
 * (TASKS §12 quick win).
 *
 * A flat list is the wrong shape once a resume has been re-checked: three runs
 * against the same job read as three unrelated rows, when what they actually
 * are is one story — 66, then 68 after the edits, then 71. Grouping turns the
 * table into that story and leaves every individual run reachable.
 *
 * Pure. The delta here is arithmetic on stored scores, never a re-score.
 */

export interface MatchRun {
  id: number;
  matchScore: number;
  resumeVersion: number;
  draft: boolean;
  createdAt: Date;
}

export interface JobHistory<J> {
  job: J;
  /** Newest first, like the flat list this replaces. */
  runs: MatchRun[];
  latest: MatchRun;
  /** The run before the latest, or null when this posting was checked once. */
  previous: MatchRun | null;
  /** Points gained since that run; null when there is nothing to compare with. */
  delta: number | null;
}

/**
 * Groups by job id, newest run first inside each group and the group with the
 * newest run first overall — so the page still opens on what just happened.
 */
export function groupMatchesByJob<J extends { id: number }>(
  matches: (MatchRun & { job: J })[],
): JobHistory<J>[] {
  const groups = new Map<number, { job: J; runs: MatchRun[] }>();
  for (const m of matches) {
    const group = groups.get(m.job.id) ?? { job: m.job, runs: [] };
    group.runs.push({
      id: m.id,
      matchScore: m.matchScore,
      resumeVersion: m.resumeVersion,
      draft: m.draft,
      createdAt: m.createdAt,
    });
    groups.set(m.job.id, group);
  }
  const out: JobHistory<J>[] = [];
  for (const { job, runs } of groups.values()) {
    const sorted = [...runs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const latest = sorted[0];
    if (!latest) continue;
    const previous = sorted[1] ?? null;
    out.push({
      job,
      runs: sorted,
      latest,
      previous,
      delta: previous ? latest.matchScore - previous.matchScore : null,
    });
  }
  return out.sort((a, b) => b.latest.createdAt.getTime() - a.latest.createdAt.getTime());
}

/**
 * The runs oldest first — the order the story happened in, which is not the
 * order the table lists them in. Empty for a posting checked once, where
 * there is no progression to show.
 */
export function progression<J>(history: JobHistory<J>): MatchRun[] {
  return history.runs.length < 2 ? [] : [...history.runs].reverse();
}

/** "5 runs" — the count that labels the progression. Null when there is one. */
export function historyLabel<J>(history: JobHistory<J>): string | null {
  return history.runs.length < 2 ? null : `${history.runs.length} runs`;
}
