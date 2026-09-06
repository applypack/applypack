/** @jsxImportSource hono/jsx */
import { Hono, type Context } from 'hono';
import { JobStatus, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { logger } from '../../logger';
import { hashShortId } from '../../text-utils';
import { appliedResumeColumns } from '../applied-resume';
import {
  parsePlaces,
  parsePosted,
  parseWorkplaces,
  placeWhere,
  postedSince,
  tallyFacets,
} from '../job-facets';
import { getSettings } from '../../settings';
import { allStages, parseStageConfig } from '../stage-config';
import { classifyExistingJob } from '../../jobs/classify-existing';
import { locationMismatchReason } from '../../jobs/location-reason';
import { getActiveProfile, listActiveProfiles } from '../../profiles';
import { isBlankProfile } from '../../profile-guards';
import { createManualJob, ManualJobSchema, MIN_DESCRIPTION_CHARS } from '../../jobs/manual-job';
import { fetchPostingText } from '../../jobs/posting-url';
import { describeRefresh, foldOps, normaliseDescription, planRefresh, refreshFlash, restoreFlash } from '../../jobs/description-diff';
import { refreshDescription, restoreDescription } from '../../jobs/description-refresh';
import { loadLineDiff } from '../../resume/line-diff';
import { DescriptionRefreshPage } from '../pages/description-refresh';
import { checkLiveness, listVerificationsForJob, verifyJob } from '../../verification/verify';
import { readEvidence } from '../../verification/prompts';
import { addresseeFromFinding } from '../../resume/addressee';
import { LIVENESS_CODE_LABEL } from '../../verification/liveness';
import { JobsListPage } from '../pages/jobs-list';
import { JobDetailPage } from '../pages/job-detail';
import { JobNewPage } from '../pages/job-new';
import { TargetPage } from '../pages/target';
import { describeStructure, docxStructure } from '../../resume/docx-structure';
import { previousFor } from '../pages/resume-match-card';
import { nameFromFilename, readResumeUpload, resumeUploadLimit } from '../upload';
import { scanInBackground } from '../../resume/scan';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { formatRelative } from '../format';
import { claimRun, findLiveRun, matchStep, runFailure, startRun, updateRun } from '../target-runs';
import { startSuggestionsRun } from '../suggestions-run';
import {
  deleteCoverLettersForResume,
  getCoverLetter,
  getLatestCompanySnapshot,
  getLatestMatchForResumeAndJob,
  getMatch,
  getResume,
  listCoverLettersForJob,
  listFacts,
  listMatchesForJob,
  listResumes,
  replaceResumeFile,
  updateCoverLetterEdit,
  upsertScratchResume,
  getResumeOriginal,
} from '../../resume/store';
import { preselectAppliedResume, preselectResume } from '../../resume/pick';
import { briefForPosting, briefLine } from '../../resume/brief';
import { rewriteAction } from '../../resume/rewrite';
import { findReusableMatch, matchResumeToJob } from '../../resume/match';
import { parseMatchMode, readMatchMode, type MatchMode } from '../../resume/match-mode';
import { reuseNotice } from '../../resume/match-reuse';
import { generateCoverLetter } from '../../resume/cover-letter';
import {
  countWords,
  COVER_TONES,
  coverGateSources,
  readCoverAngles,
  readActions,
  readKeywords,
  type CoverTone,
  type MatchJobInput,
} from '../../resume/prompts';
import { withTableAliases } from '../../resume/keyword-aliases';
import { loadKeywordMatcher, type CountedKeyword } from '../../resume/keyword-matcher';
import { factCheck } from '../../resume/fact-check';
import { buildLetterDocx, DOCX_MIME } from '../../resume/docx-write';
import { buildLetterPdf } from '../../resume/pdf-write';
import { setCoverAngles } from '../../settings';
import { stageChangeEvent, type StageEventData } from '../stage-events';

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
  verified: z
    .string()
    .optional()
    .transform((v) => (v === '1' ? '1' : '')),
  // ADR 0033: only rows a search of mine can actually take.
  open: z
    .string()
    .optional()
    .transform((v) => (v === '1' ? '1' : '')),
  // ADR 0036: only postings from companies on the watchlist.
  watched: z
    .string()
    .optional()
    .transform((v) => (v === '1' ? '1' : '')),
  // ADR 0028: narrow the list to one search. Empty = every search.
  profile: z.coerce.number().int().positive().optional().catch(undefined),
  // ADR 0031: the facets. Unknown values are dropped, never rejected.
  country: z.string().optional().transform(parsePlaces),
  workplace: z.string().optional().transform(parseWorkplaces),
  posted: z.string().optional().transform(parsePosted),
});

const StatusBodySchema = z.object({
  status: z.enum(['NEW', 'ALERTED', 'APPLIED', 'SAVED', 'DISMISSED']),
  // Stage C: only read when the status is APPLIED. Empty = "don't record one".
  appliedResumeId: z.coerce.number().int().positive().optional(),
});

export const jobsRoute = new Hono();

jobsRoute.get('/jobs', async (c) => {
  const parsed = ListQuerySchema.safeParse({
    page: c.req.query('page'),
    status: c.req.query('status'),
    minFit: c.req.query('minFit'),
    q: c.req.query('q'),
    sort: c.req.query('sort'),
    verified: c.req.query('verified'),
    profile: c.req.query('profile') || undefined,
    country: c.req.query('country'),
    workplace: c.req.query('workplace'),
    posted: c.req.query('posted'),
    open: c.req.query('open'),
    watched: c.req.query('watched'),
  });
  if (!parsed.success) {
    return c.text('Invalid query', 400);
  }
  const { page, status, minFit, q, sort, verified, profile, country, workplace, posted, open, watched } = parsed.data;
  const now = new Date();

  const where: Prisma.JobWhereInput = {};
  if (status) {
    where.status = status as JobStatus;
  }
  const minFitNum = minFit ? Number(minFit) : NaN;
  // With a search selected both filters read that search's own score, not the
  // best-of — a chip that showed rows another search scored would be a lie.
  // "Open to me" reads the same per-search verdict (ADR 0033): with a search
  // selected, that search's; without one, any search that said yes.
  const openOnly = open === '1' ? { locationMatch: true } : {};
  if (profile) {
    where.scores = {
      some: {
        profileId: profile,
        ...(Number.isNaN(minFitNum) ? {} : { fitScore: { gte: minFitNum } }),
        ...openOnly,
      },
    };
  } else {
    if (!Number.isNaN(minFitNum)) where.fitScore = { gte: minFitNum };
    if (open === '1') where.scores = { some: { locationMatch: true } };
  }
  if (q.trim().length > 0) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { location: { contains: q, mode: 'insensitive' } },
    ];
  }
  if (verified) {
    where.verifications = { some: {} };
  }
  // ★ Only the companies the user put on the watchlist (ADR 0036).
  if (watched === '1') where.company = { watched: true };
  // The facet counts come from the rows matching everything above; each
  // facet then applies the others' selections in tallyFacets. Four narrow
  // columns per row — ~1k rows today; past ~50k move the tally into SQL.
  const facetWhere: Prisma.JobWhereInput = { ...where };
  const since = postedSince(posted, now);
  if (since) where.postedAt = { gte: since };
  const facetAnd: Prisma.JobWhereInput[] = [];
  const place = placeWhere(country);
  if (place) facetAnd.push(place);
  if (workplace.length > 0) facetAnd.push({ workplace: { in: workplace } });
  if (facetAnd.length > 0) where.AND = facetAnd;

  const orderBy = sortToOrderBy(sort);

  const [jobs, total, facetRows, activeProfile, activeProfiles] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        company: { select: { name: true, atsType: true, atsToken: true, watched: true } },
        verifications: {
          select: { verdict: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        // Only the selected search's row, so the list renders that search's
        // score in place of the best-of.
        ...(profile && { scores: { where: { profileId: profile }, take: 1 } }),
      },
    }),
    prisma.job.count({ where }),
    prisma.job.findMany({
      where: facetWhere,
      select: { countries: true, regions: true, workplace: true, postedAt: true },
    }),
    getActiveProfile(),
    listActiveProfiles(),
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
        verified,
        open,
        watched,
        profile: profile ?? null,
        country,
        workplace: workplace.map((w) => w.toLowerCase()),
        posted,
      }}
      facets={tallyFacets(facetRows, { places: country, workplaces: workplace, posted }, now)}
      profiles={activeProfiles.map((p) => ({ id: p.id, name: p.name }))}
      blankProfileBanner={activeProfile !== null && isBlankProfile(activeProfile)}
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
      ? 'Saved and scored against every running search. Next: Verify, then Compare with a resume.'
      : 'Saved. Classifier skipped (no running search or AI failure) — Verify and Compare still work.',
  );
});

/**
 * One comparison's keywords as both pages want them: alias-table spellings
 * applied on read (so a match stored before an entry highlights the same way)
 * and ordered by the matcher — hardest requirement first, ties broken by how
 * often the posting repeats the term, each row carrying that count (§5).
 */
async function orderedKeywords(
  match: { keywords: unknown } | null,
  posting: string,
): Promise<CountedKeyword[]> {
  if (!match) return [];
  const matcher = await loadKeywordMatcher();
  return matcher.orderKeywords(readKeywords(match.keywords).map(withTableAliases), posting);
}

jobsRoute.get('/jobs/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);

  const [job, settings, resumes, matches, verifications, letters, activeProfile] = await Promise.all([
    prisma.job.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true, atsType: true, atsToken: true, watched: true, checkEvery: true, alertPolicy: true } },
        // F3: the posting this one near-duplicates, and any that
        // near-duplicate it — the link is annotation only (ADR 0018).
        crossListedOf: {
          select: { id: true, title: true, company: { select: { name: true } } },
        },
        crossListings: {
          select: { id: true, title: true, company: { select: { name: true } } },
        },
        // Stage C: the resume this application went out with. Only the name is
        // read — the version and text snapshot live on the job itself.
        appliedResume: { select: { name: true } },
        // Every search's verdict, best first (ADR 0028).
        scores: {
          include: {
            profile: {
              select: {
                id: true,
                name: true,
                resumeId: true,
                active: true,
                countries: true,
                regions: true,
                workplace: true,
              },
            },
          },
          orderBy: { fitScore: 'desc' },
        },
      },
    }),
    getSettings(),
    listResumes(),
    listMatchesForJob(id),
    listVerificationsForJob(id),
    listCoverLettersForJob(id),
    getActiveProfile(),
  ]);
  if (!job) return c.text('Not found', 404);

  // ?match=<id> shows an older comparison; default is the latest. Same for ?letter.
  const requestedMatch = Number(c.req.query('match'));
  const selected = matches.find((m) => m.id === requestedMatch) ?? matches[0] ?? null;
  const requestedLetter = Number(c.req.query('letter'));
  const selectedLetter = letters.find((l) => l.id === requestedLetter) ?? letters[0] ?? null;
  // The search that speaks for this posting is the one that scored it best,
  // not merely the primary (ADR 0028) — its linked resume wins the preselect.
  // Falls back to the primary for a posting nothing has scored yet.
  const winning = job.scores[0]?.profile ?? null;
  const linkedResumeId = winning?.resumeId ?? activeProfile?.resumeId ?? null;
  const suggested = preselectResume(resumes, `${job.title} ${job.description}`, linkedResumeId);
  const suggestedReason = suggested && suggested.id === linkedResumeId ? 'linked' : 'overlap';
  // "Mark applied" starts on the resume this posting was actually compared
  // with — the comparison on screen — and only falls back to the page's own
  // preselect (Stage C).
  const appliedPick = preselectAppliedResume(resumes, selected?.resumeId ?? null, suggested);

  // The letter distils the latest comparison with the resume the cover card
  // preselects; a quick check carries no strengths to distil (#89).
  const coverMatch = matches.find((m) => m.resumeId === (suggested?.id ?? resumes[0]?.id)) ?? null;
  const quickCheck =
    coverMatch && readMatchMode(coverMatch.breakdown) === 'fast'
      ? { matchId: coverMatch.id, resumeName: coverMatch.resume.name }
      : null;

  const flashCookie = parseFlashCookie(c.req.header('cookie'));
  const selectedKeywords = await orderedKeywords(selected, job.description);
  return c.html(
    <JobDetailPage
      job={job}
      appliedResumePicker={{
        resumes: resumes.map((r) => ({ id: r.id, name: r.name })),
        suggestedId: appliedPick?.id ?? null,
      }}
      profileScores={job.scores.map((sc) => ({
        profileId: sc.profileId,
        name: sc.profile.name,
        active: sc.profile.active,
        fitScore: sc.fitScore,
        locationMatch: sc.locationMatch,
        // Built from the columns, no AI call (ADR 0032); null when they cannot say.
        locationReason: sc.locationMatch ? null : locationMismatchReason(job, sc.profile),
        summary: sc.summary,
      }))}
      applicationTrackingEnabled={settings.applicationTrackingEnabled}
      pipelineStages={allStages(parseStageConfig(settings.pipelineStages))}
      verification={verifications[0] ?? null}
      verificationCount={verifications.length}
      verificationRun={verifyRunView(id)}
      resumeMatch={{
        jobId: id,
        resumes: resumes.map((r) => ({ id: r.id, name: r.name, isDefault: r.isDefault })),
        suggestedResumeId: suggested?.id ?? null,
        suggestedReason,
        matches,
        selected,
        selectedKeywords,
        job: { title: job.title, companyName: job.company.name },
        verification: verifications[0] ?? null,
      }}
      coverLetters={{
        jobId: id,
        resumes: resumes.map((r) => ({ id: r.id, name: r.name, isDefault: r.isDefault })),
        suggestedResumeId: suggested?.id ?? null,
        suggestedReason,
        letters,
        selected: selectedLetter,
        hasCompanyFacts: Boolean(verifications[0]?.companySnapshot?.trim()),
        angles: readCoverAngles(settings.coverAngles),
        addressee: addresseeFromVerification(verifications[0]?.evidence, job.company.name),
        quickCheck,
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
  const parsed = StatusBodySchema.safeParse({
    status: form.status,
    appliedResumeId: form.appliedResumeId === '' ? undefined : form.appliedResumeId,
  });
  if (!parsed.success) return c.text('Invalid status', 400);

  const data: Prisma.JobUpdateInput = { status: parsed.data.status };
  if (parsed.data.status === 'ALERTED' || parsed.data.status === 'APPLIED') {
    data.alertedAt = data.alertedAt ?? new Date();
  }

  // When the user marks a job APPLIED and tracking is on, seed the funnel
  // so it shows up on /applications immediately. Don't overwrite existing
  // pipelineStage / appliedAt — user may have backdated them.
  let seedEvent: StageEventData | null = null;
  if (parsed.data.status === 'APPLIED') {
    const settings = await getSettings();
    if (settings.applicationTrackingEnabled) {
      const current = await prisma.job.findUnique({
        where: { id },
        select: { pipelineStage: true, appliedAt: true },
      });
      if (current && !current.pipelineStage) {
        data.pipelineStage = 'applied';
        // F5 (ADR 0024): the seeding is a funnel entry — ledger it.
        seedEvent = stageChangeEvent(id, null, 'applied', current.appliedAt, new Date());
      }
      if (!current?.appliedAt) data.appliedAt = new Date();
    }

    // Stage C. The snapshot is what makes this answerable later: the bytes of
    // a resume are replaced in place on "Upload a new version", so the id and
    // the version alone would name v3 and hand back v5's words. The rules for
    // what counts live in applied-resume.ts, shared with the two paths on
    // /applications that used to record nothing at all (#75).
    const requested = parsed.data.appliedResumeId;
    const picked = requested ? await getResume(requested) : null;
    const columns = appliedResumeColumns(picked);
    data.appliedResume = columns.appliedResumeId
      ? { connect: { id: columns.appliedResumeId } }
      : { disconnect: true };
    data.appliedResumeVersion = columns.appliedResumeVersion;
    data.appliedResumeText = columns.appliedResumeText;
  }

  const update = prisma.job.update({ where: { id }, data });
  if (seedEvent) {
    await prisma.$transaction([update, prisma.jobStageEvent.create({ data: seedEvent })]);
  } else {
    await update;
  }
  return c.redirect(`/jobs/${id}`, 303);
});

jobsRoute.post('/jobs/:id/reclassify', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const job = await prisma.job.findUnique({
    where: { id },
    include: { company: { select: { name: true, atsType: true } } },
  });
  if (!job) return c.text('Not found', 404);
  try {
    await classifyExistingJob(job, { keepStatus: false });
  } catch (err) {
    logger.error({ err, jobId: id }, 'web: reclassify failed');
  }
  return c.redirect(`/jobs/${id}`, 303);
});

/**
 * #162 stage 3 (ADR 0043): read the company's own listing the verifier
 * found, show the difference, and only on the second POST replace the
 * stored text — keeping it — and re-classify.
 */
jobsRoute.post('/jobs/:id/description/refresh', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const job = await prisma.job.findUnique({ where: { id }, include: { company: { select: { name: true } } } });
  if (!job) return c.text('Not found', 404);
  const back = `/jobs/${id}#verification`;
  const [latest] = await listVerificationsForJob(id);
  const url = latest?.postingUrl ?? null;
  if (!url) {
    return flashRedirect(back, 'warn', "The verification recorded no listing on the company's own site — run Verify (deep check) first.");
  }
  const fetched = await fetchPostingText(url, { title: job.title });
  if (!fetched.ok) return flashRedirect(back, 'warn', `Could not read the company's listing: ${fetched.error}`);
  const text = normaliseDescription(fetched.text);
  const { diffLines } = await loadLineDiff();
  const ops = diffLines(normaliseDescription(job.description), text);
  const plan = planRefresh(job.description, text, ops, job.title);
  if (plan.unchanged) return flashRedirect(back, 'ok', describeRefresh(plan));
  return c.html(
    <DescriptionRefreshPage
      job={{ id, title: job.title, companyName: job.company.name }}
      url={url}
      plan={plan}
      rows={foldOps(ops)}
      text={text}
    />,
  );
});

jobsRoute.post('/jobs/:id/description', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const job = await prisma.job.findUnique({ where: { id }, include: { company: { select: { name: true, atsType: true } } } });
  if (!job) return c.text('Not found', 404);
  const form = await c.req.parseBody();
  const text = typeof form.text === 'string' ? normaliseDescription(form.text) : '';
  if (text.length < MIN_DESCRIPTION_CHARS) {
    return flashRedirect(`/jobs/${id}#verification`, 'warn', 'The listing text is too short to be a posting — nothing was replaced.');
  }
  const swap = await refreshDescription(job, text);
  return flashRedirect(`/jobs/${id}`, 'ok', refreshFlash(job.description.length, swap.job.description.length, swap.reclassified));
});

jobsRoute.post('/jobs/:id/description/restore', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const job = await prisma.job.findUnique({ where: { id }, include: { company: { select: { name: true, atsType: true } } } });
  if (!job) return c.text('Not found', 404);
  const swap = await restoreDescription(job);
  if (!swap) return flashRedirect(`/jobs/${id}`, 'warn', 'Nothing to restore — the stored text is the original.');
  return flashRedirect(`/jobs/${id}`, 'ok', restoreFlash(swap.job.description.length, swap.reclassified));
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
  // stops there at $0; `deep=1` (the "Deep check" button) always goes to AI.
  // The whole ladder runs on the progress page (#161): the free rungs' answer
  // lands under their step within seconds, the research step names what it
  // checks, and a closed tab loses nothing. One run per job at a time.
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const deep = form['deep'] === '1';
  const back = `/jobs/${id}#verification`;
  const { run, joined } = claimRun(VERIFY_RUN_KEY(id), {
    steps: deep ? ['verify'] : ['liveness', 'verify'],
    jobTitle: job.title,
    resumeName: '',
    jobId: id,
    heading: { running: 'Checking whether the job is real', failed: 'The check failed' },
    subtitle: deep
      ? 'Straight to the AI research.'
      : job.url
        ? 'The free checks first; the AI only when they cannot say.'
        : 'No posting URL stored, so the free checks have nothing to ask — straight to the AI research.',
    backUrl: back,
    backLabel: 'Back to the job',
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);
  startRun(run.id, async () => {
    if (!deep) {
      const live = await checkLiveness({
        id: job.id,
        url: job.url,
        externalId: job.externalId,
        atsType: job.company.atsType,
        atsToken: job.company.atsToken,
      });
      const how = `${LIVENESS_CODE_LABEL[live.code]} (rung ${live.rung}, no AI spent)`;
      updateRun(run.id, { results: { liveness: how } });
      if (live.liveness !== 'uncertain') {
        updateRun(run.id, {
          stage: 'done',
          resultUrl: back,
          flashKind: live.liveness === 'expired' ? 'warn' : 'ok',
          flash:
            live.liveness === 'expired'
              ? `Posting looks closed — ${how}.`
              : `Posting is live — ${how}. Deep check runs the full ghost-job analysis.`,
        });
        return;
      }
      updateRun(run.id, { stage: 'verify' });
    }
    let reason: string | null = null;
    const row = await verifyJob(
      {
        id: job.id,
        title: job.title,
        companyName: job.company.name,
        location: job.location,
        url: job.url,
        description: job.description,
        postedAt: job.postedAt,
      },
      (r) => {
        reason = r;
      },
    );
    updateRun(
      run.id,
      row
        ? {
            stage: 'done',
            resultUrl: back,
            flash: `Verified: ${row.verdict} (${row.confidence}% confidence) — recommendation: ${row.recommendation}.`,
          }
        : { stage: 'error', error: `Verification failed${reason ? `: ${reason}` : ' — see the web logs'}.` },
    );
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
});

/** One verify run per job at a time — a second click joins it, a reload of the job page sees it. */
const VERIFY_RUN_KEY = (jobId: number): string => `verify:${jobId}`;

function verifyRunView(jobId: number): { id: string; startedAt: number } | null {
  const run = findLiveRun(VERIFY_RUN_KEY(jobId));
  return run ? { id: run.id, startedAt: run.startedAt } : null;
}

/**
 * One comparison of one text against one posting, run on the progress page.
 * Shared by the job page's Compare, the editor's Re-check and the editor's
 * re-upload, so all three behave the same: the memo answers a repeat for free,
 * a second submit of the same thing joins the run in flight, and the finished
 * run lands the user on the analysis it just wrote.
 */
interface ComparisonRequest {
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

async function startComparison(c: Context, req: ComparisonRequest): Promise<Response> {
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
    const row = await matchResumeToJob({ id: resume.id, version: resume.version, text }, job, {
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
  const text = draftText.length > 0 ? draftText : resume.text;
  const toTarget = form.next === 'target' || form.next === 'editor';
  return startComparison(c, {
    jobId: id,
    job: { id: job.id, title: job.title, companyName: job.company.name, location: job.location, description: job.description },
    resume,
    text,
    // The quick check unless the form asked for the full report (ADR 0029).
    mode: parseMatchMode(form.mode),
    // "Rebuild keywords": read the terms out of the posting again instead of
    // inheriting the frame this posting has been carrying (issue #79).
    rebuild: form.rebuild === '1',
    force: form.force === '1',
    resultUrl: (matchId) => (toTarget ? `/jobs/${id}/target?match=${matchId}` : `/jobs/${id}?match=${matchId}#resume-match`),
    label: text === resume.text ? `"${resume.name}"` : 'Draft',
  });
});


/** "Get suggestions" on a quick check: the lazy second call, the verdicts and the score untouched (ADR 0029). */
jobsRoute.post('/jobs/:id/matches/:matchId/suggestions', async (c) => {
  const id = Number(c.req.param('id'));
  const matchId = Number(c.req.param('matchId'));
  if (!Number.isFinite(id) || !Number.isFinite(matchId)) return c.text('Bad id', 400);
  const form = await c.req.parseBody();
  const [job, match] = await Promise.all([
    prisma.job.findUnique({ where: { id }, include: { company: { select: { name: true } } } }),
    getMatch(matchId),
  ]);
  if (!job || !match || match.jobId !== id) return c.text('Not found', 404);
  const resume = await getResume(match.resumeId);
  if (!resume) return c.text('Not found', 404);
  const resultUrl =
    form.next === 'target'
      ? `/jobs/${id}/target?match=${matchId}`
      : form.next === 'cover'
        ? `/jobs/${id}?match=${matchId}#cover-letter`
        : `/jobs/${id}?match=${matchId}#resume-match`;
  // "Rewrite them all" asks for the same call over the same verdicts — the
  // score does not move, only the advice — so the already-has-them guard is
  // the default, not the rule.
  if (form.rewrite !== '1' && readMatchMode(match.breakdown) === 'full') {
    return flashRedirect(resultUrl, 'warn', 'This analysis already has its suggestions.');
  }
  const jobInput = { id: job.id, title: job.title, companyName: job.company.name, location: job.location, description: job.description };
  return c.redirect(startSuggestionsRun({ match, job: jobInput, resumeName: resume.name, resultUrl }), 303);
});

/**
 * "Rewrite" on one suggestion card. Nothing the comparison decided moves — the
 * keyword verdicts, the score and the edit's target all stay — and the new
 * wording goes through the same gate as the old one, so a rewrite cannot claim
 * what the first wording was refused for.
 */
jobsRoute.post('/jobs/:id/matches/:matchId/actions/:index/rewrite', async (c) => {
  const id = Number(c.req.param('id'));
  const matchId = Number(c.req.param('matchId'));
  const index = Number(c.req.param('index'));
  if (!Number.isFinite(id) || !Number.isFinite(matchId) || !Number.isInteger(index) || index < 0) {
    return c.text('Bad id', 400);
  }
  const [job, match] = await Promise.all([
    prisma.job.findUnique({ where: { id }, include: { company: { select: { name: true } } } }),
    getMatch(matchId),
  ]);
  if (!job || !match || match.jobId !== id) return c.text('Not found', 404);
  const form = await c.req.parseBody();
  const back = form.next === 'target' ? `/jobs/${id}/target?match=${matchId}` : `/jobs/${id}?match=${matchId}#resume-match`;

  let reason = '';
  const row = await rewriteAction(
    match,
    { id: job.id, title: job.title, companyName: job.company.name, location: job.location, description: job.description },
    index,
    (r) => {
      reason = r;
    },
  );
  if (!row) {
    return flashRedirect(back, 'err', runFailure('Could not rewrite that suggestion', reason));
  }
  const written = readActions(row.actions)[index];
  return flashRedirect(
    back,
    written?.replacement ? 'ok' : 'warn',
    written?.replacement
      ? 'Rewritten — the new wording is on the card.'
      : `Rewritten, but the new wording was refused: ${written?.why ?? 'it claimed something this resume does not show'}.`,
  );
});

jobsRoute.post('/jobs/:id/cover', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const form = await c.req.parseBody();
  const resumeId = Number(form.resumeId);
  if (!Number.isFinite(resumeId)) return c.text('Bad resume id', 400);
  const tone: CoverTone = COVER_TONES.includes(form.tone as CoverTone)
    ? (form.tone as CoverTone)
    : 'warm';
  const angle = (v: unknown, max = 300) =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : undefined;
  // The card form carries saveAngles=1: its values become the saved prefill
  // (clearing a field clears the saved value). The per-letter Regenerate
  // form omits it and REUSES the saved values, so a bare regenerate never
  // wipes them.
  const fromForm = form.saveAngles === '1';
  // Per letter, never saved with the angles: a regenerate carries the name its letter greeted.
  const addressee = angle(form.addressee, 80);
  const angles = fromForm
    ? {
        whyCompany: angle(form.whyCompany),
        problem: angle(form.problem),
        approach: angle(form.approach),
        notes: angle(form.notes, 500),
      }
    : readCoverAngles((await getSettings()).coverAngles);

  const [job, resume] = await Promise.all([
    prisma.job.findUnique({ where: { id }, include: { company: { select: { name: true } } } }),
    getResume(resumeId),
  ]);
  if (!job || !resume) return c.text('Not found', 404);

  if (fromForm) await setCoverAngles(angles);

  // Tone and angles are part of the request: a second Generate with a
  // different tone is different work, not the same work twice.
  const { run, joined } = claimRun(`cover:${id}:${resume.id}:${tone}:${hashShortId(JSON.stringify({ angles, addressee }))}`, {
    steps: ['letter'],
    jobTitle: job.title,
    resumeName: resume.name,
    jobId: id,
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);
  startRun(run.id, async () => {
    const outcome = await generateCoverLetter(
      { id: resume.id, text: resume.text, version: resume.version },
      { id: job.id, title: job.title, companyName: job.company.name, location: job.location, description: job.description },
      { tone, angles, addressee },
    );
    if (outcome.kind === 'ok') {
      updateRun(run.id, {
        stage: 'done',
        resultUrl: `/jobs/${id}?letter=${outcome.row.id}#cover-letter`,
        flash: `Letter drafted — ${countWords(outcome.row.text)} words, fact-check ${outcome.row.gateVerdict}.`,
      });
    } else if (outcome.kind === 'blocked') {
      // ADR 0021: a letter blocked twice is never shown and never saved.
      updateRun(run.id, {
        stage: 'error',
        error: `The fact checker rejected the letter twice, so nothing was saved. Violations: ${outcome.reasons.join('; ')}.`,
      });
    } else {
      updateRun(run.id, { stage: 'error', error: 'Generation failed — see the web logs.' });
    }
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
});

/** Download a letter as a file; the edited text wins when one exists. */
jobsRoute.get('/jobs/:id/cover/:letterId/file/:fmt', async (c) => {
  const id = Number(c.req.param('id'));
  const letterId = Number(c.req.param('letterId'));
  const fmt = c.req.param('fmt');
  if (!Number.isFinite(id) || !Number.isFinite(letterId)) return c.text('Bad id', 400);
  if (fmt !== 'pdf' && fmt !== 'docx') return c.text('Bad format', 400);
  const letter = await getCoverLetter(letterId);
  if (!letter || letter.jobId !== id) return c.text('Not found', 404);
  const job = await prisma.job.findUnique({
    where: { id },
    include: { company: { select: { name: true } } },
  });
  if (!job) return c.text('Not found', 404);

  const text = letter.editedText ?? letter.text;
  const slug =
    job.company.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') ||
    'company';
  const body = fmt === 'docx' ? buildLetterDocx(text) : buildLetterPdf(text);
  c.header('Content-Type', fmt === 'docx' ? DOCX_MIME : 'application/pdf');
  c.header('Content-Disposition', `attachment; filename="cover-letter-${slug}.${fmt}"`);
  return c.body(new Uint8Array(body));
});

jobsRoute.post('/jobs/:id/cover/:letterId', async (c) => {
  const id = Number(c.req.param('id'));
  const letterId = Number(c.req.param('letterId'));
  if (!Number.isFinite(id) || !Number.isFinite(letterId)) return c.text('Bad id', 400);
  const form = await c.req.parseBody();
  const text = typeof form.text === 'string' ? form.text.replace(/\r\n/g, '\n').trim() : '';
  // The card autosaves over fetch and wants JSON back; the no-JS form post
  // wants the usual redirect + flash.
  const wantsJson = (c.req.header('accept') ?? '').includes('application/json');
  if (text.length === 0) {
    return wantsJson
      ? c.json({ error: 'empty' }, 400)
      : flashRedirect(`/jobs/${id}?letter=${letterId}#cover-letter`, 'err', 'The letter cannot be empty.');
  }

  const letter = await getCoverLetter(letterId);
  if (!letter || letter.jobId !== id) return c.text('Not found', 404);
  const [job, resume, facts, snapshot] = await Promise.all([
    prisma.job.findUnique({ where: { id }, include: { company: { select: { name: true } } } }),
    getResume(letter.resumeId),
    listFacts(),
    getLatestCompanySnapshot(id),
  ]);
  if (!job || !resume) return c.text('Not found', 404);

  // Manual edits are re-checked but never blocked — the gate polices the
  // model, not the user (ADR 0021). A `block` verdict is stored and shown.
  const gate = factCheck({
    text,
    sources: coverGateSources(resume.text, {
      title: job.title,
      companyName: job.company.name,
      location: job.location,
      description: job.description,
    }, snapshot),
    facts,
    addressee: job.company.name,
  });
  const reverted = text === letter.text;
  await updateCoverLetterEdit(letter.id, {
    editedText: reverted ? null : text,
    gateVerdict: gate.verdict,
    gateNotes: gate.reasons,
  });
  if (wantsJson) {
    return c.json({ gateVerdict: gate.verdict, reasons: gate.reasons, reverted });
  }
  const back = `/jobs/${id}?letter=${letter.id}#cover-letter`;
  if (reverted) return flashRedirect(back, 'ok', 'Restored the generated letter.');
  return gate.verdict === 'block'
    ? flashRedirect(back, 'warn', `Edit saved — but the fact check flags it: ${gate.reasons.join('; ')}.`)
    : flashRedirect(back, 'ok', `Edit saved — fact-check ${gate.verdict}.`);
});

jobsRoute.get('/jobs/:id/target', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const [job, matches, verifications] = await Promise.all([
    prisma.job.findUnique({ where: { id }, include: { company: { select: { name: true } } } }),
    listMatchesForJob(id),
    listVerificationsForJob(id),
  ]);
  if (!job) return c.text('Not found', 404);
  const requested = Number(c.req.query('match'));
  const match = matches.find((m) => m.id === requested) ?? matches[0];
  if (!match) {
    return flashRedirect(`/jobs/${id}#resume-match`, 'err', 'Run Compare once — tailoring the resume needs an AI match to work from.');
  }
  const resume = await getResume(match.resumeId);
  if (!resume) return c.text('Not found', 404);
  const file = await describeResumeFile(resume);
  // A one-off check keeps nothing: the comparison holds the text, and Resumes
  // is where a file the user wants to keep is uploaded.
  const fileVerdict = (resume.hidden ? 'A one-off check from the Compare page. ' : '') + file.verdict;
  return c.html(
    <TargetPage
      job={{ id: job.id, title: job.title, companyName: job.company.name, location: job.location, description: job.description }}
      resume={{ id: resume.id, name: resume.name, version: resume.version, ephemeral: resume.hidden }}
      match={match}
      keywords={await orderedKeywords(match, job.description)}
      matches={matches}
      previous={previousFor(match, matches)}
      resumeText={match.resumeText || resume.text}
      verification={verifications[0] ?? null}
      fileVerdict={fileVerdict}
      cleanHref={file.clean ? `/resumes/${resume.id}/render` : null}
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
  const [job, resume] = await Promise.all([
    prisma.job.findUnique({ where: { id }, include: { company: { select: { name: true } } } }),
    getResume(resumeId),
  ]);
  if (!job || !resume) return c.text('Not found', 404);
  const upload = await readResumeUpload(form);
  if ('error' in upload) return flashRedirect(`/jobs/${id}/target`, 'err', upload.error);

  // A new file is a new comparison, full stop. It used to open in the editor
  // within a second as a draft over the OLD analysis while a quick check ran
  // behind it — and the result of that check reached the user as a chip they
  // had to notice and click. Nobody did. Now the file goes through the same
  // progress page as any other comparison, the posting's brief is already
  // stored so only the resume is judged, and the page it lands on shows the
  // new score beside the new text. Nothing is saved: the comparison keeps its
  // own snapshot of the text (`draft`), and the resume row is untouched.
  return startComparison(c, {
    jobId: id,
    job: { id: job.id, title: job.title, companyName: job.company.name, location: job.location, description: job.description },
    resume,
    text: upload.text,
    // The editor's own action always writes the suggestions: a second button
    // for "the same check without the advice" only ever raised the question of
    // which one to press.
    mode: 'full',
    rebuild: false,
    force: false,
    resultUrl: (matchId) => `/jobs/${id}/target?match=${matchId}`,
    label: `"${upload.sourceFilename}"`,
  });
});

/** The person the verifier found, as the letter's prefilled greeting, with the finding beside it (#162 stage 4). */
function addresseeFromVerification(evidence: unknown, companyName: string): { suggested: string | null; finding: string | null } {
  const finding = readEvidence(evidence).find((e) => e.check === 'named_humans' && e.signal === 'legit')?.finding.trim() ?? null;
  return { suggested: finding ? addresseeFromFinding(finding, companyName) : null, finding };
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

/**
 * One sentence on what a Save can do with the resume's own file (ADR 0038),
 * and whether the clean re-render is worth offering beside it (ADR 0039).
 * Only a .docx is read from the database. `clean` is true exactly when Save
 * cannot write the whole file — a PDF, a text version, or a layout the
 * patcher only partly reaches.
 */
async function describeResumeFile(resume: { id: number; sourceFilename: string; hidden: boolean }): Promise<{ verdict: string; clean: boolean }> {
  // A one-off check has no Save, so it is not told what one would keep: the
  // whole sentence below is about a save that is not offered here.
  if (resume.hidden) {
    return { verdict: 'Edits stay in this browser tab — copy them out, or upload the file on Resumes to keep versions of it.', clean: false };
  }
  if (/\.docx$/i.test(resume.sourceFilename)) {
    const row = await getResumeOriginal(resume.id);
    if (row) {
      const structure = docxStructure(Buffer.from(row.original));
      return { verdict: describeStructure(structure), clean: structure.kind !== 'flow' };
    }
  }
  if (/\.pdf$/i.test(resume.sourceFilename)) {
    return {
      verdict: 'This file is a PDF: Save keeps a text version; upload the .docx it was printed from to get a styled file back.',
      clean: true,
    };
  }
  return { verdict: 'This file is plain text: Save keeps a text version.', clean: true };
}
