import type { ResumeMatch } from '@prisma/client';
import { SUGGESTIONS_FAILED, suggestionsFlash } from '../resume/match-reuse';
import { readActions, readRemovals, type MatchJobInput } from '../resume/prompts';
import { suggestForMatch } from '../resume/suggestions';
import { claimRun, startRun, updateRun } from './target-runs';

/** The name the suggestions work for one comparison is claimed under (issue #76). */
export function suggestionsKey(matchId: number): string {
  return `suggestions:${matchId}`;
}

/**
 * The lazy second call as a progress-page run (ADR 0029): "Get suggestions"
 * on a quick check, and the answer to a full analysis asked of a text whose
 * quick check is already stored. Returns the run URL to redirect to.
 */
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
  startRun(run.id, () => finishSuggestions(run.id, { match, job, resultUrl: input.resultUrl }));
  return `/target/runs/${run.id}`;
}

/**
 * The suggestions call as the rest of a run already on screen — its own run
 * above, or a comparison whose memo found a stored quick check. `when` is the
 * stored row's age, for the flash.
 */
export async function finishSuggestions(
  runId: string,
  input: { match: ResumeMatch; job: MatchJobInput & { id: number }; resultUrl: string; when?: string },
): Promise<void> {
  let reason = '';
  const row = await suggestForMatch(input.match, input.job, (r) => {
    reason = r;
  });
  updateRun(
    runId,
    row
      ? {
          stage: 'done',
          resultUrl: input.resultUrl,
          flash: suggestionsFlash({ actions: readActions(row.actions).length, removals: readRemovals(row.removals).length }, input.when),
        }
      : { stage: 'error', error: reason ? `${SUGGESTIONS_FAILED.replace(/\.$/, '')}: ${reason}.` : SUGGESTIONS_FAILED },
  );
}
