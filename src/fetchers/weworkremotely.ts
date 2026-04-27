import Parser from 'rss-parser';
import { stripHtml } from '../http';
import { hashShortId } from '../text-utils';
import type { NormalizedJob } from '../types';

const PARSER_TIMEOUT_MS = 10_000;

interface WwrItem {
  title?: string;
  link?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  guid?: string;
  // WWR includes a custom <region> tag, but rss-parser ignores unknown tags
  // unless we register them — keep it simple, location stays "Remote".
}

const parser: Parser<unknown, WwrItem> = new Parser({
  timeout: PARSER_TIMEOUT_MS,
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
  const feed = await parser.parseURL(url);
  return feed.items.map((item) => {
    const link = item.link ?? '';
    const externalId = item.guid ?? hashShortId(link || (item.title ?? ''));
    const description =
      item.contentSnippet ?? (item.content ? stripHtml(item.content) : '') ?? '';
    return {
      companyId: company.id,
      externalId,
      title: item.title ?? 'Untitled',
      url: link,
      // WWR jobs are by definition remote; the feed doesn't expose a
      // structured location and the title usually carries any country
      // restriction (the actual <region> field is namespaced and skipped
      // by our parser). Keep "Remote" — Claude reads the description for
      // country-locks.
      location: 'Remote',
      description,
      postedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
    } satisfies NormalizedJob;
  });
}
