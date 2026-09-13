import type { Context } from 'hono';
import { hashShortId } from '../text-utils';
import { briefForPosting, briefLine } from '../resume/brief';
import { findReusableMatch, matchResumeToJob } from '../resume/match';
import type { MatchMode } from '../resume/match-mode';
import { reuseNotice } from '../resume/match-reuse';
import type { MatchJobInput } from '../resume/prompts';
import { flashRedirect } from './flash';
import { formatRelative } from './format';
import { startSuggestionsRun } from './suggestions-run';
import { claimRun, matchStep, runFailure, startRun, updateRun } from './target-runs';

/**
 * One comparison of one text against one stored posting, run on the progress
 * page. Shared by the job page's Compare, the editor's Re-check and re-upload,
 * and Compare's "One of your jobs", so all of them behave the same: the memo
 * answers a repeat for free, a second submit of the same thing joins the run
 * in flight, and the finished run lands the user on the analysis it just wrote.
 */
export interface ComparisonRequest {
  jobId: number;
  job: MatchJobInput & { id: number };
  resume: { id: number; name: string; version: number; text: string };
  /** The text to judge: the stored version, the editor's draft, or a fresh upload. */
  text: string;
  mode: MatchMode;
  rebuild: boolean;
  force: boolean;
  /** Where a finished run sends the user. */
  resultUrl: (matchId: number) => string;
  /** What the done-flash calls the text — a filename, "Draft", the resume's name. */
  label: string;
}

export async function startComparison(c: Context, req: ComparisonRequest): Promise<Response> {
  const { jobId, job, resume, text, mode, rebuild, force } = req;
  const draft = text !== resume.text;

  // The same text was already judged: show that analysis instead of paying for
  // it again — unless "Re-run anyway" or a rebuild asked for a fresh call. A
  // rebuild that hit the memo would hand back the very frame it was asked to
  // replace. A full report asked of a stored quick check needs only the
  // suggestions call.
  if (!force && !rebuild) {
    const reused = await findReusableMatch(jobId, resume.id, text, mode);
    if (reused?.decision === 'reuse') {
      return flashRedirect(req.resultUrl(reused.row.id), 'warn', reuseNotice(formatRelative(reused.row.createdAt)), {
        rerun: true,
        mode,
      });
    }
    if (reused) {
      return c.redirect(
        startSuggestionsRun({ match: reused.row, job, resumeName: resume.name, resultUrl: req.resultUrl(reused.row.id) }),
        303,
      );
    }
  }

  // Same job, same resume, same text, same mode is the same comparison, so a
  // second submit joins the run in flight rather than paying for it twice.
  const { run, joined } = claimRun(
    `match:${jobId}:${resume.id}:${mode}:${rebuild ? 'rebuild' : 'frame'}:${hashShortId(text)}`,
    { steps: ['brief', matchStep(mode)], jobTitle: job.title, resumeName: resume.name, jobId },
  );
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);
  startRun(run.id, async () => {
    // The posting read on its own, cached against its text (ADR 0044): on every
    // run but the first for this posting this step costs a lookup, which is what
    // makes re-checking an edited resume quick.
    updateRun(run.id, { stage: 'brief' });
    const briefed = await briefForPosting(job);
    if (briefed) {
      updateRun(run.id, {
        results: {
          brief: briefed.reused ? `Reused this posting's analysis — ${briefLine(briefed.brief)}` : briefLine(briefed.brief),
        },
      });
    }
    updateRun(run.id, { stage: matchStep(mode) });
    let reason = '';
    const row = await matchResumeToJob({ id: resume.id, name: resume.name, version: resume.version, text }, job, {
      draft,
      mode,
      rebuild,
      brief: briefed,
      onError: (r) => {
        reason = r;
      },
    });
    if (!row) {
      updateRun(run.id, { stage: 'error', error: runFailure('Comparison failed', reason) });
      return;
    }
    updateRun(run.id, {
      stage: 'done',
      resultUrl: req.resultUrl(row.id),
      tailorUrl: `/jobs/${jobId}/target?match=${row.id}`,
      results: { [matchStep(mode)]: `AI match ${row.matchScore}/100` },
      flash: rebuild
        ? `Keywords rebuilt from the posting — AI match ${row.matchScore}/100, counted over a fresh set of terms.`
        : `${req.label} ${mode === 'fast' ? 'checked' : 'compared'} — AI match ${row.matchScore}/100.`,
    });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
}
