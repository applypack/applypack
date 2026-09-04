import Parser from 'rss-parser';
import { fetchWithRetry, stripHtml } from '../http';
import { checkPostingUrl } from '../jobs/posting-url';
import { feedItemKey } from '../text-utils';
import { conditionalHeaders, rememberResponse } from './conditional';
import type { NormalizedJob } from '../types';

/**
 * A generic RSS / Atom job feed (TASKS §17 stage A, ADR 0036). The atsToken
 * IS the feed URL — there is no vendor here to derive one from.
 *
 * This is the rung below the vendor-shaped types, never a replacement for
 * one: `watchlist/resolve.ts` reaches it only after every ATS shape has
 * failed, because a board API tells us the arrangement, the department and a
 * stable id, and a feed tells us a title and a link.
 *
 * Two rules the fixture bought (docs/company-watchlist.md):
 *
 * - **The URL is the user's, so it goes through the same guards an arbitrary
 *   posting URL does** — `checkPostingUrl` refuses a private address, a
 *   non-http scheme and every ADR 0005 host. It is checked again here rather
 *   than trusted from the moment it was added, because a row is a row and
 *   nothing stops one being edited into the database by hand.
 * - **A feed with no items is not a feed.** Measured on automattic.com:
 *   WordPress answers a well-formed, item-less RSS at any `/<x>/feed`, so a
 *   resolver that accepts "200 and parses" would add a source that can never
 *   produce a posting. The emptiness check belongs to the resolver, which
 *   decides whether to offer the row; here an empty feed is simply `empty`,
 *   which is what ADR 0019 already knows how to age out.
 */

const TIMEOUT_MS = 15_000;

export interface FeedItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  isoDate?: string;
  content?: string;
  contentSnippet?: string;
  categories?: string[];
}

const parser: Parser<{ title?: string }, FeedItem> = new Parser({ timeout: TIMEOUT_MS });

export interface FeedCompany {
  id: number;
  /** The feed URL itself. */
  atsToken: string;
}

export async function fetchFeed(company: FeedCompany): Promise<NormalizedJob[]> {
  const url = feedUrl(company.atsToken);
  const resp = await fetchWithRetry(url, {
    timeoutMs: TIMEOUT_MS,
    init: { headers: conditionalHeaders(company.id, url) },
  });
  const feed = await parser.parseString(await resp.text());
  const jobs = feed.items.flatMap((item) => mapFeedItem(item, company.id) ?? []);
  rememberResponse(company.id, url, resp, jobs.length);
  return jobs;
}

/** The token as a URL, refused if it is not one we are allowed to fetch. */
export function feedUrl(atsToken: string): string {
  const checked = checkPostingUrl(atsToken);
  if (!checked.ok) throw new Error(`feed: ${checked.error}`);
  return checked.url.toString();
}

/** True when the body parses as RSS or Atom. Cheap enough to run before the parser. */
export function looksLikeFeed(body: string): boolean {
  return /<(?:rss|feed)[\s>]/i.test(body.slice(0, 2_000));
}

/**
 * Pure mapper. A feed carries no structured location, so `location` is left
 * empty and `parseLocation` reads what the title and description say — the
 * same position every text-only source is in.
 */
export function mapFeedItem(item: FeedItem, companyId: number): NormalizedJob | null {
  const link = (item.link ?? '').trim();
  // The link is the stable identity; guid is a fallback because some feeds
  // reuse a permalink as guid and some publish an opaque one.
  const externalId = feedItemKey(link, item.guid, item.title);
  if (!externalId) return null;
  const title = (item.title ?? '').trim();
  if (title.length === 0) return null;
  // The description is HTML in most feeds; stripHtml decodes entities first
  // and rebuilds paragraphs from block tags (gotcha 12).
  const body = item.content ?? item.contentSnippet ?? '';
  const categories = (item.categories ?? []).map((c) => String(c).trim()).filter((c) => c.length > 0);
  const posted = new Date(item.isoDate ?? item.pubDate ?? '');
  return {
    companyId,
    externalId,
    title,
    url: link,
    location: '',
    description: [stripHtml(body), categories.length > 0 ? `Tags: ${categories.join(', ')}.` : '']
      .filter((s) => s.length > 0)
      .join('\n\n'),
    postedAt: Number.isNaN(posted.getTime()) ? new Date() : posted,
  } satisfies NormalizedJob;
}
