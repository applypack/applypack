import type { Resume } from '@prisma/client';
import { findReusableMatch, matchResumeToJob } from '../resume/match';
import { reuseNotice } from '../resume/match-reuse';
import type { MatchJobInput } from '../resume/prompts';
import { hashShortId } from '../text-utils';
import { formatRelative } from './format';
import { claimRun, startRun, updateRun, type TargetRun } from './target-runs';

/**
 * The quick AI check of a text that just landed in the editor as a draft
 * (#184): a draft row over the resume's current version — no new version, no
 * scan — that the page follows through the run's state and offers when it
 * lands. A text already judged is answered from the stored row; the same
 * text twice joins the run in flight. Started by the re-upload on the editor
 * and by the Compare page when a known resume's text changed.
 */
export function startDraftCheck(input: {
  job: MatchJobInput & { id: number };
  resume: Pick<Resume, 'id' | 'name' | 'text' | 'version'>;
  text: string;
}): TargetRun {
  const { job, resume, text } = input;
  const { run, joined } = claimRun(`check:${job.id}:${resume.id}:${hashShortId(text)}`, {
    steps: ['keywords'],
    jobTitle: job.title,
    resumeName: resume.name,
    jobId: job.id,
    backUrl: `/jobs/${job.id}/target`,
    backLabel: 'Back to the editor',
  });
  if (joined) return run;
  startRun(run.id, async () => {
    const reused = await findReusableMatch(job.id, resume.id, text, 'fast');
    if (reused) {
      updateRun(run.id, {
        stage: 'done',
        resultUrl: `/jobs/${job.id}/target?match=${reused.row.id}`,
        results: { keywords: `AI match ${reused.row.matchScore}/100 — the same text was judged ${formatRelative(reused.row.createdAt)}` },
        flash: reuseNotice(formatRelative(reused.row.createdAt)),
        reused: true,
      });
      return;
    }
    const row = await matchResumeToJob({ id: resume.id, text, version: resume.version }, job, { draft: text !== resume.text });
    updateRun(
      run.id,
      row
        ? {
            stage: 'done',
            resultUrl: `/jobs/${job.id}/target?match=${row.id}`,
            results: { keywords: `AI match ${row.matchScore}/100` },
            flash: `Checked — AI match ${row.matchScore}/100.`,
          }
        : { stage: 'error', error: 'The AI check failed — see the web logs.' },
    );
  });
  return run;
}
