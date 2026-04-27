import { z } from 'zod';
import { fetchWithRetry, stripHtml } from '../http';
import { hashShortId } from '../text-utils';
import type { NormalizedJob } from '../types';

const ENDPOINT = 'https://remoteok.com/api';

// RemoteOK returns an array whose first element is meta:
//   [{ legal: '...', last_updated: 1234 }, ...jobs]
// Subsequent items are jobs. Schema fields are loose because RemoteOK
// occasionally adds/renames fields.
const RemoteOkJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    slug: z.string().optional(),
    position: z.string().optional(),
    title: z.string().optional(),
    company: z.string().optional(),
    company_name: z.string().optional(),
    location: z.string().optional().nullable(),
    description: z.string().optional().default(''),
    apply_url: z.string().optional(),
    url: z.string().optional(),
    epoch: z.number().optional(),
    date: z.string().optional(),
    tags: z.array(z.string()).optional().default([]),
    salary_min: z.number().optional(),
    salary_max: z.number().optional(),
  })
  .passthrough();

type RemoteOkJob = z.infer<typeof RemoteOkJobSchema>;

export async function fetchRemoteOk(companyId: number): Promise<NormalizedJob[]> {
  const resp = await fetchWithRetry(ENDPOINT);
  const raw: unknown = await resp.json();
  return mapRemoteokFeed(raw, companyId);
}

/**
 * Pure mapper: takes the parsed JSON payload and returns NormalizedJob[].
 * Exported separately so it can be unit-tested with fixture data.
 */
export function mapRemoteokFeed(raw: unknown, companyId: number): NormalizedJob[] {
  if (!Array.isArray(raw) || raw.length < 1) {
    return [];
  }
  // Drop the meta entry at index 0.
  const rest = raw.slice(1);
  const out: NormalizedJob[] = [];
  for (const item of rest) {
    const parsed = RemoteOkJobSchema.safeParse(item);
    if (!parsed.success) continue;
    out.push(toNormalized(parsed.data, companyId));
  }
  return out;
}

function toNormalized(j: RemoteOkJob, companyId: number): NormalizedJob {
  const title = j.position ?? j.title ?? 'Untitled';
  const company = j.company ?? j.company_name ?? '';
  const externalId = j.id || j.slug || hashShortId(`${title}|${company}`);
  const url = j.apply_url ?? j.url ?? '';
  const location = formatLocation(j.location ?? '', company);
  const postedAt = parsePostedAt(j.epoch, j.date);
  return {
    companyId,
    externalId,
    title,
    url,
    location,
    description: stripHtml(j.description ?? ''),
    postedAt,
  };
}

function formatLocation(loc: string, _company: string): string {
  const trimmed = (loc ?? '').trim();
  if (trimmed.length === 0) return 'Remote';
  // RemoteOK is by definition remote — surface that explicitly so the base
  // filter sees the "remote" keyword even when only a region is listed.
  if (/\bremote\b/i.test(trimmed)) return trimmed;
  return `Remote · ${trimmed}`;
}

function parsePostedAt(epoch?: number, date?: string): Date {
  if (typeof epoch === 'number' && Number.isFinite(epoch)) {
    // RemoteOK epoch is in seconds.
    return new Date(epoch * 1000);
  }
  if (date) {
    const d = new Date(date);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}
