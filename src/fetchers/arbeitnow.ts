import { z } from 'zod';
import { fetchWithRetry, stripHtml } from '../http';
import { hashShortId } from '../text-utils';
import type { NormalizedJob } from '../types';

const ENDPOINT = 'https://www.arbeitnow.com/api/job-board-api';

const ArbeitnowJobSchema = z
  .object({
    slug: z.string().optional(),
    title: z.string(),
    company_name: z.string().optional(),
    description: z.string().optional().default(''),
    remote: z.boolean().optional().default(false),
    url: z.string().optional(),
    tags: z.array(z.string()).optional().default([]),
    job_types: z.array(z.string()).optional().default([]),
    location: z.string().optional().nullable(),
    // Arbeitnow created_at is unix epoch in seconds
    created_at: z.number().optional(),
  })
  .passthrough();

type ArbeitnowJob = z.infer<typeof ArbeitnowJobSchema>;

const ArbeitnowResponseSchema = z
  .object({
    data: z.array(z.unknown()),
  })
  .passthrough();

export async function fetchArbeitnow(companyId: number): Promise<NormalizedJob[]> {
  // TODO(phase-4): paginate via response.links.next; current call returns
  // ~100 jobs (page 1) which is enough for now.
  const resp = await fetchWithRetry(ENDPOINT);
  const raw: unknown = await resp.json();
  return mapArbeitnowFeed(raw, companyId);
}

export function mapArbeitnowFeed(raw: unknown, companyId: number): NormalizedJob[] {
  const top = ArbeitnowResponseSchema.safeParse(raw);
  if (!top.success) return [];
  const out: NormalizedJob[] = [];
  for (const item of top.data.data) {
    const parsed = ArbeitnowJobSchema.safeParse(item);
    if (!parsed.success) continue;
    out.push(toNormalized(parsed.data, companyId));
  }
  return out;
}

function toNormalized(j: ArbeitnowJob, companyId: number): NormalizedJob {
  const externalId =
    j.slug && j.slug.length > 0
      ? j.slug
      : hashShortId(`${j.title}|${j.company_name ?? ''}`);
  const url = j.url ?? '';
  const location = formatLocation(j.location ?? '', j.remote);
  const postedAt =
    typeof j.created_at === 'number' ? new Date(j.created_at * 1000) : new Date();
  return {
    companyId,
    externalId,
    title: j.title,
    url,
    location,
    description: stripHtml(j.description ?? ''),
    postedAt: Number.isNaN(postedAt.getTime()) ? new Date() : postedAt,
  };
}

function formatLocation(loc: string, remote: boolean): string {
  const trimmed = (loc ?? '').trim();
  const remoteTag = remote ? 'Remote' : '';
  if (trimmed.length === 0) return remoteTag || 'Remote';
  if (remote && !/\bremote\b/i.test(trimmed)) {
    return `Remote · ${trimmed}`;
  }
  return trimmed;
}
