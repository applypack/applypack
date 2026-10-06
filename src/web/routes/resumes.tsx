/** @jsxImportSource hono/jsx */
import { Hono, type Context } from 'hono';
import { sameTextAs } from '../../resume/duplicate';
import { idParam } from '../params';
import { onceGuard } from '../once-guard';
import { logger } from '../../logger';
import type { ResumeReview } from '@prisma/client';
import { reviewResume } from '../../resume/review';
import { scanInBackground, scanResume } from '../../resume/scan';
import type { ResumeScan } from '../../resume/prompts';
import { matchResumeToJob } from '../../resume/match';
import { prisma } from '../../db';
import {
  createResume,
  findResumeWithText,
  deleteImpact,
  deleteResume,
  getLatestReviewForResume,
  getPreviousReview,
  getResume,
  getResumeOriginal,
  latestReviewByResume,
  listFacts,
  listLatestKeywordTables,
  listMatchesForResume,
  listResumes,
  matchStatsByResume,
  renameResume,
  replaceResumeFile,
  type ResumeSummary,
  saveReviewAnswer,
  saveResumeTextVersion,
  setDefaultResume,
  replaceResumeBytes,
  versionFileName,
} from '../../resume/store';
import { readAnswers, unansweredAsks } from '../../resume/answers';
import { describeStructure, docxStructure, type DocxStructure } from '../../resume/docx-structure';
import { patchDocx } from '../../resume/docx-patch';
import { readProps, withProps, type DocxProps } from '../../resume/docx-props';
import { DOCX_MIME } from '../../resume/docx-write';
import { cleanDocx } from '../../resume/draft-document';
import { knobsFrom } from '../../resume/render/knobs';
import { resumeStyle } from '../resume-style';
import { deltaSentence, reviewDelta, type ReviewDelta, type ReviewSnapshot } from '../../resume/review-delta';
import { readReviewAdvice, readReviewGrades } from '../../resume/prompts';
import { coverage, MIN_POSTINGS } from '../../resume/coverage';
import { loadKeywordMatcher } from '../../resume/keyword-matcher';
import { readReviewPromptVersion } from '../../resume/review-score';
import { parseWarnings } from '../../resume/parse-warnings';
import { listProfilesForResume } from '../../profiles';
import { createProfileFromResume, newProfileDraft } from '../profile-from-resume';
import { ResumeDetailPage } from '../pages/resume-detail';
import { FormatComparePage } from '../pages/format-compare';
import { compareFormats, formatSides } from '../format-compare';
import { loadLineDiff } from '../../resume/line-diff';
import { ResumesPage } from '../pages/resumes';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { claimRun, startRun, updateRun } from '../target-runs';
import { runFailure } from '../run-failure';
import { hashShortId } from '../../text-utils';
import {
  MAX_RESUME_NAME_CHARS,
  nameFromFilename,
  readResumeUpload,
  resumeUploadLimit,
} from '../upload';
import { t } from '../../i18n/t';

const MIN_DRAFT_CHARS = 200;
/** A resume runs to a few thousand characters; the model reads 30 k. Past this it is not a resume. */
const MAX_DRAFT_CHARS = 200_000;

export const resumesRoute = new Hono();

resumesRoute.get('/resumes', async (c) => {
  const [resumes, facts, stats, reviews] = await Promise.all([
    listResumes(),
    listFacts(),
    matchStatsByResume(),
    latestReviewByResume(),
  ]);
  return c.html(
    <ResumesPage
      resumes={resumes.map((r) => ({
        ...r,
        matches: stats.get(r.id) ?? null,
        review: reviews.get(r.id) ?? null,
      }))}
      facts={facts}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

resumesRoute.post('/resumes', resumeUploadLimit('/resumes'), onceGuard(() => 'resumes:upload', () => '/resumes'), async (c) => {
  const form = await c.req.parseBody();
  const upload = await readResumeUpload(form);
  if ('error' in upload) return flashRedirect('/resumes', 'err', upload.error);
  // R16: the same text again is not a second resume, and not a second scan to pay for.
  const same = await findResumeWithText(upload.text);
  if (same) {
    return flashRedirect(`/resumes/${same.id}`, 'warn', t('resume.flash.sameAsExisting', { name: same.name, version: same.version }));
  }
  const name =
    typeof form.name === 'string' && form.name.trim().length > 0
      ? form.name.trim().slice(0, MAX_RESUME_NAME_CHARS)
      : nameFromFilename(upload.sourceFilename);
  const resume = await createResume({ name, ...upload });
  return startScanRun(c, resume, {
    subtitle: t('resume.run.scanSubtitle', { name }),
    onScanned: () => t('resume.flash.uploaded', { name }),
    onFailed: t('resume.flash.uploadedScanFailed', { name }),
  });
});

resumesRoute.post('/resumes/:id/replace', resumeUploadLimit('/resumes'), onceGuard((c) => `resumes:replace:${c.req.param('id')}`, (c) => `/resumes/${c.req.param('id')}`), async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const current = await getResume(id);
  if (!current) return c.text(t('http.notFound'), 404);
  const upload = await readResumeUpload(await c.req.parseBody());
  if ('error' in upload) return flashRedirect(`/resumes/${id}`, 'err', upload.error);
  // R16: a new version that reads like the one in place changes nothing, and would pay for a scan of it.
  if (sameTextAs(upload.text, [current])) {
    return flashRedirect(`/resumes/${id}`, 'warn', t('resume.flash.sameAsCurrent', { version: current.version }));
  }
  const resume = await replaceResumeFile(id, upload);
  return startScanRun(c, resume, {
    subtitle: t('resume.run.rescanSubtitle', { name: resume.name, version: resume.version }),
    onScanned: () => t('resume.flash.versionUploaded', { version: resume.version }),
    onFailed: t('resume.flash.versionScanFailed', { version: resume.version }),
  });
});

// TASKS R14: the same resume as another file, read beside the saved one — rendered, never stored, no AI.
resumesRoute.post('/resumes/:id/compare-format', resumeUploadLimit('/resumes'), async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const resume = await getResume(id);
  if (!resume) return c.text(t('http.notFound'), 404);
  const upload = await readResumeUpload(await c.req.parseBody());
  if ('error' in upload) return flashRedirect(`/resumes/${id}#ats`, 'err', upload.error);
  const [saved, uploaded] = formatSides(resume.sourceFilename, resume.version, upload.sourceFilename);
  const { diffLines } = await loadLineDiff();
  const result = compareFormats({ ...saved, text: resume.text }, { ...uploaded, text: upload.text }, diffLines);
  return c.html(<FormatComparePage resume={resume} files={[resume.sourceFilename, upload.sourceFilename]} result={result} />);
});

resumesRoute.get('/resumes/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const [resume, matches, review, linkedProfiles, impact, tables, facts] = await Promise.all([
    getResume(id),
    listMatchesForResume(id),
    getLatestReviewForResume(id),
    listProfilesForResume(id),
    deleteImpact(id),
    listLatestKeywordTables(id),
    listFacts(),
  ]);
  if (!resume) return c.text(t('http.notFound'), 404);
  // What the compared postings keep asking for (N10): no AI, the stored
  // tables read against the text as it is now. The scratch row's tables
  // belong to one-off files, not to a resume.
  const missing =
    resume.hidden || tables.length < MIN_POSTINGS ? null : coverage(tables, resume.text, facts, await loadKeywordMatcher());
  // The template check is recomputed from the bytes on every view (ADR 0038) —
  // 40 KB of XML, sub-millisecond. Only a .docx is read; a 5 MB PDF is not
  // pulled out of the database to learn its extension.
  const original = isDocx(resume.sourceFilename) ? await getResumeOriginal(id) : null;
  const docx = original ? Buffer.from(original.original) : null;
  const structure: DocxStructure | null = docx ? docxStructure(docx) : null;
  const props: DocxProps | null = docx ? readProps(docx) : null;
  // The run before this one, so the card can say what the edits changed.
  const previous = review ? await getPreviousReview(id, review.id) : null;
  return c.html(
    <ResumeDetailPage
      resume={resume}
      matches={matches}
      coverage={missing}
      review={review}
      answers={readAnswers(resume.answers)}
      reviewDelta={deltaFor(review, previous)}
      deleteImpact={impact}
      warnings={parseWarnings(resume.text)}
      structure={structure}
      props={props}
      // The draft the "Create a search" button would save — rendered, not
      // stored (ADR 0015). Only a scanned resume has anything to say.
      search={{
        linkedProfiles,
        draft: resume.scannedAt && !resume.hidden ? newProfileDraft(resume) : null,
      }}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

resumesRoute.get('/resumes/:id/download', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const row = await getResumeOriginal(id);
  if (!row) return c.text(t('http.notFound'), 404);
  const filename = row.sourceFilename.replace(/["\r\n]/g, '');
  return new Response(Buffer.from(row.original), {
    headers: {
      'Content-Type': row.mimeType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

resumesRoute.post('/resumes/:id/draft', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const current = await getResume(id);
  if (!current) return c.text(t('http.notFound'), 404);
  const form = await c.req.parseBody();
  const text = typeof form.text === 'string' ? form.text.replace(/\r\n/g, '\n').trim() : '';
  if (text.length < MIN_DRAFT_CHARS) {
    return flashRedirect(`/resumes/${id}`, 'err', t('resume.flash.draftTooShort'));
  }
  if (text.length > MAX_DRAFT_CHARS) {
    return flashRedirect(`/resumes/${id}`, 'err', t('resume.flash.draftTooLong', { max: MAX_DRAFT_CHARS }));
  }
  // A one-off check from the Tailor resume page is not a resume: its text belongs to
  // the comparison, which keeps its own snapshot of it. Saving one used to mint
  // a row on /resumes named after the company — the surest way to end up with
  // six resumes and no idea which is the real one.
  if (current.hidden) {
    return flashRedirect(`/resumes`, 'err', t('resume.flash.oneOffNotSaved'));
  }
  // What the edits are relative to — the text the editor started from. Without
  // it a .docx cannot be patched (the diff would be against nothing) and the
  // save is the clean version (ADR 0059).
  const baseText = typeof form.baseText === 'string' ? form.baseText.replace(/\r\n/g, '\n').trim() : '';
  const jobId = idParam(form.jobId);
  const job = Number.isFinite(jobId)
    ? await prisma.job.findUnique({ where: { id: jobId }, include: { company: { select: { name: true } } } })
    : null;

  // Claimed BEFORE the save, not after: this route's side effect is a new
  // resume version, so a second submit that got as far as saving would leave
  // a duplicate version behind whatever the run registry then did. Keyed on
  // the text, because that is what the user submitted (issue #76).
  const { run, joined } = claimRun(`draft:${id}:${hashShortId(text)}:${job?.id ?? ''}`, {
    steps: job ? ['keywords'] : ['scan'],
    jobTitle: job?.title ?? '',
    resumeName: '',
    jobId: job?.id,
    heading: { running: t('resume.run.draftRunning'), failed: t('resume.run.draftFailed') },
    subtitle: t('resume.run.saving'),
    backUrl: `/resumes/${id}`,
    backLabel: t('resume.backToResume'),
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);

  // The save happens inside the run, so a failure lands on the progress page
  // as an error instead of stranding a claimed run nothing will ever finish.
  // Scan and match are the slow part after it: two AI calls back to back is
  // the worst wait on the site, which is why this gets a run at all.
  startRun(run.id, async () => {
    const { resume, note, document } = await saveEdited(id, text, baseText);
    // Every sentence below opens the same way: the version it was saved as, and how.
    const saved = { version: resume.version, note };
    // TASKS R25: the saved file — the user's own .docx written into, or the clean one — handed back.
    const downloadUrl = document ? `/resumes/${resume.id}/download` : undefined;
    updateRun(run.id, {
      resumeName: resume.name,
      subtitle: t(job ? 'resume.save.scoring' : 'resume.save.done', saved),
    });
    let reason = '';
    const noteReason = (r: string) => {
      reason = r;
    };
    if (!job) {
      const scan = await scanResume(resume, noteReason);
      updateRun(run.id, scan
        ? { stage: 'done', resultUrl: `/resumes/${resume.id}`, flash: t('resume.save.done', saved), downloadUrl }
        : { stage: 'error', error: runFailure(t('resume.save.scanFailed', saved), reason, t('resume.save.scanFailedNext')) });
      return;
    }
    // The match reads the text, never the scan (target-plan §3.1 item 2), so
    // the scan runs behind it as the re-upload route's does — it was 63 % of
    // a six-minute wait on a CLI engine (#168).
    scanInBackground(resume);
    const match = await matchResumeToJob(
      resume,
      { id: job.id, title: job.title, companyName: job.employer ?? job.company.name, location: job.location, description: job.description },
      { onError: noteReason },
    );
    updateRun(run.id, match
      ? {
          stage: 'done',
          resultUrl: `/jobs/${job.id}/target?match=${match.id}`,
          flash: t('resume.save.checked', { ...saved, score: match.matchScore }),
          downloadUrl,
        }
      : {
          stage: 'error',
          error: runFailure(t('resume.save.compareFailed', saved), reason, t('resume.save.compareFailedNext')),
        });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
});

function isDocx(filename: string): boolean {
  return /\.docx$/i.test(filename);
}

/**
 * Save the editor's text as the next version of the resume — as a document,
 * never as a Markdown file. When the file is a .docx the template check
 * allows, the user's own file is patched with the edits (ADR 0038); otherwise
 * the version is the clean .docx the Tailor page's document pane drew, in the
 * typeface read off the file it replaces (ADR 0039), and `note` says why. A
 * text version is left only for a clean file that would drop a line.
 *
 * There is no "save as a tailored copy" any more: one comparison per posting
 * used to mint one more row on /resumes, named after the company, and a user
 * with four applications had eight resumes and no idea which was theirs.
 */
async function saveEdited(
  id: number,
  text: string,
  baseText: string,
): Promise<{ resume: ResumeSummary; note: string; document: boolean }> {
  const [current, row] = await Promise.all([getResume(id), getResumeOriginal(id)]);
  if (!current) throw new Error(`resume ${id} is gone`);
  const nextVersion = current.version + 1;
  const name = current.name;
  let file: { sourceFilename: string; mimeType: string; original: Buffer; text: string } | null = null;
  let why = row && /\.pdf$/i.test(row.sourceFilename) ? t('resume.save.why.pdf') : t('resume.save.why.text');
  if (row && isDocx(row.sourceFilename)) {
    const original = Buffer.from(row.original);
    if (!baseText) why = t('resume.save.why.noBase');
    else if (docxStructure(original).kind === 'unsupported') why = t('resume.save.why.unsupported');
    else {
      const patched = await patchDocx(original, baseText, text);
      if (patched.ok) {
        const r = patched.report;
        file = { sourceFilename: versionFileName(name, nextVersion, 'docx'), mimeType: DOCX_MIME, original: patched.docx, text: patched.text };
        why = t('resume.save.why.patched', { changed: r.changed, added: r.added, removed: r.removed });
        logger.info({ id, ...r, bytes: patched.docx.length }, 'resume: docx patched');
      } else {
        why = t('resume.save.why.refused', { reason: patched.shown });
        logger.info({ id, reason: patched.reason, skipped: patched.report?.skipped }, 'resume: docx patch refused');
      }
    }
  }
  let note = why;
  if (!file) {
    const style = row ? await resumeStyle(current, row) : undefined;
    const clean = await cleanDocx(text, knobsFrom(style), style?.layout ?? null);
    if (clean.missing.length === 0) {
      file = { sourceFilename: versionFileName(name, nextVersion, 'docx'), mimeType: DOCX_MIME, original: clean.docx, text: clean.text };
      note = t('resume.save.note.clean', { why });
    } else {
      note = t('resume.save.note.text', { why, n: clean.missing.length });
      logger.info({ id, missing: clean.missing.slice(0, 3) }, 'resume: clean save would drop lines');
    }
  }
  const payload = file ?? {
    sourceFilename: versionFileName(name, nextVersion, 'md'),
    mimeType: 'text/markdown',
    original: Buffer.from(text, 'utf8'),
    text,
  };
  return { resume: await replaceResumeFile(id, payload), note, document: file !== null };
}

/**
 * "Fix document properties": the template author's name and title out, the
 * candidate's in, bytes only — the words, the version and the scan stay.
 * Offered on click with the current values shown, never done silently.
 */
resumesRoute.post('/resumes/:id/props', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const [resume, row] = await Promise.all([getResume(id), getResumeOriginal(id)]);
  if (!resume || !row) return c.text(t('http.notFound'), 404);
  if (!isDocx(row.sourceFilename)) return flashRedirect(`/resumes/${id}`, 'err', t('resume.flash.propsOnlyDocx'));
  const candidate = resume.text.split('\n')[0]?.trim() || resume.name;
  const fixed = await withProps(Buffer.from(row.original), { title: `${candidate} — Resume`, creator: candidate, lastModifiedBy: candidate });
  await replaceResumeBytes(id, fixed);
  return flashRedirect(`/resumes/${id}`, 'ok', t('resume.flash.propsFixed', { candidate }));
});

/**
 * "Create a search from this resume" — the card above the button already
 * showed exactly what this writes, so one press is enough (ADR 0015).
 */
resumesRoute.post('/resumes/:id/profile', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const resume = await getResume(id);
  if (!resume || resume.hidden) return c.text(t('http.notFound'), 404);
  if (!resume.scannedAt) {
    return flashRedirect(`/resumes/${id}`, 'err', t('resume.flash.scanFirst'));
  }
  const profile = await createProfileFromResume(resume);
  logger.info({ profileId: profile.id, resumeId: id }, 'profile: created from resume');
  return flashRedirect(
    `/settings?tab=profile&profile=${profile.id}`,
    'ok',
    t('resume.flash.searchCreated', { search: profile.name, resume: resume.name }),
  );
});

resumesRoute.post('/resumes/:id/rescan', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const resume = await getResume(id);
  if (!resume) return c.text(t('http.notFound'), 404);
  return startScanRun(c, resume, {
    subtitle: t('resume.run.scanSubtitle', { name: resume.name }),
    onScanned: (scan) => t('resume.flash.scanned', { skills: scan.skills.length, issues: scan.issues.length }),
    onFailed: t('resume.flash.scanFailed'),
  });
});

/** A stored review as the delta reads it; null passes straight through. */
function snapshotOf(review: ResumeReview | null): ReviewSnapshot | null {
  if (!review) return null;
  return {
    score: review.reviewScore,
    version: review.resumeVersion,
    promptVersion: readReviewPromptVersion(review.breakdown),
    grades: readReviewGrades(review.grades).map((g) => ({ dimension: g.dimension, grade: g.grade })),
  };
}

/** What moved between two runs of one resume — null unless both exist. */
function deltaFor(current: ResumeReview | null, previous: ResumeReview | null): ReviewDelta | null {
  const now = snapshotOf(current);
  return now ? reviewDelta(snapshotOf(previous), now) : null;
}

/**
 * "Run strength review" — one AI call, on demand only (resumes-plan §B.1). The
 * run registry shows the rubric being walked instead of a spinner; nothing
 * about the resume changes, so a failure costs the user nothing but the wait.
 */
resumesRoute.post('/resumes/:id/review', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const resume = await getResume(id);
  if (!resume) return c.text(t('http.notFound'), 404);
  const { text, version, roleTypes, answers } = resume;
  const answered = readAnswers(answers);

  // Two tabs used to start two reviews of the same version and store both
  // (PR #86's follow-up); the second POST now joins the first. The answers are
  // part of the key, hashed rather than counted: correcting a figure leaves the
  // count alone but is a different review, and must not join the run that
  // predates it.
  const { run, joined } = claimRun(`review:${id}:v${version}:${hashShortId(JSON.stringify(answered))}`, {
    steps: ['review'],
    jobTitle: '',
    resumeName: resume.name,
    heading: { running: t('review.run.running'), failed: t('review.run.failed') },
    subtitle: t('review.run.subtitle'),
    backUrl: `/resumes/${id}`,
    backLabel: t('resume.backToResume'),
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);
  startRun(run.id, async () => {
    const row = await reviewResume({ id, text, version, roleTypes, answers });
    const delta = deltaFor(row, row ? await getPreviousReview(id, row.id) : null);
    updateRun(run.id, row
      ? {
          stage: 'done',
          resultUrl: `/resumes/${id}`,
          flash: delta
            ? deltaSentence(delta)
            : t('review.flash.done', { score: row.reviewScore, headline: row.headline }),
        }
      : { stage: 'error', error: t('review.run.error') });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
});

/**
 * One answer to one of the review's questions (ADR 0030 phase 3). No AI call
 * and no re-run: the answer is stored, and the NEXT review reads it. Saying so
 * in the flash matters — this is a button that spends nothing, and the user
 * should know which button does.
 */
resumesRoute.post('/resumes/:id/answers', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const form = await c.req.parseBody();
  const question = typeof form.question === 'string' ? form.question : '';
  const answer = typeof form.answer === 'string' ? form.answer : '';
  if (question.trim().length === 0) return c.text('Bad answer', 400);

  const saved = await saveReviewAnswer(id, question, answer);
  if (saved === null) return c.text(t('http.notFound'), 404);
  const open = unansweredAsks(
    readReviewAdvice((await getLatestReviewForResume(id))?.advice).map((a) => a.ask),
    saved,
  ).length;
  const cleared = answer.trim().length === 0;
  logger.info({ resumeId: id, answers: saved.length, open, cleared }, 'resume: review answer saved');
  return flashRedirect(
    `/resumes/${id}#resume-strength`,
    'ok',
    cleared ? t('review.flash.answerRemoved') : t('review.flash.answerSaved', { open }),
  );
});

/**
 * Rename a resume (§12 quick win). The name is what every picker, flash and
 * "applied with" line says, and until now it was whatever the uploaded file
 * happened to be called — `nameFromFilename` on a download from a job board
 * produces things like "Alex Doe Senior Backend Resume (3)".
 */
resumesRoute.post('/resumes/:id/rename', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const form = await c.req.parseBody();
  const name = (typeof form.name === 'string' ? form.name : '').trim().slice(0, MAX_RESUME_NAME_CHARS);
  if (name.length === 0) {
    return flashRedirect(`/resumes/${id}`, 'err', t('resume.flash.needsName'));
  }
  const renamed = await renameResume(id, name);
  if (!renamed) return c.text(t('http.notFound'), 404);
  return flashRedirect(`/resumes/${id}`, 'ok', t('resume.flash.renamed', { name }));
});

resumesRoute.post('/resumes/:id/default', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  if (!(await getResume(id))) return c.text(t('http.notFound'), 404);
  await setDefaultResume(id);
  return flashRedirect(`/resumes/${id}`, 'ok', t('resume.flash.defaultUpdated'));
});

resumesRoute.post('/resumes/:id/delete', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  // A row that was not there is not a deletion. Saying it was sent a user
  // looking for a resume they still have back to a list that still shows it.
  const deleted = await deleteResume(id);
  if (!deleted) {
    return flashRedirect('/resumes', 'warn', t('resume.flash.deleteMissing'));
  }
  logger.info({ id }, 'resume: deleted');
  return flashRedirect('/resumes', 'ok', t('resume.flash.deleted'));
});

/**
 * Upload, replace and rescan all end in the same ~60 s call to the resume
 * model. Awaiting it inline froze the browser on a live form: the submit
 * button stayed enabled, so a second click created a duplicate resume *and*
 * a second AI call. The run registry — already carrying /target and
 * /jobs/:id/match — returns the POST immediately and shows real progress.
 */
function startScanRun(
  c: Context,
  resume: ResumeSummary,
  copy: { subtitle: string; onScanned: (scan: ResumeScan) => string; onFailed: string },
): Response {
  const { id, name, text } = resume;
  const { run, joined } = claimRun(`scan:${id}:${hashShortId(text)}`, {
    steps: ['scan'],
    jobTitle: '',
    resumeName: name,
    heading: { running: t('resume.run.scanRunning'), failed: t('resume.run.scanFailed') },
    subtitle: copy.subtitle,
    // The row exists either way, so the error state has somewhere real to go.
    backUrl: `/resumes/${id}`,
    backLabel: t('resume.backToResume'),
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);
  startRun(run.id, async () => {
    const scan = await scanResume({ id, text });
    updateRun(run.id, scan
      ? { stage: 'done', resultUrl: `/resumes/${id}`, flash: copy.onScanned(scan) }
      : { stage: 'error', error: copy.onFailed });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
}

/** "Alex_Doe_Senior_Backend_Resume.docx" → "Alex Doe Senior Backend Resume". */
