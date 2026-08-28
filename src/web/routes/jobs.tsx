/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { AtsType, JobStatus, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { logger } from '../../logger';
import { getSettings } from '../../settings';
import { classifyExistingJob } from '../../jobs/classify-existing';
import { hashShortId } from '../../text-utils';
import { listVerificationsForJob, verifyJob } from '../../verification/verify';
import { JobsListPage } from '../pages/jobs-list';
import { JobDetailPage } from '../pages/job-detail';
import { JobNewPage } from '../pages/job-new';
import { TargetPage } from '../pages/target';
import { readResumeUpload, resumeUploadLimit } from '../upload';
import { scanResume } from '../../resume/scan';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { getResume, listMatchesForJob, listResumes, replaceResumeFile } from '../../resume/store';
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

const MIN_DESCRIPTION_CHARS = 200;
const MAX_FIELD_CHARS = 200;

const ManualJobSchema = z.object({
  companyName: z.string().trim().min(1).max(MAX_FIELD_CHARS),
  title: z.string().trim().min(1).max(MAX_FIELD_CHARS),
  url: z.string().trim().max(2000).default(''),
  location: z.string().trim().max(MAX_FIELD_CHARS).default(''),
  description: z.string().trim().min(MIN_DESCRIPTION_CHARS),
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
  const f = parsed.data;
  const atsToken = slugify(f.companyName);
  const company = await prisma.company.upsert({
    where: { atsType_atsToken: { atsType: AtsType.MANUAL, atsToken } },
    update: {},
    create: { name: f.companyName, atsType: AtsType.MANUAL, atsToken, active: false },
  });
  const externalId = `manual-${hashShortId(`${f.title}\n${f.description}`)}`;
  const existing = await prisma.job.findUnique({
    where: { companyId_externalId: { companyId: company.id, externalId } },
  });
  if (existing) {
    return flashRedirect(`/jobs/${existing.id}`, 'ok', 'This posting was already saved.');
  }
  const job = await prisma.job.create({
    data: {
      companyId: company.id,
      externalId,
      title: f.title,
      url: f.url,
      location: f.location,
      description: f.description,
      postedAt: new Date(),
      status: JobStatus.SAVED,
    },
    include: { company: { select: { name: true } } },
  });
  const classified = await classifyExistingJob(job, { keepStatus: true });
  logger.info({ jobId: job.id, company: company.name, classified }, 'web: manual job saved');
  return flashRedirect(
    `/jobs/${job.id}`,
    'ok',
    classified
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
      include: { company: { select: { id: true, name: true, atsType: true } } },
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
    include: { company: { select: { name: true } } },
  });
  if (!job) return c.text('Not found', 404);
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
  const back = toTarget ? `/jobs/${id}/target` : `/jobs/${id}#resume-match`;

  const row = await matchResumeToJob(
    { id: resume.id, version: resume.version, text: draft ? draftText : resume.text },
    { id: job.id, title: job.title, companyName: job.company.name, location: job.location, description: job.description },
    { draft },
  );
  if (!row) return flashRedirect(back, 'err', 'Comparison failed — see the web logs.');
  return flashRedirect(
    toTarget ? `/jobs/${id}/target?match=${row.id}` : `/jobs/${id}?match=${row.id}#resume-match`,
    'ok',
    `${draft ? 'Draft' : `"${resume.name}"`} compared — AI match ${row.matchScore}/100.`,
  );
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
      resume={{ id: resume.id, name: resume.name, version: resume.version }}
      match={match}
      matches={matches}
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

  const resume = await replaceResumeFile(resumeId, upload);
  await scanResume(resume);
  const row = await matchResumeToJob(resume, {
    id: job.id,
    title: job.title,
    companyName: job.company.name,
    location: job.location,
    description: job.description,
  });
  return row
    ? flashRedirect(`/jobs/${id}/target?match=${row.id}`, 'ok', `v${resume.version} uploaded and compared — AI match ${row.matchScore}/100.`)
    : flashRedirect(`/jobs/${id}/target`, 'err', `v${resume.version} uploaded, but the comparison failed — see the web logs.`);
});

/** "Acme Corp." → "acme-corp" — the MANUAL company's atsToken. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'company';
}

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
