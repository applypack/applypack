import Parser from 'rss-parser';
import { fetchWithRetry, stripHtml } from '../http';
import { conditionalHeaders, rememberResponse } from './conditional';
import { parseLocation } from '../location';
import { feedItemKey } from '../text-utils';
import type { NormalizedJob } from '../types';

const PARSER_TIMEOUT_MS = 10_000;
/** A 70-country allow-list stays in the hints; the string shows the region instead. */
const MAX_COUNTRY_TEXT = 120;

/**
 * WWR's feed carries two location elements rss-parser drops unless they are
 * registered (the LaraJobs pitfall): `<region>` is the coarse label
 * ("Anywhere in the World", "USA Only") and `<country>` a comma list of
 * flag + ISO name ("🇵🇱 Poland, 🇷🇴 Romania, … 🇺🇦 Ukraine") — empty on most
 * items, 70 entries long on some. Verified live 2026-09-03.
 */
export interface WwrItem {
  title?: string;
  link?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  guid?: string;
  region?: string;
  country?: string;
}

const parser: Parser<unknown, WwrItem> = new Parser({
  timeout: PARSER_TIMEOUT_MS,
  customFields: { item: ['region', 'country'] },
});

export interface WwrCompany {
  id: number;
  /** Category slug: "back-end-programming", "full-stack-programming", etc. */
  atsToken: string;
}

/**
 * Fetches a single WeWorkRemotely category RSS feed. Each (id, atsToken)
 * is one synthetic Company row — same pattern as LaraJobs. Multiple
 * categories = multiple Company rows.
 */
export async function fetchWeWorkRemotely(
  company: WwrCompany,
): Promise<NormalizedJob[]> {
  const slug = (company.atsToken || 'back-end-programming').trim();
  const url = `https://weworkremotely.com/categories/remote-${slug}-jobs.rss`;
  // Fetched here rather than through parser.parseURL, so the request carries
  // our own User-Agent and the feed's ETag (docs/scale-plan.md §4).
  const resp = await fetchWithRetry(url, {
    timeoutMs: PARSER_TIMEOUT_MS,
    init: { headers: conditionalHeaders(company.id, url) },
  });
  const feed = await parser.parseString(await resp.text());
  const jobs = feed.items.flatMap((item) => mapWwrItem(item, company.id) ?? []);
  rememberResponse(company.id, url, resp, jobs.length);
  return jobs;
}

/**
 * Pure mapper extracted for unit tests. Every WWR job is remote; the
 * country list is the eligibility allow-list and wins over the region
 * label, which only speaks when the list is empty. The location string
 * carries whichever of the two decided, so the classifier reads it too.
 */
export function mapWwrItem(item: WwrItem, companyId: number): NormalizedJob | null {
  const link = item.link ?? '';
  const externalId = item.guid ?? feedItemKey(link, item.title);
  // Nothing identifies this row — skip it rather than hash '' and merge
  // every such row onto one shared id.
  if (!externalId) return null;
  const description =
    item.contentSnippet ?? (item.content ? stripHtml(item.content) : '') ?? '';
  const countryText = (item.country ?? '').trim();
  const region = (item.region ?? '').trim();
  const allowList = parseLocation(countryText).countries;
  const fromRegion = parseLocation(region);
  const countries = allowList.length > 0 ? allowList : fromRegion.countries;
  const regions = allowList.length > 0 ? [] : fromRegion.regions;
  const where = allowList.length > 0 && countryText.length <= MAX_COUNTRY_TEXT ? countryText : region;
  return {
    companyId,
    externalId,
    title: item.title ?? 'Untitled',
    url: link,
    location: where.length > 0 ? `Remote · ${where}` : 'Remote',
    description,
    postedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
    locationHints: { workplace: 'REMOTE', countries, regions },
  } satisfies NormalizedJob;
}
