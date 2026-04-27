import { z } from 'zod';
import { fetchWithRetry, stripHtml } from '../http';
import type { NormalizedJob } from '../types';

const AshbyJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  department: z.string().nullable().optional(),
  team: z.string().nullable().optional(),
  employmentType: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  secondaryLocations: z
    .array(
      z.object({
        location: z.string().nullable().optional(),
      }).passthrough(),
    )
    .optional()
    .default([]),
  publishedAt: z.string(),
  isListed: z.boolean().nullable().optional().default(true),
  isRemote: z.boolean().nullable().optional().default(false),
  workplaceType: z.string().nullable().optional(),
  jobUrl: z.string(),
  applyUrl: z.string().optional(),
  descriptionHtml: z.string().nullable().optional(),
});

const AshbyResponseSchema = z.object({
  jobs: z.array(AshbyJobSchema),
});

export interface AshbyCompany {
  id: number;
  atsToken: string;
}

export async function fetchAshby(
  company: AshbyCompany,
): Promise<NormalizedJob[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company.atsToken)}`;
  const resp = await fetchWithRetry(url);
  const data: unknown = await resp.json();
  const parsed = AshbyResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Ashby schema invalid for "${company.atsToken}": ${parsed.error.message}`,
    );
  }

  return parsed.data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const secondary = j.secondaryLocations
        .map((s) => s.location ?? '')
        .filter((s) => s.length > 0);
      const locationParts = [j.location ?? '', ...secondary].filter(
        (s) => s.length > 0,
      );
      const workplace = j.workplaceType ? ` (${j.workplaceType})` : '';
      return {
        companyId: company.id,
        externalId: j.id,
        title: j.title,
        url: j.jobUrl,
        location: `${locationParts.join(' / ')}${workplace}`.trim(),
        description: stripHtml(j.descriptionHtml ?? ''),
        postedAt: parseDate(j.publishedAt),
      } satisfies NormalizedJob;
    });
}

function parseDate(s: string): Date {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
