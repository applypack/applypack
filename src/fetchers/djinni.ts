import Parser from 'rss-parser';
import { fetchWithRetry, stripHtml } from '../http';
import type { LocationHints } from '../location';
import { feedItemKey } from '../text-utils';
import type { NormalizedJob } from '../types';

/**
 * Djinni — the Ukrainian tech job marketplace (stage 3b, plan §4.2). The RSS
 * at `/jobs/rss/` takes the site's filters and answers the newest matches:
 *   primary_keyword=PHP   employment=remote|office|parttime
 *   region=UKR|eu|other|worldwide   location=kyiv   country=POL (ISO-3)
 *   exp_level, english_level, salary, page
 * bare = the 100 newest. Items carry title, link, description, pubDate,
 * guid and the `<category>` the keyword matched — no company (only in
 * prose) and NO location: where a posting is open lives solely in the
 * filter, so one Company row per filter string, which is the `atsToken`,
 * and the location string is written from that filter. Verified live
 * 2026-09-03: an UNKNOWN primary_keyword answers the whole bare feed (100
 * items, byte-identical), not an error — the channel head lists every
 * category, so rows whose category is not the requested keyword are dropped
 * and the probe refuses a keyword that leaves nothing. `country=` with an
 * unknown value answers an empty channel. robots.txt allows `/jobs/rss/`.
 */
const FEED_URL = 'https://djinni.co/jobs/rss/';
const TIMEOUT_MS = 15_000;
/** The filter keys the feed understands; anything else is dropped from the token. */
const FEED_PARAMS = [
  'primary_keyword',
  'employment',
  'region',
  'location',
  'country',
  'exp_level',
  'english_level',
  'salary',
  'page',
] as const;

/** What a `region=` value says about where the candidate may live. */
const REGION_PLACE: Readonly<Record<string, { label: string; hints: LocationHints }>> = {
  UKR: { label: 'Ukraine', hints: { countries: ['UA'] } },
  eu: { label: 'EU', hints: { regions: ['EU'] } },
  worldwide: { label: 'Worldwide', hints: { regions: ['WORLDWIDE'] } },
  other: { label: 'outside Ukraine', hints: {} },
};

const EMPLOYMENT_PLACE: Readonly<Record<string, { label: string; workplace: LocationHints['workplace'] }>> = {
  remote: { label: 'Remote', workplace: 'REMOTE' },
  office: { label: 'Office', workplace: 'ONSITE' },
};

export interface DjinniItem {
  title?: string;
  link?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  guid?: string;
  categories?: string[];
}

const parser: Parser<unknown, DjinniItem> = new Parser({ timeout: TIMEOUT_MS });

export interface DjinniCompany {
  id: number;
  /** The feed's filter string: "primary_keyword=PHP&employment=remote&region=UKR". */
  atsToken: string;
}

export async function fetchDjinni(company: DjinniCompany): Promise<NormalizedJob[]> {
  const resp = await fetchWithRetry(djinniFeedUrl(company.atsToken), { timeoutMs: TIMEOUT_MS });
  const feed = await parser.parseString(await resp.text());
  const place = djinniPlace(company.atsToken);
  const keyword = filterParams(company.atsToken).get('primary_keyword');
  return feed.items.flatMap((item) => mapDjinniItem(item, company.id, place, keyword) ?? []);
}

/** The token as a feed URL: known keys only, values encoded. */
export function djinniFeedUrl(token: string): string {
  const given = filterParams(token);
  const parts: string[] = [];
  for (const key of FEED_PARAMS) {
    if (given.has(key)) parts.push(`${key}=${encodeURIComponent(given.get(key) ?? '')}`);
  }
  return parts.length > 0 ? `${FEED_URL}?${parts.join('&')}` : FEED_URL;
}

export interface DjinniPlace {
  /** What the filter says, for the row and the prompt: "Remote · Ukraine", "Office · Kyiv, Ukraine". */
  location: string;
  hints: LocationHints;
}

/**
 * The location a filter string implies. `location=kyiv` is a city slug that
 * the parser reads as a word; `country=` is ISO-3, which the gazetteer does
 * not speak, so it stays in the string only.
 */
export function djinniPlace(token: string): DjinniPlace {
  const given = filterParams(token);
  const employment = EMPLOYMENT_PLACE[given.get('employment') ?? ''];
  const region = REGION_PLACE[given.get('region') ?? ''];
  const city = given.get('location');
  const country = given.get('country');
  const where = [city ? capitalize(city) : '', region?.label ?? '', !region && country ? country.toUpperCase() : '']
    .filter((s) => s.length > 0)
    .join(', ');
  const location = [employment?.label ?? '', where].filter((s) => s.length > 0).join(' · ');
  return {
    location,
    hints: {
      ...(region?.hints ?? {}),
      ...(employment ? { workplace: employment.workplace } : {}),
    },
  };
}

/** Pure mapper; a row whose category is not the requested keyword is the bare-feed fallback and is skipped. */
export function mapDjinniItem(
  item: DjinniItem,
  companyId: number,
  place: DjinniPlace,
  keyword: string | null,
): NormalizedJob | null {
  const link = item.link ?? '';
  const externalId = vacancyId(link) ?? feedItemKey(link, item.title);
  if (!externalId) return null;
  if (keyword && !(item.categories ?? []).some((c) => c.trim().toLowerCase() === keyword.toLowerCase())) return null;
  return {
    companyId,
    externalId,
    title: (item.title ?? '').trim() || 'Untitled',
    url: link,
    location: place.location,
    // `content` is HTML; stripHtml decodes entities first (gotcha 12).
    description: stripHtml(item.content ?? item.contentSnippet ?? ''),
    postedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
    locationHints: place.hints,
  } satisfies NormalizedJob;
}

/** "https://djinni.co/jobs/846307-backend-team-lead-php/" → "846307". */
function vacancyId(link: string): string | null {
  return /\/jobs\/(\d+)-/.exec(link)?.[1] ?? null;
}

function filterParams(token: string): URLSearchParams {
  return new URLSearchParams(token.trim().replace(/^\?/, ''));
}

function capitalize(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}
