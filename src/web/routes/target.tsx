/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { getAiRuntime } from '../../ai-runtime';
import { laneOf, type Lane } from '../lane';
import { z } from 'zod';
import { hashShortId } from '../../text-utils';
import { classifyInBackground } from '../../jobs/classify-existing';
import { createManualJob, ManualJobSchema, MAX_FIELD_CHARS, MIN_DESCRIPTION_CHARS } from '../../jobs/manual-job';
import { extractPostingFacts, fallbackTitle } from '../../jobs/posting-extract';
import { briefForPosting, briefLine } from '../../resume/brief';
import { findReusableMatch, matchResumeToJob } from '../../resume/match';
import { parseMatchMode } from '../../resume/match-mode';
import { reuseNotice, SUGGESTIONS_FAILED, suggestionsFlash } from '../../resume/match-reuse';
import { readActions, readRemovals } from '../../resume/prompts';
import {
  deleteCoverLettersForResume,
  getResume,
  listResumes,
  upsertScratchResume,
} from '../../resume/store';
import { suggestForMatch } from '../../resume/suggestions';
import { suggestionsKey } from '../suggestions-run';
import { TargetStartPage } from '../pages/target-start';
import { TargetRunPage } from '../pages/target-run';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { formatRelative } from '../format';
import { alsoClaims, claimRun, getRun, matchStep, startRun, updateRun, type RunStep, runFailure } from '../target-runs';
import {
  MAX_RESUME_NAME_CHARS,
  nameFromFilename,
  readResumeUpload,
  resumeUploadLimit,
} from '../upload';

const MIN_RESUME_CHARS = 200;

/* zod strips unknown keys, so the multipart `file` field is read from the raw form.
 * Company and title are optional here (unlike /jobs/new): when left empty they
 * are auto-detected from the description — client-side via /target/extract,
 * and again server-side below as the no-JS fallback. */
const TargetFormSchema = ManualJobSchema.extend({
  companyName: z.string().trim().max(MAX_FIELD_CHARS).default(''),
  title: z.string().trim().max(MAX_FIELD_CHARS).default(''),
  resumeMode: z.enum(['existing', 'upload', 'paste']),
  /** The quick check unless "Full analysis" was pressed (ADR 0029). */
  mode: z.unknown().transform(parseMatchMode),
  resumeId: z.coerce.number().int().optional(),
  resumeText: z.string().optional().default(''),
  uploadName: z.string().optional().default(''),
  pasteName: z.string().optional().default(''),
});

export const targetRoute = new Hono();

async function resumeRows() {
  return (await listResumes()).map((r) => ({
    id: r.id,
    name: r.name,
    isDefault: r.isDefault,
    version: r.version,
  }));
}

targetRoute.get('/target', async (c) => {
  return c.html(
    <TargetStartPage
      resumes={await resumeRows()}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

/** Polled by the progress page; terminal states reload into the redirect below. */
targetRoute.get('/target/runs/:id/state', (c) => {
  const run = getRun(c.req.param('id'));
  if (!run) return c.json({ gone: true }, 404);
  return c.json({
    stage: run.stage,
    steps: run.steps,
    jobTitle: run.jobTitle,
    progress: run.progress ?? null,
    results: run.results ?? {},
    resultUrl: run.resultUrl ?? null,
    error: run.error ?? null,
    stepMs: run.stepMs,
    stageElapsedMs: Date.now() - run.stageAt,
    elapsedMs: Date.now() - run.startedAt,
  });
});

/** The progress page: target-run.mjs polls the state route until the chain resolves. */
targetRoute.get('/target/runs/:id', async (c) => {
  const run = getRun(c.req.param('id'));
  if (!run) {
    return flashRedirect('/target', 'err', 'That comparison run is gone (runs live ~30 min). Start again.');
  }
  if (run.stage === 'done' && run.resultUrl) {
    return flashRedirect(run.resultUrl, run.flashKind ?? (run.reused ? 'warn' : 'ok'), run.flash ?? 'Done.', {
      rerun: run.reused,
      tailor: run.tailorUrl,
    });
  }
  return c.html(<TargetRunPage run={run} lane={await resumeLane()} />);
});

/** Engine × model the resume calls run on — the run page states its measured band (#184). */
async function resumeLane(): Promise<Lane> {
  const runtime = await getAiRuntime();
  const id = runtime.chain[0];
  return id ? laneOf(id, runtime.modelFor(id, 'resume')) : 'other';
}

targetRoute.post('/target', resumeUploadLimit('/target'), async (c) => {
  const form = await c.req.parseBody();
  const parsed = TargetFormSchema.safeParse(form);
  if (!parsed.success) {
    return flashRedirect(
      '/target',
      'err',
      `A description of at least ${MIN_DESCRIPTION_CHARS} characters is required.`,
    );
  }
  const f = parsed.data;

  // Empty company / title / location are detected from the description INSIDE
  // the run — a visible "Detect posting facts" step. Detection never blocks:
  // unfound facts fall back to defaults the user can see on the job.
  let { companyName, title, location, salaryMin, salaryMax } = f;
  const needExtract = !companyName || !title || !location;

  // Resolve the resume inline (fast, and bad files fail before anything runs).
  // Upload / paste land on the hidden scratch row — /target is a pure
  // comparison and never adds rows to the user's Resumes.
  let resume: { id: number; name: string; version: number; text: string; ephemeral: boolean };
  if (f.resumeMode === 'existing') {
    if (!f.resumeId) return flashRedirect('/target', 'err', 'Pick a resume from the list.');
    const row = await getResume(f.resumeId);
    if (!row || row.hidden) return flashRedirect('/target', 'err', 'That resume no longer exists.');
    resume = { ...row, ephemeral: false };
  } else if (f.resumeMode === 'upload') {
    const upload = await readResumeUpload(form);
    if ('error' in upload) return flashRedirect('/target', 'err', upload.error);
    const name =
      f.uploadName.trim().slice(0, MAX_RESUME_NAME_CHARS) ||
      nameFromFilename(upload.sourceFilename);
    resume = { ...(await upsertScratchResume({ name, ...upload })), ephemeral: true };
  } else {
    const text = f.resumeText.replace(/\r\n/g, '\n').trim();
    if (text.length < MIN_RESUME_CHARS) {
      return flashRedirect(
        '/target',
        'err',
        `The pasted resume is too short — at least ${MIN_RESUME_CHARS} characters.`,
      );
    }
    const name = f.pasteName.trim().slice(0, MAX_RESUME_NAME_CHARS) || 'Pasted resume';
    resume = {
      ...(await upsertScratchResume({
        name,
        sourceFilename: 'pasted.txt',
        mimeType: 'text/plain',
        original: Buffer.from(text, 'utf8'),
        text,
      })),
      ephemeral: true,
    };
  }

  // The posting is read as its own visible step (ADR 0044) — it is what the
  // comparison is judged against, and on a second run it finishes instantly.
  const steps: RunStep[] = needExtract ? ['extract', 'brief', matchStep(f.mode)] : ['brief', matchStep(f.mode)];
  // The posting text and the resolved resume are what was submitted; a second
  // POST of the same pair joins the run instead of paying twice (issue #76).
  const { run, joined } = claimRun(
    `target:${resume.id}:${f.mode}:${hashShortId(f.description)}`,
    { steps, jobTitle: title || 'Detecting the role…', resumeName: resume.name },
  );
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);

  startRun(run.id, async () => {
    // 0. Detect what the user left empty; fall back to visible defaults.
    if (needExtract) {
      const facts = await extractPostingFacts(f.description);
      companyName = companyName || facts?.company || 'Unknown company';
      title = title || facts?.title || fallbackTitle(f.description);
      location = location || facts?.location || '';
      salaryMin = salaryMin ?? facts?.salaryMin ?? undefined;
      salaryMax = salaryMax ?? facts?.salaryMax ?? undefined;
      const workplace = facts?.workplace ?? null;
      // The arrangement goes into the string on purpose: the classifier prompt
      // reads the location string (CLAUDE.md gotcha 8), and the parser fills
      // Job.workplace from the same words — one text, two readers (ADR 0031).
      if (workplace && !/(remote|hybrid|on-?site)/i.test(location)) {
        const label = workplace === 'onsite' ? 'on-site' : workplace;
        location = location ? `${location} (${label})` : label;
      }
      updateRun(run.id, { jobTitle: title });
    }

    // 1. The posting becomes a normal MANUAL job (deduped). A new one is
    //    classified in the background: the comparison never reads the fit
    //    score, and that leg alone was ~50 s on a CLI engine
    //    (docs/target-plan.md §3.1).
    const result = await createManualJob(
      {
        companyName,
        title,
        url: f.url,
        location,
        description: f.description,
        salaryMin,
        salaryMax,
      },
      { classify: false },
    );
    const job = result.job;
    if (result.kind === 'created') classifyInBackground(result.job);
    updateRun(run.id, { jobId: job.id });
    const jobInput = { id: job.id, title: job.title, companyName, location: job.location, description: job.description };

    // 2. The same text against the same posting is already answered — a
    //    double submit or a re-paste shows the stored analysis instead. A
    //    full analysis asked of a stored quick check needs only the
    //    suggestions call, which this run makes itself: one progress page,
    //    not two chained ones. It answers to the suggestions key as well,
    //    so pressing "Get suggestions" on that comparison meanwhile joins
    //    this run instead of calling the model a second time (issue #76).
    const reused = await findReusableMatch(job.id, resume.id, resume.text, f.mode);
    if (reused?.decision === 'reuse') {
      updateRun(run.id, {
        stage: 'done',
        resultUrl: `/jobs/${job.id}/target?match=${reused.row.id}`,
        flash: reuseNotice(formatRelative(reused.row.createdAt)),
        reused: true,
      });
      return;
    }
    if (reused) {
      alsoClaims(run.id, suggestionsKey(reused.row.id));
      updateRun(run.id, {
        steps: needExtract ? ['extract', 'suggestions'] : ['suggestions'],
        stage: 'suggestions',
      });
      let reason = '';
      const row = await suggestForMatch(reused.row, jobInput, (r) => {
        reason = r;
      });
      if (!row) {
        updateRun(run.id, { stage: 'error', error: reason ? `${SUGGESTIONS_FAILED.replace(/\.$/, '')}: ${reason}.` : SUGGESTIONS_FAILED });
        return;
      }
      updateRun(run.id, {
        stage: 'done',
        resultUrl: `/jobs/${job.id}/target?match=${reused.row.id}`,
        flash: suggestionsFlash(
          { actions: readActions(row.actions).length, removals: readRemovals(row.removals).length },
          formatRelative(reused.row.createdAt),
        ),
      });
      return;
    }

    // 2c. The posting read on its own, cached against its text. Shown as a
    //     step because it is the analysis the user asked to see, and because a
    //     reused reading is the visible reason the second run is faster.
    updateRun(run.id, { stage: 'brief' });
    const briefed = await briefForPosting(jobInput);
    if (briefed) {
      updateRun(run.id, {
        results: {
          brief: briefed.reused ? `Reused this posting's analysis — ${briefLine(briefed.brief)}` : briefLine(briefed.brief),
        },
      });
    }
    updateRun(run.id, { stage: matchStep(f.mode) });

    // 3. Older comparisons stay. A one-off check used to keep only its latest
    //    analysis, which meant comparing the same posting again threw away the
    //    run the user was about to compare against — and the whole point of
    //    re-uploading a resume is seeing whether the number moved. The job page
    //    lists them under "older runs"; each one carries its own text snapshot,
    //    so an old row still shows the resume it actually judged.
    if (resume.ephemeral) await deleteCoverLettersForResume(resume.id);

    // 4. One resume-model call, then straight into the targeted workspace.
    let reason = '';
    const row = await matchResumeToJob({ id: resume.id, version: resume.version, text: resume.text }, jobInput, {
      mode: f.mode,
      brief: briefed,
      onError: (r) => {
        reason = r;
      },
    });
    if (!row) {
      updateRun(run.id, { stage: 'error', error: runFailure('The posting was saved, but the AI comparison failed', reason) });
      return;
    }
    updateRun(run.id, {
      stage: 'done',
      resultUrl: `/jobs/${job.id}/target?match=${row.id}`,
      flash:
        `AI match ${row.matchScore}/100 — "${resume.name}" vs "${job.title}"${f.mode === 'fast' ? ' (quick check: keywords, gates and score).' : '.'}` +
        (result.kind === 'created' ? ' The fit score is still being scored; it lands on the job page in about a minute.' : ''),
    });
  });

  return c.redirect(`/target/runs/${run.id}`, 303);
});
