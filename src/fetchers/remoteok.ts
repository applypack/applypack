import { isIP } from 'node:net';
import { z } from 'zod';
import { fetchWithRetry, stripHtml } from '../http';
import { conditionalHeaders, rememberResponse } from './conditional';
import { hashShortId } from '../text-utils';
import type { NormalizedJob } from '../types';
import { cleanEmployer } from '../employer';

const ENDPOINT = 'https://remoteok.com/api';

/*
 * RemoteOK ends every description with a paragraph asking the applicant to
 * quote a word and a tag. The tag is "R" and the base64 of the address that
 * asked for the feed: this machine's public IP. Kept, it was stored, sent to
 * the AI engine with every call that reads the description, and shown on the
 * job page, so it is cut before the posting goes anywhere. A tag that turns up
 * outside that paragraph is cut when it decodes to an address.
 */
const READ_CHECK =
  /Please mention the word[^()]*\(#R[A-Za-z0-9+/=]+\)\.?(?:\s*This is a beta feature to avoid spam applicants\.)?(?:\s*Companies can search these words to find applicants that read this and see they(?:'|&#39;|&#x27;|’)re human\.)?/g;
const TAG = /#?R[A-Za-z0-9+/]{6,}={0,2}/g;

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
  const resp = await fetchWithRetry(ENDPOINT, { init: { headers: conditionalHeaders(companyId, ENDPOINT) } });
  const raw: unknown = await resp.json();
  const jobs = mapRemoteokFeed(raw, companyId);
  rememberResponse(companyId, ENDPOINT, resp, jobs.length);
  return jobs;
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
    employer: cleanEmployer(company),
    externalId,
    title,
    url,
    location,
    description: stripHtml(withoutAddressTag(j.description ?? '')),
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

/** The description without RemoteOK's read-check paragraph, or any tag that carries an IP address. */
export function withoutAddressTag(description: string): string {
  return description.replace(READ_CHECK, '').replace(TAG, (tag) => (isIP(Buffer.from(tag.replace(/^#?R/, ''), 'base64').toString('latin1')) === 0 ? tag : ''));
}
