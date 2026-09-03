import { z } from 'zod';
import { fetchWithRetry, sleep, stripHtml } from '../http';
import { logger } from '../logger';
import { hashShortId } from '../text-utils';
import type { NormalizedJob } from '../types';

const ENDPOINT = 'https://www.arbeitnow.com/api/job-board-api';
// 175 rows a page, no total, `links.next` until the end (verified live
// 2026-09-03). Three pages an hour is well inside "please do not abuse";
// the base filter culls the rest by title before any AI call.
const MAX_PAGES = 3;
const PAGE_DELAY_MS = 1_000;

/**
 * The second Company row (stage 3a): `visa_sponsorship=true` is a server-side
 * filter — the rows carry no visa field of their own — so it is a feed of
 * its own, keyed by this token. Any other token is the plain board.
 */
export const VISA_TOKEN = 'visa';

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
    links: z.object({ next: z.string().nullable().optional() }).passthrough().optional(),
  })
  .passthrough();

export interface ArbeitnowCompany {
  id: number;
  /** `visa` for the sponsorship feed; anything else is the plain board. */
  atsToken: string;
}

export async function fetchArbeitnow(company: ArbeitnowCompany): Promise<NormalizedJob[]> {
  const out = new Map<string, NormalizedJob>();
  let url: string | null = arbeitnowUrl(company.atsToken);
  for (let page = 1; url && page <= MAX_PAGES; page++) {
    if (page > 1) await sleep(PAGE_DELAY_MS);
    const resp = await fetchWithRetry(url);
    const raw: unknown = await resp.json();
    for (const job of mapArbeitnowFeed(raw, company.id)) {
      if (!out.has(job.externalId)) out.set(job.externalId, job);
    }
    url = nextPageUrl(raw);
    logger.debug({ page, rows: out.size, next: url }, 'arbeitnow: page read');
  }
  return [...out.values()];
}

export function arbeitnowUrl(token: string): string {
  return token === VISA_TOKEN ? `${ENDPOINT}?visa_sponsorship=true` : ENDPOINT;
}

/** The API's own next link, followed only when it stays on the board's host. */
export function nextPageUrl(raw: unknown): string | null {
  const top = ArbeitnowResponseSchema.safeParse(raw);
  const next = top.success ? top.data.links?.next : null;
  return next && next.startsWith(`${ENDPOINT}?`) ? next : null;
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
    // `location` is free text ("Berlin", "Homeoffice", "Deutschlandweit") the
    // parser reads; `remote` is the only structured field.
    locationHints: { workplace: j.remote ? 'REMOTE' : 'UNKNOWN' },
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
