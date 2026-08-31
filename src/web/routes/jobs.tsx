/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { JobStatus, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { logger } from '../../logger';
import { getSettings } from '../../settings';
import { classifyExistingJob } from '../../jobs/classify-existing';
import { createManualJob, ManualJobSchema, MIN_DESCRIPTION_CHARS } from '../../jobs/manual-job';
import { checkLiveness, listVerificationsForJob, verifyJob } from '../../verification/verify';
import { LIVENESS_CODE_LABEL } from '../../verification/liveness';
import { JobsListPage } from '../pages/jobs-list';
import { JobDetailPage } from '../pages/job-detail';
import { JobNewPage } from '../pages/job-new';
import { TargetPage } from '../pages/target';
import { previousFor } from '../pages/resume-match-card';
import { nameFromFilename, readResumeUpload, resumeUploadLimit } from '../upload';
import { scanResume } from '../../resume/scan';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { createRun, startRun, updateRun } from '../target-runs';
import {
  deleteMatchesForResume,
  getResume,
  listMatchesForJob,
  listResumes,
  replaceResumeFile,
  upsertScratchResume,
} from '../../resume/store';
import { pickResumeForJob } from '../../resume/pick';
import { matchResumeToJob } from '../../resume/match';

const PAGE_SIZE = 50;

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  status: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v))
    .refine(
      (v) =>
        v === undefined || ['NEW', 'ALERTED', 'APPLIED', 'SAVED', 'DISMISSED'].includes(v),
      { message: 'invalid status' },
    ),
  minFit: z
    .string()
    .optional()
    .transform((v) => (v === '' || v === undefined ? '' : v)),
  q: z.string().optional().default(''),
  sort: z
    .enum(['fetchedAt_desc', 'fitScore_desc', 'postedAt_desc', 'title_asc'])
    .default('fetchedAt_desc'),
});

const StatusBodySchema = z.object({
  status: z.enum(['NEW', 'ALERTED', 'APPLIED', 'SAVED', 'DISMISSED']),
});

export const jobsRoute = new Hono();

jobsRoute.get('/jobs', async (c) => {
  const parsed = ListQuerySchema.safeParse({
    page: c.req.query('page'),
    status: c.req.query('status'),
    minFit: c.req.query('minFit'),
    q: c.req.query('q'),
    sort: c.req.query('sort'),
  });
  if (!parsed.success) {
    return c.text('Invalid query', 400);
  }
  const { page, status, minFit, q, sort } = parsed.data;

  const where: Prisma.JobWhereInput = {};
  if (status) {
    where.status = status as JobStatus;
  }
  const minFitNum = minFit ? Number(minFit) : NaN;
  if (!Number.isNaN(minFitNum)) {
    where.fitScore = { gte: minFitNum };
  }
  if (q.trim().length > 0) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
    ];
  }

  const orderBy = sortToOrderBy(sort);

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { company: { select: { name: true } } },
    }),
    prisma.job.count({ where }),
  ]);

  return c.html(
    <JobsListPage
      jobs={jobs}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      filters={{
        status: status ?? '',
        minFit,
        q,
        sort,
      }}
    />,
  );
});

jobsRoute.get('/jobs/new', (c) =>
  c.html(<JobNewPage flash={parseFlashCookie(c.req.header('cookie'))} />, 200, {
    'Set-Cookie': clearFlashCookie(),
  }),
);

jobsRoute.post('/jobs/new', async (c) => {
  const parsed = ManualJobSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) {
    return flashRedirect(
      '/jobs/new',
      'err',
      `Company, title and a description of at least ${MIN_DESCRIPTION_CHARS} characters are required.`,
    );
  }
  const result = await createManualJob(parsed.data);
  if (result.kind === 'existing') {
    return flashRedirect(`/jobs/${result.job.id}`, 'ok', 'This posting was already saved.');
  }
  return flashRedirect(
    `/jobs/${result.job.id}`,
    'ok',
    result.classified
      ? 'Saved and scored against the active profile. Next: Verify, then Compare with a resume.'
      : 'Saved. Classifier skipped (no active profile or AI failure) — Verify and Compare still work.',
  );
});

jobsRoute.get('/jobs/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);

  const [job, settings, resumes, matches, verifications] = await Promise.all([
    prisma.job.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true, atsType: true } },
        // F3: the posting this one near-duplicates, and any that
        // near-duplicate it — the link is annotation only (ADR 0018).
        crossListedOf: {
          select: { id: true, title: true, company: { select: { name: true } } },
        },
        crossListings: {
          select: { id: true, title: true, company: { select: { name: true } } },
        },
      },
    }),
    getSettings(),
    listResumes(),
    listMatchesForJob(id),
    listVerificationsForJob(id),
  ]);
  if (!job) return c.text('Not found', 404);

  // ?match=<id> shows an older comparison; default is the latest.
  const requestedMatch = Number(c.req.query('match'));
  const selected = matches.find((m) => m.id === requestedMatch) ?? matches[0] ?? null;
  const suggested = pickResumeForJob(resumes, `${job.title} ${job.description}`);

  const flashCookie = parseFlashCookie(c.req.header('cookie'));
  return c.html(
    <JobDetailPage
      job={job}
      applicationTrackingEnabled={settings.applicationTrackingEnabled}
      verification={verifications[0] ?? null}
      verificationCount={verifications.length}
      resumeMatch={{
        jobId: id,
        resumes: resumes.map((r) => ({ id: r.id, name: r.name, isDefault: r.isDefault })),
        suggestedResumeId: suggested?.id ?? null,
        matches,
        selected,
      }}
      flash={flashCookie}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

jobsRoute.post('/jobs/:id/status', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);

  const form = await c.req.parseBody();
  const parsed = StatusBodySchema.safeParse({ status: form.status });
  if (!parsed.success) return c.text('Invalid status', 400);

  const data: Prisma.JobUpdateInput = { status: parsed.data.status };
  if (parsed.data.status === 'ALERTED' || parsed.data.status === 'APPLIED') {
    data.alertedAt = data.alertedAt ?? new Date();
  }

  // When the user marks a job APPLIED and tracking is on, seed the funnel
  // so it shows up on /applications immediately. Don't overwrite existing
  // pipelineStage / appliedAt — user may have backdated them.
  if (parsed.data.status === 'APPLIED') {
    const settings = await getSettings();
    if (settings.applicationTrackingEnabled) {
      const current = await prisma.job.findUnique({
        where: { id },
        select: { pipelineStage: true, appliedAt: true },
      });
      if (!current?.pipelineStage) data.pipelineStage = 'applied';
      if (!current?.appliedAt) data.appliedAt = new Date();
    }
  }

  await prisma.job.update({ where: { id }, data });
  return c.redirect(`/jobs/${id}`, 303);
});

jobsRoute.post('/jobs/:id/reclassify', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const job = await prisma.job.findUnique({
    where: { id },
    include: { company: { select: { name: true } } },
  });
  if (!job) return c.text('Not found', 404);
  try {
    await classifyExistingJob(job, { keepStatus: false });
  } catch (err) {
    logger.error({ err, jobId: id }, 'web: reclassify failed');
  }
  return c.redirect(`/jobs/${id}`, 303);
});

jobsRoute.post('/jobs/:id/verify', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const job = await prisma.job.findUnique({
    where: { id },
    include: { company: { select: { name: true, atsType: true, atsToken: true } } },
  });
  if (!job) return c.text('Not found', 404);

  // Rungs 1-2 (ADR 0016): free ATS-API / page checks. A resolved verdict
  // stops here at $0; `deep=1` (the "Deep check" button) always goes to AI.
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const deep = form['deep'] === '1';
  const live = await checkLiveness({
    id: job.id,
    url: job.url,
    externalId: job.externalId,
    atsType: job.company.atsType,
    atsToken: job.company.atsToken,
  });
  if (!deep && live.liveness !== 'uncertain') {
    const how = `${LIVENESS_CODE_LABEL[live.code]} (rung ${live.rung}, no AI spent)`;
    return live.liveness === 'expired'
      ? flashRedirect(`/jobs/${id}#verification`, 'warn', `Posting looks closed — ${how}.`)
      : flashRedirect(
          `/jobs/${id}#verification`,
          'ok',
          `Posting is live — ${how}. Deep check runs the full ghost-job analysis.`,
        );
  }

  const row = await verifyJob({
    id: job.id,
    title: job.title,
    companyName: job.company.name,
    location: job.location,
    url: job.url,
    description: job.description,
    postedAt: job.postedAt,
  });
  return row
    ? flashRedirect(
        `/jobs/${id}#verification`,
        'ok',
        `Verified: ${row.verdict} (${row.confidence}% confidence) — recommendation: ${row.recommendation}.`,
      )
    : flashRedirect(`/jobs/${id}#verification`, 'err', 'Verification failed — see the web logs.');
});

jobsRoute.post('/jobs/:id/match', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const form = await c.req.parseBody();
  const resumeId = Number(form.resumeId);
  if (!Number.isFinite(resumeId)) return c.text('Bad resume id', 400);

  const [job, resume] = await Promise.all([
    prisma.job.findUnique({ where: { id }, include: { company: { select: { name: true } } } }),
    getResume(resumeId),
  ]);
  if (!job || !resume) return c.text('Not found', 404);

  // The targeted view posts its edited text; a non-empty draft is judged instead of the stored version.
  const draftText = typeof form.draftText === 'string' ? form.draftText.replace(/\r\n/g, '\n').trim() : '';
  const draft = draftText.length > 0 && draftText !== resume.text;
  const toTarget = form.next === 'target';

  const run = createRun({ steps: ['match'], jobTitle: job.title, resumeName: resume.name, jobId: id });
  startRun(run.id, async () => {
    // Ephemeral (scratch) compares keep only the current analysis.
    if (resume.hidden) await deleteMatchesForResume(resume.id);
    const row = await matchResumeToJob(
      { id: resume.id, version: resume.version, text: draft ? draftText : resume.text },
      { id: job.id, title: job.title, companyName: job.company.name, location: job.location, description: job.description },
      { draft },
    );
    if (!row) {
      updateRun(run.id, { stage: 'error', error: 'Comparison failed — see the web logs.' });
      return;
    }
    updateRun(run.id, {
      stage: 'done',
      resultUrl: toTarget ? `/jobs/${id}/target?match=${row.id}` : `/jobs/${id}?match=${row.id}#resume-match`,
      flash: `${draft ? 'Draft' : `"${resume.name}"`} compared — AI match ${row.matchScore}/100.`,
    });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
});

jobsRoute.get('/jobs/:id/target', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const [job, matches] = await Promise.all([
    prisma.job.findUnique({ where: { id }, include: { company: { select: { name: true } } } }),
    listMatchesForJob(id),
  ]);
  if (!job) return c.text('Not found', 404);
  const requested = Number(c.req.query('match'));
  const match = matches.find((m) => m.id === requested) ?? matches[0];
  if (!match) {
    return flashRedirect(`/jobs/${id}#resume-match`, 'err', 'Run Compare once — the targeted view needs an AI match to work from.');
  }
  const resume = await getResume(match.resumeId);
  if (!resume) return c.text('Not found', 404);
  return c.html(
    <TargetPage
      job={{ id: job.id, title: job.title, companyName: job.company.name, location: job.location, description: job.description }}
      resume={{ id: resume.id, name: resume.name, version: resume.version, ephemeral: resume.hidden }}
      match={match}
      matches={matches}
      previous={previousFor(match, matches)}
      resumeText={match.resumeText || resume.text}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

jobsRoute.post('/jobs/:id/target/reupload', async (c, next) => resumeUploadLimit(`/jobs/${c.req.param('id')}/target`)(c, next), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const form = await c.req.parseBody();
  const resumeId = Number(form.resumeId);
  if (!Number.isFinite(resumeId)) return c.text('Bad resume id', 400);
  const [job, existing] = await Promise.all([
    prisma.job.findUnique({ where: { id }, include: { company: { select: { name: true } } } }),
    getResume(resumeId),
  ]);
  if (!job || !existing) return c.text('Not found', 404);
  const upload = await readResumeUpload(form);
  if ('error' in upload) return flashRedirect(`/jobs/${id}/target`, 'err', upload.error);

  // Scratch (ephemeral) resumes are replaced in place with no scan and no
  // history — a fresh upload means a fresh analysis, nothing saved.
  const ephemeral = existing.hidden;
  const newName = ephemeral ? nameFromFilename(upload.sourceFilename) : existing.name;
  const run = createRun({
    steps: ephemeral ? ['match'] : ['scan', 'match'],
    jobTitle: job.title,
    resumeName: newName,
    jobId: id,
  });
  startRun(run.id, async () => {
    let resume;
    if (ephemeral) {
      resume = await upsertScratchResume({ name: newName, ...upload });
      await deleteMatchesForResume(resume.id);
    } else {
      resume = await replaceResumeFile(resumeId, upload);
      await scanResume(resume);
      updateRun(run.id, { stage: 'match' });
    }
    const row = await matchResumeToJob(resume, {
      id: job.id,
      title: job.title,
      companyName: job.company.name,
      location: job.location,
      description: job.description,
    });
    if (!row) {
      updateRun(run.id, {
        stage: 'error',
        error: ephemeral
          ? 'Upload worked, but the comparison failed — see the web logs.'
          : `v${resume.version} uploaded, but the comparison failed — see the web logs.`,
      });
      return;
    }
    updateRun(run.id, {
      stage: 'done',
      resultUrl: `/jobs/${id}/target?match=${row.id}`,
      flash: ephemeral
        ? `"${newName}" compared — AI match ${row.matchScore}/100.`
        : `v${resume.version} uploaded and compared — AI match ${row.matchScore}/100.`,
    });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
});

function sortToOrderBy(sort: string): Prisma.JobOrderByWithRelationInput[] {
  switch (sort) {
    case 'fitScore_desc':
      return [{ fitScore: { sort: 'desc', nulls: 'last' } }, { fetchedAt: 'desc' }];
    case 'postedAt_desc':
      return [{ postedAt: 'desc' }];
    case 'title_asc':
      return [{ title: 'asc' }];
    case 'fetchedAt_desc':
    default:
      return [{ fetchedAt: 'desc' }];
  }
}
