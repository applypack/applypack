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
  return profiles.some((p) => passesBaseFilter(job, p));
}

export function passesBaseFilter(
  job: FilterableJob,
  profile: FilterProfile,
): boolean {
  const title = job.title.toLowerCase();

  // 1. Title must contain at least one stackRequired keyword OR one
  //    roleType keyword. Either is enough to admit the job to Claude;
  //    the classifier itself decides whether the actual tech matches.
  const required = profile.stackRequired.map((s) => s.toLowerCase());
  const roles = profile.roleTypes.map((s) => s.toLowerCase());
  const hasGate = required.length > 0 || roles.length > 0;
  if (hasGate) {
    const hits =
      required.some((k) => k.length > 0 && title.includes(k)) ||
      roles.some((k) => k.length > 0 && title.includes(k));
    if (!hits) return false;
  }

  // 2. Exclude — any match in title rejects.
  const exclude = profile.stackExclude.map((s) => s.toLowerCase());
  if (exclude.some((k) => k.length > 0 && title.includes(k))) {
    return false;
  }

  // 3. Location.
  return locationMatches(job, profile);
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
function locationMatches(job: FilterableJob, profile: FilterProfile): boolean {
  const location = job.location.toLowerCase();
  const cities = profile.onsiteCities.map((c) => c.toLowerCase()).filter((c) => c.length > 0);
  if (cities.some((c) => location.includes(c))) return true;

  if (
    job.workplace !== 'UNKNOWN' &&
    profile.workplace.length > 0 &&
    !profile.workplace.includes(job.workplace)
  ) {
    return false;
  }

  // Nothing said, or said only on one side → Claude decides.
  if (job.workplace === 'UNKNOWN') return true;
  if (job.countries.length === 0 && job.regions.length === 0) return true;
  if (profile.countries.length === 0 && profile.regions.length === 0) return true;

  return placesOverlap(job, profile);
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
