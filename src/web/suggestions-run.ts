import type { ResumeMatch } from '@prisma/client';
import { SUGGESTIONS_FAILED, suggestionsFlash } from '../resume/match-reuse';
import { readActions, readRemovals, type MatchJobInput } from '../resume/prompts';
import { suggestForMatch } from '../resume/suggestions';
import { claimRun, startRun, updateRun } from './target-runs';

/**
 * The lazy second call as a progress-page run (ADR 0029): "Get suggestions"
 * on a quick check, and the answer to a full analysis asked of a text whose
 * quick check is already stored. Returns the run URL to redirect to.
 */
/** The name the suggestions work for one comparison is claimed under (issue #76). */
export function suggestionsKey(matchId: number): string {
  return `suggestions:${matchId}`;
}

export function startSuggestionsRun(input: {
  match: ResumeMatch;
  job: MatchJobInput & { id: number };
  resumeName: string;
  resultUrl: string;
}): string {
  const { match, job } = input;
  // One comparison can only be completed once: a second "Get suggestions" —
  // another tab, a reload — joins the call in flight (issue #76).
  const { run, joined } = claimRun(suggestionsKey(match.id), {
    steps: ['suggestions'],
    jobTitle: job.title,
    resumeName: input.resumeName,
    jobId: job.id,
    backUrl: input.resultUrl,
    backLabel: 'Back to the comparison',
  });
  if (joined) return `/target/runs/${run.id}`;
  startRun(run.id, async () => {
    const row = await suggestForMatch(match, job);
    updateRun(
      run.id,
      row
        ? {
            stage: 'done',
            resultUrl: input.resultUrl,
            flash: suggestionsFlash({ actions: readActions(row.actions).length, removals: readRemovals(row.removals).length }),
          }
        : { stage: 'error', error: SUGGESTIONS_FAILED },
    );
  });
  return `/target/runs/${run.id}`;
}
