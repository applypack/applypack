import type { LocationSource, WorkplaceCode } from '../location';

/*
 * Where the classifier's reading of a posting's place meets the parser's
 * (ADR 0032). The model reads the whole description, so it may KNOW MORE —
 * a country the location line never named, an arrangement the office
 * address hid — but it must never blank out what a source's own structured
 * field said. Pure; the persist sites call it and store the result.
 */

export interface AiPlace {
  workplace: WorkplaceCode;
  countries: string[];
  regions: string[];
}

export interface StoredPlace {
  workplace: WorkplaceCode;
  countries: string[];
  regions: string[];
  source: LocationSource | 'ai' | null;
}

/**
 * The model's block wins only where it is more specific than the parser:
 *   - an arrangement where the parser had UNKNOWN;
 *   - countries where the parser had none, or a strict subset of the
 *     parser's list (the description narrowed a multi-country line);
 *   - regions where the parser had none.
 * Anything else keeps the parser's reading. `source` becomes 'ai' when the
 * model changed something, so a later re-parse knows not to overwrite it.
 */
export function mergeAiLocation(parsed: StoredPlace, ai: AiPlace | null): StoredPlace {
  if (!ai) return parsed;

  const workplace = parsed.workplace === 'UNKNOWN' && ai.workplace !== 'UNKNOWN' ? ai.workplace : parsed.workplace;
  const countries = narrower(parsed.countries, ai.countries);
  const regions = parsed.regions.length === 0 && ai.regions.length > 0 ? ai.regions : parsed.regions;

  const changed =
    workplace !== parsed.workplace || countries !== parsed.countries || regions !== parsed.regions;
  return { workplace, countries, regions, source: changed ? 'ai' : parsed.source };
}

/** The model's list when it fills a blank or narrows the parser's; else the parser's. */
function narrower(parsed: string[], ai: string[]): string[] {
  if (ai.length === 0) return parsed;
  if (parsed.length === 0) return ai;
  const strictSubset = ai.length < parsed.length && ai.every((c) => parsed.includes(c));
  return strictSubset ? ai : parsed;
}
