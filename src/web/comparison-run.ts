import type { Context } from 'hono';
import { hashShortId } from '../text-utils';
import { briefForPosting, briefLine } from '../resume/brief';
import { findReusableMatch, matchResumeToJob } from '../resume/match';
import type { MatchEvidence, MatchMode } from '../resume/match-mode';
import { reuseNotice } from '../resume/match-reuse';
import type { MatchJobInput } from '../resume/prompts';
import { flashRedirect } from './flash';
import { formatRelative } from './format';
import { finishSuggestions, startSuggestionsRun, suggestionsKey } from './suggestions-run';
import { alsoClaims, claimRun, matchStep, startRun, updateRun, type RunStep } from './target-runs';
import { runFailure } from './run-failure';
import { t } from '../i18n/t';

/**
 * One comparison of one text against one stored posting, run on the progress
 * page. Every comparison goes through here — the job page's Compare, the
 * editor's Re-check and re-upload, and both halves of the Tailor resume page (`/target`) — so
 * all of them behave the same: the memo answers a repeat for free, a second
 * submit of the same thing joins the run in flight, and the finished run lands
 * the user on the analysis it just wrote.
 */
export interface ComparisonRequest {
  jobId: number;
  job: MatchJobInput & { id: number };
  /** `name` is stored with the row (match-name.ts); `text` is the stored text a draft is measured against. */
  resume: { id: number; name: string; version: number; text: string };
  /** The text to judge: the stored version, the editor's draft, or a fresh upload. */
  text: string;
  mode: MatchMode;
  /** R1: the owner's facts and other resumes, or the text alone — a file on the Tailor resume page may not be theirs. */
  evidence: MatchEvidence;
  rebuild: boolean;
  force: boolean;
  /** Where a finished run sends the user. */
  resultUrl: (matchId: number) => string;
  /** What the done-flash calls the text — a filename, "Draft", the resume's name. */
  label: string;
  /** Set when the caller knows better than `text !== resume.text` — a one-off's re-run or a fresh file (match-name.ts). */
  draft?: boolean;
  /** A sentence the done-flash ends with ("the fit score is still being scored"). */
  doneNote?: string;
  /** What the run's error says went wrong before the model's reason. */
  failure?: string;
}

/** The job is already stored: answer from the memo without a run, or claim one and compare. */
export async function startComparison(c: Context, req: ComparisonRequest): Promise<Response> {
  const { jobId, job, resume, text, mode, rebuild } = req;

  // The same text was already judged: show that analysis instead of paying for
  // it again — unless "Re-run anyway" or a rebuild asked for a fresh call. A
  // rebuild that hit the memo would hand back the very frame it was asked to
  // replace. A full report asked of a stored quick check needs only the
  // suggestions call.
  if (!req.force && !rebuild) {
    const reused = await findReusableMatch(jobId, resume.id, text, mode, req.evidence);
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
  startRun(run.id, () => compare(run.id, req));
  return c.redirect(`/target/runs/${run.id}`, 303);
}

/**
 * The comparison inside a run the caller already claimed, for a caller with
 * work to do before the job exists — a pasted posting is detected and stored
 * first. The memo answers here too, on the progress page instead of by a
 * redirect: a stored analysis finishes the run, and a stored quick check runs
 * the suggestions call as this run's own last step. It answers to that
 * comparison's suggestions key as well, so "Get suggestions" pressed on it
 * meanwhile joins this run instead of calling the model twice (issue #76).
 * `lead` is the steps the run already showed before this one.
 */
export async function runComparison(runId: string, req: ComparisonRequest, lead: RunStep[] = []): Promise<void> {
  if (!req.force && !req.rebuild) {
    const reused = await findReusableMatch(req.jobId, req.resume.id, req.text, req.mode, req.evidence);
    if (reused?.decision === 'reuse') {
      updateRun(runId, {
        stage: 'done',
        resultUrl: req.resultUrl(reused.row.id),
        flash: reuseNotice(formatRelative(reused.row.createdAt)),
        reused: true,
      });
      return;
    }
    if (reused) {
      alsoClaims(runId, suggestionsKey(reused.row.id));
      updateRun(runId, { steps: [...lead, 'suggestions'], stage: 'suggestions' });
      await finishSuggestions(runId, {
        match: reused.row,
        job: req.job,
        resultUrl: req.resultUrl(reused.row.id),
        when: formatRelative(reused.row.createdAt),
      });
      return;
    }
  }
  await compare(runId, req);
}

/** The posting's reading, then one resume-model call, then the run's result. */
async function compare(runId: string, req: ComparisonRequest): Promise<void> {
  const { jobId, job, resume, text, mode, rebuild } = req;
  // The posting read on its own, cached against its text (ADR 0044): on every
  // run but the first for this posting this step costs a lookup, which is what
  // makes re-checking an edited resume quick.
  updateRun(runId, { stage: 'brief' });
  const briefed = await briefForPosting(job);
  // updateRun replaces `results`, so the lines are gathered here and the done step keeps the reading's.
  const results: Record<string, string> = {};
  if (briefed) {
    results.brief = briefed.reused ? t('target.run.briefReused', { line: briefLine(briefed.brief) }) : briefLine(briefed.brief);
    updateRun(runId, { results: { ...results } });
  }
  updateRun(runId, { stage: matchStep(mode) });
  let reason = '';
  const row = await matchResumeToJob({ id: resume.id, name: resume.name, version: resume.version, text }, job, {
    draft: req.draft ?? text !== resume.text,
    mode,
    evidence: req.evidence,
    rebuild,
    brief: briefed,
    onError: (r) => {
      reason = r;
    },
  });
  if (!row) {
    updateRun(runId, {
      stage: 'error',
      error: runFailure(req.failure ?? t('target.run.compareFailure'), reason, t('target.run.compareNext')),
    });
    return;
  }
  const flash = rebuild
    ? t('target.run.done.rebuilt', { score: row.matchScore })
    : t(mode === 'fast' ? 'target.run.done.checked' : 'target.run.done.compared', { label: req.label, score: row.matchScore });
  updateRun(runId, {
    stage: 'done',
    resultUrl: req.resultUrl(row.id),
    tailorUrl: `/jobs/${jobId}/target?match=${row.id}`,
    results: { ...results, [matchStep(mode)]: t('target.run.result.match', { score: row.matchScore }) },
    flash: req.doneNote ? `${flash} ${req.doneNote}` : flash,
  });
}
