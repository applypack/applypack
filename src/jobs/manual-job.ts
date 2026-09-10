import { AtsType, JobStatus, Prisma } from '@prisma/client';
import type { Job } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { decodeHtmlEntities } from '../http';
import { parseLocation } from '../location';
import { logger } from '../logger';
import { hashShortId } from '../text-utils';
import { classifyExistingJob, type ClassifiableJob } from './classify-existing';

/*
 * Pasted postings (the /jobs/new form and the /target compare page) become
 * normal jobs under an inactive MANUAL company. Deduped by a hash of
 * title + description so re-pasting the same posting reuses the row.
 */

export const MIN_DESCRIPTION_CHARS = 200;
export const MAX_FIELD_CHARS = 200;

/** '' and absent both mean "no salary" — hidden form fields post empty strings. */
const SalaryField = z.preprocess(
  (v) => (v === '' || v == null ? undefined : Number(v)),
  z.number().int().positive().max(5_000_000).optional(),
);

export const ManualJobSchema = z.object({
  companyName: z.string().trim().min(1).max(MAX_FIELD_CHARS),
  title: z.string().trim().min(1).max(MAX_FIELD_CHARS),
  url: z.string().trim().max(2000).default(''),
  location: z.string().trim().max(MAX_FIELD_CHARS).default(''),
  description: z.string().trim().min(MIN_DESCRIPTION_CHARS),
  salaryMin: SalaryField,
  salaryMax: SalaryField,
});

export type ManualJobInput = z.infer<typeof ManualJobSchema>;

export type ManualJobResult =
  | { kind: 'existing'; job: Job }
  | { kind: 'created'; job: ClassifiableJob; classified: boolean };

/**
 * `classify: false` skips the fit-score call — the cover-letter path never
 * reads the score and the user is waiting on the letter (F8.3). Re-classify
 * from the job page whenever the number is actually wanted.
 */
export async function createManualJob(
  f: ManualJobInput,
  opts: { classify?: boolean } = {},
): Promise<ManualJobResult> {
  // Pastes copied from rendered pages occasionally carry literal entities
  // ("&nbsp;", "&amp;") — decode them so the stored text reads clean.
  const description = decodeHtmlEntities(f.description).trim();
  const atsToken = slugify(f.companyName);
  const externalId = `manual-${hashShortId(`${f.title}\n${description}`)}`;
  // A pasted posting has no structured fields: the parser reads the string
  // the user typed (ADR 0031), and nothing here rewrites that string.
  const place = parseLocation(f.location);
  const jobInclude = { company: { select: { name: true, atsType: true } } } as const;
  // One transaction: the company row and the job row appear together or not
  // at all, and the same paste from two tabs at once (/jobs/new and
  // /screen/new both land here) is settled by the unique key, not by a read
  // that the other tab can outrun (audit 2026-09-10, DATA-10).
  const found = await prisma.$transaction(async (tx) => {
    const company = await tx.company.upsert({
      where: { atsType_atsToken: { atsType: AtsType.MANUAL, atsToken } },
      update: {},
      create: { name: f.companyName, atsType: AtsType.MANUAL, atsToken, active: false },
    });
    const where = { companyId_externalId: { companyId: company.id, externalId } };
    const existing = await tx.job.findUnique({ where, include: jobInclude });
    if (existing) return { kind: 'existing' as const, job: existing, company };
    try {
      const job = await tx.job.create({
        data: {
          companyId: company.id,
          externalId,
          title: f.title,
          url: f.url,
          location: f.location,
          workplace: place.workplace,
          countries: place.countries,
          regions: place.regions,
          locationSource: place.source,
          description,
          salaryMin: f.salaryMin ?? null,
          salaryMax: f.salaryMax ?? null,
          postedAt: new Date(),
          status: JobStatus.SAVED,
        },
        include: jobInclude,
      });
      return { kind: 'created' as const, job, company };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await tx.job.findUnique({ where, include: jobInclude });
        if (raced) return { kind: 'existing' as const, job: raced, company };
      }
      throw err;
    }
  });
  if (found.kind === 'existing') return { kind: 'existing', job: found.job };
  const { job, company } = found;
  const classified =
    opts.classify === false ? false : await classifyExistingJob(job, { keepStatus: true });
  logger.info({ jobId: job.id, company: company.name, classified }, 'web: manual job saved');
  return { kind: 'created', job, classified };
}

/** "Acme Corp." → "acme-corp" — the MANUAL company's atsToken. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'company';
}
