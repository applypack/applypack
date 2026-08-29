/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { z } from 'zod';
import { createManualJob, ManualJobSchema, MAX_FIELD_CHARS, MIN_DESCRIPTION_CHARS } from '../../jobs/manual-job';
import { extractPostingFacts } from '../../jobs/posting-extract';
import { matchResumeToJob } from '../../resume/match';
import {
  deleteMatchesForResume,
  getResume,
  listResumes,
  upsertScratchResume,
} from '../../resume/store';
import { TargetStartPage } from '../pages/target-start';
import { TargetRunPage } from '../pages/target-run';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { createRun, getRun, startRun, updateRun } from '../target-runs';
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
  /** Hidden field the auto-fill sets; folded into location below, not stored. */
  workplace: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.enum(['remote', 'hybrid', 'onsite']).optional(),
  ),
  resumeMode: z.enum(['existing', 'upload', 'paste']),
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
    stageElapsedMs: Date.now() - run.stageAt,
    elapsedMs: Date.now() - run.startedAt,
  });
});

/** The progress page: target-run.mjs polls the state route until the chain resolves. */
targetRoute.get('/target/runs/:id', (c) => {
  const run = getRun(c.req.param('id'));
  if (!run) {
    return flashRedirect('/target', 'err', 'That comparison run is gone (runs live ~30 min). Start again.');
  }
  if (run.stage === 'done' && run.resultUrl) {
    return flashRedirect(run.resultUrl, 'ok', run.flash ?? 'Done.');
  }
  return c.html(<TargetRunPage run={run} />);
});

const ExtractBodySchema = z.object({ description: z.string().min(MIN_DESCRIPTION_CHARS) });

/** JSON endpoint for the form's auto-fill: description in, detected facts out. */
targetRoute.post('/target/extract', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ExtractBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ company: null, title: null, location: null }, 400);
  const facts = await extractPostingFacts(parsed.data.description);
  return c.json(facts ?? { company: null, title: null, location: null });
});

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

  // Fields the user left empty are detected from the description (the page
  // normally pre-fills them via /target/extract; this is the no-JS fallback).
  let { companyName, title, location, salaryMin, salaryMax, workplace } = f;
  if (!companyName || !title) {
    const facts = await extractPostingFacts(f.description);
    companyName = companyName || facts?.company || '';
    title = title || facts?.title || '';
    location = location || facts?.location || '';
    salaryMin = salaryMin ?? facts?.salaryMin ?? undefined;
    salaryMax = salaryMax ?? facts?.salaryMax ?? undefined;
    workplace = workplace ?? facts?.workplace ?? undefined;
  }
  if (!companyName || !title) {
    // Render the form BACK with everything the user typed — a redirect here
    // would throw their paste away. A chosen file cannot be re-rendered.
    return c.html(
      <TargetStartPage
        resumes={await resumeRows()}
        flash={{
          kind: 'err',
          text:
            "Couldn't detect the company or job title from the description — fill those two fields in." +
            (f.resumeMode === 'upload' ? ' Please re-pick the resume file too.' : ''),
        }}
        values={{
          companyName,
          title,
          url: f.url,
          location,
          description: f.description,
          resumeMode: f.resumeMode,
          resumeId: f.resumeId,
          uploadName: f.uploadName,
          pasteName: f.pasteName,
          resumeText: f.resumeText,
          salaryMin,
          salaryMax,
          workplace,
        }}
      />,
    );
  }
  // The Job schema has no workplace column; the location string is where the
  // classifier reads the arrangement anyway (CLAUDE.md gotcha 8).
  if (workplace && !/(remote|hybrid|on-?site)/i.test(location)) {
    const label = workplace === 'onsite' ? 'on-site' : workplace;
    location = location ? `${location} (${label})` : label;
  }

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

  const run = createRun({
    steps: ['classify', 'match'],
    jobTitle: title,
    resumeName: resume.name,
  });

  startRun(run.id, async () => {
    // 1. The posting becomes a normal MANUAL job (deduped, classified when new).
    const result = await createManualJob({
      companyName,
      title,
      url: f.url,
      location,
      description: f.description,
      salaryMin,
      salaryMax,
    });
    const job = result.job;
    updateRun(run.id, { stage: 'match', jobId: job.id });

    // 2. Ephemeral compares keep only the current analysis.
    if (resume.ephemeral) await deleteMatchesForResume(resume.id);

    // 3. One resume-model call, then straight into the targeted workspace.
    const row = await matchResumeToJob(
      { id: resume.id, version: resume.version, text: resume.text },
      {
        id: job.id,
        title: job.title,
        companyName,
        location: job.location,
        description: job.description,
      },
    );
    if (!row) {
      updateRun(run.id, {
        stage: 'error',
        error: 'The posting was saved, but the AI comparison failed — see the web logs.',
      });
      return;
    }
    updateRun(run.id, {
      stage: 'done',
      resultUrl: `/jobs/${job.id}/target?match=${row.id}`,
      flash: `AI match ${row.matchScore}/100 — "${resume.name}" vs "${job.title}".`,
    });
  });

  return c.redirect(`/target/runs/${run.id}`, 303);
});
