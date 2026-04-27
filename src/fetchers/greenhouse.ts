import { z } from 'zod';
import { fetchWithRetry, stripHtml } from '../http';
import type { NormalizedJob } from '../types';

const GreenhouseLocationSchema = z
  .object({ name: z.string().nullable().optional() })
  .nullable()
  .optional();

const GreenhouseOfficeSchema = z.object({
  name: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
});

const GreenhouseJobSchema = z.object({
  id: z.number(),
  title: z.string(),
  location: GreenhouseLocationSchema,
  content: z.string().nullable().optional(),
  absolute_url: z.string(),
  updated_at: z.string(),
  departments: z
    .array(z.object({ name: z.string() }).passthrough())
    .optional()
    .default([]),
  offices: z.array(GreenhouseOfficeSchema).optional().default([]),
});

const GreenhouseResponseSchema = z.object({
  jobs: z.array(GreenhouseJobSchema),
});

export interface GreenhouseCompany {
  id: number;
  atsToken: string;
}

export async function fetchGreenhouse(
  company: GreenhouseCompany,
): Promise<NormalizedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company.atsToken)}/jobs?content=true`;
  const resp = await fetchWithRetry(url);
  const data: unknown = await resp.json();
  const parsed = GreenhouseResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Greenhouse schema invalid for "${company.atsToken}": ${parsed.error.message}`,
    );
  }

  return parsed.data.jobs.map((j) => {
    const officeLocations = j.offices
      .map((o) => o.location ?? o.name ?? '')
      .filter((s) => s.length > 0);
    const primaryLocation =
      j.location?.name ?? officeLocations[0] ?? '';
    return {
      companyId: company.id,
      externalId: String(j.id),
      title: j.title,
      url: j.absolute_url,
      location: primaryLocation,
      description: stripHtml(j.content ?? ''),
      postedAt: parseDate(j.updated_at),
    } satisfies NormalizedJob;
  });
}

function parseDate(s: string): Date {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
