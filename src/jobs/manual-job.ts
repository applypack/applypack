import { AtsType, JobStatus } from '@prisma/client';
import type { Job } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { decodeHtmlEntities } from '../http';
import { logger } from '../logger';
import { hashShortId } from '../text-utils';
import { classifyExistingJob } from './classify-existing';

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
  | { kind: 'created'; job: Job; classified: boolean };

export async function createManualJob(f: ManualJobInput): Promise<ManualJobResult> {
  // Pastes copied from rendered pages occasionally carry literal entities
  // ("&nbsp;", "&amp;") — decode them so the stored text reads clean.
  const description = decodeHtmlEntities(f.description).trim();
  const atsToken = slugify(f.companyName);
  const company = await prisma.company.upsert({
    where: { atsType_atsToken: { atsType: AtsType.MANUAL, atsToken } },
    update: {},
    create: { name: f.companyName, atsType: AtsType.MANUAL, atsToken, active: false },
  });
  const externalId = `manual-${hashShortId(`${f.title}\n${description}`)}`;
  const existing = await prisma.job.findUnique({
    where: { companyId_externalId: { companyId: company.id, externalId } },
  });
  if (existing) return { kind: 'existing', job: existing };

  const job = await prisma.job.create({
    data: {
      companyId: company.id,
      externalId,
      title: f.title,
      url: f.url,
      location: f.location,
      description,
      salaryMin: f.salaryMin ?? null,
      salaryMax: f.salaryMax ?? null,
      postedAt: new Date(),
      status: JobStatus.SAVED,
    },
    include: { company: { select: { name: true } } },
  });
  const classified = await classifyExistingJob(job, { keepStatus: true });
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
