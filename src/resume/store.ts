import type { CandidateFact, CoverLetter, Prisma, Resume, ResumeMatch, ResumeReview } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { readAnswers, upsertAnswer, type ReviewAnswer } from './answers';
import { readFrameReason, type FrameReason } from './keyword-frame';
import { effectiveKeywords } from './keyword-overrides';
import { readMatchMode, storedBreakdown, withSuggestionsMode, type MatchMode } from './match-mode';
import { readPromptVersion } from './match-reuse';
import type { MatchKeyword, MatchSuggestions, ResumeMatchResult, ResumeReviewResult, ResumeScan } from './prompts';
import { storedReviewBreakdown, type ReviewBreakdown } from './review-score';
import { readBreakdown, scoreMatch, type ScoreBreakdown } from './score';

/** Resume without the uploaded bytes — what every page and prompt works with. */
export type ResumeSummary = Omit<Resume, 'original'>;

const WITHOUT_ORIGINAL = { original: true } as const;

export async function listResumes(): Promise<ResumeSummary[]> {
  return prisma.resume.findMany({
    where: { hidden: false },
    omit: WITHOUT_ORIGINAL,
    orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
  });
}

export async function getResume(id: number): Promise<ResumeSummary | null> {
  return prisma.resume.findUnique({ where: { id }, omit: WITHOUT_ORIGINAL });
}

export async function getResumeOriginal(
  id: number,
): Promise<Pick<Resume, 'sourceFilename' | 'mimeType' | 'original'> | null> {
  return prisma.resume.findUnique({
    where: { id },
    select: { sourceFilename: true, mimeType: true, original: true },
  });
}

export async function createResume(input: {
  name: string;
  sourceFilename: string;
  mimeType: string;
  original: Buffer;
  text: string;
}): Promise<ResumeSummary> {
  // The first upload becomes the default so the job page has a preselection.
  const isDefault = (await prisma.resume.count()) === 0;
  const row = await prisma.resume.create({
    // Prisma 6 types Bytes as Uint8Array<ArrayBuffer>; a Buffer's backing store may be shared.
    data: { ...input, original: new Uint8Array(input.original), isDefault },
    omit: WITHOUT_ORIGINAL,
  });
  logger.info({ id: row.id, name: row.name, chars: input.text.length }, 'resume: created');
  return row;
}

/**
 * The /target scratch resume: one hidden row, replaced in place on every
 * ephemeral compare — nothing accumulates in the user's Resumes.
 */
export async function upsertScratchResume(input: {
  name: string;
  sourceFilename: string;
  mimeType: string;
  original: Buffer;
  text: string;
}): Promise<ResumeSummary> {
  const existing = await prisma.resume.findFirst({ where: { hidden: true }, select: { id: true } });
  const data = { ...input, original: new Uint8Array(input.original) };
  if (existing) {
    const row = await prisma.resume.update({
      where: { id: existing.id },
      data: { ...data, version: { increment: 1 }, scannedAt: null },
      omit: WITHOUT_ORIGINAL,
    });
    logger.info({ id: row.id, chars: input.text.length }, 'resume: scratch replaced');
    return row;
  }
  const row = await prisma.resume.create({
    data: { ...data, hidden: true, isDefault: false },
    omit: WITHOUT_ORIGINAL,
  });
  logger.info({ id: row.id, chars: input.text.length }, 'resume: scratch created');
  return row;
}

/** Ephemeral compares keep only the latest analysis — old scratch matches go. */
export async function deleteMatchesForResume(resumeId: number): Promise<number> {
  const r = await prisma.resumeMatch.deleteMany({ where: { resumeId } });
  if (r.count > 0) logger.info({ resumeId, deleted: r.count }, 'resume: old matches cleared');
  return r.count;
}

/** Same rule for letters: replacing the scratch resume retires its letters. */
export async function deleteCoverLettersForResume(resumeId: number): Promise<number> {
  const r = await prisma.coverLetter.deleteMany({ where: { resumeId } });
  if (r.count > 0) logger.info({ resumeId, deleted: r.count }, 'resume: old letters cleared');
  return r.count;
}

/** "Upload new version": swap the file + text, bump version, clear the scan. */
export async function replaceResumeFile(
  id: number,
  input: { sourceFilename: string; mimeType: string; original: Buffer; text: string },
): Promise<ResumeSummary> {
  const row = await prisma.resume.update({
    where: { id },
    data: {
      ...input,
      original: new Uint8Array(input.original),
      version: { increment: 1 },
      scannedAt: null,
    },
    omit: WITHOUT_ORIGINAL,
  });
  logger.info({ id, version: row.version, chars: input.text.length }, 'resume: new version');
  return row;
}

/** Renames a resume; null when the row is gone (deleted in another tab). */
export async function renameResume(id: number, name: string): Promise<ResumeSummary | null> {
  return prisma.resume
    .update({ where: { id }, data: { name }, omit: WITHOUT_ORIGINAL })
    .catch(() => null);
}

export async function deleteResume(id: number): Promise<void> {
  await prisma.resume.delete({ where: { id } }).catch((err) => {
    logger.warn({ err, id }, 'resume: delete failed (already gone?)');
  });
}

export async function setDefaultResume(id: number): Promise<void> {
  await prisma.$transaction([
    prisma.resume.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
    prisma.resume.update({ where: { id }, data: { isDefault: true } }),
  ]);
}

export async function saveResumeScan(id: number, scan: ResumeScan): Promise<void> {
  await prisma.resume.update({
    where: { id },
    data: {
      scannedAt: new Date(),
      title: scan.title,
      seniority: scan.seniority,
      yearsExperience: scan.years_experience,
      skills: scan.skills,
      primarySkills: scan.primary_skills,
      roleTypes: scan.role_types,
      summary: scan.summary,
      issues: scan.issues as Prisma.InputJsonValue,
    },
  });
}

export type MatchWithResume = ResumeMatch & { resume: { id: number; name: string } };
export type MatchWithJob = ResumeMatch & {
  job: { id: number; title: string; company: { name: string } };
};

/** Newest matches win; re-runs accumulate forever, so the lists are capped. */
const MATCH_LIST_LIMIT = 50;

export async function listMatchesForJob(jobId: number): Promise<MatchWithResume[]> {
  return prisma.resumeMatch.findMany({
    where: { jobId },
    include: { resume: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: MATCH_LIST_LIMIT,
  });
}

export async function listMatchesForResume(resumeId: number): Promise<MatchWithJob[]> {
  return prisma.resumeMatch.findMany({
    where: { resumeId },
    include: { job: { select: { id: true, title: true, company: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: MATCH_LIST_LIMIT,
  });
}

/**
 * What deleting a resume touches. The first three cascade, and the letters
 * carry the user's own edited text — the confirm dialog has to say so. The
 * last two are SetNull: a search keeps running but goes back to guessing its
 * resume by skill overlap, and an application keeps its text snapshot but
 * loses the name. Silent either way until the dialog names them.
 */
export async function deleteImpact(resumeId: number): Promise<{
  matches: number;
  letters: number;
  reviews: number;
  searches: number;
  applications: number;
}> {
  const [matches, letters, reviews, searches, applications] = await Promise.all([
    prisma.resumeMatch.count({ where: { resumeId } }),
    prisma.coverLetter.count({ where: { resumeId } }),
    prisma.resumeReview.count({ where: { resumeId } }),
    prisma.profile.count({ where: { resumeId } }),
    prisma.job.count({ where: { appliedResumeId: resumeId } }),
  ]);
  return { matches, letters, reviews, searches, applications };
}

export interface ResumeMatchStats {
  /** Comparisons run against this resume, all versions. */
  count: number;
  /** The best score it has ever reached — the hub's "is this one working?" signal. */
  best: number;
}

/**
 * One groupBy for the whole hub, instead of a query per row. Resumes with no
 * comparison are absent from the map rather than present with zeros: "never
 * compared" and "compared, scored 0" are different answers.
 */
export async function matchStatsByResume(): Promise<Map<number, ResumeMatchStats>> {
  const rows = await prisma.resumeMatch.groupBy({
    by: ['resumeId'],
    _count: { _all: true },
    _max: { matchScore: true },
  });
  return new Map(
    rows.map((r) => [r.resumeId, { count: r._count._all, best: r._max.matchScore ?? 0 }]),
  );
}

/* ---------- strength reviews (docs/resumes-plan.md §B) ---------- */

export async function createReview(input: {
  resumeId: number;
  resumeVersion: number;
  model: string;
  result: ResumeReviewResult;
  /** Computed by review-score.ts — the model never sets the number (ADR 0012). */
  breakdown: ReviewBreakdown;
  /** Rides inside the breakdown JSON, the way the match markers do. */
  promptVersion: number;
}): Promise<ResumeReview> {
  return prisma.resumeReview.create({
    data: {
      resumeId: input.resumeId,
      resumeVersion: input.resumeVersion,
      model: input.model,
      reviewScore: input.breakdown.score,
      headline: input.result.headline,
      grades: input.result.grades as unknown as Prisma.InputJsonValue,
      advice: input.result.advice as unknown as Prisma.InputJsonValue,
      strengths: input.result.strengths,
      breakdown: storedReviewBreakdown(input.breakdown, input) as Prisma.InputJsonValue,
    },
  });
}

/** The review a resume page shows: the most recent run, whatever version it read. */
export async function getLatestReviewForResume(resumeId: number): Promise<ResumeReview | null> {
  return prisma.resumeReview.findFirst({ where: { resumeId }, orderBy: { createdAt: 'desc' } });
}

/**
 * The run before a given one, for the delta (review-delta.ts). Ordered by id,
 * not by `createdAt`: two runs a second apart are exactly what "answer, then
 * re-run" produces, and a timestamp tie would pick arbitrarily.
 */
export async function getPreviousReview(resumeId: number, beforeId: number): Promise<ResumeReview | null> {
  return prisma.resumeReview.findFirst({
    where: { resumeId, id: { lt: beforeId } },
    orderBy: { id: 'desc' },
  });
}

/**
 * The candidate's answers to the review's questions (answers.ts). Read-modify-
 * write of one JSON column, so it takes the row lock the same way a keyword
 * edit does — two answers typed in two tabs must both survive.
 */
export async function saveReviewAnswer(
  resumeId: number,
  question: string,
  answer: string,
): Promise<ReviewAnswer[] | null> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM resume WHERE id = ${resumeId} FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await tx.resume.findUniqueOrThrow({ where: { id: resumeId }, select: { answers: true } });
    const next = upsertAnswer(readAnswers(row.answers), question, answer);
    await tx.resume.update({
      where: { id: resumeId },
      data: { answers: next as unknown as Prisma.InputJsonValue },
    });
    return next;
  });
}

export type ReviewSummary = Pick<ResumeReview, 'resumeId' | 'resumeVersion' | 'reviewScore' | 'createdAt'>;

/**
 * Latest review per resume for the hub column — one query, not one per row.
 * A resume with no review is absent from the map: "never reviewed" and
 * "reviewed, scored 0" are different answers (as in matchStatsByResume).
 */
export async function latestReviewByResume(): Promise<Map<number, ReviewSummary>> {
  const rows = await prisma.resumeReview.findMany({
    distinct: ['resumeId'],
    orderBy: [{ resumeId: 'asc' }, { createdAt: 'desc' }],
    select: { resumeId: true, resumeVersion: true, reviewScore: true, createdAt: true },
  });
  return new Map(rows.map((r) => [r.resumeId, r]));
}

/** A resume version made from edited text (the targeted view's "Save as vN") — a .md file, no docx. */
/** "Senior Backend PHP" + 5 + ".docx" → "senior-backend-php-v5.docx". */
export function versionFileName(name: string, version: number, ext: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'resume';
  return `${slug}-v${version}.${ext}`;
}

export async function saveResumeTextVersion(id: number, text: string): Promise<ResumeSummary> {
  const current = await prisma.resume.findUniqueOrThrow({ where: { id }, select: { name: true, version: true } });
  return replaceResumeFile(id, {
    sourceFilename: versionFileName(current.name, current.version + 1, 'md'),
    mimeType: 'text/markdown',
    original: Buffer.from(text, 'utf8'),
    text,
  });
}

/**
 * Swap the stored bytes and nothing else — the text, the version and the scan
 * stay. For the document-properties fix (ADR 0038): the words did not change,
 * so a new version and a re-scan would be noise.
 */
export async function replaceResumeBytes(id: number, original: Buffer): Promise<void> {
  await prisma.resume.update({ where: { id }, data: { original: new Uint8Array(original) } });
  logger.info({ id, bytes: original.length }, 'resume: bytes replaced');
}

export async function createMatch(input: {
  jobId: number;
  resumeId: number;
  resumeVersion: number;
  resumeText: string;
  draft: boolean;
  model: string;
  result: ResumeMatchResult;
  /** Computed by score.ts — the model never sets the number (ADR 0012). */
  breakdown: ScoreBreakdown;
  /** All three ride inside the breakdown JSON — the memo key (match-reuse.ts), the row's shape (ADR 0029) and where its keyword frame came from (keyword-frame.ts). */
  promptVersion: number;
  mode: MatchMode;
  frame: FrameReason;
}): Promise<ResumeMatch> {
  const r = input.result;
  return prisma.resumeMatch.create({
    data: {
      jobId: input.jobId,
      resumeId: input.resumeId,
      resumeVersion: input.resumeVersion,
      resumeText: input.resumeText,
      draft: input.draft,
      model: input.model,
      matchScore: input.breakdown.score,
      summary: r.summary,
      strengths: r.strengths,
      redFlags: r.red_flags,
      cautions: r.cautions,
      keywords: r.keywords as Prisma.InputJsonValue,
      actions: r.actions as Prisma.InputJsonValue,
      removals: r.removals as Prisma.InputJsonValue,
      breakdown: storedBreakdown(input.breakdown, input) as Prisma.InputJsonValue,
      hardRequirements: r.hard_requirements as Prisma.InputJsonValue,
    },
  });
}

export async function getMatch(id: number): Promise<ResumeMatch | null> {
  return prisma.resumeMatch.findUnique({ where: { id } });
}

/** Latest analysis of a posting, any resume — its keyword frame keeps re-runs comparable. */
export async function getLatestMatchForJob(jobId: number): Promise<ResumeMatch | null> {
  return prisma.resumeMatch.findFirst({ where: { jobId }, orderBy: { createdAt: 'desc' } });
}

export interface KeywordRescore<T> {
  /** The list to store, or null to leave the row exactly as it is. */
  keywords: MatchKeyword[] | null;
  /** Handed back to the caller — the pure edit's own result, for the flash. */
  detail: T;
}

export interface RescoreOutcome<T> {
  detail: T;
  /** The stored score before and after the edit; equal when nothing was written. */
  before: number;
  after: number;
  /** False when the row predates the deterministic score (ADR 0012) — nothing was written. */
  scored: boolean;
}

/**
 * Read → pure edit → write of one comparison's keyword list, under a row lock.
 *
 * Two routes share this shape: a keyword override and an answered `ask_user`
 * question. Both used to read the row, compute outside, and write the whole
 * JSON back — check-then-act, so two edits in flight, or a confirmation
 * landing during an override, kept only the last one (PR #83's follow-up).
 * Postgres runs at Read Committed, so a plain transaction here would change
 * nothing: the read inside it still returns the version current when it
 * started. `SELECT … FOR UPDATE` first is what serialises them; the edit is
 * pure and instant, so the lock is held for a millisecond.
 *
 * Scoring lives here too, deliberately: `effectiveKeywords` — the user's
 * levels minus the rows they ignored — has to be applied before `scoreMatch`
 * or an override silently disappears from the number, which is what the facts
 * route did.
 */
export async function rescoreMatchKeywords<T>(
  id: number,
  edit: (match: ResumeMatch) => KeywordRescore<T>,
): Promise<RescoreOutcome<T> | null> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM resume_match WHERE id = ${id} FOR UPDATE`;
    if (locked.length === 0) return null;
    const match = await tx.resumeMatch.findUniqueOrThrow({ where: { id } });
    const { keywords, detail } = edit(match);
    const breakdown = readBreakdown(match.breakdown);
    const before = match.matchScore;
    if (keywords === null || !breakdown) {
      return { detail, before, after: before, scored: breakdown !== null };
    }
    const next = scoreMatch(effectiveKeywords(keywords), breakdown.alignment, match.redFlags.length);
    await tx.resumeMatch.update({
      where: { id },
      data: {
        keywords: keywords as Prisma.InputJsonValue,
        breakdown: storedBreakdown(next, {
          // Read off the locked row, not off the caller's older copy: a
          // re-score changes the number, never what the row is.
          promptVersion: readPromptVersion(match.breakdown),
          mode: readMatchMode(match.breakdown),
          frame: readFrameReason(match.breakdown),
        }) as Prisma.InputJsonValue,
        matchScore: next.score,
      },
    });
    return { detail, before, after: next.score, scored: true };
  });
}

/**
 * The lazy second call lands: a quick check becomes a full analysis; the
 * verdicts and the score stay (ADR 0029). The breakdown is re-read here, not
 * taken from the caller: a fact confirmation during the ~40 s call rewrites
 * that JSON, and writing back a snapshot would silently undo it.
 */
export async function updateMatchSuggestions(
  id: number,
  suggestions: MatchSuggestions,
): Promise<ResumeMatch> {
  const current = await prisma.resumeMatch.findUniqueOrThrow({ where: { id }, select: { breakdown: true } });
  return prisma.resumeMatch.update({
    where: { id },
    data: {
      strengths: suggestions.strengths,
      cautions: suggestions.cautions,
      actions: suggestions.actions as Prisma.InputJsonValue,
      removals: suggestions.removals as Prisma.InputJsonValue,
      breakdown: withSuggestionsMode(current.breakdown) as Prisma.InputJsonValue,
    },
  });
}

/* ---------- cover letters (F8, ADR 0021) ---------- */

export type CoverLetterWithResume = CoverLetter & { resume: { id: number; name: string } };

export async function listCoverLettersForJob(jobId: number): Promise<CoverLetterWithResume[]> {
  return prisma.coverLetter.findMany({
    where: { jobId },
    include: { resume: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getCoverLetter(id: number): Promise<CoverLetterWithResume | null> {
  return prisma.coverLetter.findUnique({
    where: { id },
    include: { resume: { select: { id: true, name: true } } },
  });
}

/** Latest analysis of this posting BY THIS RESUME — the letter's shortlist. */
export async function getLatestMatchForResumeAndJob(
  jobId: number,
  resumeId: number,
): Promise<ResumeMatch | null> {
  return prisma.resumeMatch.findFirst({
    where: { jobId, resumeId },
    orderBy: { createdAt: 'desc' },
  });
}

/** Company facts researched by "Is this job real?" — the letter's only company source beyond the posting. */
export async function getLatestCompanySnapshot(jobId: number): Promise<string | null> {
  const row = await prisma.jobVerification.findFirst({
    where: { jobId },
    orderBy: { createdAt: 'desc' },
    select: { companySnapshot: true },
  });
  const snapshot = row?.companySnapshot?.trim();
  return snapshot && snapshot.length > 0 ? snapshot : null;
}

/** Only pass|warn letters reach this — a blocked generation persists nothing. */
export async function createCoverLetter(input: {
  jobId: number;
  resumeId: number;
  resumeVersion: number;
  tone: string;
  text: string;
  model: string;
  promptVersion: number;
  keywordsUsed: string[];
  gapsAcknowledged: string[];
  usedVerification: boolean;
  gateVerdict: string;
  gateNotes: string[];
}): Promise<CoverLetter> {
  const row = await prisma.coverLetter.create({ data: input });
  logger.info(
    { id: row.id, jobId: input.jobId, resumeId: input.resumeId, verdict: input.gateVerdict },
    'resume: cover letter saved',
  );
  return row;
}

/** A manual edit; null editedText restores the generated original. */
export async function updateCoverLetterEdit(
  id: number,
  input: { editedText: string | null; gateVerdict: string; gateNotes: string[] },
): Promise<CoverLetter> {
  return prisma.coverLetter.update({ where: { id }, data: input });
}

/* ---------- candidate facts (ask_user answers) ---------- */

export async function listFacts(): Promise<CandidateFact[]> {
  return prisma.candidateFact.findMany({ orderBy: { term: 'asc' } });
}

export async function upsertFact(
  term: string,
  status: 'confirmed' | 'denied',
  note: string | null,
): Promise<CandidateFact> {
  const key = term.trim().toLowerCase();
  const row = await prisma.candidateFact.upsert({
    where: { term: key },
    create: { term: key, status, note },
    update: { status, note },
  });
  logger.info({ term: key, status }, 'resume: candidate fact saved');
  return row;
}

export async function deleteFact(term: string): Promise<void> {
  await prisma.candidateFact
    .delete({ where: { term: term.trim().toLowerCase() } })
    .catch(() => undefined);
}

/**
 * Skill tags scanned from the user's OTHER visible resumes — the lightweight
 * evidence vault behind "you have it, but this resume hides it".
 */
export async function listOtherResumeSkills(
  excludeResumeId: number,
): Promise<{ skill: string; resumeName: string }[]> {
  const rows = await prisma.resume.findMany({
    where: { hidden: false, id: { not: excludeResumeId } },
    select: { name: true, skills: true },
    orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
  });
  const seen = new Map<string, string>();
  for (const r of rows) {
    for (const skill of r.skills) {
      if (!seen.has(skill)) seen.set(skill, r.name);
    }
  }
  return [...seen].map(([skill, resumeName]) => ({ skill, resumeName }));
}
