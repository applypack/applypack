import { z } from 'zod';
import { fetchWithRetry, HttpError, sleep } from '../http';
import { SourceKeyMissingError, resolveSourceKeys } from '../source-keys';
import type { NormalizedJob } from '../types';
import { EMPTY_CONTEXT, type FetchContext } from './fetch-context';
import { forgetFranceTravailToken, franceTravailToken, scrubbed, type FranceTravailCredentials } from './francetravail-auth';

/**
 * France Travail, Offres d'emploi v2 (stage 3e, ADR 0034) — every job ad in
 * France, through the user's own free client id + secret. The Company row's
 * token is the search filter (`codeROME=M1805`, `motsCles=php,laravel`,
 * `departement=75` …); the fetcher adds newest-first sorting and the
 * last-day window and reads up to three pages of 150. Verified against the
 * vendor's documentation 2026-09-04 (no key of ours to run it live): the
 * search answers 200, or 206 PARTIAL with `Content-Range: offres p-d/t`
 * when more remain; `resultats[]` carry the same fields as the detail
 * resource; the detail of a withdrawn offer is a 204 with a JSON error
 * body — that answer is what the daily mirror (jobs/france-travail-sync.ts)
 * relies on. The data is under the board's own licence, whose obligations
 * are code (ADR 0034): the offer is stored as received, the source and the
 * update date ride with it, and the licence line opens the description so
 * the classifier and the match read it too.
 */
const API_BASE = 'https://api.francetravail.io/partenaire/offresdemploi/v2';
export const FRANCE_TRAVAIL_LICENCE_URL =
  'https://francetravail.io/produits-partages/documentation/conditions-dutilisation-api/licence-offres-emploi';
const PAGE_SIZE = 150;
const MAX_PAGES = 3;
/** The vendor's quota is 4 calls a second per application; one every 300 ms keeps under it with a margin. */
export const CALL_GAP_MS = 300;
const TIMEOUT_MS = 20_000;
/** The API's own vocabulary for "published in the last day". */
const PUBLISHED_SINCE_DAYS = '1';

/** The filter keys a token may carry; sort, range and the window are the fetcher's. */
const FILTER_KEYS = [
  'motsCles',
  'codeROME',
  'appellation',
  'commune',
  'departement',
  'region',
  'distance',
  'typeContrat',
  'natureContrat',
  'experience',
  'qualification',
  'tempsPlein',
  'origineOffre',
  'secteurActivite',
  'publieeDepuis',
] as const;

const OfferSchema = z
  .object({
    id: z.string().min(1),
    intitule: z.string(),
    description: z.string().nullable().optional(),
    dateCreation: z.string().nullable().optional(),
    dateActualisation: z.string().nullable().optional(),
    lieuTravail: z
      .object({ libelle: z.string().nullable().optional(), codePostal: z.string().nullable().optional(), commune: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    romeLibelle: z.string().nullable().optional(),
    appellationlibelle: z.string().nullable().optional(),
    entreprise: z.object({ nom: z.string().nullable().optional() }).passthrough().nullable().optional(),
    typeContratLibelle: z.string().nullable().optional(),
    natureContrat: z.string().nullable().optional(),
    experienceLibelle: z.string().nullable().optional(),
    dureeTravailLibelle: z.string().nullable().optional(),
    dureeTravailLibelleConverti: z.string().nullable().optional(),
    salaire: z
      .object({ libelle: z.string().nullable().optional(), commentaire: z.string().nullable().optional(), complement1: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    nombrePostes: z.number().nullable().optional(),
    origineOffre: z.object({ urlOrigine: z.string().nullable().optional() }).passthrough().nullable().optional(),
  })
  .passthrough();

export type FranceTravailOffer = z.infer<typeof OfferSchema>;

const SearchSchema = z.object({ resultats: z.array(z.unknown()).optional().default([]) }).passthrough();

export interface FranceTravailCompany {
  id: number;
  /** The search filter string: "codeROME=M1805", "motsCles=php&departement=75". */
  atsToken: string;
}

export async function fetchFranceTravail(company: FranceTravailCompany, context: FetchContext = EMPTY_CONTEXT): Promise<NormalizedJob[]> {
  const creds = credentialsFrom(context);
  const out: NormalizedJob[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { offers, total } = await searchPage(company.atsToken, page, creds);
    out.push(...offers.map((o) => mapFranceTravailOffer(o, company.id)));
    const seen = (page + 1) * PAGE_SIZE;
    if (total === null || seen >= total || offers.length < PAGE_SIZE) break;
    await sleep(CALL_GAP_MS);
  }
  return out;
}

/** One page of the token's search: the offers and, from `Content-Range`, how many there are in all. */
export async function searchPage(
  token: string,
  page: number,
  creds: FranceTravailCredentials,
): Promise<{ offers: FranceTravailOffer[]; total: number | null }> {
  const url = franceTravailSearchUrl(token, page);
  const resp = await authorised(url, creds);
  const total = parseContentRange(resp.headers.get('content-range'));
  const raw: unknown = resp.status === 204 ? { resultats: [] } : await resp.json();
  const parsed = SearchSchema.safeParse(raw);
  if (!parsed.success) throw new Error('France Travail: the search answered something other than a result list');
  const offers = parsed.data.resultats.flatMap((o) => {
    const offer = OfferSchema.safeParse(o);
    return offer.success ? [offer.data] : [];
  });
  return { offers, total };
}

/** Whether an offer still exists: 200 = yes, 204 = withdrawn (the vendor's documented answer). */
export async function offerStillListed(id: string, creds: FranceTravailCredentials): Promise<{ listed: boolean; offer: FranceTravailOffer | null }> {
  const resp = await authorised(`${API_BASE}/offres/${encodeURIComponent(id)}`, creds);
  if (resp.status === 204) return { listed: false, offer: null };
  const text = await resp.text();
  const parsed = text.length > 0 ? OfferSchema.safeParse(JSON.parse(text) as unknown) : null;
  return { listed: true, offer: parsed?.success ? parsed.data : null };
}

/** The count behind a filter, for the probe: one call, an empty range, the total from the header. */
export async function franceTravailProbeCount(token: string, creds: FranceTravailCredentials): Promise<number | null> {
  const resp = await authorised(franceTravailSearchUrl(token, 0, 1), creds);
  const total = parseContentRange(resp.headers.get('content-range'));
  if (total !== null) return total;
  if (resp.status === 204) return 0;
  const raw = SearchSchema.safeParse(await resp.json());
  return raw.success ? raw.data.resultats.length : null;
}

/** The token's filters plus sort, window and page — known keys only, values as given. */
export function franceTravailSearchUrl(token: string, page: number, pageSize = PAGE_SIZE): string {
  const given = new URLSearchParams(token.trim().replace(/^\?/, ''));
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    for (const value of given.getAll(key)) params.append(key, value);
  }
  if (!params.has('publieeDepuis')) params.set('publieeDepuis', PUBLISHED_SINCE_DAYS);
  params.set('sort', '1');
  params.set('range', `${page * pageSize}-${page * pageSize + pageSize - 1}`);
  return `${API_BASE}/offres/search?${params.toString()}`;
}

/** "offres 0-149/1234" → 1234; null when the header is absent or not of that shape. */
export function parseContentRange(header: string | null): number | null {
  const m = /offres\s+\d+-\d+\/(\d+)/i.exec(header ?? '');
  return m ? Number(m[1]) : null;
}

/** The licence line every display carries (art. 4): source, last update, the licence itself. */
export function licenceLine(updatedAt: Date | null): string {
  const when = updatedAt ? ` — updated ${updatedAt.toISOString().slice(0, 10)}` : '';
  return `Source: France Travail${when}. Reused under its licence: ${FRANCE_TRAVAIL_LICENCE_URL}`;
}

/** Pure mapper; the offer rides whole in `sourcePayload` (art. 5.3), nothing in it is rewritten. */
export function mapFranceTravailOffer(o: FranceTravailOffer, companyId: number): NormalizedJob {
  const created = new Date(o.dateCreation ?? '');
  const updated = new Date(o.dateActualisation ?? o.dateCreation ?? '');
  const updatedAt = Number.isNaN(updated.getTime()) ? null : updated;
  const place = (o.lieuTravail?.libelle ?? '').trim();
  const head: string[] = [licenceLine(updatedAt)];
  const employer = o.entreprise?.nom?.trim();
  if (employer) head.push(`Hiring company: ${employer}.`);
  const occupation = (o.appellationlibelle ?? o.romeLibelle ?? '').trim();
  if (occupation) head.push(`Occupation: ${occupation}.`);
  const contract = [o.typeContratLibelle, o.dureeTravailLibelleConverti ?? o.dureeTravailLibelle]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0);
  if (contract.length > 0) head.push(`Contract: ${contract.join(', ')}.`);
  const experience = o.experienceLibelle?.trim();
  if (experience) head.push(`Experience: ${experience}.`);
  const salary = [o.salaire?.libelle, o.salaire?.complement1, o.salaire?.commentaire]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0);
  if (salary.length > 0) head.push(`Salary: ${salary.join('; ')}.`);
  if (o.nombrePostes && o.nombrePostes > 1) head.push(`Positions: ${o.nombrePostes}.`);
  return {
    companyId,
    externalId: o.id,
    title: o.intitule.trim() || 'Untitled',
    url: (o.origineOffre?.urlOrigine ?? '').trim() || `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(o.id)}`,
    location: place.length > 0 ? `${place}, France` : 'France',
    // The description is the board's plain text — kept as is (art. 5.3).
    description: [head.join(' '), (o.description ?? '').trim()].filter((s) => s.length > 0).join('\n\n'),
    postedAt: Number.isNaN(created.getTime()) ? new Date() : created,
    locationHints: { countries: ['FR'] },
    sourcePayload: o,
    sourceUpdatedAt: updatedAt,
  };
}

/** The credentials the tick loaded, or the error that names the Sources tab. */
export function credentialsFrom(context: FetchContext): FranceTravailCredentials {
  const creds = resolveSourceKeys('FRANCETRAVAIL', context.keys ?? {});
  if (!creds) throw new SourceKeyMissingError('France Travail');
  return creds as unknown as FranceTravailCredentials;
}

/** A GET with the bearer token; a 401 drops the cached token and is retried once. */
async function authorised(url: string, creds: FranceTravailCredentials, retried = false): Promise<Response> {
  const token = await franceTravailToken(creds);
  try {
    return await fetchWithRetry(url, { timeoutMs: TIMEOUT_MS, init: { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } } });
  } catch (err) {
    if (err instanceof HttpError && err.status === 401 && !retried) {
      forgetFranceTravailToken();
      return authorised(url, creds, true);
    }
    throw scrubbed(err, [creds.client_secret, creds.client_id, token]);
  }
}
