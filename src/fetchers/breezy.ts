import { z } from 'zod';
import { fetchWithRetry, stripHtml } from '../http';
import { conditionalHeaders, rememberResponse } from './conditional';
import type { NormalizedJob } from '../types';

// Breezy's public board JSON: top-level array, one GET, no auth.
// `verbose=true` is what adds the description body (F2 re-analysis).
// Invalid slugs answer 404 HTML.
const ENDPOINT_TEMPLATE = (slug: string) =>
  `https://${encodeURIComponent(slug)}.breezy.hr/json?verbose=true`;

const BreezyLocationSchema = z
  .object({
    name: z.string().nullable().optional(),
    is_remote: z.boolean().nullable().optional(),
    /** `id` is the ISO 3166-1 alpha-2 code ("PL"). */
    country: z
      .object({ name: z.string().nullable().optional(), id: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const BreezyPositionSchema = z
  .object({
    id: z.string(),
    friendly_id: z.string().nullable().optional(),
    name: z.string(),
    url: z.string(),
    published_date: z.string().nullable().optional(),
    type: z
      .object({ name: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    location: BreezyLocationSchema.nullable().optional(),
    department: z.string().nullable().optional(),
    salary: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .passthrough();

type BreezyPosition = z.infer<typeof BreezyPositionSchema>;

export interface BreezyCompany {
  id: number;
  atsToken: string;
}

export async function fetchBreezy(
  company: BreezyCompany,
): Promise<NormalizedJob[]> {
  const url = ENDPOINT_TEMPLATE(company.atsToken);
  const resp = await fetchWithRetry(url, { init: { headers: conditionalHeaders(company.id, url) } });
  const raw: unknown = await resp.json();
  const jobs = mapBreezyFeed(raw, company.id);
  rememberResponse(company.id, url, resp, jobs.length);
  return jobs;
}

export function mapBreezyFeed(
  raw: unknown,
  companyId: number,
): NormalizedJob[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedJob[] = [];
  for (const item of raw) {
    const parsed = BreezyPositionSchema.safeParse(item);
    if (!parsed.success) continue;
    out.push(toNormalized(parsed.data, companyId));
  }
  return out;
}

function toNormalized(p: BreezyPosition, companyId: number): NormalizedJob {
  return {
    companyId,
    externalId: p.id,
    title: p.name,
    url: p.url,
    location: formatLocation(p.location ?? null),
    description: buildDescription(p),
    postedAt: safeDate(p.published_date),
    locationHints: {
      countries: p.location?.country?.id ? [p.location.country.id] : [],
      workplace: p.location?.is_remote ? 'REMOTE' : 'UNKNOWN',
    },
  };
}

function formatLocation(
  loc: z.infer<typeof BreezyLocationSchema> | null,
): string {
  const place = (loc?.name ?? loc?.country?.name ?? '').trim();
  if (!loc?.is_remote) return place;
  if (place.length === 0) return 'Remote';
  if (/\bremote\b/i.test(place)) return place;
  return `Remote · ${place}`;
}

// Salary / department / employment type are list-level strings — folded
// into text per the F2 decision (no salary schema in v1).
function buildDescription(p: BreezyPosition): string {
  const parts: string[] = [];
  if (p.department && p.department.trim().length > 0) {
    parts.push(`Department: ${p.department.trim()}.`);
  }
  if (p.type?.name && p.type.name.trim().length > 0) {
    parts.push(`Type: ${p.type.name.trim()}.`);
  }
  if (p.salary && p.salary.trim().length > 0) {
    parts.push(`Salary: ${p.salary.trim()}.`);
  }
  const header = parts.join(' ');
  const body = p.description ? stripHtml(p.description) : '';
  if (header.length === 0) return body;
  if (body.length === 0) return header;
  return `${header}\n\n${body}`;
}

function safeDate(s: string | null | undefined): Date {
  if (!s) return new Date();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
