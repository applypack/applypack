import Parser from 'rss-parser';
import { findCountry } from '../countries';
import { fetchWithRetry, stripHtml } from '../http';
import type { LocationHints, WorkplaceCode } from '../location';
import { feedItemKey } from '../text-utils';
import type { NormalizedJob } from '../types';
import { firstText, nested } from './xml-text';

/**
 * Landing.jobs — the Portuguese tech board (stage 3c, plan §4.2). Its Atom
 * feed carries the ~55 newest postings with the board's own fields:
 * `lj:location{lj:city, lj:country}`, `lj:remote_policy` ("Full remote" /
 * "Partial remote" — the board has no on-site value), `lj:category`,
 * `lj:job_type`, `lj:salary`, `lj:expires_at`; the company is the entry's
 * author, the content the full posting as HTML, opening with an offer-info
 * block (company, contract, place, salary, expiry, policy). Verified live
 * 2026-09-03: 55 entries, Portugal 49 / Brazil 3 / Germany 2 / Poland 1.
 * robots.txt allows `/feed` and disallows `/api/`, so the feed it is
 * (ADR 0005); 294 KB, read plainly each tick.
 */
const FEED_URL = 'https://landing.jobs/feed';
const TIMEOUT_MS = 15_000;

/** The feed's policy words → the arrangement; anything else stays with the parser. */
const REMOTE_POLICY: Readonly<Record<string, WorkplaceCode>> = {
  'full remote': 'REMOTE',
  'partial remote': 'HYBRID',
};

export interface LandingJobsItem {
  title?: string;
  link?: string;
  id?: string;
  isoDate?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  author?: string;
  'lj:category'?: unknown;
  'lj:job_type'?: unknown;
  'lj:remote_policy'?: unknown;
  'lj:salary'?: unknown;
  /** xml2js shape: `{ 'lj:city': ['Lisbon'], 'lj:country': ['Portugal'] }`. */
  'lj:location'?: unknown;
}

const parser: Parser<unknown, LandingJobsItem> = new Parser({
  timeout: TIMEOUT_MS,
  customFields: { item: ['lj:category', 'lj:job_type', 'lj:remote_policy', 'lj:location', 'lj:salary', 'author'] },
});

export async function fetchLandingJobs(companyId: number): Promise<NormalizedJob[]> {
  const resp = await fetchWithRetry(FEED_URL, { timeoutMs: TIMEOUT_MS });
  const feed = await parser.parseString(await resp.text());
  return feed.items.flatMap((item) => mapLandingJobsItem(item, companyId) ?? []);
}

/** Pure mapper; the place and the arrangement come from the feed's own fields. */
export function mapLandingJobsItem(item: LandingJobsItem, companyId: number): NormalizedJob | null {
  const link = (item.link ?? '').trim();
  const externalId = /\/at\/([^?#]+)/.exec(item.id ?? link)?.[1]?.replace(/\/+$/, '') || feedItemKey(link, item.title);
  if (!externalId) return null;
  const city = firstText(nested(item['lj:location'], 'lj:city'));
  const country = firstText(nested(item['lj:location'], 'lj:country'));
  const policy = firstText(item['lj:remote_policy']);
  const workplace = REMOTE_POLICY[policy.toLowerCase()];
  const code = findCountry(country)?.code;
  const hints: LocationHints = {
    ...(code ? { countries: [code] } : {}),
    ...(workplace ? { workplace } : {}),
  };
  const category = firstText(item['lj:category']);
  const posted = new Date(item.isoDate ?? item.pubDate ?? '');
  return {
    companyId,
    externalId,
    title: (item.title ?? '').trim() || 'Untitled',
    url: link,
    location: formatLocation(policy, city, country),
    // The posting is HTML; stripHtml decodes entities first (gotcha 12).
    description: [category ? `Category: ${category}.` : '', stripHtml(item.content ?? item.contentSnippet ?? '')]
      .filter((s) => s.length > 0)
      .join('\n\n'),
    postedAt: Number.isNaN(posted.getTime()) ? new Date() : posted,
    locationHints: hints,
  } satisfies NormalizedJob;
}

/** "Partial remote · Lisbon, Portugal", "Full remote · Portugal", "Munich, Germany". */
function formatLocation(policy: string, city: string, country: string): string {
  const place = [city, country].filter((s, i, all) => s.length > 0 && all.indexOf(s) === i).join(', ');
  if (policy.length === 0) return place;
  return place.length > 0 ? `${policy} · ${place}` : policy;
}

