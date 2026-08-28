import type { Prisma, Resume, ResumeMatch } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import type { ResumeMatchResult, ResumeScan } from './prompts';

/** Resume without the uploaded bytes — what every page and prompt works with. */
export type ResumeSummary = Omit<Resume, 'original'>;

const WITHOUT_ORIGINAL = { original: true } as const;

export async function listResumes(): Promise<ResumeSummary[]> {
  return prisma.resume.findMany({
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
      matchScore: r.match_score,
      summary: r.summary,
      strengths: r.strengths,
      redFlags: r.red_flags,
      keywords: r.keywords as Prisma.InputJsonValue,
      actions: r.actions as Prisma.InputJsonValue,
      removals: r.removals as Prisma.InputJsonValue,
    },
  });
}
