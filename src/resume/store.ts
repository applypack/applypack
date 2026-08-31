import type { CandidateFact, CoverLetter, Prisma, Resume, ResumeMatch } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import type { MatchKeyword, ResumeMatchResult, ResumeScan } from './prompts';
import type { ScoreBreakdown } from './score';

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

export async function listMatchesForJob(jobId: number): Promise<MatchWithResume[]> {
  return prisma.resumeMatch.findMany({
    where: { jobId },
    include: { resume: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listMatchesForResume(resumeId: number): Promise<MatchWithJob[]> {
  return prisma.resumeMatch.findMany({
    where: { resumeId },
    include: { job: { select: { id: true, title: true, company: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
}

/** A resume version made from edited text (the targeted view's "Save as vN") — a .md file, no docx. */
export async function saveResumeTextVersion(id: number, text: string): Promise<ResumeSummary> {
  const current = await prisma.resume.findUniqueOrThrow({ where: { id }, select: { name: true, version: true } });
  const slug = current.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'resume';
  return replaceResumeFile(id, {
    sourceFilename: `${slug}-v${current.version + 1}.md`,
    mimeType: 'text/markdown',
    original: Buffer.from(text, 'utf8'),
    text,
  });
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
      breakdown: input.breakdown as unknown as Prisma.InputJsonValue,
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

/** A fact flip recomputes the stored score deterministically — no AI call. */
export async function updateMatchScoring(
  id: number,
  input: { keywords: MatchKeyword[]; breakdown: ScoreBreakdown },
): Promise<ResumeMatch> {
  return prisma.resumeMatch.update({
    where: { id },
    data: {
      keywords: input.keywords as Prisma.InputJsonValue,
      breakdown: input.breakdown as unknown as Prisma.InputJsonValue,
      matchScore: input.breakdown.score,
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
