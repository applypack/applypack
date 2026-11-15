import { Hono } from 'hono';
import { prisma } from '../../db';
import { postingForPrompt } from '../../employer';
import { t } from '../../i18n/t';
import { DEFAULT_INTERVIEW_LANGUAGE, interviewLanguage } from '../../interview/languages';
import { prepareInterview } from '../../interview/prep';
import { MAX_NOTE_CHARS, notesThatFit, readQuestions, sourceKeyOf } from '../../interview/prompts';
import { createCareerNote, deleteCareerNote, getInterviewPrep, lastInterviewLanguage, listCareerNotes, updateCareerNote } from '../../interview/store';
import { ResumeTextError } from '../../resume/docx-text';
import { extractResumeText } from '../../resume/resume-text';
import { getResume } from '../../resume/store';
import { spendHint } from '../cost-hint';
import { flashRedirect } from '../flash';
import { jobHref } from '../job-tabs';
import type { InterviewCardProps } from '../pages/interview-card';
import { idParam } from '../params';
import { runFailure } from '../run-failure';
import { claimRun, startRun, updateRun } from '../target-runs';
import { nameFromFilename, resumeUploadLimit } from '../upload';

/*
 * Interview preparation on a job page (ADR 0065): the person's history, kept
 * once for every job, and the one call that reads it against this posting.
 * Nothing here runs on a visit — the questions are written on a press.
 */

export const interviewRoute = new Hono();

const MAX_TITLE_CHARS = 120;
/** Where the history sits on the tab; every note form leads back to it. */
const HISTORY_ANCHOR = 'history';

/** The job tab a note form was sent from; the jobs list when it named none. */
function backTo(jobId: unknown): string {
  const id = idParam(jobId);
  return Number.isFinite(id) ? jobHref(id, 'interview', {}, HISTORY_ANCHOR) : '/jobs';
}

function field(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** A note's title: what was typed, else the file's name, else the first words of the text. */
function titleFor(typed: string, fileName: string | null, text: string): string {
  const fallback = fileName ? nameFromFilename(fileName) : (text.split('\n').find((line) => line.trim().length > 0) ?? '').trim();
  return (typed || fallback).slice(0, MAX_TITLE_CHARS);
}

interviewRoute.post('/career/notes', resumeUploadLimit('/jobs'), async (c) => {
  const form = await c.req.parseBody();
  const back = backTo(form.jobId);
  const file = form.file instanceof File && form.file.size > 0 ? form.file : null;
  let text = field(form.text);
  if (file) {
    try {
      const read = (await extractResumeText(file.name, Buffer.from(await file.arrayBuffer()))).trim();
      text = text ? `${text}\n\n${read}` : read;
    } catch (err) {
      if (err instanceof ResumeTextError) return flashRedirect(back, 'err', err.reason());
      throw err;
    }
  }
  if (!text) return flashRedirect(back, 'err', t('interview.flash.noteEmpty'));
  if (text.length > MAX_NOTE_CHARS) return flashRedirect(back, 'err', t('interview.flash.noteTooLong', { n: text.length, max: MAX_NOTE_CHARS }));
  await createCareerNote(titleFor(field(form.title), file?.name ?? null, text), text);
  return flashRedirect(back, 'ok', t('interview.flash.noteAdded'));
});

interviewRoute.post('/career/notes/:noteId', async (c) => {
  const noteId = idParam(c.req.param('noteId'));
  if (!Number.isFinite(noteId)) return c.text(t('http.badId'), 400);
  const form = await c.req.parseBody();
  const back = backTo(form.jobId);
  const text = field(form.text);
  if (!text) return flashRedirect(back, 'err', t('interview.flash.noteEmpty'));
  if (text.length > MAX_NOTE_CHARS) return flashRedirect(back, 'err', t('interview.flash.noteTooLong', { n: text.length, max: MAX_NOTE_CHARS }));
  const saved = await updateCareerNote(noteId, titleFor(field(form.title), null, text), text);
  return flashRedirect(back, saved ? 'ok' : 'warn', t(saved ? 'interview.flash.noteSaved' : 'interview.flash.noteGone'));
});

interviewRoute.post('/career/notes/:noteId/delete', async (c) => {
  const noteId = idParam(c.req.param('noteId'));
  if (!Number.isFinite(noteId)) return c.text(t('http.badId'), 400);
  const form = await c.req.parseBody();
  await deleteCareerNote(noteId);
  return flashRedirect(backTo(form.jobId), 'ok', t('interview.flash.noteDeleted'));
});

interviewRoute.post('/jobs/:id/interview', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text(t('http.badId'), 400);
  const form = await c.req.parseBody();
  const language = interviewLanguage(form.language) ?? interviewLanguage(DEFAULT_INTERVIEW_LANGUAGE);
  const resumeId = idParam(form.resumeId);
  const [job, resume, notes] = await Promise.all([
    prisma.job.findUnique({ where: { id }, include: { company: { select: { name: true, atsType: true } } } }),
    Number.isFinite(resumeId) ? getResume(resumeId) : null,
    listCareerNotes(),
  ]);
  if (!job || !language) return c.text(t('http.notFound'), 404);
  const tab = jobHref(id, 'interview');
  // Answers come from the person's own material; with none there is nothing to answer from.
  if (!resume && notes.length === 0) return flashRedirect(jobHref(id, 'interview', {}, HISTORY_ANCHOR), 'err', t('interview.flash.nothingToReadFrom'));

  const { run, joined } = claimRun(`interview:${id}:${language.code}:${resume?.id ?? 'notes'}`, {
    steps: ['interview'],
    jobTitle: job.title,
    resumeName: resume?.name ?? t('interview.run.fromHistory'),
    jobId: id,
    backUrl: tab,
    backLabel: t('job.backToTheJob'),
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);
  startRun(run.id, async () => {
    const row = await prepareInterview(postingForPrompt(job), language, resume ? { id: resume.id, text: resume.text } : null);
    if (row) {
      updateRun(run.id, { stage: 'done', resultUrl: tab, flash: t('interview.flash.prepared', { n: readQuestions(row.questions).length }) });
    } else {
      updateRun(run.id, { stage: 'error', error: runFailure(t('interview.run.failedWhat'), '', t('interview.run.failedNext')) });
    }
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
});

/** Everything the job page's Interview tab shows; no call is spent to render it. */
export async function loadInterviewView(
  job: { id: number; description: string },
  resumes: { id: number; label: string }[],
  suggestedResumeId: number | null,
): Promise<InterviewCardProps> {
  const [prep, notes, lastLanguage, costHint] = await Promise.all([getInterviewPrep(job.id), listCareerNotes(), lastInterviewLanguage(), spendHint('interview-prep')]);
  const language = interviewLanguage(prep?.language ?? lastLanguage) ?? interviewLanguage(DEFAULT_INTERVIEW_LANGUAGE);
  return {
    jobId: job.id,
    resumes,
    suggestedResumeId,
    languageCode: language?.code ?? DEFAULT_INTERVIEW_LANGUAGE,
    prep: prep && {
      language: interviewLanguage(prep.language),
      questions: readQuestions(prep.questions),
      createdAt: prep.createdAt,
      stale: prep.sourceKey !== sourceKeyOf(job.description, notes),
    },
    notes,
    notesRead: notesThatFit(notes).length,
    costHint,
  };
}
