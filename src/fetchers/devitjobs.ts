import Parser from 'rss-parser';
import { placeLabel } from '../countries';
import { decodeHtmlEntities, fetchWithRetry, stripHtml } from '../http';
import { conditionalHeaders, rememberResponse } from './conditional';
import { feedItemKey } from '../text-utils';
import type { NormalizedJob } from '../types';

/**
 * The DevITjobs family (stage 3c, plan §4.2): GermanTechJobs.de, DevITjobs.uk
 * and DevITjobs.nl — one site per country, one RSS feed each at `/rss`, the
 * host is the Company row's token. Verified live 2026-09-03: 839 / 1 758 /
 * 242 items (1.6–12.6 MB uncompressed, brotli on the wire), every title
 * `Role @ Company [salary]`, `content:encoded` with Salary / Requirements /
 * Responsibilities / Technologies / More sections, links tagged
 * `utm_source=our_rss_feed` — the sites' own syndication. No city and no
 * arrangement in the feed (the words appear in prose only), so the country
 * hint is the site's and the arrangement stays with the classifier. The
 * feeds keep items for years; only the last MAX_AGE_DAYS are taken, the
 * rest would be dead postings scored for nothing. Both validators answer
 * 304 — the shared conditional cache handles that for every source now
 * (docs/scale-plan.md §4).
 */
const SITES: Readonly<Record<string, string>> = {
  'germantechjobs.de': 'DE',
  'devitjobs.uk': 'GB',
  'devitjobs.nl': 'NL',
};
/** The UK feed is 12.6 MB before compression. */
const TIMEOUT_MS = 30_000;
/** Items older than this are skipped — the feeds carry postings from years back. */
const MAX_AGE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface DevItJobsItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  'content:encoded'?: string;
}

const parser: Parser<unknown, DevItJobsItem> = new Parser({
  timeout: TIMEOUT_MS,
  customFields: { item: ['content:encoded'] },
});

export interface DevItJobsCompany {
  id: number;
  /** The site host: "germantechjobs.de", "devitjobs.uk" or "devitjobs.nl". */
  atsToken: string;
}

export async function fetchDevItJobs(company: DevItJobsCompany): Promise<NormalizedJob[]> {
  const host = devItJobsHost(company.atsToken);
  const url = `https://${host}/rss`;
  const resp = await fetchWithRetry(url, {
    timeoutMs: TIMEOUT_MS,
    init: { headers: conditionalHeaders(company.id, url) },
  });
  const feed = await parser.parseString(await resp.text());
  const now = new Date();
  const jobs = feed.items.flatMap((item) => mapDevItJobsItem(item, company.id, host, now) ?? []);
  rememberResponse(company.id, url, resp, jobs.length);
  return jobs;
}

/** The token as one of the three hosts; a scheme, `www.` or a path is tolerated, anything else refused. */
export function devItJobsHost(token: string): string {
  const host = token
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
  if (!(host in SITES)) {
    throw new Error(`devitjobs: unknown site "${token}" — one of ${Object.keys(SITES).join(', ')}`);
  }
  return host;
}

export interface DevItJobsTitle {
  role: string;
  company: string | null;
  salary: string | null;
}

/** "Software Engineer - C++ @ Additional Resources [£17,500 - 35,000]" → role, company, salary. */
export function parseDevItJobsTitle(title: string): DevItJobsTitle {
  const m = /^(.*) @ (.*?)(?: \[([^\]]*)\])?$/s.exec(title.trim());
  if (!m) return { role: title.trim(), company: null, salary: null };
  return {
    role: (m[1] ?? '').trim(),
    company: (m[2] ?? '').trim() || null,
    salary: (m[3] ?? '').trim() || null,
  };
}

/**
 * Pure mapper; the country is the site's, the id the posting's path slug.
 * An item older than MAX_AGE_DAYS (against `now`) is skipped.
 */
export function mapDevItJobsItem(item: DevItJobsItem, companyId: number, host: string, now: Date = new Date()): NormalizedJob | null {
  const country = SITES[host];
  if (!country) return null;
  const link = decodeHtmlEntities(item.link ?? '').trim();
  const externalId = /\/jobs\/([^/?#]+)/.exec(link)?.[1] ?? feedItemKey(link, item.title);
  if (!externalId) return null;
  const posted = item.pubDate ? new Date(item.pubDate) : now;
  const postedAt = Number.isNaN(posted.getTime()) ? now : posted;
  if (now.getTime() - postedAt.getTime() > MAX_AGE_DAYS * DAY_MS) return null;
  const title = parseDevItJobsTitle(decodeHtmlEntities(item.title ?? ''));
  const content = item['content:encoded'] ?? item.content ?? item.contentSnippet ?? '';
  const header = title.company ? `Hiring company: ${title.company}.` : '';
  const body = stripHtml(content);
  return {
    companyId,
    externalId,
    title: title.role || 'Untitled',
    url: link,
    location: placeLabel(country),
    description: [header, body].filter((s) => s.length > 0).join('\n\n'),
    postedAt,
    locationHints: { countries: [country] },
  } satisfies NormalizedJob;
}
