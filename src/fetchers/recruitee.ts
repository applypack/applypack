import { z } from 'zod';
import { fetchWithRetry, stripHtml } from '../http';
import type { NormalizedJob } from '../types';

// Recruitee's public careers-site API: one GET, all published offers,
// no pagination, no auth. Invalid slugs answer 404 JSON.
const ENDPOINT_TEMPLATE = (slug: string) =>
  `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`;

const RecruiteeSalarySchema = z
  .object({
    min: z.union([z.string(), z.number()]).nullable().optional(),
    max: z.union([z.string(), z.number()]).nullable().optional(),
    currency: z.string().nullable().optional(),
    period: z.string().nullable().optional(),
  })
  .passthrough();

const RecruiteeOfferSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    title: z.string(),
    slug: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    careers_url: z.string().nullable().optional(),
    published_at: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    remote: z.boolean().nullable().optional(),
    hybrid: z.boolean().nullable().optional(),
    description: z.string().nullable().optional(),
    requirements: z.string().nullable().optional(),
    salary: RecruiteeSalarySchema.nullable().optional(),
  })
  .passthrough();

type RecruiteeOffer = z.infer<typeof RecruiteeOfferSchema>;

const RecruiteeResponseSchema = z
  .object({
    offers: z.array(z.unknown()),
  })
  .passthrough();

export interface RecruiteeCompany {
  id: number;
  atsToken: string;
}

export async function fetchRecruitee(
  company: RecruiteeCompany,
): Promise<NormalizedJob[]> {
  const resp = await fetchWithRetry(ENDPOINT_TEMPLATE(company.atsToken));
  const raw: unknown = await resp.json();
  return mapRecruiteeFeed(raw, company.id, company.atsToken);
}

export function mapRecruiteeFeed(
  raw: unknown,
  companyId: number,
  slug: string,
): NormalizedJob[] {
  const top = RecruiteeResponseSchema.safeParse(raw);
  if (!top.success) return [];
  const out: NormalizedJob[] = [];
  for (const item of top.data.offers) {
    const parsed = RecruiteeOfferSchema.safeParse(item);
    if (!parsed.success) continue;
    const offer = parsed.data;
    // The public API only lists published offers, but the status field
    // exists — guard against drafts leaking in.
    if (offer.status && offer.status !== 'published') continue;
    out.push(toNormalized(offer, companyId, slug));
  }
  return out;
}

function toNormalized(
  o: RecruiteeOffer,
  companyId: number,
  slug: string,
): NormalizedJob {
  const url =
    o.careers_url ??
    (o.slug ? `https://${slug}.recruitee.com/o/${o.slug}` : '');
  return {
    companyId,
    externalId: o.id,
    title: o.title,
    url,
    location: formatLocation(o),
    description: buildDescription(o),
    postedAt: parseRecruiteeDate(o.published_at ?? o.created_at),
  };
}

function formatLocation(o: RecruiteeOffer): string {
  const place = (o.location ?? '').trim();
  const prefix = o.remote ? 'Remote' : o.hybrid ? 'Hybrid' : '';
  if (prefix.length === 0) return place;
  if (place.length === 0) return prefix;
  if (new RegExp(`\\b${prefix}\\b`, 'i').test(place)) return place;
  return `${prefix} · ${place}`;
}

// description and requirements are separate HTML documents; salary is a
// structured object folded into text (F2 decision: no salary schema in v1).
function buildDescription(o: RecruiteeOffer): string {
  const body = [o.description, o.requirements]
    .map((html) => (html ? stripHtml(html) : ''))
    .filter((s) => s.length > 0)
    .join('\n\n');
  const salary = formatSalary(o.salary ?? null);
  if (!salary) return body;
  return body.length > 0 ? `${salary}\n\n${body}` : salary;
}

function formatSalary(
  salary: z.infer<typeof RecruiteeSalarySchema> | null,
): string | null {
  if (!salary) return null;
  const min = numeric(salary.min);
  const max = numeric(salary.max);
  if (min === null && max === null) return null;
  const currency = salary.currency?.trim() || 'EUR';
  const period = salary.period?.trim() || 'month';
  const range =
    min !== null && max !== null
      ? `${min}-${max}`
      : min !== null
        ? `from ${min}`
        : `up to ${max}`;
  return `Salary: ${range} ${currency} (${period}).`;
}

function numeric(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Recruitee dates come as "2026-08-28 11:47:47 UTC" — normalise to ISO
// instead of relying on V8's lenient parser.
export function parseRecruiteeDate(
  s: string | null | undefined,
): Date {
  if (!s) return new Date();
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/.exec(s.trim());
  const d = new Date(m ? `${m[1]}T${m[2]}Z` : s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
