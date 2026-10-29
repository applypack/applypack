import type { WorkplaceCode } from '../location';
import { placeName, workplaceName } from '../i18n/places';
import { t } from '../i18n/t';

/*
 * Where a posting is, in one short line for a list row (pure): the
 * arrangement, then the first places by name and how many more there are —
 * "Remote · USA, Canada +3". It reads the structured columns (ADR 0031); a
 * row that names no place says its arrangement in the reader's language, and
 * only a row that knows neither keeps the posting's own words. The whole list
 * — or the posting's words — is the `title`, so nothing is lost to the "+3".
 */

/** How the three longest-named usual suspects are written in a row: "USA", "UK", "UAE" — and each language's own short form. */
const SHORT_NAME = { US: 'place.short.US', GB: 'place.short.GB', AE: 'place.short.AE' } as const;

/** Places named before the rest become a count. */
const NAMED_PLACES = 2;

function name(code: string): string {
  return code in SHORT_NAME ? t(SHORT_NAME[code as keyof typeof SHORT_NAME]) : placeName(code);
}

/** The places a row names first: where the running searches hunt, and where the user lives. */
export function preferredPlaces(searches: readonly { countries: readonly string[]; residence: string | null }[]): string[] {
  return [...new Set(searches.flatMap((p) => [...p.countries, ...(p.residence ? [p.residence] : [])]))];
}

export interface PlaceInput {
  workplace: WorkplaceCode;
  countries: readonly string[];
  regions: readonly string[];
  location: string;
}

export interface PlaceLine {
  /** The short line a row shows. */
  text: string;
  /** Every place, for the row's tooltip. */
  title: string;
  /** The line, or its tooltip, is the posting's own words (data, `translate="no"`), not names in the reader's language. */
  asPosted: boolean;
}

/**
 * `prefer` lists the codes to name first — the places the running searches
 * hunt in — so a posting open to seventy countries says "USA +69" to someone
 * searching the US, not "Albania, Andorra +68".
 */
export function placeLine(job: PlaceInput, prefer: readonly string[] = []): PlaceLine {
  const arrangement = job.workplace === 'UNKNOWN' ? '' : workplaceName(job.workplace);
  const codes = job.countries.length > 0 ? job.countries : job.regions;
  if (codes.length === 0) {
    const posted = job.location.trim();
    // "Remote" as posted sat in English beside "Німеччина" (#652): the arrangement is known, so it is worded.
    if (arrangement) return { text: arrangement, title: posted || arrangement, asPosted: posted !== '' };
    const words = posted || workplaceName('REMOTE');
    return { text: words, title: words, asPosted: posted !== '' };
  }
  const wanted = new Set(prefer);
  const ordered = [...codes].sort((a, b) => Number(wanted.has(b)) - Number(wanted.has(a)));
  const names = ordered.map(name);
  const shown = names.slice(0, NAMED_PLACES).join(', ');
  const more = names.length - NAMED_PLACES;
  const places = more > 0 ? `${shown} +${more}` : shown;
  const join = (list: string) => (arrangement ? `${arrangement} · ${list}` : list);
  return { text: join(places), title: join(names.join(', ')), asPosted: false };
}

/**
 * The place beside the company in a job page's header: the posting's own
 * words, which may name a city the chips under it cannot. Null when the chips
 * already say all there is — no words of its own, or no place but the
 * arrangement, which read "Smoke Co · Remote" over a «Віддалено» chip (#652).
 */
export function headerPlace(job: PlaceInput): { text: string; asPosted: boolean } | null {
  const posted = job.location.trim();
  const placed = job.countries.length > 0 || job.regions.length > 0;
  if (job.workplace !== 'UNKNOWN' && !placed) return null;
  if (posted) return { text: posted, asPosted: true };
  return placed ? null : { text: workplaceName('REMOTE'), asPosted: false };
}
