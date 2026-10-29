import { z } from 'zod';
import { safeDate } from './dates';
import { fetchWithRetry, HttpError, type FetchOptions } from '../http';
import { conditionalHeaders, rememberResponse } from './conditional';
import { workplaceFromText } from '../location';
import type { NormalizedJob } from '../types';
import { listedInFull } from './listing';

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
  const { resp, url } = await fetchLeverList(company.atsToken, (url) => ({ init: { headers: conditionalHeaders(company.id, url) } }));
  const data: unknown = await resp.json();
  const parsed = LeverResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Lever schema invalid for "${company.atsToken}": ${parsed.error.message}`,
    );
  }
  const jobs = parsed.data.map((p) => mapLeverPosting(p, company.id));
  // Without `limit` the API lists every published posting (TASKS S13).
  listedInFull(company.id);
  rememberResponse(company.id, url, resp, jobs.length);
  return jobs;
}

/**
 * Lever runs a second instance in the EU (`jobs.eu.lever.co`). A token lives
 * on one of the two, and the other answers 404 "Document not found" — the
 * answer an unknown token gets from both (#663) — so a 404 from the global
 * host is asked of the EU one before the board is called dead.
 */
const GLOBAL_API = 'https://api.lever.co';
const EU_API = 'https://api.eu.lever.co';

/** A board's whole list (no `limit`), from whichever instance holds the token. */
export async function fetchLeverList(
  token: string,
  options: (url: string) => FetchOptions = () => ({}),
  get: typeof fetchWithRetry = fetchWithRetry,
): Promise<{ resp: Response; url: string }> {
  const listUrl = (host: string): string => `${host}/v0/postings/${encodeURIComponent(token)}?mode=json`;
  const global = listUrl(GLOBAL_API);
  try {
    return { resp: await get(global, options(global)), url: global };
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) throw err;
    const eu = listUrl(EU_API);
    return { resp: await get(eu, options(eu)), url: eu };
  }
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
    postedAt: safeDate(p.createdAt),
    locationHints: {
      countries: p.country ? [p.country] : [],
      workplace: workplaceFromText(p.workplaceType ?? ''),
    },
  } satisfies NormalizedJob;
}
