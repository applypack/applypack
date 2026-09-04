import { z } from 'zod';
import { fetchWithRetry } from '../http';
import { conditionalHeaders, rememberResponse } from './conditional';
import { workplaceFromText } from '../location';
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
  /** ISO 3166-1 alpha-2 of the primary office (verified live 2026-09-03). */
  country: z.string().nullable().optional(),
});

export type LeverPosting = z.infer<typeof LeverPostingSchema>;

const LeverResponseSchema = z.array(LeverPostingSchema);

export interface LeverCompany {
  id: number;
  atsToken: string;
}

export async function fetchLever(
  company: LeverCompany,
): Promise<NormalizedJob[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company.atsToken)}?mode=json`;
  const resp = await fetchWithRetry(url, { init: { headers: conditionalHeaders(company.id, url) } });
  const data: unknown = await resp.json();
  const parsed = LeverResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Lever schema invalid for "${company.atsToken}": ${parsed.error.message}`,
    );
  }
  const jobs = parsed.data.map((p) => mapLeverPosting(p, company.id));
  rememberResponse(company.id, url, resp, jobs.length);
  return jobs;
}

/**
 * Pure mapper extracted for unit tests. Lever puts location in
 * `categories.location` (most reliable) or as the first item of
 * `categories.allLocations`. `workplaceType` is a separate enum
 * ("remote"/"onsite"/"hybrid") which we append in parens so the
 * downstream filter can read it as part of the location string; it and the
 * ISO `country` also travel as structured hints (ADR 0031).
 */
export function mapLeverPosting(
  p: LeverPosting,
  companyId: number,
): NormalizedJob {
  const allLocations = p.categories?.allLocations ?? [];
  const primary = p.categories?.location ?? allLocations[0] ?? '';
  const workplace = p.workplaceType ? ` (${p.workplaceType})` : '';
  return {
    companyId,
    externalId: p.id,
    title: p.text,
    url: p.hostedUrl,
    location: `${primary}${workplace}`.trim(),
    description: p.descriptionPlain ?? '',
    postedAt: new Date(p.createdAt),
    locationHints: {
      countries: p.country ? [p.country] : [],
      workplace: workplaceFromText(p.workplaceType ?? ''),
    },
  } satisfies NormalizedJob;
}
