import Parser from 'rss-parser';
import { findCountry } from '../countries';
import { fetchWithRetry, stripHtml } from '../http';
import { conditionalHeaders, rememberResponse } from './conditional';
import { isPrivateHost } from '../jobs/posting-url';
import type { LocationHints, WorkplaceCode } from '../location';
import { feedItemKey } from '../text-utils';
import type { NormalizedJob } from '../types';
import { firstText, nested, nestedAll } from './xml-text';

/**
 * Teamtailor — the Nordic / UK / Benelux ATS (stage 3d, plan §4.2). Every
 * board serves `jobs.rss` and `jobs.json` beside each other, on
 * `{slug}.teamtailor.com` and on the customer's own career domain
 * (jobs.tibber.com). Verified live 2026-09-03 on tibber: the JSON Feed
 * carries a schema.org JobPosting with ISO-2 countries but no remote
 * status at all (`jobLocationType` null on every hybrid posting); the RSS
 * carries `remoteStatus` (none / hybrid / temporary / fully), the
 * locations with city and country name, department and role, and the full
 * HTML — so the RSS is the feed read, and the gazetteer turns the country
 * names into codes. An unknown slug is a plain 404. The token is a slug
 * or a host; a host must be public (the posting-URL guard) since the
 * request goes wherever it points.
 */
const VENDOR_DOMAIN = 'teamtailor.com';
const SLUG_RE = /^[a-z0-9-]{2,60}$/i;
const HOST_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
const TIMEOUT_MS = 15_000;

/** The board's own words for the arrangement (Teamtailor's `remote_status`). */
const REMOTE_STATUS: Readonly<Record<string, WorkplaceCode>> = {
  fully: 'REMOTE',
  hybrid: 'HYBRID',
  none: 'ONSITE',
};

export interface TeamtailorItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  isoDate?: string;
  content?: string;
  contentSnippet?: string;
  remoteStatus?: unknown;
  /** xml2js shape: `{ 'tt:location': [{ 'tt:name': [..], 'tt:city': [..], 'tt:country': [..] }] }`. */
  'tt:locations'?: unknown;
  'tt:department'?: unknown;
  'tt:role'?: unknown;
}

const parser: Parser<{ title?: string }, TeamtailorItem> = new Parser({
  timeout: TIMEOUT_MS,
  customFields: { item: ['remoteStatus', 'tt:locations', 'tt:department', 'tt:role'] },
});

export interface TeamtailorCompany {
  id: number;
  /** A slug ("tibber") or the board's host ("jobs.tibber.com"). */
  atsToken: string;
}

export async function fetchTeamtailor(company: TeamtailorCompany): Promise<NormalizedJob[]> {
  const host = teamtailorHost(company.atsToken);
  const url = teamtailorFeedUrl(host);
  const resp = await fetchWithRetry(url, {
    timeoutMs: TIMEOUT_MS,
    init: { headers: conditionalHeaders(company.id, url) },
  });
  const feed = await parser.parseString(await resp.text());
  const jobs = feed.items.flatMap((item) => mapTeamtailorItem(item, company.id, feed.title) ?? []);
  rememberResponse(company.id, url, resp, jobs.length);
  return jobs;
}

export function teamtailorFeedUrl(host: string): string {
  return `https://${host}/jobs.rss`;
}

/** A slug becomes `{slug}.teamtailor.com`; a host is kept when it is a public hostname. */
export function teamtailorHost(token: string): string {
  const cleaned = token
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '');
  if (SLUG_RE.test(cleaned)) return `${cleaned}.${VENDOR_DOMAIN}`;
  if (!HOST_RE.test(cleaned)) throw new Error(`teamtailor: "${token}" is neither a slug nor a hostname`);
  if (isPrivateHost(cleaned)) throw new Error(`teamtailor: "${cleaned}" is not a public host`);
  return cleaned;
}

/** Pure mapper; the place words are the board's, the codes the gazetteer's, the arrangement the board's. */
export function mapTeamtailorItem(item: TeamtailorItem, companyId: number, boardTitle?: string): NormalizedJob | null {
  const link = (item.link ?? '').trim();
  const externalId = /\/jobs\/(\d+)(?:[-/?#]|$)/.exec(link)?.[1] ?? (item.guid ?? '').trim() ?? feedItemKey(link, item.title);
  if (!externalId) return null;
  const places = nestedAll(item['tt:locations'], 'tt:location').map((loc) => ({
    city: firstText(nested(loc, 'tt:city')) || firstText(nested(loc, 'tt:name')),
    country: firstText(nested(loc, 'tt:country')),
  }));
  const codes = [...new Set(places.flatMap((p) => findCountry(p.country)?.code ?? []))];
  const workplace = REMOTE_STATUS[firstText(item.remoteStatus).toLowerCase()];
  const hints: LocationHints = { ...(codes.length > 0 ? { countries: codes } : {}), ...(workplace ? { workplace } : {}) };
  const head = [
    boardTitle?.trim() ? `Hiring company: ${boardTitle.trim()}.` : '',
    firstText(item['tt:department']) ? `Department: ${firstText(item['tt:department'])}.` : '',
    firstText(item['tt:role']) ? `Role: ${firstText(item['tt:role'])}.` : '',
  ]
    .filter((s) => s.length > 0)
    .join(' ');
  const posted = new Date(item.isoDate ?? item.pubDate ?? '');
  return {
    companyId,
    externalId,
    title: (item.title ?? '').trim() || 'Untitled',
    url: link,
    location: formatLocation(workplace, places),
    // The description is HTML; stripHtml decodes entities first (gotcha 12).
    description: [head, stripHtml(item.content ?? item.contentSnippet ?? '')].filter((s) => s.length > 0).join('\n\n'),
    postedAt: Number.isNaN(posted.getTime()) ? new Date() : posted,
    locationHints: hints,
  } satisfies NormalizedJob;
}

const WORKPLACE_LABEL: Readonly<Record<WorkplaceCode, string>> = { REMOTE: 'Remote', HYBRID: 'Hybrid', ONSITE: 'On-site', UNKNOWN: '' };

/** "Hybrid · Berlin, Germany / Stockholm, Sweden", "Amsterdam, Netherlands", "Remote". */
function formatLocation(workplace: WorkplaceCode | undefined, places: { city: string; country: string }[]): string {
  const where = places
    .map((p) => [p.city, p.country].filter((s) => s.length > 0).join(', '))
    .filter((s, i, all) => s.length > 0 && all.indexOf(s) === i)
    .join(' / ');
  const label = workplace ? WORKPLACE_LABEL[workplace] : '';
  if (label.length === 0) return where;
  return where.length > 0 ? `${label} · ${where}` : label;
}
