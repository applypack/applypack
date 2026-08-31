import { z } from 'zod';
import { fetchWithRetry, stripHtml } from '../http';
import { feedItemKey } from '../text-utils';
import type { NormalizedJob } from '../types';

const ENDPOINT = 'https://www.workingnomads.com/api/exposed_jobs/';

/**
 * Working Nomads is a cross-company remote-job aggregator with a free,
 * no-auth JSON API (`/api/exposed_jobs/`) returning the ~30 most recent
 * postings. Categories are mixed (Development-heavy, but Administration /
 * Customer Success / Education appear too) and the `?category=` query
 * param is ignored server-side (verified 2026-08-27), so we normalize
 * everything and let `passesBaseFilter` cull non-matching titles for free.
 *
 * Like Jobicy, all jobs land under one synthetic Company row; the real
 * employer is folded into the description so Claude scores against it.
 */
const WorkingNomadsJobSchema = z
  .object({
    url: z.string().optional().default(''),
    title: z.string(),
    description: z.string().optional().default(''),
    company_name: z.string().optional(),
    category_name: z.string().optional(),
    tags: z.string().optional(),
    location: z.string().optional().nullable(),
    pub_date: z.string().optional(),
  })
  .passthrough();

type WorkingNomadsJob = z.infer<typeof WorkingNomadsJobSchema>;

const WorkingNomadsResponseSchema = z.array(z.unknown());

export async function fetchWorkingNomads(
  companyId: number,
): Promise<NormalizedJob[]> {
  const resp = await fetchWithRetry(ENDPOINT);
  const raw: unknown = await resp.json();
  return mapWorkingNomadsFeed(raw, companyId);
}

export function mapWorkingNomadsFeed(
  raw: unknown,
  companyId: number,
): NormalizedJob[] {
  const top = WorkingNomadsResponseSchema.safeParse(raw);
  if (!top.success) return [];
  const out: NormalizedJob[] = [];
  for (const item of top.data) {
    const parsed = WorkingNomadsJobSchema.safeParse(item);
    if (!parsed.success) continue;
    const job = toNormalized(parsed.data, companyId);
    // Nothing identifies this row — skip it rather than hash '' and merge
    // every such row onto one shared id.
    if (job) out.push(job);
  }
  return out;
}

function toNormalized(j: WorkingNomadsJob, companyId: number): NormalizedJob | null {
  // Job URLs look like https://www.workingnomads.com/job/go/1818986/ —
  // the numeric segment is the stable posting id.
  const externalId =
    /\/job\/go\/(\d+)/.exec(j.url)?.[1] ??
    feedItemKey(j.url, j.title, j.company_name);
  if (!externalId) return null;
  const postedAt = j.pub_date ? new Date(j.pub_date) : new Date();
  return {
    companyId,
    externalId,
    title: j.title,
    url: j.url,
    location: formatLocation(j.location ?? ''),
    description: augmentDescription(stripHtml(j.description), j),
    postedAt: Number.isNaN(postedAt.getTime()) ? new Date() : postedAt,
  };
}

function formatLocation(rawLocation: string): string {
  const trimmed = rawLocation.trim();
  if (trimmed.length === 0) return 'Remote';
  if (/\bremote\b/i.test(trimmed)) return trimmed;
  return `Remote · ${trimmed}`;
}

function augmentDescription(base: string, j: WorkingNomadsJob): string {
  const parts: string[] = [];
  if (j.company_name && j.company_name.trim().length > 0) {
    parts.push(`Hiring company: ${j.company_name.trim()}.`);
  }
  if (j.category_name && j.category_name.trim().length > 0) {
    parts.push(`Category: ${j.category_name.trim()}.`);
  }
  if (j.tags && j.tags.trim().length > 0) {
    parts.push(`Tags: ${j.tags.trim()}.`);
  }
  const header = parts.join(' ');
  if (header.length === 0) return base.trim();
  if (base.trim().length === 0) return header;
  return `${header}\n\n${base.trim()}`;
}
