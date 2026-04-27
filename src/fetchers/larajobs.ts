import { createHash } from 'node:crypto';
import Parser from 'rss-parser';
import { stripHtml } from '../http';
import type { NormalizedJob } from '../types';

const FEED_URL = 'https://larajobs.com/feed';
const PARSER_TIMEOUT_MS = 10_000;

interface LarajobsItem {
  title?: string;
  link?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  guid?: string;
}

const parser: Parser<unknown, LarajobsItem> = new Parser({
  timeout: PARSER_TIMEOUT_MS,
});

export async function fetchLarajobs(
  companyId: number,
): Promise<NormalizedJob[]> {
  const feed = await parser.parseURL(FEED_URL);
  return feed.items.map((item) => {
    const link = item.link ?? '';
    const externalId = item.guid ?? hashId(link || (item.title ?? ''));
    const description =
      item.contentSnippet ??
      (item.content ? stripHtml(item.content) : '') ??
      '';
    return {
      companyId,
      externalId,
      title: item.title ?? 'Untitled',
      url: link,
      // LaraJobs feed doesn't include a structured location field.
      // Default to "Remote" so the base filter lets it through and Claude
      // makes the US-eligibility call.
      location: 'Remote',
      description,
      postedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
    } satisfies NormalizedJob;
  });
}

function hashId(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}
