import { z } from 'zod';
import { fetchWithRetry, stripHtml } from '../http';
import { hashShortId } from '../text-utils';
import type { NormalizedJob } from '../types';

const ENDPOINT = 'https://remotive.com/api/remote-jobs?category=software-dev';

const RemotiveJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    url: z.string().optional(),
    title: z.string(),
    company_name: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional().default([]),
    job_type: z.string().optional(),
    publication_date: z.string().optional(),
    candidate_required_location: z.string().optional().nullable(),
    salary: z.string().optional().nullable(),
    description: z.string().optional().default(''),
  })
  .passthrough();

type RemotiveJob = z.infer<typeof RemotiveJobSchema>;

const RemotiveResponseSchema = z
  .object({
    jobs: z.array(z.unknown()),
  })
  .passthrough();

export async function fetchRemotive(companyId: number): Promise<NormalizedJob[]> {
  const resp = await fetchWithRetry(ENDPOINT);
  const raw: unknown = await resp.json();
  return mapRemotiveFeed(raw, companyId);
}

export function mapRemotiveFeed(raw: unknown, companyId: number): NormalizedJob[] {
  const top = RemotiveResponseSchema.safeParse(raw);
  if (!top.success) return [];
  const out: NormalizedJob[] = [];
  for (const item of top.data.jobs) {
    const parsed = RemotiveJobSchema.safeParse(item);
    if (!parsed.success) continue;
    out.push(toNormalized(parsed.data, companyId));
  }
  return out;
}

function toNormalized(j: RemotiveJob, companyId: number): NormalizedJob {
  const externalId = j.id || hashShortId(`${j.title}|${j.company_name ?? ''}`);
  const url = j.url ?? '';
  const location = formatLocation(j.candidate_required_location ?? '');
  const postedAt = j.publication_date ? new Date(j.publication_date) : new Date();
  const description = stripHtml(j.description ?? '');
  return {
    companyId,
    externalId,
    title: j.title,
    url,
    location,
    description,
    postedAt: Number.isNaN(postedAt.getTime()) ? new Date() : postedAt,
  };
}

function formatLocation(rawLocation: string): string {
  const trimmed = (rawLocation ?? '').trim();
  if (trimmed.length === 0) return 'Remote';
  if (/\bremote\b/i.test(trimmed)) return trimmed;
  return `Remote · ${trimmed}`;
}
