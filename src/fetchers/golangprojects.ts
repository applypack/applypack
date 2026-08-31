import Parser from 'rss-parser';
import { stripHtml } from '../http';
import { feedItemKey } from '../text-utils';
import type { NormalizedJob } from '../types';

const FEED_URL = 'https://www.golangprojects.com/rss.xml';
const PARSER_TIMEOUT_MS = 10_000;

interface GolangProjectsItem {
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
 * Title typically encodes location ("🇺🇸 …" or "🇪🇺 …" prefixes), so we
 * pull a hint into the location field and let Claude verify the rest
 * from the description.
 */
export async function fetchGolangProjects(
  companyId: number,
): Promise<NormalizedJob[]> {
  const feed = await parser.parseURL(FEED_URL);
  return feed.items.flatMap((item) => {
    const link = item.link ?? '';
    const externalId = item.guid ?? feedItemKey(link, item.title);
    // Nothing identifies this row — skip it rather than hash '' and merge
    // every such row onto one shared id.
    if (!externalId) return [];
    const description =
      item.contentSnippet ?? (item.content ? stripHtml(item.content) : '') ?? '';
    return {
      companyId,
      externalId,
      title: item.title ?? 'Untitled',
      url: link,
      location: deriveLocation(item.title ?? '', description),
      description,
      postedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
    } satisfies NormalizedJob;
  });
}

/**
 * Pull a rough location hint out of the title or first description line
 * — golangprojects titles tend to start with a flag emoji + region.
 */
function deriveLocation(title: string, description: string): string {
  const t = title;
  if (/🇺🇸/.test(t)) return 'Remote · United States';
  if (/🇪🇺/.test(t) || /\bRemote Europe\b/i.test(t) || /\bEMEA\b/i.test(t)) {
    return 'Remote · Europe';
  }
  if (/🇨🇦/.test(t)) return 'Remote · Canada';
  if (/🇬🇧/.test(t)) return 'Remote · United Kingdom';
  if (/\bRemote\b/i.test(t)) return 'Remote';
  // Fallback: try the first line of the description.
  const firstLine = description.split('\n')[0]?.trim() ?? '';
  if (/\bRemote\b/i.test(firstLine)) return firstLine.slice(0, 60);
  return 'Remote';
}
