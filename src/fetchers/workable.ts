import { z } from 'zod';
import { fetchWithRetry } from '../http';
import type { NormalizedJob } from '../types';

const ENDPOINT_TEMPLATE = (slug: string) =>
  `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(slug)}/jobs`;

// The list endpoint returns lightweight job metadata. Workable does NOT
// expose per-job descriptions on a public endpoint, so description stays
// empty — Claude classifies on the title alone (which is usually clear
// for engineering roles).
const WorkableLocationSchema = z
  .object({
    country: z.string().nullable().optional(),
    countryCode: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    region: z.string().nullable().optional(),
  })
  .passthrough();

const WorkableJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    shortcode: z.string(),
    title: z.string(),
    remote: z.boolean().optional().default(false),
    location: WorkableLocationSchema.nullable().optional(),
    state: z.string().optional(),
    published: z.string().optional(),
    workplace: z.string().nullable().optional(),
  })
  .passthrough();

const WorkableResponseSchema = z
  .object({
    total: z.number().optional(),
    results: z.array(z.unknown()),
  })
  .passthrough();

export interface WorkableCompany {
  id: number;
  atsToken: string;
}

export async function fetchWorkable(
  company: WorkableCompany,
): Promise<NormalizedJob[]> {
  const resp = await fetchWithRetry(ENDPOINT_TEMPLATE(company.atsToken), {
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', workplace: [], department: [] }),
    },
  });
  const data: unknown = await resp.json();
  return mapWorkableFeed(data, company.id, company.atsToken);
}

export function mapWorkableFeed(
  raw: unknown,
  companyId: number,
  slug: string,
): NormalizedJob[] {
  const top = WorkableResponseSchema.safeParse(raw);
  if (!top.success) return [];
  const out: NormalizedJob[] = [];
  for (const item of top.data.results) {
    const parsed = WorkableJobSchema.safeParse(item);
    if (!parsed.success) continue;
    const j = parsed.data;
    out.push({
      companyId,
      externalId: j.shortcode,
      title: j.title,
      url: `https://apply.workable.com/${slug}/j/${j.shortcode}/`,
      location: formatLocation(j),
      // Workable's public list endpoint omits the description body; Claude
      // classifies on the title alone for these roles.
      description: '',
      postedAt: j.published ? safeDate(j.published) : new Date(),
    });
  }
  return out;
}

function formatLocation(
  j: z.infer<typeof WorkableJobSchema>,
): string {
  const loc = j.location ?? {};
  const parts: string[] = [];
  const isRemote = j.remote || j.workplace === 'remote';
  if (isRemote) parts.push('Remote');
  const city = loc.city?.trim();
  const region = loc.region?.trim();
  const country = loc.country?.trim();
  const place = [city, region, country].filter(Boolean).join(', ');
  if (place.length > 0) parts.push(place);
  return parts.join(' · ') || (isRemote ? 'Remote' : '');
}

function safeDate(s: string): Date {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
