import Parser from 'rss-parser';
import { fetchWithRetry, stripHtml } from '../http';
import { feedItemKey } from '../text-utils';
import { conditionalHeaders, rememberResponse } from './conditional';
import type { NormalizedJob } from '../types';

const FEED_URL = 'https://www.golangprojects.com/rss.xml';
const PARSER_TIMEOUT_MS = 10_000;

export interface GolangProjectsItem {
  title?: string;
  link?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  guid?: string;
}

const parser: Parser<unknown, GolangProjectsItem> = new Parser({
  timeout: PARSER_TIMEOUT_MS,
});

/**
 * golangprojects.com — single curated feed, ~12-year-old Go-only board.
 * The flag emoji the titles used to open with are gone (checked
 * 2026-09-03); the region now lives in the URL slug, so `deriveLocation`
 * reads it from there and Claude verifies the rest from the description.
 */
export async function fetchGolangProjects(
  companyId: number,
): Promise<NormalizedJob[]> {
  const resp = await fetchWithRetry(FEED_URL, {
    timeoutMs: PARSER_TIMEOUT_MS,
    init: { headers: conditionalHeaders(companyId, FEED_URL) },
  });
  const feed = await parser.parseString(await resp.text());
  const jobs = feed.items.flatMap((item) => mapGolangProjectsItem(item, companyId) ?? []);
  rememberResponse(companyId, FEED_URL, resp, jobs.length);
  return jobs;
}

export function mapGolangProjectsItem(
  item: GolangProjectsItem,
  companyId: number,
): NormalizedJob | null {
  const link = item.link ?? '';
  const externalId = item.guid ?? feedItemKey(link, item.title);
  // Nothing identifies this row — skip it rather than hash '' and merge
  // every such row onto one shared id.
  if (!externalId) return null;
  const description =
    item.contentSnippet ?? (item.content ? stripHtml(item.content) : '') ?? '';
  return {
    companyId,
    externalId,
    title: item.title ?? 'Untitled',
    url: link,
    location: deriveLocation(item.title ?? '', link),
    description,
    postedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
  } satisfies NormalizedJob;
}

// ".../golang-go-job-gxf-Remote-Europe-Senior-Software-Engineer-…-Form3-remotework.html"
const SLUG_RE = /\/golang-(?:go|remote)-job-[a-z0-9]+-([^/]+)\.html$/i;

/**
 * The slug is `<region words>-<title words>-<company words>`. The region is
 * whatever comes before the title's first word: "Remote", "Remote Europe".
 * A slug that does not fit the pattern yields nothing rather than a guess.
 */
export function deriveLocation(title: string, link: string): string {
  const slug = SLUG_RE.exec(link)?.[1];
  const firstTitleWord = title.trim().split(/\s+/)[0]?.replace(/[^\w]/g, '');
  if (!slug || !firstTitleWord) return '';
  const words = slug.split('-');
  const titleAt = words.findIndex((w) => w.toLowerCase() === firstTitleWord.toLowerCase());
  const head = titleAt > 0 ? words.slice(0, titleAt) : [];
  return head.join(' ').replace(/^Remote (\w)/, 'Remote · $1');
}
