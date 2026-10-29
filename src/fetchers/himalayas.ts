import { z } from 'zod';
import { findCountry } from '../countries';
import { fetchWithRetry, sleep, stripHtml } from '../http';
import { logger } from '../logger';
import { hashShortId } from '../text-utils';
import type { NormalizedJob } from '../types';
import { type FetchContext, EMPTY_CONTEXT } from './fetch-context';
import { cleanEmployer } from '../employer';

// The browse endpoint caps `limit` at 20 and returns newest-first, and some
// 220 postings arrive an hour (#661: the 100 newest spanned 27 minutes), so
// one page saw 9 % of them. A read follows `nextCursor` (`?cursor=`, the
// API's own paging since 2026-08-21; `offset` is deprecated) back to where
// the previous read began, ten pages at most.
const ENDPOINT = 'https://himalayas.app/jobs/api?limit=20';
const BROWSE_PAGES_MAX = 10;
/**
 * The first page comes out of a cache that keeps it up to two hours
 * (`s-maxage=7200`; 30 minutes old when measured, 2026-10-29), so the
 * previous read may have begun that far behind its own clock. The walk
 * reaches that far past it; the store dedupes the overlap.
 */
const CACHE_SLACK_MS = 2 * 60 * 60 * 1000;
// The search endpoint (stage 3a, verified live 2026-09-03): same `jobs[]`
// shape, `limit` capped at 20 as well, `country=` takes an ISO code or a
// name and answers HTTP 400 to an unknown one — an error, not a silent
// empty feed. `exclude_worldwide=true` keeps the country-locked rows; the
// worldwide rows come from one extra `worldwide=true` call.
const SEARCH_ENDPOINT = 'https://himalayas.app/jobs/api/search';
/** One call per country, one for worldwide; enough for the eight-search ceiling. */
const MAX_COUNTRY_CALLS = 8;
const CALL_DELAY_MS = 1_000;

/**
 * Himalayas is a cross-company remote-job aggregator with a free,
 * no-auth JSON API. The feed spans ALL categories (tech next to Legal /
 * Sales / Support) and the browse endpoint has no category filter, so —
 * like Working Nomads — we normalize everything and let
 * `passesBaseFilter` cull non-matching titles for free.
 *
 * Structured extras the feed carries (employer, seniority, employment
 * type, salary range) are folded into the description so Claude sees
 * them; salary especially, since `salary_min` extraction otherwise
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

const CursorSchema = z.object({ nextCursor: z.string().min(1) }).passthrough();

/**
 * With searches that name countries: one search call per country (country-
 * locked rows) plus one worldwide call, merged by guid. Otherwise — a search
 * that hunts anywhere, or one that names only groups the API cannot express —
 * the browse feed, walked back to the previous read.
 */
export async function fetchHimalayas(
  companyId: number,
  context: FetchContext = EMPTY_CONTEXT,
  /** The source's last good read (`Company.lastOkAt`): where the browse walk may stop. */
  previousRead: Date | null = null,
): Promise<NormalizedJob[]> {
  let calls = 0;
  const readPage = async (url: string): Promise<unknown> => {
    if (calls++ > 0) await sleep(CALL_DELAY_MS);
    return (await fetchWithRetry(url)).json();
  };
  const out = new Map<string, NormalizedJob>();
  for (const url of himalayasUrls(context)) {
    const jobs = url === ENDPOINT ? await walkBrowseFeed(readPage, companyId, previousRead) : mapHimalayasFeed(await readPage(url), companyId);
    let added = 0;
    for (const job of jobs) {
      if (!out.has(job.externalId)) {
        out.set(job.externalId, job);
        added++;
      }
    }
    logger.debug({ url, added }, 'himalayas: feed read');
  }
  logger.debug({ calls, jobs: out.size }, 'himalayas: read done');
  return [...out.values()];
}

/**
 * The browse feed, page after page, until a page reaches back to the
 * previous read (less the cache's slack), the cursor runs out, a page is
 * empty or ten pages are read. A first read reads all ten. A page after the
 * first that fails ends the walk with what it brought — a 429 on page six
 * must not throw away five pages.
 */
export async function walkBrowseFeed(
  readPage: (url: string) => Promise<unknown>,
  companyId: number,
  previousRead: Date | null,
): Promise<NormalizedJob[]> {
  const stopAt = previousRead === null ? null : previousRead.getTime() - CACHE_SLACK_MS;
  const jobs: NormalizedJob[] = [];
  let url: string | null = ENDPOINT;
  for (let page = 0; url !== null && page < BROWSE_PAGES_MAX; page++) {
    let raw: unknown;
    try {
      raw = await readPage(url);
    } catch (err) {
      if (page === 0) throw err;
      logger.warn({ err, page: page + 1 }, 'himalayas: browse walk stopped at a failed page');
      break;
    }
    const mapped = mapHimalayasFeed(raw, companyId);
    jobs.push(...mapped);
    const reachedBack = stopAt !== null && mapped.some((j) => j.postedAt.getTime() <= stopAt);
    url = mapped.length === 0 || reachedBack ? null : nextPageUrl(raw);
  }
  return jobs;
}

/** The browse page after this one, from the answer's `nextCursor`; null at the end of the feed. */
export function nextPageUrl(raw: unknown): string | null {
  const page = CursorSchema.safeParse(raw);
  return page.success ? `${ENDPOINT}&cursor=${encodeURIComponent(page.data.nextCursor)}` : null;
}

/**
 * The calls a context needs: per-country searches + worldwide, or the browse
 * feed. A search that names a group as well as countries ("PL, DE and the
 * EU") also reads the browse feed: the country calls alone missed a posting
 * open to Spain only, which the group admits (audit FETCH-5). The base
 * filter narrows what it brings.
 */
export function himalayasUrls(context: FetchContext): string[] {
  const countries = context.countries.slice(0, MAX_COUNTRY_CALLS);
  if (countries.length === 0) return [ENDPOINT];
  return [
    ...countries.map((c) => `${SEARCH_ENDPOINT}?country=${encodeURIComponent(c)}&exclude_worldwide=true&limit=20`),
    `${SEARCH_ENDPOINT}?worldwide=true&limit=20`,
    ...(context.regions.length > 0 ? [ENDPOINT] : []),
  ];
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
    employer: cleanEmployer(j.companyName),
    externalId,
    title: j.title,
    url,
    location: formatLocation(j.locationRestrictions),
    description: augmentDescription(stripHtml(rawDescription), j),
    postedAt: parsePubDate(j.pubDate),
    // `locationRestrictions` are ISO country names ("United States",
    // "Romania"); verified live 2026-09-03. Unknown names stay in the string.
    locationHints: {
      workplace: 'REMOTE',
      countries: j.locationRestrictions.flatMap((name) => findCountry(name)?.code ?? []),
    },
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
