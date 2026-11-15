import type { CareerNote, InterviewPrep, Prisma } from '@prisma/client';
import { prisma } from '../db';
import type { PrepQuestion } from './prompts';

/* The only file that touches `career_note` and `interview_prep` (ADR 0065). */

/** The person's history, the note changed last first. */
export async function listCareerNotes(): Promise<CareerNote[]> {
  return prisma.careerNote.findMany({ orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] });
}

export async function createCareerNote(title: string, text: string): Promise<CareerNote> {
  return prisma.careerNote.create({ data: { title, text } });
}

/** False when the note is gone. */
export async function updateCareerNote(id: number, title: string, text: string): Promise<boolean> {
  const { count } = await prisma.careerNote.updateMany({ where: { id }, data: { title, text } });
  return count > 0;
}

export async function deleteCareerNote(id: number): Promise<void> {
  await prisma.careerNote.deleteMany({ where: { id } });
}

export async function getInterviewPrep(jobId: number): Promise<InterviewPrep | null> {
  return prisma.interviewPrep.findUnique({ where: { jobId } });
}

/** The language the person prepared in last, for the next job's select. */
export async function lastInterviewLanguage(): Promise<string | null> {
  const row = await prisma.interviewPrep.findFirst({ orderBy: { createdAt: 'desc' }, select: { language: true } });
  return row?.language ?? null;
}

/** One preparation per job: preparing again replaces it. */
export async function saveInterviewPrep(input: {
  jobId: number;
  language: string;
  questions: PrepQuestion[];
  sourceKey: string;
  model: string;
  promptVersion: number;
}): Promise<InterviewPrep> {
  const { jobId, questions, ...rest } = input;
  const data = { ...rest, questions: questions as unknown as Prisma.InputJsonValue };
  return prisma.interviewPrep.upsert({
    where: { jobId },
    create: { jobId, ...data },
    update: { ...data, createdAt: new Date() },
  });
}
