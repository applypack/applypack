import type { SourceKeys } from '../source-keys';

/**
 * What every fetcher may know about the searches that are running (plan
 * §4.2, stage 3a): the union of their places. A source with a geo filter
 * asks for those places instead of the whole world; a source without one
 * ignores the context. Pure — the wrapper in index.ts builds it once per
 * tick from the active, non-blank profiles.
 */

export interface FetchContext {
  /** ISO-2 codes every running search hunts in, once each. */
  countries: string[];
  /** Group codes (EU, EUROPE, WORLDWIDE, …), once each. */
  regions: string[];
  /** The keyed sources' credentials (ADR 0034), loaded once per tick; absent = none pasted. */
  keys?: SourceKeys;
  /** True for the dashboard's "Fetch now": a source polled on a cadence asks anyway. */
  manual?: boolean;
  /** When the tick runs — for sources polled on a cadence. */
  now?: Date;
}

export const EMPTY_CONTEXT: FetchContext = { countries: [], regions: [] };

/**
 * The union of the searches' places. One search that hunts anywhere (no
 * countries, no regions, or WORLDWIDE) makes the whole context "anywhere" —
 * a geo filter would hide rows that search wants.
 */
export function searchPlaces(
  profiles: readonly { countries: string[]; regions: string[] }[],
): FetchContext {
  const countries = new Set<string>();
  const regions = new Set<string>();
  for (const p of profiles) {
    const anywhere = (p.countries.length === 0 && p.regions.length === 0) || p.regions.includes('WORLDWIDE');
    if (anywhere) return EMPTY_CONTEXT;
    for (const c of p.countries) countries.add(c);
    for (const r of p.regions) regions.add(r);
  }
  return { countries: [...countries], regions: [...regions] };
}
