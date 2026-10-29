import { z } from 'zod';
import { safeDate } from './dates';
import { fetchWithRetry, stripHtml } from '../http';
import type { NormalizedJob } from '../types';
import { cleanEmployer } from '../employer';
import { parseLocation } from '../location';

const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';
const FRESH_WINDOW_DAYS = 14;
const HITS_PER_PAGE = 100;

/**
 * HN /jobs feed — separate from the monthly Who-is-Hiring thread.
 * Algolia indexes individual YC-job posts under tags=job; these post
 * continuously (each a few hours apart, typically YC-portfolio
 * companies). The post URL almost always points directly to the
 * company's ATS (Greenhouse / Lever / Ashby / Workable), which lets
 * the discovery pipeline harvest CompanyCandidate rows for free —
 * essentially "auto-seed" for any new YC-funded employer.
 *
 * We restrict to the last 14 days because HN /jobs has 17K+ historical
 * entries from 2009 onward; old posts are already filled and re-fetching
 * them on every tick wastes Anthropic budget on stale data.
 */
const HnJobHitSchema = z
  .object({
    objectID: z.string(),
    title: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    job_text: z.string().nullable().optional(),
    story_text: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    created_at_i: z.number().nullable().optional(),
  })
  .passthrough();

export type HnJobHit = z.infer<typeof HnJobHitSchema>;

const HnJobSearchResultSchema = z
  .object({
    hits: z.array(HnJobHitSchema),
    nbHits: z.number().optional(),
  })
  .passthrough();

export async function fetchHnJobs(
  companyId: number,
  now: Date = new Date(),
): Promise<NormalizedJob[]> {
  const since = Math.floor(now.getTime() / 1000) - FRESH_WINDOW_DAYS * 86_400;
  const url = `${ALGOLIA_BASE}/search_by_date?tags=job&hitsPerPage=${HITS_PER_PAGE}&numericFilters=created_at_i>${since}`;
  // No conditional request (ADR 0035): `since` moves with the clock, so the
  // URL is new on every tick and a stored validator would never be sent.
  const resp = await fetchWithRetry(url);
  const raw: unknown = await resp.json();
  const parsed = HnJobSearchResultSchema.safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.hits.map((h) => mapHnJobHit(h, companyId));
}

/**
 * Pure mapper extracted for unit tests.
 *
 * - HN /jobs entries don't carry a structured location field. We
 *   parse common patterns ("(Remote)", "(US-Remote)", "(SF or Remote)")
 *   out of the title, defaulting to empty so Claude decides.
 * - `job_text` is the body when present; otherwise `story_text`. Both
 *   are HTML-encoded HN snippets; stripHtml decodes entities.
 * - The url field, when present, is THE company's ATS link (e.g.
 *   `jobs.ashbyhq.com/infisical/<id>`) — kept verbatim so the
 *   discovery pipeline can run extractAtsToken on it later.
 */
export function mapHnJobHit(
  hit: HnJobHit,
  companyId: number,
): NormalizedJob {
  const title = (hit.title ?? '').trim() || 'Untitled HN job';
  const link = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
  const bodyRaw = hit.job_text ?? hit.story_text ?? '';
  const description = stripHtml(bodyRaw);
  return {
    companyId,
    employer: hnJobEmployer(title),
    externalId: `hn-job-${hit.objectID}`,
    title,
    url: link,
    location: extractLocationFromTitle(title),
    description,
    postedAt: hit.created_at_i ? safeDate(hit.created_at_i * 1000) : safeDate(hit.created_at),
  } satisfies NormalizedJob;
}

const TITLE_LOCATION_RE = /\(([^)]+)\)\s*$/;

// Lazy and capped, one line only (gotcha 6): the name ends at the first
// "is hiring", past an optional "(YC W23)".
const HIRING_TITLE_RE = /^(.{1,60}?)\s+(?:\(YC\b[^)]{0,20}\)\s+)?(?:is|are)\s+hiring\b/i;
const NOT_A_NAME = new Set(['we', 'i', 'our', 'you', 'they']);

/** "Infisical (YC W23) Is Hiring …" → "Infisical"; a title of another shape names nobody (ADR 0056). */
export function hnJobEmployer(title: string): string | null {
  const name = HIRING_TITLE_RE.exec(title.trim())?.[1];
  return name && !NOT_A_NAME.has(name.toLowerCase()) ? cleanEmployer(name) : null;
}

/** A YC batch: a season's letter and a year — W23, S21, F24, X25, P26. */
const YC_BATCH_RE = /^YC\s+[A-Z]\d{2,4}$/i;
/** "9 Mothers (YC P26) Is Hiring in Austin, TX": the place right after the verb. */
const HIRING_IN_RE = /\b(?:is|are)\s+hiring\s+in\s+([^()]{2,60})$/i;

/**
 * HN job titles often look like:
 *   "Infisical (YC W23) Is Hiring Full Stack Software Engineers (Remote)"
 *   "Acme Is Hiring a Founding Engineer (SF or NYC)"
 *   "9 Mothers (YC P26) Is Hiring in Austin, TX"
 *   "Stardex Is Hiring a Founding Customer Success Lead"
 * The trailing parens tend to hold location. YC batch markers like
 * "(YC W23)" are NOT location — we filter those out by token. Without
 * parentheses, "Is Hiring in …" names a place when the location parser
 * knows it: "in Office of CEO" after a role is no place.
 */
function extractLocationFromTitle(title: string): string {
  const matches = [...title.matchAll(/\(([^)]+)\)/g)];
  // Take the last paren group that is NOT a YC batch marker.
  for (let i = matches.length - 1; i >= 0; i--) {
    const candidate = matches[i]?.[1]?.trim() ?? '';
    if (candidate.length === 0 || YC_BATCH_RE.test(candidate)) continue;
    return candidate;
  }
  const place = HIRING_IN_RE.exec(title)?.[1]?.trim() ?? '';
  return place && parseLocation(place).source !== null ? place : '';
}

// Re-export helper for caller-side discovery URL extraction.
export { TITLE_LOCATION_RE };
