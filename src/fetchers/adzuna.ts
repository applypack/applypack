import { z } from 'zod';
import { placeLabel } from '../countries';
import { HttpError, fetchWithRetry } from '../http';
import { SourceKeyMissingError, redactSecrets, resolveSourceKeys } from '../source-keys';
import type { NormalizedJob } from '../types';
import { EMPTY_CONTEXT, type FetchContext } from './fetch-context';

/**
 * Adzuna (stage 3e, ADR 0034): one Company row per market, the token the
 * market's code (`de`, `gb`, `pl` …). `GET /v1/api/jobs/{cc}/search/1` with
 * the user's own app_id + app_key answers up to 50 ads; we ask for the IT
 * category, the last day, newest first. The vendor's terms are code here:
 * the monthly limit (2 500 calls) binds, so a row is polled four times a
 * day and at most ten rows are accepted; descriptions are snippets and the
 * stored text says so; the credentials are query parameters, so every
 * error is redacted before it can reach a log or source health. The
 * "Jobs by Adzuna" label the terms require is rendered by the pages
 * (`adzunaAttribution` says which domain and logo).
 */
const ENDPOINT = 'https://api.adzuna.com/v1/api/jobs';
const RESULTS_PER_PAGE = 50;
const MAX_DAYS_OLD = 1;
const CATEGORY = 'it-jobs';
const TIMEOUT_MS = 15_000;

/** The UTC hours a row is polled — four a day keeps ten markets under 2 500 calls a month. */
export const ADZUNA_HOURS: readonly number[] = [0, 6, 12, 18];
/** Rows beyond this are skipped with an error, whatever the user adds. */
export const MAX_ADZUNA_ROWS = 10;

/** The logo the terms name, served by the vendor's own CDN (press page, 2026-09-04). */
export const ADZUNA_LOGO_URL = 'https://zunastatic-abf.kxcdn.com/images/global/adzuna_logo.svg';

export interface AdzunaMarket {
  /** ISO-2 of the market, for the country hint. */
  country: string;
  /** The "relevant local domain" the label must link to. */
  domain: string;
  /** What the salary fields are quoted in. */
  currency: string;
}

/** Every market Adzuna serves (developer.adzuna.com, 2026-09-04), by its two-letter API code. */
export const ADZUNA_MARKETS: Readonly<Record<string, AdzunaMarket>> = {
  at: { country: 'AT', domain: 'www.adzuna.at', currency: 'EUR' },
  au: { country: 'AU', domain: 'www.adzuna.com.au', currency: 'AUD' },
  be: { country: 'BE', domain: 'www.adzuna.be', currency: 'EUR' },
  br: { country: 'BR', domain: 'www.adzuna.com.br', currency: 'BRL' },
  ca: { country: 'CA', domain: 'www.adzuna.ca', currency: 'CAD' },
  ch: { country: 'CH', domain: 'www.adzuna.ch', currency: 'CHF' },
  de: { country: 'DE', domain: 'www.adzuna.de', currency: 'EUR' },
  es: { country: 'ES', domain: 'www.adzuna.es', currency: 'EUR' },
  fr: { country: 'FR', domain: 'www.adzuna.fr', currency: 'EUR' },
  gb: { country: 'GB', domain: 'www.adzuna.co.uk', currency: 'GBP' },
  in: { country: 'IN', domain: 'www.adzuna.in', currency: 'INR' },
  it: { country: 'IT', domain: 'www.adzuna.it', currency: 'EUR' },
  mx: { country: 'MX', domain: 'www.adzuna.mx', currency: 'MXN' },
  nl: { country: 'NL', domain: 'www.adzuna.nl', currency: 'EUR' },
  nz: { country: 'NZ', domain: 'www.adzuna.co.nz', currency: 'NZD' },
  pl: { country: 'PL', domain: 'www.adzuna.pl', currency: 'PLN' },
  sg: { country: 'SG', domain: 'www.adzuna.sg', currency: 'SGD' },
  us: { country: 'US', domain: 'www.adzuna.com', currency: 'USD' },
  za: { country: 'ZA', domain: 'www.adzuna.co.za', currency: 'ZAR' },
};

/** The market code for an ISO country, when Adzuna serves it. */
export function adzunaCodeFor(country: string): string | null {
  const hit = Object.entries(ADZUNA_MARKETS).find(([, m]) => m.country === country.toUpperCase());
  return hit ? hit[0] : null;
}

/** The token as a market code; anything else refused before a request is made. */
export function adzunaMarket(token: string): { code: string; market: AdzunaMarket } {
  const code = token.trim().toLowerCase();
  const market = ADZUNA_MARKETS[code];
  if (!market) throw new Error(`adzuna: "${token}" is not a market code — one of ${Object.keys(ADZUNA_MARKETS).join(', ')}`);
  return { code, market };
}

/** Whether a scheduled tick at `now` is one of the four that poll Adzuna. */
export function adzunaDue(now: Date): boolean {
  return ADZUNA_HOURS.includes(now.getUTCHours());
}

export interface AdzunaCredentials {
  app_id: string;
  app_key: string;
}

export function adzunaSearchUrl(code: string, creds: AdzunaCredentials, perPage = RESULTS_PER_PAGE): string {
  const params = new URLSearchParams({
    app_id: creds.app_id,
    app_key: creds.app_key,
    results_per_page: String(perPage),
    max_days_old: String(MAX_DAYS_OLD),
    sort_by: 'date',
    category: CATEGORY,
    'content-type': 'application/json',
  });
  return `${ENDPOINT}/${code}/search/1?${params.toString()}`;
}

/** The label the terms require, for the pages: "Jobs" and the logo, both linked to the local domain. */
export function adzunaAttribution(token: string): { domain: string; url: string; logo: string } {
  const { market } = adzunaMarket(token);
  return { domain: market.domain, url: `https://${market.domain}/`, logo: ADZUNA_LOGO_URL };
}

const AdzunaAdSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    title: z.string(),
    redirect_url: z.string(),
    description: z.string().nullable().optional(),
    created: z.string().nullable().optional(),
    company: z.object({ display_name: z.string().nullable().optional() }).passthrough().nullable().optional(),
    location: z
      .object({ display_name: z.string().nullable().optional(), area: z.array(z.string()).optional() })
      .passthrough()
      .nullable()
      .optional(),
    salary_min: z.number().nullable().optional(),
    salary_max: z.number().nullable().optional(),
    salary_is_predicted: z.union([z.string(), z.number()]).nullable().optional(),
    contract_type: z.string().nullable().optional(),
    contract_time: z.string().nullable().optional(),
    category: z.object({ label: z.string().nullable().optional() }).passthrough().nullable().optional(),
  })
  .passthrough();

type AdzunaAd = z.infer<typeof AdzunaAdSchema>;

const AdzunaPageSchema = z.object({ results: z.array(z.unknown()), count: z.number().optional() }).passthrough();

export interface AdzunaCompany {
  id: number;
  /** The market code: "de", "gb", "pl" … */
  atsToken: string;
}

/**
 * One call per row per polled tick. Off the four hours a scheduled tick
 * answers nothing (not an error: the row's last `ok` stays), a manual
 * "Fetch now" always asks.
 */
export async function fetchAdzuna(company: AdzunaCompany, context: FetchContext = EMPTY_CONTEXT): Promise<NormalizedJob[]> {
  const { code, market } = adzunaMarket(company.atsToken);
  const creds = resolveSourceKeys('ADZUNA', context.keys ?? {});
  if (!creds) throw new SourceKeyMissingError('Adzuna');
  if (!context.manual && !adzunaDue(context.now ?? new Date())) return [];
  const raw = await fetchAdzunaJson(adzunaSearchUrl(code, creds as unknown as AdzunaCredentials), creds);
  return mapAdzunaPage(raw, company.id, market);
}

/** The fetch with the credentials scrubbed from whatever it throws. */
export async function fetchAdzunaJson(url: string, creds: Record<string, string>): Promise<unknown> {
  const secrets = Object.values(creds);
  try {
    const resp = await fetchWithRetry(url, { timeoutMs: TIMEOUT_MS });
    return (await resp.json()) as unknown;
  } catch (err) {
    if (err instanceof HttpError) throw new HttpError(redactSecrets(err.message, secrets), err.status, redactSecrets(err.url, secrets));
    if (err instanceof Error) {
      const clean = new Error(redactSecrets(err.message, secrets));
      clean.name = err.name;
      throw clean;
    }
    throw err;
  }
}

/** `count` of a search answer, or the page length — for the probe. */
export function adzunaCount(raw: unknown): number | null {
  const page = AdzunaPageSchema.safeParse(raw);
  if (!page.success) return null;
  return page.data.count ?? page.data.results.length;
}

/** Pure mapper; the country is the market's, the text a snippet and says so. */
export function mapAdzunaPage(raw: unknown, companyId: number, market: AdzunaMarket): NormalizedJob[] {
  const page = AdzunaPageSchema.safeParse(raw);
  if (!page.success) return [];
  const out: NormalizedJob[] = [];
  for (const item of page.data.results) {
    const parsed = AdzunaAdSchema.safeParse(item);
    if (!parsed.success) continue;
    out.push(toNormalized(parsed.data, companyId, market));
  }
  return out;
}

function toNormalized(ad: AdzunaAd, companyId: number, market: AdzunaMarket): NormalizedJob {
  const posted = new Date(ad.created ?? '');
  const where = (ad.location?.display_name ?? '').trim();
  const country = placeLabel(market.country);
  return {
    companyId,
    externalId: ad.id,
    title: ad.title.trim() || 'Untitled',
    url: ad.redirect_url,
    location: where.length > 0 && !where.includes(country) ? `${where}, ${country}` : where || country,
    description: buildDescription(ad, market),
    postedAt: Number.isNaN(posted.getTime()) ? new Date() : posted,
    locationHints: { countries: [market.country] },
  };
}

function buildDescription(ad: AdzunaAd, market: AdzunaMarket): string {
  const head: string[] = [];
  const employer = ad.company?.display_name?.trim();
  if (employer) head.push(`Hiring company: ${employer}.`);
  const contract = [ad.contract_type, ad.contract_time]
    .map((s) => (s ?? '').trim().replace(/_/g, ' '))
    .filter((s) => s.length > 0);
  if (contract.length > 0) head.push(`Contract: ${contract.join(', ')}.`);
  const salary = formatSalary(ad, market);
  if (salary) head.push(salary);
  const snippet = (ad.description ?? '').trim();
  const note = 'Snippet only (Jobs by Adzuna) — the full posting is behind the apply link.';
  return [head.join(' '), snippet, note].filter((s) => s.length > 0).join('\n\n');
}

function formatSalary(ad: AdzunaAd, market: AdzunaMarket): string | null {
  const min = ad.salary_min ?? null;
  const max = ad.salary_max ?? null;
  if ((min === null || min <= 0) && (max === null || max <= 0)) return null;
  const range = min && max && min !== max ? `${Math.round(min)}-${Math.round(max)}` : `${Math.round((max ?? min) as number)}`;
  const predicted = String(ad.salary_is_predicted ?? '0') === '1' ? ', Adzuna estimate' : '';
  return `Salary: ${range} ${market.currency} (year${predicted}).`;
}
