/**
 * Location parser (ADR 0031): one free-text location string, plus whatever
 * the source said in structured fields, → workplace + countries + regions.
 * Pure — no DB, no HTTP, no config.
 *
 * Like apply-link.ts it only adds columns; the string it reads is never
 * rewritten. It is a hint layer: when a rule is unsure it says nothing, so a
 * bare "Remote" ends with an empty country list — never "worldwide".
 */

import {
  DEMONYMS,
  PLACE_ALIAS_RE,
  PLACE_ALIASES,
  SUBDIVISION_CODES,
  UPPERCASE_ALIASES,
  codesOfFlags,
  isCountryCode,
  isRegionCode,
  normalizePlace,
  type PlaceHit,
} from './countries';

export type WorkplaceCode = 'REMOTE' | 'HYBRID' | 'ONSITE' | 'UNKNOWN';

export const WORKPLACE_CODES: readonly WorkplaceCode[] = ['REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN'];

export const WORKPLACE_LABEL: Record<WorkplaceCode, string> = {
  REMOTE: 'Remote',
  HYBRID: 'Hybrid',
  ONSITE: 'On-site',
  UNKNOWN: 'Unknown',
};

/** Who filled the columns: the source's own fields, or this parser. */
export type LocationSource = 'structured' | 'parsed';

/** What a fetcher already knows from structured fields (ISO codes, region codes). */
export interface LocationHints {
  countries?: string[];
  regions?: string[];
  workplace?: WorkplaceCode;
}

export interface ParsedLocation {
  workplace: WorkplaceCode;
  /** ISO 3166-1 alpha-2, in order of appearance, once each. */
  countries: string[];
  /** Explicit region markers the text or the source named (EU, EUROPE, WORLDWIDE, …). */
  regions: string[];
  /** Null when nothing at all was recognised. */
  source: LocationSource | null;
}

// Arrangement markers, shared with filter.ts. Unicode boundaries rather than
// \b so the Ukrainian and German spellings match as whole words too.
export const REMOTE_RE =
  /(?<![\p{L}\p{N}])(?:remote|home[- ]?based|home ?office|work from home|wfh|віддалено|дистанційно|praca zdalna|zdalnie|t[ée]l[ée]travail)(?![\p{L}\p{N}])/iu;
export const HYBRID_RE = /(?<![\p{L}\p{N}])hybrid(?![\p{L}\p{N}])/iu;
export const ONSITE_RE = /(?<![\p{L}\p{N}])(?:on[-_ ]?site|in[- ]?office|in[- ]?person)(?![\p{L}\p{N}])/iu;

// One office or several: a segment is one place. Spaced hyphens and the
// words "or" / "and" separate too; a bare hyphen does not (Cluj-Napoca).
const SEGMENT_SPLIT_RE = /\s*[;/·|,()[\]+&:—–]\s*|\s+-\s+|\s+(?:or|and)\s+/;

// "(m/w/d)" and its variants: a German-market posting, no country claimed.
const GERMAN_GENDER_NOTE_RE = /\((?:[mwfdx]\s*\/\s*){2}[mwfdx]\)/i;

// "Poland or Romanian residents only": a demonym counts only with a word
// that ties it to where people live, never alone ("Dutch required" is a language).
const RESIDENCY_WORDS = 'residents?|citizens?|nationals?|passport';

const DEMONYM_RESIDENTS_RE = new RegExp(
  `(?<![\\p{L}])(${[...DEMONYMS.keys()].sort((a, b) => b.length - a.length).join('|')})\\s+(?:${RESIDENCY_WORDS})(?![\\p{L}])`,
  'giu',
);

// A two-letter code inside a longer segment only counts next to one of these
// ("US only", "Remote DE", "UK based"); anywhere else "IN" is Indiana.
const CODE_CONTEXT_RE = /(?<![\p{L}\p{N}])(?:remote|hybrid|only|based|timezones?|time zones?|hours)(?![\p{L}\p{N}])/iu;

const TWO_LETTER_CODE_RE = /(?<![\p{L}\p{N}])[A-Z]{2}(?![\p{L}\p{N}])/gu;

/** Softest arrangement named wins: an office list with one remote entry is remote. */
export function workplaceFromText(text: string): WorkplaceCode {
  if (REMOTE_RE.test(text)) return 'REMOTE';
  if (HYBRID_RE.test(text)) return 'HYBRID';
  if (ONSITE_RE.test(text)) return 'ONSITE';
  return 'UNKNOWN';
}

/**
 * Structured hints come first and the text can only add to them; the
 * workplace hint replaces the text's reading outright. `source` says who
 * decided, and is null when neither found anything.
 */
export function parseLocation(text: string, hints: LocationHints = {}): ParsedLocation {
  const hintCountries = unique((hints.countries ?? []).map((c) => c.toUpperCase()).filter(isCountryCode));
  const hintRegions = unique((hints.regions ?? []).filter(isRegionCode));
  const hintWorkplace = hints.workplace && hints.workplace !== 'UNKNOWN' ? hints.workplace : null;

  const parsed = placesFromText(text);
  const countries = unique([...hintCountries, ...parsed.countries]);
  const regions = unique([...hintRegions, ...parsed.regions]);
  const workplace = hintWorkplace ?? workplaceFromText(text);

  const structured = hintCountries.length > 0 || hintRegions.length > 0 || hintWorkplace !== null;
  const found = countries.length > 0 || regions.length > 0 || workplace !== 'UNKNOWN';
  return { workplace, countries, regions, source: structured ? 'structured' : found ? 'parsed' : null };
}

interface Places {
  countries: string[];
  regions: string[];
}

/** Countries and regions named in the text, in order of appearance. */
export function placesFromText(text: string): Places {
  const countries: string[] = [];
  const regions: string[] = [];

  for (const code of codesOfFlags(text)) push(countries, code);
  if (GERMAN_GENDER_NOTE_RE.test(text)) push(regions, 'DACH');
  for (const m of text.matchAll(DEMONYM_RESIDENTS_RE)) {
    const code = DEMONYMS.get(normalizePlace(m[1] ?? ''));
    if (code) push(countries, code);
  }

  const segments = text.split(SEGMENT_SPLIT_RE).filter((s) => s.trim().length > 0);
  let previous: SegmentResult | null = null;
  for (const segment of segments) {
    const result = readSegment(segment, previous);
    if (result.dropsPrevious && previous) {
      for (const code of previous.countries) remove(countries, code);
    }
    for (const code of result.countries) push(countries, code);
    for (const code of result.regions) push(regions, code);
    previous = result;
  }
  return { countries, regions };
}

interface SegmentResult {
  countries: string[];
  regions: string[];
  /** The segment named a city ("Birmingham", "Paris") rather than a country. */
  city: boolean;
  /** Only an arrangement word ("Remote", "Hybrid"): the next code is a country. */
  marker: boolean;
  /** "City, ST": the previous segment was that state's city, whatever it looked like. */
  dropsPrevious: boolean;
}

function readSegment(segment: string, previous: SegmentResult | null): SegmentResult {
  const result: SegmentResult = { countries: [], regions: [], city: false, marker: false, dropsPrevious: false };
  // Dots vanish and hyphens become spaces so "U.S." and "US-Remote" read as words.
  const plain = segment.replace(/\./g, '').replace(/[-–—]/g, ' ').replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
  const normalized = normalizePlace(segment);

  const matched: string[] = [];
  for (const m of normalized.matchAll(PLACE_ALIAS_RE)) {
    if (UPPERCASE_ALIASES.has(m[0]) && !plain.includes(m[0].toUpperCase())) continue;
    matched.push(m[0]);
    apply(result, PLACE_ALIASES.get(m[0]));
  }

  const codes = [...plain.matchAll(TWO_LETTER_CODE_RE)].map((m) => m[0]);
  if (plain.length === 2 && codes.length === 1) {
    readBareCode(result, codes[0]!, previous);
  } else {
    const explicit = CODE_CONTEXT_RE.test(plain);
    for (const code of codes) {
      // "EU" inside "EU time zones" was already read as the phrase.
      if (matched.some((key) => key.split(' ').includes(code.toLowerCase()))) continue;
      const hit = PLACE_ALIASES.get(code.toLowerCase());
      if (hit?.kind === 'region') push(result.regions, hit.code);
      else if (explicit || !SUBDIVISION_CODES.has(code)) apply(result, countryHit(code, hit));
    }
  }

  result.marker =
    result.countries.length === 0 && result.regions.length === 0 && workplaceFromText(segment) !== 'UNKNOWN';
  return result;
}

function apply(result: SegmentResult, hit: PlaceHit | undefined): void {
  if (!hit) return;
  if (hit.kind === 'region') push(result.regions, hit.code);
  else push(result.countries, hit.code);
  if (hit.kind === 'city') result.city = true;
}

/** "US" is its own code; "UK" and "SF" are spellings the gazetteer maps. */
function countryHit(code: string, hit: PlaceHit | undefined): PlaceHit | undefined {
  return isCountryCode(code) ? { kind: 'country', code } : hit;
}

/**
 * A segment that is exactly two capital letters. After "Remote" it is a
 * country ("Remote (US)", "Remote · DE"). After a place it is that place's
 * subdivision when the place is known ("Kyiv, UA" stays Ukraine,
 * "Indianapolis, IN" stays Indiana); after an unknown word a US state wins
 * ("Wilmington, DE"), then the ISO country ("Delft, NL"), then a province.
 */
function readBareCode(result: SegmentResult, code: string, previous: SegmentResult | null): void {
  const hit = PLACE_ALIASES.get(code.toLowerCase());
  if (hit && hit.kind !== 'country') return apply(result, hit);

  const stateOf = SUBDIVISION_CODES.get(code) ?? null;
  const country = countryHit(code, hit)?.code ?? null;
  const placeCountry = previous && !previous.marker ? (previous.countries[0] ?? null) : null;

  let resolved: string | null;
  if (placeCountry === null) {
    resolved = previous && !previous.marker && stateOf === 'US' ? 'US' : (country ?? stateOf);
  } else if (placeCountry === code || placeCountry === country) {
    resolved = placeCountry;
  } else if (stateOf === placeCountry) {
    resolved = stateOf;
  } else if (stateOf && previous?.city) {
    resolved = stateOf;
    result.dropsPrevious = true;
  } else {
    resolved = country;
  }
  if (resolved) push(result.countries, resolved);
}

function push(list: string[], code: string): void {
  if (!list.includes(code)) list.push(code);
}

function remove(list: string[], code: string): void {
  const i = list.indexOf(code);
  if (i >= 0) list.splice(i, 1);
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}
