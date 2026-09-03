/**
 * The gazetteer (ADR 0031): countries, their cities and spellings, the
 * region groups, and the lookups the location parser and the picker share.
 * Pure — the JSON sits next to this file so `tsc` copies it into `dist/`.
 */

import { z } from 'zod';
import gazetteer from './countries.json';

const CountrySchema = z.object({
  code: z.string().regex(/^[A-Z]{2}$/),
  name: z.string().min(1),
  flag: z.string().min(1),
  names: z.array(z.string().min(1)),
  demonyms: z.array(z.string().min(1)),
  cities: z.array(z.string().min(1)),
});

const RegionSchema = z.object({
  label: z.string().min(1),
  flag: z.string().optional(),
  aliases: z.array(z.string().min(1)),
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)),
});

const GazetteerSchema = z.object({
  countries: z.array(CountrySchema).min(1),
  subdivisions: z.record(z.record(z.array(z.string().min(1)))),
  groups: z.record(RegionSchema),
});

export type Country = z.infer<typeof CountrySchema>;
export interface Region extends z.infer<typeof RegionSchema> {
  code: string;
}

const data = GazetteerSchema.parse(gazetteer);

export const COUNTRIES: readonly Country[] = data.countries;
export const REGIONS: readonly Region[] = Object.entries(data.groups).map(([code, g]) => ({
  code,
  ...g,
}));
export const REGION_CODES: readonly string[] = REGIONS.map((r) => r.code);

/** Only these countries abbreviate subdivisions in job postings ("Austin, TX", "Toronto, ON"). */
const ABBREVIATING_COUNTRIES = ['US', 'CA'];

/** "USA", "EMEA", "SF": at this length an all-caps spelling is an abbreviation, not a word. */
const SHORT_ALIAS_LENGTH = 4;

const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
const regionByCode = new Map(REGIONS.map((r) => [r.code, r]));

export function countryOf(code: string): Country | null {
  return byCode.get(code.toUpperCase()) ?? null;
}

export function isCountryCode(s: string): boolean {
  return byCode.has(s);
}

export function isRegionCode(s: string): boolean {
  return regionByCode.has(s);
}

export function regionOf(code: string): Region | null {
  return regionByCode.get(code) ?? null;
}

/** Members of a region; WORLDWIDE lists no members and means every country. */
export function countriesOf(region: string): string[] {
  const r = regionByCode.get(region);
  if (!r) return [];
  return r.countries.length > 0 ? [...r.countries] : COUNTRIES.map((c) => c.code);
}

/** Regions a country belongs to, WORLDWIDE excluded (it has no member list). */
export function groupsOf(code: string): string[] {
  return REGIONS.filter((r) => r.countries.includes(code)).map((r) => r.code);
}

/**
 * One spelling, one form: lowercase, accents and apostrophes off, dots
 * dropped ("U.S." → "us"), hyphens and non-breaking spaces to plain spaces.
 * Every alias and every input goes through this before a comparison.
 */
export function normalizePlace(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[-–—_ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What one spelling refers to. `country` is the ISO code the hit resolves to. */
export interface PlaceHit {
  kind: 'country' | 'city' | 'subdivision' | 'region';
  /** ISO country code, or the region code for kind === 'region'. */
  code: string;
}

/**
 * Names the parser must not resolve on their own: "Georgia" is a US state
 * and a country, and the corpus has both ("Atlanta, Georgia", "Tbilisi,
 * Georgia"). The city decides; the bare word decides nothing.
 */
export const AMBIGUOUS_NAMES: ReadonlySet<string> = new Set(['georgia']);

/** Normalised spelling → hit. Country names, cities, subdivision names, region phrases. */
export const PLACE_ALIASES: ReadonlyMap<string, PlaceHit> = buildAliases();

/**
 * Short all-caps spellings ("USA", "CAN", "CET", "SF", "EMEA") only count
 * when written in capitals: lowercase "can" is a verb, "cet" is French.
 */
export const UPPERCASE_ALIASES: ReadonlySet<string> = buildUppercaseAliases();

/** Two-letter subdivision abbreviations, per abbreviating country ("TX" → US). */
export const SUBDIVISION_CODES: ReadonlyMap<string, string> = buildSubdivisionCodes();

/** Normalised demonym → country ("polish" → PL). */
export const DEMONYMS: ReadonlyMap<string, string> = new Map(
  COUNTRIES.flatMap((c) => c.demonyms.map((d) => [normalizePlace(d), c.code] as const)),
);

function buildAliases(): Map<string, PlaceHit> {
  const map = new Map<string, PlaceHit>();
  const add = (alias: string, hit: PlaceHit) => {
    const key = normalizePlace(alias);
    if (key.length === 0 || AMBIGUOUS_NAMES.has(key)) return;
    // First writer wins so a country name is never shadowed by a city
    // spelled the same way ("Luxembourg", "Singapore").
    if (!map.has(key)) map.set(key, hit);
  };
  for (const c of COUNTRIES) {
    add(c.name, { kind: 'country', code: c.code });
    for (const n of c.names) add(n, { kind: 'country', code: c.code });
  }
  for (const r of REGIONS) {
    for (const a of r.aliases) add(a, { kind: 'region', code: r.code });
  }
  for (const [country, subdivisions] of Object.entries(data.subdivisions)) {
    for (const names of Object.values(subdivisions)) {
      for (const n of names) add(n, { kind: 'subdivision', code: country });
    }
  }
  for (const c of COUNTRIES) {
    for (const city of c.cities) add(city, { kind: 'city', code: c.code });
  }
  return map;
}

function buildUppercaseAliases(): Set<string> {
  const spellings = new Map<string, string[]>();
  const note = (alias: string) => {
    const key = normalizePlace(alias);
    if (PLACE_ALIASES.has(key)) spellings.set(key, [...(spellings.get(key) ?? []), alias]);
  };
  for (const c of COUNTRIES) [c.name, ...c.names, ...c.cities].forEach(note);
  for (const r of REGIONS) r.aliases.forEach(note);
  for (const subdivisions of Object.values(data.subdivisions)) {
    for (const names of Object.values(subdivisions)) names.forEach(note);
  }
  const out = new Set<string>();
  for (const [key, forms] of spellings) {
    const short = key.length <= SHORT_ALIAS_LENGTH && !key.includes(' ');
    if (short && forms.every((f) => f === f.toUpperCase())) out.add(key);
  }
  return out;
}

function buildSubdivisionCodes(): Map<string, string> {
  const map = new Map<string, string>();
  for (const country of ABBREVIATING_COUNTRIES) {
    for (const abbr of Object.keys(data.subdivisions[country] ?? {})) {
      if (/^[A-Z]{2}$/.test(abbr)) map.set(abbr, country);
    }
  }
  return map;
}

/**
 * Longest alias first, on letter/digit boundaries, so "south america" wins
 * over "america" and "us" never fires inside "campus" or "Russia".
 * Two-letter spellings ("US", "UK", "EU") are left to the parser's code
 * rule, which needs them in capitals and in a telling position.
 */
export const PLACE_ALIAS_RE: RegExp = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${[...PLACE_ALIASES.keys()]
    .filter((k) => k.length > 2)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')})(?![\\p{L}\\p{N}])`,
  'gu',
);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A single spelling → the country. Code, any name, flag, city, subdivision or demonym. */
export function findCountry(query: string): Country | null {
  const trimmed = query.trim();
  if (trimmed.length === 0) return null;
  const upper = trimmed.toUpperCase();
  if (byCode.has(upper)) return byCode.get(upper)!;
  const fromFlag = codeOfFlag(trimmed);
  if (fromFlag && byCode.has(fromFlag)) return byCode.get(fromFlag)!;
  const key = normalizePlace(trimmed);
  const hit = PLACE_ALIASES.get(key);
  if (hit && hit.kind !== 'region') return byCode.get(hit.code) ?? null;
  const demonym = DEMONYMS.get(key);
  return demonym ? (byCode.get(demonym) ?? null) : null;
}

const REGIONAL_INDICATOR_A = 0x1f1e6;
const FLAG_RE = /\p{Regional_Indicator}{2}/u;

/** "🇵🇱" → "PL". Null for anything that is not exactly one flag. */
export function codeOfFlag(s: string): string | null {
  const m = FLAG_RE.exec(s);
  if (!m || m[0].length !== s.trim().length) return null;
  return [...m[0]]
    .map((ch) => String.fromCharCode(ch.codePointAt(0)! - REGIONAL_INDICATOR_A + 65))
    .join('');
}

/** Every flag in a text, as ISO codes the gazetteer knows, in order, once each. */
export function codesOfFlags(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\p{Regional_Indicator}{2}/gu)) {
    const code = codeOfFlag(m[0]);
    if (code && byCode.has(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

export function flagOf(code: string): string {
  return byCode.get(code)?.flag ?? regionByCode.get(code)?.flag ?? '';
}

/** Display name for a country or region code; the code itself when unknown. */
export function placeLabel(code: string): string {
  return byCode.get(code)?.name ?? regionByCode.get(code)?.label ?? code;
}
