/*
 * Which resume to compare against a job by default: the one whose scanned
 * skill tags show up most in the posting. Pure heuristic, no AI — it only
 * preselects the dropdown; the user can override.
 */

export interface PickableResume {
  id: number;
  skills: string[];
  isDefault: boolean;
}

export function pickResumeForJob<T extends PickableResume>(resumes: T[], jobText: string): T | null {
  if (resumes.length === 0) return null;
  const haystack = tokenise(jobText);
  const scored = resumes.map((r) => ({ r, score: countSkillHits(r.skills, haystack) }));
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.r.isDefault) - Number(a.r.isDefault) ||
      a.r.id - b.r.id,
  );
  return scored[0]?.r ?? null;
}

/**
 * What a job page preselects. A profile that names its resume has already
 * answered the question — "this search hunts jobs I'd apply to with THIS CV"
 * (docs/onboarding-plan.md §4) — so the link wins over the heuristic. A link
 * to a resume that is gone or hidden falls back to the overlap pick, which is
 * also what every unlinked profile gets.
 */
export function preselectResume<T extends PickableResume>(
  resumes: T[],
  jobText: string,
  linkedResumeId: number | null,
): T | null {
  const linked = resumes.find((r) => r.id === linkedResumeId);
  return linked ?? pickResumeForJob(resumes, jobText);
}

/** Number of skill tags that appear in the text as whole tokens. Exported for tests. */
export function countSkillHits(skills: string[], text: string): number {
  const haystack = tokenise(text);
  let hits = 0;
  for (const skill of new Set(skills.map((s) => tokenise(s).trim()))) {
    if (skill.length > 0 && haystack.includes(` ${skill} `)) hits++;
  }
  return hits;
}

/** Lowercase, one space between tokens, dots kept inside tokens ("node.js") but not at the end ("PostgreSQL."). */
function tokenise(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ')} `.replace(/\.+(?= )/g, '');
}
