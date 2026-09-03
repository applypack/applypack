import Parser from 'rss-parser';
import { findCountry } from '../countries';
import { fetchWithRetry, stripHtml } from '../http';
import { feedItemKey } from '../text-utils';
import type { NormalizedJob } from '../types';
import { insideParens, parseDouTitle } from './dou-title';

/**
 * DOU.ua — the Ukrainian tech job board (stage 3b, plan §4.2). The RSS at
 * `/vacancies/feeds/` is DOU's own interface (every link carries
 * `utm_source=jobsrss`) and takes the same filters as the site:
 *   category=PHP (59 names)   city=Київ   remote   search=laravel
 *   exp=0-1|1-3|3-5|5plus     page=2
 * bare = the 50 newest, filtered = 25 a page. One Company row per query
 * string, which is the `atsToken` ("category=PHP&remote"). Verified live
 * 2026-09-03: an unknown category answers an EMPTY channel (not an error)
 * and an unencoded city answers HTTP 400 — so the token is re-serialised
 * through URLSearchParams and the probe refuses a query with no items.
 *
 * Terms (plan §0.5): fine for a self-hosted personal tool with the link-back
 * kept; a hosted or commercial deployment needs DOU's written consent.
 *
 * The title carries everything but the description — role, company,
 * salary, cities, "за кордоном", "віддалено" — see dou-title.ts.
 *
 * DOU answers rss-parser's own User-Agent with 403 (measured 2026-09-03),
 * so the feed is fetched with the project's UA through fetchWithRetry and
 * only parsed by rss-parser.
 */
const FEED_URL = 'https://jobs.dou.ua/vacancies/feeds/';
const PARSER_TIMEOUT_MS = 15_000;
/** The query keys the feed understands; anything else is dropped from the token. */
const FEED_PARAMS = ['category', 'city', 'remote', 'search', 'exp', 'page'] as const;

export interface DouItem {
  title?: string;
  link?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  guid?: string;
}

const parser: Parser<unknown, DouItem> = new Parser({ timeout: PARSER_TIMEOUT_MS });

export interface DouCompany {
  id: number;
  /** The feed's query string: "category=PHP&remote", "search=laravel", "" for the newest 50. */
  atsToken: string;
}

export async function fetchDou(company: DouCompany): Promise<NormalizedJob[]> {
  const resp = await fetchWithRetry(douFeedUrl(company.atsToken), { timeoutMs: PARSER_TIMEOUT_MS });
  const feed = await parser.parseString(await resp.text());
  return feed.items.flatMap((item) => mapDouItem(item, company.id) ?? []);
}

/** The token as a feed URL: known keys only, values encoded, `remote` kept bare as DOU writes it. */
export function douFeedUrl(token: string): string {
  const given = new URLSearchParams(token.trim().replace(/^\?/, ''));
  const parts: string[] = [];
  for (const key of FEED_PARAMS) {
    if (!given.has(key)) continue;
    const value = given.get(key) ?? '';
    parts.push(key === 'remote' ? 'remote' : `${key}=${encodeURIComponent(value)}`);
  }
  return parts.length > 0 ? `${FEED_URL}?${parts.join('&')}` : FEED_URL;
}

/**
 * Pure mapper. The employer goes into the description ("Hiring company: …")
 * as every aggregator's does; the location string keeps DOU's own words
 * ("Київ, за кордоном, віддалено") so the parser reads the city and the
 * classifier reads the rest.
 */
export function mapDouItem(item: DouItem, companyId: number): NormalizedJob | null {
  const link = item.link ?? '';
  const externalId = vacancyId(link) ?? feedItemKey(link, item.title);
  if (!externalId) return null;
  const parsed = parseDouTitle(item.title ?? '');
  const location = [...parsed.places, parsed.abroad ? 'за кордоном' : '', parsed.remote ? 'віддалено' : '']
    .filter((s) => s.length > 0)
    .join(', ');
  const header = [
    parsed.company ? `Hiring company: ${parsed.company}.` : '',
    parsed.salary ? `Salary: ${parsed.salary}.` : '',
  ]
    .filter((s) => s.length > 0)
    .join(' ');
  // `content` is the HTML DOU escaped into the XML; rss-parser hands it back
  // as HTML, and stripHtml decodes entities first (gotcha 12).
  const body = stripHtml(item.content ?? item.contentSnippet ?? '');
  return {
    companyId,
    externalId,
    title: parsed.title || item.title || 'Untitled',
    url: link,
    location,
    description: header && body ? `${header}\n\n${body}` : header || body,
    postedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
    locationHints: {
      workplace: parsed.remote ? 'REMOTE' : 'UNKNOWN',
      countries: parsed.places.flatMap((p) => findCountry(p)?.code ?? findCountry(insideParens(p))?.code ?? []),
    },
  } satisfies NormalizedJob;
}

/** "…/vacancies/332846/?utm_source=jobsrss" → "332846": stable across feeds and re-fetches. */
function vacancyId(link: string): string | null {
  return /\/vacancies\/(\d+)\//.exec(link)?.[1] ?? null;
}
