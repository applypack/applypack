import { z } from 'zod';
import { safeDate } from './dates';
import { fetchWithRetry, stripHtml } from '../http';
import { conditionalHeaders, rememberResponse } from './conditional';
import { workplaceFromText } from '../location';
import type { NormalizedJob } from '../types';
import { listedInFull } from './listing';
import { salaryLine } from './salary';

/** One `lists[]` block: a heading and the HTML of its `<li>` items. */
const LeverListSchema = z
  .object({
    text: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
  })
  .passthrough();

const LeverSalarySchema = z
  .object({
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    interval: z.string().nullable().optional(),
  })
  .passthrough();

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
  /** The intro only — `openingPlain` + `descriptionBodyPlain` (verified on spotify, 2026-10-29). */
  descriptionPlain: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  /** Requirements, "Who You Are", responsibilities: most of a posting lives here. A malformed block costs the blocks, never the board. */
  lists: z.array(LeverListSchema).optional().catch([]),
  /** The closing section: benefits and the pay-transparency text, often. */
  additionalPlain: z.string().nullable().optional(),
  additional: z.string().nullable().optional(),
  salaryRange: LeverSalarySchema.nullable().optional().catch(null),
  /** What some boards fill instead of `salaryRange`. */
  salaryDescriptionPlain: z.string().nullable().optional(),
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
  const jobs = parseLeverBoard(await resp.json(), company.atsToken).map((p) => mapLeverPosting(p, company.id));
  // Without `limit` the API lists every published posting (TASKS S13).
  listedInFull(company.id);
  rememberResponse(company.id, url, resp, jobs.length);
  return jobs;
}

/** The board's postings; a body that is not one throws, so a changed shape reads as a failing source. */
export function parseLeverBoard(data: unknown, token: string): LeverPosting[] {
  const parsed = LeverResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Lever schema invalid for "${token}": ${parsed.error.message}`);
  }
  return parsed.data;
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
    description: leverDescription(p),
    postedAt: safeDate(p.createdAt),
    locationHints: {
      countries: p.country ? [p.country] : [],
      workplace: workplaceFromText(p.workplaceType ?? ''),
    },
  } satisfies NormalizedJob;
}

/**
 * The whole posting as Lever's own page shows it (#658): the salary range,
 * the intro, every `lists[]` block as its heading over its items, then the
 * closing section. `descriptionPlain` alone was the intro: on 2026-10-29,
 * 81 k of spotify's 377 k characters, and nothing at all on siteground's.
 */
function leverDescription(p: LeverPosting): string {
  const intro = p.descriptionPlain ?? stripHtml(p.description ?? '');
  const blocks = (p.lists ?? []).map((list) => {
    const items = stripHtml(list.content ?? '');
    const heading = (list.text ?? '').trim();
    return items && heading ? `${heading}\n${items}` : items;
  });
  const closing = p.additionalPlain ?? stripHtml(p.additional ?? '');
  return [leverSalary(p), intro, ...blocks, p.salaryDescriptionPlain ?? '', closing]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0)
    .join('\n\n');
}

/** "Salary: 82550-99000 USD (year)." off `salaryRange`; a range of zeros says nothing. */
function leverSalary(p: LeverPosting): string | null {
  const r = p.salaryRange;
  if (!r) return null;
  // "per-year-salary", "per-hour-wage", "per-month-salary" → year / hour / month.
  const period = (r.interval ?? '').replace(/^per-/, '').replace(/-(salary|wage)$/, '');
  return salaryLine(r.min, r.max, r.currency, period);
}
