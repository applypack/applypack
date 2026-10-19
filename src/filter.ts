import { countriesOf } from './countries';
import type { WorkplaceCode } from './location';

/** A stored or parsed job: the string for the city rule, the columns for the sets (ADR 0031). */
export interface FilterableJob {
  title: string;
  location: string;
  workplace: WorkplaceCode;
  countries: string[];
  regions: string[];
}

/** What a search says about itself (ADR 0032): codes, never names. */
export interface FilterProfile {
  stackRequired: string[];
  roleTypes: string[];
  stackExclude: string[];
  /** ISO-2 codes; empty with empty regions = anywhere. */
  countries: string[];
  /** Group codes from the gazetteer (EU, EUROPE, WORLDWIDE, …). */
  regions: string[];
  /** Arrangements the search accepts; empty = any. */
  workplace: WorkplaceCode[];
  onsiteCities: string[];
}

/**
 * What a search's base filter reads, as one string: two searches with the
 * same key turn the same postings away before any model is asked. The order
 * and the case of a list do not matter to the filter, so they do not here.
 */
export function filterKey(profile: FilterProfile): string {
  const list = (values: readonly string[]): string[] => [...new Set(values.map((v) => v.trim().toLowerCase()))].sort();
  const fields = ['stackRequired', 'roleTypes', 'stackExclude', 'countries', 'regions', 'workplace', 'onsiteCities'] as const satisfies readonly (keyof FilterProfile)[];
  return JSON.stringify(fields.map((field) => list(profile[field])));
}

/**
 * Whether two versions of a search admit different postings before any
 * model is asked. A saved search that changed only its notes, its thresholds
 * or its resume turns the same postings away as it did (#448).
 */
export function filterChanged(before: FilterProfile, after: FilterProfile): boolean {
  return filterKey(before) !== filterKey(after);
}

/**
 * ADR 0028: with several searches running, a posting is admitted when ANY of
 * them admits it — a plain union, and free, because the gate is pure string
 * work. `passesBaseFilter` stays single-profile on purpose: the per-search
 * answer is what the classifier prompt and the alert routing need, and a
 * function that took an array would have to invent a meaning for "the"
 * profile's excludes.
 *
 * No active searches means nothing is admitted. That is not a degenerate
 * case to paper over — a deployment with every search switched off has asked
 * for silence, and the tick says so in its stats.
 */
export function passesAnyBaseFilter(
  job: FilterableJob,
  profiles: readonly FilterProfile[],
): boolean {
  return anyBaseFilterReason(job, profiles) === null;
}

/**
 * Why the base filter turned a posting away, gate by gate: no title keyword,
 * an excluded word in the title, an arrangement the search does not accept,
 * a place outside the search's. The search funnel counts them (TASKS §20),
 * because "why do I get nothing?" is answered by which gate took the jobs.
 */
export const FILTER_REASONS = ['title', 'excluded', 'workplace', 'place'] as const;
export type FilterReason = (typeof FILTER_REASONS)[number];

/**
 * For the union: null when any search admits the posting, else the reason of
 * the search that got it furthest — a posting that matched one search's
 * titles and missed its places is a "place" miss, whatever the other searches
 * made of its title. With no search at all the first gate is the reason.
 */
export function anyBaseFilterReason(
  job: FilterableJob,
  profiles: readonly FilterProfile[],
): FilterReason | null {
  let furthest: FilterReason = 'title';
  for (const profile of profiles) {
    const reason = baseFilterReason(job, profile);
    if (reason === null) return null;
    if (FILTER_REASONS.indexOf(reason) > FILTER_REASONS.indexOf(furthest)) furthest = reason;
  }
  return furthest;
}

/**
 * A title keyword matches whole words, not any run of characters inside one.
 *
 * `title.includes(k)` was wrong in both directions, and the two corpora on
 * this machine (941 distinct stored titles) say by how much:
 *
 * - On the EXCLUDE list it loses jobs silently. Of the 13 titles holding
 *   "java", only 6 are Java; excluding "java" also dropped 7 JavaScript
 *   roles. "intern" reads "International" the same way.
 * - On the required / role gate it was merely generous, and a generous gate
 *   only buys a classifier call. Still, 35 of the 50 titles holding "go" were
 *   Chicago, Google, Government and Category.
 *
 * So the rule is one rule for all three lists: the keyword must start and end
 * on a word boundary. Two exceptions, both measured rather than assumed:
 *
 * - A boundary is demanded only where the keyword's OWN edge is a letter or
 *   a digit. "c++", "c#" and "node.js" would never match if a non-word
 *   character were required after a "+" or a "#", and ".net" has to be free
 *   to sit inside "ASP.NET".
 * - A short list of suffixes may follow, because plain boundaries dropped six
 *   real matches on the corpus and nothing else: "go" no longer found five
 *   Golang roles and "team lead" no longer found "Team Leader". "ing" came
 *   from a wider keyword list than the live profile's: "engineer" lost 33
 *   titles such as "Head of Engineering". Five of the six below fire on
 *   stored titles; "ers" rides along with "er", being its plural. A suffix
 *   nothing needed ("es", "ship", a version digit as in "PHP8") is not here
 *   — a tolerance that was never measured is a guess about which words a
 *   user will type.
 *
 * And one spelling rule (#528): a hyphen, a space, a dot or nothing between
 * the parts of a word are the same word, so "back-end", "back end" and
 * "backend" meet, as do "node.js", "node js" and "nodejs". The setup's own
 * suggestions ("backend, full-stack") turned away 17 of 406 titles that only
 * spelled them another way. The parts are joined on both sides and the
 * boundaries still read off the title as written, so "ASP.NET" keeps ".net".
 */
const KEYWORD_SUFFIXES = [
  's', // 40 hits: "sale" → "Sales"
  'er', // 7 hits: "team lead" → "Team Leader"
  'ers', // the plural of the above
  'js', // 2 hits: "vue" → "VueJS", "node" → "NodeJS"
  'lang', // 10 hits: "go" → "Golang"
  'ing', // 33 hits: "engineer" → "Engineering Manager"
] as const;

export function titleHasKeyword(title: string, keyword: string): boolean {
  const k = keyword.toLowerCase();
  if (k.length === 0) return false;
  if (hasBoundedRun(title, k, title, null)) return true;
  const joined = joinParts(title);
  return hasBoundedRun(joined.text, joinParts(k).text, title, joined.at);
}

/**
 * The keyword inside `haystack` on word boundaries. `at` maps each character
 * of a joined haystack back to the title, where the boundaries are read.
 */
function hasBoundedRun(haystack: string, k: string, title: string, at: readonly number[] | null): boolean {
  const boundedLeft = isWordChar(k[0]);
  const boundedRight = isWordChar(k[k.length - 1]);
  let i = haystack.indexOf(k);
  while (i >= 0) {
    const start = at ? at[i]! : i;
    const end = at ? at[i + k.length - 1]! + 1 : i + k.length;
    const before = start > 0 ? title[start - 1] : undefined;
    const rest = title.slice(end);
    if (
      (!boundedLeft || !isWordChar(before)) &&
      (!boundedRight || !isWordChar(rest[0]) || endsOnSuffix(rest))
    ) {
      return true;
    }
    i = haystack.indexOf(k, i + 1);
  }
  return false;
}

/** Hyphens (the Unicode ones too), spaces and dots between two parts of a word: "back-end", "node js". */
const PART_SEPARATOR = /[\s.\-\u2010\u2011]/u;

/** The text with every run of separators between two word characters taken out, and where each kept character stood. */
function joinParts(text: string): { text: string; at: number[] } {
  let out = '';
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (PART_SEPARATOR.test(text[i]!) && isWordChar(text[i - 1])) {
      let next = i;
      while (next < text.length && PART_SEPARATOR.test(text[next]!)) next++;
      if (isWordChar(text[next])) {
        i = next - 1;
        continue;
      }
    }
    out += text[i];
    at.push(i);
  }
  return { text: out, at };
}

/** One allowed suffix, itself ending on a boundary: "golang" yes, "google" no. */
function endsOnSuffix(rest: string): boolean {
  return KEYWORD_SUFFIXES.some(
    (s) => rest.startsWith(s) && !isWordChar(rest[s.length]),
  );
}

/** Letters and digits of any script: "Angular" and "Розробник" bound alike. */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

export function passesBaseFilter(
  job: FilterableJob,
  profile: FilterProfile,
): boolean {
  return baseFilterReason(job, profile) === null;
}

/** The gate that turned the posting away for this search, or null when it passes. */
export function baseFilterReason(
  job: FilterableJob,
  profile: FilterProfile,
): FilterReason | null {
  const title = job.title.toLowerCase();

  // 1. Title must contain at least one stackRequired keyword OR one
  //    roleType keyword. Either is enough to admit the job to Claude;
  //    the classifier itself decides whether the actual tech matches.
  const required = profile.stackRequired;
  const roles = profile.roleTypes;
  const hasGate = required.length > 0 || roles.length > 0;
  if (hasGate) {
    const hits =
      required.some((k) => titleHasKeyword(title, k)) ||
      roles.some((k) => titleHasKeyword(title, k));
    if (!hits) return 'title';
  }

  // 2. Exclude — any match in title rejects.
  if (profile.stackExclude.some((k) => titleHasKeyword(title, k))) {
    return 'excluded';
  }

  // 3. Location.
  return locationReason(job, profile);
}

/**
 * The gate is deliberately loose: it rejects only what the columns prove
 * incompatible and leaves every "unknown" to the classifier, which reads the
 * whole description. Three questions, in order:
 *   - a listed on-site city in the string admits the job outright;
 *   - an arrangement the search does not accept rejects it;
 *   - when both sides name places, they must overlap — groups expand to
 *     their members, so PL is inside EU and "Europe" reaches an EU search.
 */
function locationReason(job: FilterableJob, profile: FilterProfile): FilterReason | null {
  const location = job.location.toLowerCase();
  const cities = profile.onsiteCities.map((c) => c.toLowerCase()).filter((c) => c.length > 0);
  if (cities.some((c) => location.includes(c))) return null;

  if (
    job.workplace !== 'UNKNOWN' &&
    profile.workplace.length > 0 &&
    !profile.workplace.includes(job.workplace)
  ) {
    return 'workplace';
  }

  // Nothing said, or said only on one side → Claude decides.
  if (job.workplace === 'UNKNOWN') return null;
  if (job.countries.length === 0 && job.regions.length === 0) return null;
  if (profile.countries.length === 0 && profile.regions.length === 0) return null;

  return placesOverlap(job, profile) ? null : 'place';
}

/** Set intersection that understands groups on both sides. */
export function placesOverlap(
  job: Pick<FilterableJob, 'countries' | 'regions'>,
  profile: Pick<FilterProfile, 'countries' | 'regions'>,
): boolean {
  const wanted = new Set([...profile.countries, ...profile.regions.flatMap(countriesOf)]);
  if (job.countries.some((c) => wanted.has(c))) return true;
  return job.regions.some(
    (r) => profile.regions.includes(r) || countriesOf(r).some((c) => wanted.has(c)),
  );
}
