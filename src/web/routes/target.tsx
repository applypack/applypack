/** @jsxImportSource hono/jsx */
import { Hono, type Context } from 'hono';
import { getAiRuntime } from '../../ai-runtime';
import { attributeCalls, loadAnswerTimes } from '../../ai-ledger';
import { laneTimes, TIMED_FEATURES } from '../lane';
import { z } from 'zod';
import { prisma } from '../../db';
import { postingForPrompt } from '../../employer';
import { secondLookTitle } from '../../fingerprint';
import { hashShortId } from '../../text-utils';
import { classifyInBackground } from '../../jobs/classify-existing';
import { createManualJob, findJobByText, findJobByUrl, ManualJobSchema, MAX_FIELD_CHARS, MAX_POSTING_CHARS, MIN_DESCRIPTION_CHARS } from '../../jobs/manual-job';
import { extractPostingFacts, fallbackTitle } from '../../jobs/posting-extract';
import { parseMatchMode, type MatchMode } from '../../resume/match-mode';
import { runComparison, startComparison } from '../comparison-run';
import { listPickableJobs } from '../job-pick';
import { idParam } from '../params';
import { TargetStartPage } from '../pages/target-start';
import { TargetRunPage, type RunLanes } from '../pages/target-run';
import { clearFlashCookie, flashRedirect, parseFlashCookie, refusedField } from '../flash';
import { launcherRefusal } from '../form-refusal';
import { claimRun, getRun, matchStep, startRun, updateRun, type RunStep } from '../target-runs';
import { listResumeOptions, resolveResumeSource, ResumeSourceFields, type ResolvedResume } from '../resume-source';
import { resumeUploadLimit } from '../upload';
import { t } from '../../i18n/t';

/* zod strips unknown keys, so the multipart `file` field is read from the raw form.
 * Two job sources: one of the stored jobs (`jobId`), or a pasted posting whose
 * company and title are optional here (unlike /jobs/new) — left empty, they
 * are detected from the description inside the run. A form without `jobMode`
 * is a pasted posting, which is all this page used to take. */
const TargetFormSchema = ManualJobSchema.extend({
  jobMode: z.enum(['existing', 'new']).default('new'),
  jobId: z.coerce.number().int().optional(),
  companyName: z.string().trim().max(MAX_FIELD_CHARS).default(''),
  title: z.string().trim().max(MAX_FIELD_CHARS).default(''),
  description: z.string().trim().default(''),
  /** The quick check unless "Full analysis" was pressed (ADR 0029). */
  mode: z.unknown().optional().transform(parseMatchMode),
  ...ResumeSourceFields,
});

export const targetRoute = new Hono();

targetRoute.get('/target', async (c) => {
  // `?job=70` is the job page's "compare another file": the picker opens on it.
  const wanted = idParam(c.req.query('job'));
  const include = Number.isFinite(wanted) ? wanted : null;
  const [jobs, resumes] = await Promise.all([listPickableJobs(include), listResumeOptions()]);
  return c.html(
    <TargetStartPage
      jobs={jobs}
      selectedJobId={jobs.some((j) => j.id === include) ? include : null}
      resumes={resumes}
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
    return flashRedirect('/target', 'err', t('target.flash.runGone'));
  }
  if (run.stage === 'done' && run.resultUrl) {
    return flashRedirect(run.resultUrl, run.flashKind ?? (run.reused ? 'warn' : 'ok'), run.flash ?? t('target.flash.done'), {
      rerun: run.reused,
      tailor: run.tailorUrl,
      download: run.downloadUrl,
    });
  }
  return c.html(<TargetRunPage run={run} lanes={await resumeLanes()} />);
});

/** Engine × model the resume calls run on, and this install's own times there — the run page states a band per step (#184, #483). */
async function resumeLanes(): Promise<RunLanes> {
  const runtime = await getAiRuntime();
  const target = (task: 'resume-read' | 'analysis') => {
    const engine = runtime.chainFor(task)[0];
    return engine ? { engine, model: runtime.modelFor(engine, 'resume') } : null;
  };
  const read = target('resume-read');
  const analysis = target('analysis');
  const times = await loadAnswerTimes([read, analysis].flatMap((lane) => (lane ? [lane.engine] : [])), TIMED_FEATURES);
  return { read: laneTimes(read, times), analysis: laneTimes(analysis, times) };
}

targetRoute.post('/target', resumeUploadLimit('/target'), async (c) => {
  const form = await c.req.parseBody();
  const parsed = TargetFormSchema.safeParse(form);
  if (!parsed.success) {
    const { issues } = parsed.error;
    return flashRedirect('/target', 'err', launcherRefusal(issues, t('target.flash.pickBoth'), ['jobMode', 'resumeMode']), refusedField(c.req.path, issues));
  }
  const f = parsed.data;

  if (f.jobMode === 'existing') {
    if (!f.jobId) return flashRedirect('/target', 'err', t('target.flash.pickJob'));
    const back = `/target?job=${f.jobId}`;
    const job = await storedJob(f.jobId);
    if (!job) return flashRedirect('/target', 'err', t('target.flash.jobGone'));
    const resume = await resolveResumeSource(form, f);
    if ('error' in resume) return flashRedirect(back, 'err', resume.error);
    return compareStored(c, job, resume, f.mode, back);
  }

  if (f.description.length < MIN_DESCRIPTION_CHARS) {
    return flashRedirect('/target', 'err', t('target.flash.descriptionShort', { n: MIN_DESCRIPTION_CHARS }));
  }
  if (f.description.length > MAX_POSTING_CHARS) {
    return flashRedirect('/target', 'err', t('target.flash.postingLong', { n: MAX_POSTING_CHARS }));
  }

  // Empty company / title / location are detected from the description INSIDE
  // the run — a visible "Detect posting facts" step. Detection never blocks:
  // unfound facts fall back to defaults the user can see on the job.
  let { companyName, title, location, salaryMin, salaryMax } = f;
  const needExtract = !companyName || !title || !location;

  // Resolve the resume inline (fast, and bad files fail before anything runs).
  // Upload / paste land on the hidden scratch row — /target is a pure
  // comparison and never adds rows to the user's Resumes.
  const resume = await resolveResumeSource(form, f);
  if ('error' in resume) return flashRedirect('/target', 'err', resume.error);

  // A posting the dashboard stores already is that job (#609): no second copy,
  // no second reading. Its text decides, as on Cover letter (#579), and a
  // stored job's link names the role when no title was typed. The link alone
  // could hand back a stored teaser in place of the whole posting pasted here.
  const linked = f.url ? await findJobByUrl(f.url) : null;
  const role = f.title || linked?.title || '';
  const storedId = await findJobByText(f.description, role);
  const stored = storedId === null ? null : await storedJob(storedId);
  if (stored) return compareStored(c, stored, resume, f.mode, '/target');

  // The posting is read as its own visible step (ADR 0044) — it is what the
  // comparison is judged against, and on a second run it finishes instantly.
  const steps: RunStep[] = needExtract ? ['extract', 'brief', matchStep(f.mode)] : ['brief', matchStep(f.mode)];
  // The posting text and the resolved resume are what was submitted; a second
  // POST of the same pair joins the run instead of paying twice (issue #76).
  const { run, joined } = claimRun(
    `target:${resume.id}:${f.mode}:${hashShortId(f.description)}`,
    { steps, jobTitle: title || t('target.run.detectingRole'), resumeName: resume.name },
  );
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);

  startRun(run.id, async () => {
    // 0. Detect what the user left empty; fall back to visible defaults.
    const calls: number[] = [];
    let readTitle: string | null = null;
    if (needExtract) {
      const facts = await extractPostingFacts(f.description, { calls });
      readTitle = facts?.title ?? null;
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

    // 1. A paste that named no role is looked up again by the one the
    //    extraction read: the same posting is the stored job. Otherwise it
    //    becomes a normal MANUAL job (deduped). A new one is classified in the
    //    background: the comparison never reads the fit score, and that leg
    //    alone was ~50 s on a CLI engine (docs/target-plan.md §3.1).
    const again = secondLookTitle(role, readTitle);
    const sameId = again === null ? null : await findJobByText(f.description, again);
    const same = sameId === null ? null : await storedJob(sameId);
    let job: { id: number; title: string; companyName: string; location: string; description: string };
    let created = false;
    if (same) {
      job = postingForPrompt(same);
    } else {
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
      created = result.kind === 'created';
      if (result.kind === 'created') classifyInBackground(result.job);
      job = { id: result.job.id, title: result.job.title, companyName, location: result.job.location, description: result.job.description };
    }
    // The extraction read the posting before it had a row: its call is booked to the job it became.
    await attributeCalls(calls, job.id);
    updateRun(run.id, { jobId: job.id, jobTitle: job.title });

    // 2. From here it is the comparison every other page runs: the memo (a
    //    double submit or a re-paste shows the stored analysis), the posting's
    //    reading, the resume-model call, the targeted workspace.
    await runComparison(
      run.id,
      {
        jobId: job.id,
        job,
        resume,
        text: resume.text,
        mode: f.mode,
        evidence: resume.evidence,
        rebuild: false,
        force: false,
        resultUrl: (matchId) => `/jobs/${job.id}/target?match=${matchId}`,
        label: `"${resume.name}"`,
        doneNote: created ? t('target.run.fitPending') : undefined,
        failure: same ? undefined : t('target.run.savedButFailed'),
      },
      needExtract ? ['extract'] : [],
    );
  });

  return c.redirect(`/target/runs/${run.id}`, 303);
});

function storedJob(id: number) {
  return prisma.job.findUnique({ where: { id }, include: { company: { select: { name: true, atsType: true } } } });
}

/**
 * A stored job: nothing to detect and nothing to create, so this is the job
 * page's own Compare — the same memo, the same run, the same result page —
 * with the resume chosen here, a file or a paste included.
 */
function compareStored(c: Context, job: NonNullable<Awaited<ReturnType<typeof storedJob>>>, resume: ResolvedResume, mode: MatchMode, back: string): Promise<Response> {
  return startComparison(c, {
    jobId: job.id,
    job: postingForPrompt(job),
    resume,
    text: resume.text,
    mode,
    evidence: resume.evidence,
    rebuild: false,
    force: false,
    resultUrl: (matchId) => `/jobs/${job.id}/target?match=${matchId}`,
    label: `"${resume.name}"`,
  }, { url: back, label: t('target.run.backToTarget') });
}
