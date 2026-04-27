import { z } from 'zod';
import { fetchWithRetry } from '../http';
import type { NormalizedJob } from '../types';

const LeverPostingSchema = z.object({
  id: z.string(),
  text: z.string(),
  categories: z
    .object({
      commitment: z.string().nullable().optional(),
      department: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      team: z.string().nullable().optional(),
      allLocations: z.array(z.string()).optional().default([]),
    })
    .optional(),
  descriptionPlain: z.string().nullable().optional(),
  hostedUrl: z.string(),
  createdAt: z.number(),
  workplaceType: z.string().nullable().optional(),
});

const LeverResponseSchema = z.array(LeverPostingSchema);

export interface LeverCompany {
  id: number;
  atsToken: string;
}

export async function fetchLever(
  company: LeverCompany,
): Promise<NormalizedJob[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company.atsToken)}?mode=json`;
  const resp = await fetchWithRetry(url);
  const data: unknown = await resp.json();
  const parsed = LeverResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Lever schema invalid for "${company.atsToken}": ${parsed.error.message}`,
    );
  }

  return parsed.data.map((p) => {
    const allLocations = p.categories?.allLocations ?? [];
    const primary = p.categories?.location ?? allLocations[0] ?? '';
    const workplace = p.workplaceType ? ` (${p.workplaceType})` : '';
    return {
      companyId: company.id,
      externalId: p.id,
      title: p.text,
      url: p.hostedUrl,
      location: `${primary}${workplace}`.trim(),
      description: p.descriptionPlain ?? '',
      postedAt: new Date(p.createdAt),
    } satisfies NormalizedJob;
  });
}
