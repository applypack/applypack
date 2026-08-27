import { z } from 'zod';
import { fetchWithRetry, stripHtml } from '../http';
import { hashShortId } from '../text-utils';
import type { NormalizedJob } from '../types';

// The browse endpoint caps `limit` at 20 and returns newest-first. One
// page per hourly tick is plenty; the `offset` param is deprecated
// upstream and cursor pagination is unnecessary at our cadence.
const ENDPOINT = 'https://himalayas.app/jobs/api?limit=20';

/**
 * Himalayas is a cross-company remote-job aggregator with a free,
 * no-auth JSON API. The feed spans ALL categories (tech next to Legal /
 * Sales / Support) and the browse endpoint has no category filter, so —
 * like Working Nomads — we normalize everything and let
 * `passesBaseFilter` cull non-matching titles for free.
 *
 * Structured extras the feed carries (employer, seniority, employment
 * type, salary range) are folded into the description so Claude sees
 * them; salary especially, since `salary_min_usd` extraction otherwise
 * has nothing to work with. `applicationLink` pages often carry the
 * employer's real ATS URL, which feeds the phase-7.5 discovery harvest.
 */
const HimalayasJobSchema = z
  .object({
    title: z.string(),
    companyName: z.string().optional(),
    guid: z.string().optional(),
    applicationLink: z.string().optional(),
    description: z.string().optional().default(''),
    excerpt: z.string().optional(),
    employmentType: z.string().optional().nullable(),
    seniority: z.array(z.string()).optional().default([]),
    locationRestrictions: z.array(z.string()).optional().default([]),
    minSalary: z.number().optional().nullable(),
    maxSalary: z.number().optional().nullable(),
    currency: z.string().optional().nullable(),
    salaryPeriod: z.string().optional().nullable(),
    pubDate: z.number().optional(),
  })
  .passthrough();

type HimalayasJob = z.infer<typeof HimalayasJobSchema>;

const HimalayasResponseSchema = z
  .object({
    jobs: z.array(z.unknown()),
  })
  .passthrough();

export async function fetchHimalayas(
  companyId: number,
): Promise<NormalizedJob[]> {
  const resp = await fetchWithRetry(ENDPOINT);
  const raw: unknown = await resp.json();
  return mapHimalayasFeed(raw, companyId);
}

export function mapHimalayasFeed(
  raw: unknown,
  companyId: number,
): NormalizedJob[] {
  const top = HimalayasResponseSchema.safeParse(raw);
  if (!top.success) return [];
  const out: NormalizedJob[] = [];
  for (const item of top.data.jobs) {
    const parsed = HimalayasJobSchema.safeParse(item);
    if (!parsed.success) continue;
    out.push(toNormalized(parsed.data, companyId));
  }
  return out;
}

function toNormalized(j: HimalayasJob, companyId: number): NormalizedJob {
  const url = j.applicationLink ?? j.guid ?? '';
  const externalId =
    j.guid ?? j.applicationLink ?? hashShortId(`${j.title}|${j.companyName ?? ''}`);
  const rawDescription = j.description.trim().length > 0 ? j.description : (j.excerpt ?? '');
  return {
    companyId,
    externalId,
    title: j.title,
    url,
    location: formatLocation(j.locationRestrictions),
    description: augmentDescription(stripHtml(rawDescription), j),
    postedAt: parsePubDate(j.pubDate),
  };
}

// pubDate is epoch SECONDS (e.g. 1787776402); guard against a future
// switch to milliseconds by magnitude.
function parsePubDate(pubDate: number | undefined): Date {
  if (!pubDate || pubDate <= 0) return new Date();
  const ms = pubDate > 1e12 ? pubDate : pubDate * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function formatLocation(restrictions: string[]): string {
  const joined = restrictions
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .join(', ');
  if (joined.length === 0) return 'Remote';
  if (/\bremote\b/i.test(joined)) return joined;
  return `Remote · ${joined}`;
}

function augmentDescription(base: string, j: HimalayasJob): string {
  const parts: string[] = [];
  if (j.companyName && j.companyName.trim().length > 0) {
    parts.push(`Hiring company: ${j.companyName.trim()}.`);
  }
  if (j.employmentType && j.employmentType.trim().length > 0) {
    parts.push(`Type: ${j.employmentType.trim().toLowerCase()}.`);
  }
  if (j.seniority.length > 0) {
    parts.push(`Seniority: ${j.seniority.join(', ')}.`);
  }
  const salary = formatSalary(j);
  if (salary) parts.push(salary);
  const header = parts.join(' ');
  if (header.length === 0) return base.trim();
  if (base.trim().length === 0) return header;
  return `${header}\n\n${base.trim()}`;
}

function formatSalary(j: HimalayasJob): string | null {
  const min = typeof j.minSalary === 'number' && j.minSalary > 0 ? j.minSalary : null;
  const max = typeof j.maxSalary === 'number' && j.maxSalary > 0 ? j.maxSalary : null;
  if (min === null && max === null) return null;
  const currency = j.currency && j.currency.trim().length > 0 ? j.currency : 'USD';
  const period = j.salaryPeriod && j.salaryPeriod.trim().length > 0 ? j.salaryPeriod : 'annual';
  const range =
    min !== null && max !== null
      ? `${min}-${max}`
      : min !== null
        ? `from ${min}`
        : `up to ${max}`;
  return `Salary: ${range} ${currency} (${period}).`;
}
