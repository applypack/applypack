import { z } from 'zod';
import { findCountry, placeLabel } from '../countries';
import { fetchWithRetry, sleep } from '../http';
import type { NormalizedJob } from '../types';

/**
 * JobTech JobSearch — Arbetsförmedlingen's open API over every job ad in
 * Sweden (stage 3c, plan §4.2), CC0, no key. `GET /search?<filters>` answers
 * `{ total: { value }, hits[] }`, `limit` ≤ 100, `offset` ≤ 2000. The
 * Company row's token is the filter string (the seed row is the Data/IT
 * field, `occupation-field=apaJ_2ja_LuF`: ~140 ads a day, verified live
 * 2026-09-03); the fetcher adds the window (`published-after` in minutes),
 * the newest-first sort and the page size. An unknown taxonomy code or a
 * hopeless query is not an error — the API answers 200 with total 0 — so
 * the /companies probe checks the count. `workplace_address.country_code`
 * is the taxonomy's ("199" = Sverige), not ISO; `workplace_model` says
 * "Arbete på plats" on every ad — a form default, not a signal — so the
 * arrangement is left to the classifier. `description.text` is plain text.
 */
const ENDPOINT = 'https://jobsearch.api.jobtechdev.se/search';
const TIMEOUT_MS = 20_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const PAGE_DELAY_MS = 500;
/** The hourly tick reads the last day; the store dedupes the overlap. */
const LOOKBACK_MINUTES = 24 * 60;
/** The taxonomy's code for Sweden in `workplace_address.country_code`. */
const SWEDEN_TAXONOMY_CODE = '199';

/** The filter keys a token may carry; the window, sort and paging are the fetcher's. */
const FILTER_KEYS = [
  'q',
  'occupation-field',
  'occupation-group',
  'occupation-name',
  'skill',
  'language',
  'municipality',
  'region',
  'country',
  'remote',
  'abroad',
  'employer',
  'employment-type',
  'experience',
  'worktime-extent',
  'workplace-model',
] as const;

const LabelSchema = z.object({ label: z.string().nullable().optional() }).passthrough().nullable().optional();

const JobTechHitSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    headline: z.string(),
    webpage_url: z.string().nullable().optional(),
    publication_date: z.string().nullable().optional(),
    application_deadline: z.string().nullable().optional(),
    removed: z.boolean().nullable().optional(),
    employer: z.object({ name: z.string().nullable().optional() }).passthrough().nullable().optional(),
    occupation: LabelSchema,
    employment_type: LabelSchema,
    working_hours_type: LabelSchema,
    salary_description: z.string().nullable().optional(),
    workplace_address: z
      .object({
        municipality: z.string().nullable().optional(),
        region: z.string().nullable().optional(),
        country: z.string().nullable().optional(),
        country_code: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    description: z.object({ text: z.string().nullable().optional() }).passthrough().nullable().optional(),
  })
  .passthrough();

type JobTechHit = z.infer<typeof JobTechHitSchema>;

const JobTechPageSchema = z
  .object({
    total: z.object({ value: z.number() }).passthrough().optional(),
    hits: z.array(z.unknown()),
  })
  .passthrough();

export interface JobTechCompany {
  id: number;
  /** The search filter string: "occupation-field=apaJ_2ja_LuF", "q=php&remote=true". */
  atsToken: string;
}

export async function fetchJobTech(company: JobTechCompany): Promise<NormalizedJob[]> {
  const out: NormalizedJob[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const resp = await fetchWithRetry(jobTechSearchUrl(company.atsToken, page * PAGE_SIZE), { timeoutMs: TIMEOUT_MS });
    const raw: unknown = await resp.json();
    const mapped = mapJobTechPage(raw, company.id);
    out.push(...mapped.jobs);
    if (!mapped.full) break;
    if (page < MAX_PAGES - 1) await sleep(PAGE_DELAY_MS);
  }
  return out;
}

/** The token's filters plus the window, newest first, one page from `offset`. */
export function jobTechSearchUrl(token: string, offset = 0): string {
  const params = filterParams(token);
  params.set('published-after', String(LOOKBACK_MINUTES));
  params.set('sort', 'pubdate-desc');
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(offset));
  return `${ENDPOINT}?${params.toString()}`;
}

/** The token's filters over every live ad, one hit — enough for the count. */
export function jobTechProbeUrl(token: string): string {
  const params = filterParams(token);
  params.set('limit', '1');
  return `${ENDPOINT}?${params.toString()}`;
}

/** `total.value` of a search answer, 0 for anything else. */
export function parseJobTechTotal(raw: unknown): number {
  const page = JobTechPageSchema.safeParse(raw);
  return page.success ? (page.data.total?.value ?? 0) : 0;
}

/** Pure mapper; `full` says the page was a whole one, so another may follow. */
export function mapJobTechPage(raw: unknown, companyId: number): { jobs: NormalizedJob[]; full: boolean } {
  const page = JobTechPageSchema.safeParse(raw);
  if (!page.success) return { jobs: [], full: false };
  const jobs: NormalizedJob[] = [];
  for (const item of page.data.hits) {
    const parsed = JobTechHitSchema.safeParse(item);
    if (!parsed.success || parsed.data.removed) continue;
    jobs.push(toNormalized(parsed.data, companyId));
  }
  return { jobs, full: page.data.hits.length >= PAGE_SIZE };
}

function toNormalized(hit: JobTechHit, companyId: number): NormalizedJob {
  const code = countryCode(hit);
  const posted = utcDate(hit.publication_date);
  return {
    companyId,
    externalId: hit.id,
    title: hit.headline.trim() || 'Untitled',
    url: hit.webpage_url ?? '',
    location: formatLocation(hit, code),
    // `description.text` is plain text with real newlines — no tag strip (gotcha 12).
    description: augmentDescription((hit.description?.text ?? '').trim(), hit),
    postedAt: Number.isNaN(posted.getTime()) ? new Date() : posted,
    locationHints: code ? { countries: [code] } : {},
  };
}

/** The API's timestamps carry no zone ("2026-09-03T22:24:49"); read them as UTC so every host agrees. */
function utcDate(s: string | null | undefined): Date {
  if (!s) return new Date(Number.NaN);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
}

/** The taxonomy code for Sweden, else the gazetteer on the country name (Swedish exonyms may miss). */
function countryCode(hit: JobTechHit): string | null {
  const address = hit.workplace_address;
  if (address?.country_code === SWEDEN_TAXONOMY_CODE) return 'SE';
  return findCountry(address?.country ?? '')?.code ?? null;
}

/** "Stockholm, Sweden", "Borlänge, Dalarnas län, Sweden", "Spanien". */
function formatLocation(hit: JobTechHit, code: string | null): string {
  const address = hit.workplace_address;
  const country = code ? placeLabel(code) : (address?.country ?? '').trim();
  return [address?.municipality, address?.region, country]
    .map((s) => (s ?? '').trim())
    .filter((s, i, all) => s.length > 0 && all.indexOf(s) === i)
    .join(', ');
}

function augmentDescription(base: string, hit: JobTechHit): string {
  const parts: string[] = [];
  const employer = hit.employer?.name?.trim();
  if (employer) parts.push(`Hiring company: ${employer}.`);
  const occupation = hit.occupation?.label?.trim();
  if (occupation) parts.push(`Occupation: ${occupation}.`);
  const employment = [hit.employment_type?.label, hit.working_hours_type?.label]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0);
  if (employment.length > 0) parts.push(`Employment: ${employment.join(', ')}.`);
  const salary = hit.salary_description?.trim();
  if (salary) parts.push(`Salary: ${salary}.`);
  const deadline = hit.application_deadline?.slice(0, 10);
  if (deadline) parts.push(`Apply by: ${deadline}.`);
  const header = parts.join(' ');
  if (header.length === 0) return base;
  if (base.length === 0) return header;
  return `${header}\n\n${base}`;
}

/** The token's known filter keys, values kept as given. */
function filterParams(token: string): URLSearchParams {
  const given = new URLSearchParams(token.trim().replace(/^\?/, ''));
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    for (const value of given.getAll(key)) params.append(key, value);
  }
  return params;
}
