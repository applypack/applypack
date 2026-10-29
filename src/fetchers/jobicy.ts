import Parser from 'rss-parser';
import { safeDate } from './dates';
import { fetchWithRetry, sleep, stripHtml } from '../http';
import { logger } from '../logger';
import { feedEntryId } from '../text-utils';
import type { NormalizedJob } from '../types';
import { type FetchContext, EMPTY_CONTEXT } from './fetch-context';
import { cleanEmployer } from '../employer';
import { salaryLine } from './salary';

const FEED_URL = 'https://jobicy.com/?feed=job_feed';
const DEFAULT_CATEGORY = 'dev';
const PARSER_TIMEOUT_MS = 15_000;
/** One feed per place the searches hunt in; a pause between them (credit + link-back terms). */
const FEED_DELAY_MS = 1_000;

/**
 * Jobicy's `geo` vocabulary, verified live 2026-09-03: the API echoes the
 * slug in `appliedFilters`, the RSS answers an unknown slug with an EMPTY
 * feed — which is why only these slugs are ever sent. `geo=poland` has
 * eligibility semantics: it also returns Europe / EMEA / Anywhere rows.
 */
export const JOBICY_GEO: Readonly<Record<string, string>> = {
  US: 'usa',
  CA: 'canada',
  GB: 'uk',
  DE: 'germany',
  PL: 'poland',
  UA: 'ukraine',
  NL: 'netherlands',
  ES: 'spain',
  FR: 'france',
  EU: 'europe',
  EUROPE: 'europe',
  EMEA: 'emea',
  LATAM: 'latam',
  APAC: 'apac',
};

/**
 * Jobicy is a cross-company remote-job aggregator. Their RSS feed
 * `https://jobicy.com/?feed=job_feed&job_categories=dev` returns ~200
 * recent jobs spanning many employers (PSI CRO, ManTech, Mindrift,
 * etc.) — none of which we'd ever seed individually. This is the
 * mechanism for "see jobs at companies I don't track yet".
 *
 * Like Larajobs, the structured fields live in a custom XML namespace
 * (`xmlns:job_listing="https://jobicy.com"`):
 *   <job_listing:location>USA</job_listing:location>
 *   <job_listing:job_type>Full Time</job_listing:job_type>
 *   <job_listing:company>ManTech</job_listing:company>
 * rss-parser drops these unless we opt in via customFields. The
 * Larajobs fetcher (phase-7.2) hit the exact same pitfall — see that
 * file's header comment for the gotcha.
 *
 * `<description>` is an excerpt cut at ~250 characters and ending in "…";
 * the whole posting is `<content:encoded>` (~13 k characters, 200 of 200
 * items on 2026-10-29), which rss-parser keeps under its own name (#658).
 * About half the items also carry `salary_min` / `salary_max` /
 * `salary_currency` / `salary_period`.
 */
export interface JobicyItem {
  title?: string;
  link?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  'content:encoded'?: string;
  guid?: string;
  jobLocation?: string;
  jobType?: string;
  jobCompany?: string;
  salaryMin?: string;
  salaryMax?: string;
  salaryCurrency?: string;
  salaryPeriod?: string;
}

const parser: Parser<unknown, JobicyItem> = new Parser({
  timeout: PARSER_TIMEOUT_MS,
  customFields: {
    item: [
      ['job_listing:location', 'jobLocation'],
      ['job_listing:job_type', 'jobType'],
      ['job_listing:company', 'jobCompany'],
      ['job_listing:salary_min', 'salaryMin'],
      ['job_listing:salary_max', 'salaryMax'],
      ['job_listing:salary_currency', 'salaryCurrency'],
      ['job_listing:salary_period', 'salaryPeriod'],
    ],
  },
});

/**
 * One feed per place the running searches hunt in (stage 3a): a PL + DE + EU
 * search pulls `geo=poland`, `geo=germany` and `geo=europe` instead of the
 * whole feed, and a posting listed in several of them is kept once. A search
 * that hunts anywhere — or one whose places Jobicy has no slug for — falls
 * back to the unfiltered feed, exactly as before.
 */
export async function fetchJobicy(
  companyId: number,
  context: FetchContext = EMPTY_CONTEXT,
  category: string = DEFAULT_CATEGORY,
): Promise<NormalizedJob[]> {
  const slugs = jobicySlugsFor(context);
  const feeds = slugs.length > 0 ? slugs : [null];
  const out = new Map<string, NormalizedJob>();
  for (const [i, slug] of feeds.entries()) {
    if (i > 0) await sleep(FEED_DELAY_MS);
    // fetchWithRetry rather than parser.parseURL: the project's User-Agent and
    // the retry ladder. No validator — one row makes several requests (ADR 0035).
    const resp = await fetchWithRetry(jobicyFeedUrl(category, slug), { timeoutMs: PARSER_TIMEOUT_MS });
    const items = await readJobicyFeed(await resp.text());
    let added = 0;
    for (const item of items) {
      const job = mapJobicyItem(item, companyId);
      if (job && !out.has(job.externalId)) {
        out.set(job.externalId, job);
        added++;
      }
    }
    logger.debug({ slug, items: items.length, added }, 'jobicy: feed read');
  }
  return [...out.values()];
}

/** The items of one feed, its own fields included. */
export async function readJobicyFeed(xml: string): Promise<JobicyItem[]> {
  return (await parser.parseString(xml)).items;
}

/** The slugs Jobicy knows for the searches' places, once each, in context order. */
export function jobicySlugsFor(context: FetchContext): string[] {
  const slugs: string[] = [];
  for (const code of [...context.countries, ...context.regions]) {
    const slug = JOBICY_GEO[code];
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}

export function jobicyFeedUrl(category: string, slug: string | null): string {
  const geo = slug ? `&geo=${encodeURIComponent(slug)}` : '';
  return `${FEED_URL}&job_categories=${encodeURIComponent(category)}${geo}`;
}

/**
 * Pure mapper extracted for unit tests. Folds the underlying employer
 * name (Jobicy aggregates across companies, but we register a single
 * synthetic Company row for the feed) into the description so Claude
 * sees `Hiring company: ManTech` and can score accordingly.
 */
export function mapJobicyItem(
  item: JobicyItem,
  companyId: number,
): NormalizedJob | null {
  const link = item.link ?? '';
  const externalId = feedEntryId(item.guid, link, item.title);
  // Nothing identifies this row — skip it rather than hash '' and merge
  // every such row onto one shared id.
  if (!externalId) return null;
  const full = item['content:encoded'];
  const baseDescription = full
    ? stripHtml(full)
    : (item.contentSnippet ?? (item.content ? stripHtml(item.content) : ''));
  const description = augmentDescription(baseDescription, item);
  const location = (item.jobLocation && item.jobLocation.trim()) || 'Remote';
  return {
    companyId,
    employer: cleanEmployer(item.jobCompany),
    externalId,
    title: item.title ?? 'Untitled',
    url: link,
    location,
    description,
    postedAt: safeDate(item.pubDate),
    // <job_listing:location> is a fixed vocabulary ("USA", "Europe, Norway",
    // "Anywhere") the parser reads from the string; the board is remote-only.
    locationHints: { workplace: 'REMOTE' },
  } satisfies NormalizedJob;
}

function augmentDescription(base: string, item: JobicyItem): string {
  const parts: string[] = [];
  if (item.jobCompany && item.jobCompany.trim().length > 0) {
    parts.push(`Hiring company: ${item.jobCompany.trim()}.`);
  }
  if (item.jobType && item.jobType.trim().length > 0) {
    parts.push(`Type: ${item.jobType.trim().toLowerCase()}.`);
  }
  const salary = jobicySalary(item);
  if (salary) parts.push(salary);
  const header = parts.join(' ');
  if (header.length === 0) return base.trim();
  if (base.trim().length === 0) return header;
  return `${header}\n\n${base.trim()}`;
}

/** "Salary: 150000-200000 USD (yearly)." off the item's own fields. */
function jobicySalary(item: JobicyItem): string | null {
  const bound = (v: string | undefined) => Number.parseFloat(v ?? '');
  return salaryLine(bound(item.salaryMin), bound(item.salaryMax), item.salaryCurrency, item.salaryPeriod);
}
