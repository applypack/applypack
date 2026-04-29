import Parser from 'rss-parser';
import { stripHtml } from '../http';
import { hashShortId } from '../text-utils';
import type { NormalizedJob } from '../types';

const FEED_URL_TEMPLATE = (category: string) =>
  `https://jobicy.com/?feed=job_feed&job_categories=${encodeURIComponent(category)}`;
const PARSER_TIMEOUT_MS = 15_000;
const DEFAULT_CATEGORY = 'dev';

/**
 * Jobicy is a cross-company remote-job aggregator. Their RSS feed
 * `https://jobicy.com/?feed=job_feed&job_categories=dev` returns ~50
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
 */
export interface JobicyItem {
  title?: string;
  link?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  guid?: string;
  jobLocation?: string;
  jobType?: string;
  jobCompany?: string;
}

const parser: Parser<unknown, JobicyItem> = new Parser({
  timeout: PARSER_TIMEOUT_MS,
  customFields: {
    item: [
      ['job_listing:location', 'jobLocation'],
      ['job_listing:job_type', 'jobType'],
      ['job_listing:company', 'jobCompany'],
    ],
  },
});

export async function fetchJobicy(
  companyId: number,
  category: string = DEFAULT_CATEGORY,
): Promise<NormalizedJob[]> {
  const feed = await parser.parseURL(FEED_URL_TEMPLATE(category));
  return feed.items.map((item) => mapJobicyItem(item, companyId));
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
): NormalizedJob {
  const link = item.link ?? '';
  const externalId = item.guid ?? hashShortId(link || (item.title ?? ''));
  const baseDescription =
    item.contentSnippet ??
    (item.content ? stripHtml(item.content) : '') ??
    '';
  const description = augmentDescription(baseDescription, item);
  const location = (item.jobLocation && item.jobLocation.trim()) || 'Remote';
  return {
    companyId,
    externalId,
    title: item.title ?? 'Untitled',
    url: link,
    location,
    description,
    postedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
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
  const header = parts.join(' ');
  if (header.length === 0) return base.trim();
  if (base.trim().length === 0) return header;
  return `${header}\n\n${base.trim()}`;
}
