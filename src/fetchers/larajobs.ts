import Parser from 'rss-parser';
import { stripHtml } from '../http';
import { hashShortId } from '../text-utils';
import type { NormalizedJob } from '../types';

const FEED_URL = 'https://larajobs.com/feed';
const PARSER_TIMEOUT_MS = 10_000;

/**
 * LaraJobs RSS uses a custom XML namespace `xmlns:job="https://larajobs.com"`
 * for the most useful fields:
 *   <job:location>United States/Remote (USA Only)</job:location>
 *   <job:salary>USD 130,000 - 160,000</job:salary>
 *   <job:company>Acme Inc</job:company>
 *   <job:tags>laravel,vue,inertia</job:tags>
 *
 * rss-parser treats unknown elements as "custom fields" we have to opt into.
 * Without this opt-in, all of the above is silently dropped — Claude only
 * sees an empty <description>, location defaults to "Remote", and the
 * filter has nothing to grade. This was a real bug in production: every
 * LaraJobs job landed with `location='Remote'` regardless of the actual
 * country/region in the feed.
 */
export interface LarajobsItem {
  title?: string;
  link?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  guid?: string;
  jobLocation?: string;
  jobSalary?: string;
  jobCompany?: string;
  jobTags?: string;
  jobJobType?: string;
}

const parser: Parser<unknown, LarajobsItem> = new Parser({
  timeout: PARSER_TIMEOUT_MS,
  customFields: {
    item: [
      ['job:location', 'jobLocation'],
      ['job:salary', 'jobSalary'],
      ['job:company', 'jobCompany'],
      ['job:tags', 'jobTags'],
      ['job:job_type', 'jobJobType'],
    ],
  },
});

export async function fetchLarajobs(
  companyId: number,
): Promise<NormalizedJob[]> {
  const feed = await parser.parseURL(FEED_URL);
  return feed.items.map((item) => mapLarajobsItem(item, companyId));
}

/**
 * Pure mapper extracted for unit tests. Folds salary / company / tags
 * into the description so Claude has a chance to grade them; uses
 * `<job:location>` if present, falls back to "Remote" so the base
 * filter still admits the job.
 */
export function mapLarajobsItem(
  item: LarajobsItem,
  companyId: number,
): NormalizedJob {
  const link = item.link ?? '';
  const externalId = item.guid ?? hashShortId(link || (item.title ?? ''));
  const baseDescription =
    item.contentSnippet ??
    (item.content ? stripHtml(item.content) : '') ??
    '';
  const description = augmentDescription(baseDescription, item);
  const location =
    (item.jobLocation && item.jobLocation.trim()) || 'Remote';
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

function augmentDescription(base: string, item: LarajobsItem): string {
  const parts: string[] = [];
  if (item.jobCompany && item.jobCompany.trim().length > 0) {
    parts.push(`Hiring company: ${item.jobCompany.trim()}.`);
  }
  if (item.jobSalary && item.jobSalary.trim().length > 0) {
    parts.push(`Salary: ${item.jobSalary.trim()}.`);
  }
  if (item.jobTags && item.jobTags.trim().length > 0) {
    parts.push(`Tags: ${item.jobTags.trim()}.`);
  }
  if (item.jobJobType && item.jobJobType.trim().length > 0) {
    parts.push(`Type: ${item.jobJobType.replace(/_/g, ' ').toLowerCase()}.`);
  }
  const header = parts.join(' ');
  if (header.length === 0) return base.trim();
  if (base.trim().length === 0) return header;
  return `${header}\n\n${base.trim()}`;
}
