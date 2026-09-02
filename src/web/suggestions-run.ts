import type { ResumeMatch } from '@prisma/client';
import type { MatchJobInput } from '../resume/prompts';
import { suggestForMatch } from '../resume/suggestions';
import { createRun, startRun, updateRun } from './target-runs';

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
  const run = createRun({
    steps: ['suggestions'],
    jobTitle: job.title,
    resumeName: input.resumeName,
    jobId: job.id,
    backUrl: input.resultUrl,
    backLabel: 'Back to the comparison',
  });
  startRun(run.id, async () => {
    const row = await suggestForMatch(match, job);
    updateRun(
      run.id,
      row
        ? {
            stage: 'done',
            resultUrl: input.resultUrl,
            flash: `Suggestions added — ${countOf(row.actions)} edits, ${countOf(row.removals)} removals; the score is unchanged.`,
          }
        : { stage: 'error', error: 'The suggestions call failed — the quick check is still there. See the web logs.' },
    );
  });
  return `/target/runs/${run.id}`;
}

function countOf(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}
