const REMOTE_RE = /\bremote\b/i;
const HYBRID_RE = /\bhybrid\b/i;
const ONSITE_RE = /\b(on[- ]?site|in[- ]?office|in[- ]?person)\b/i;

const REGION_PATTERNS: Record<string, RegExp> = {
  US: /\b(united states|usa|us only|us[- ]based|americas|north america|usa?\b)/i,
  Americas: /\b(americas|north america|south america|latam|latin america)\b/i,
  EU: /\b(eu|europe|emea|european union)\b/i,
  UK: /\b(uk|united kingdom|britain)\b/i,
  APAC: /\b(apac|asia|asia[- ]pacific)\b/i,
  Worldwide: /\b(worldwide|anywhere|global|fully remote)\b/i,
};

export interface FilterableJob {
  title: string;
  location: string;
}

export interface FilterProfile {
  stackRequired: string[];
  stackExclude: string[];
  remoteOk: boolean;
  remoteRegions: string[];
  onsiteCities: string[];
  hybridOk: boolean;
}

export function passesBaseFilter(
  job: FilterableJob,
  profile: FilterProfile,
): boolean {
  const title = job.title.toLowerCase();
  const location = job.location.toLowerCase();

  // 1. Required stack — at least one keyword in title.
  if (profile.stackRequired.length > 0) {
    const required = profile.stackRequired.map((s) => s.toLowerCase());
    if (!required.some((k) => k.length > 0 && title.includes(k))) {
      return false;
    }
  }

  // 2. Exclude — any match in title rejects.
  const exclude = profile.stackExclude.map((s) => s.toLowerCase());
  if (exclude.some((k) => k.length > 0 && title.includes(k))) {
    return false;
  }

  // 3. Location.
  return locationMatches(location, profile);
}

function locationMatches(location: string, profile: FilterProfile): boolean {
  // Empty location → let Claude decide.
  if (location.trim() === '') return true;

  // On-site cities first — strong signal that overrides remote-only profile.
  if (profile.onsiteCities.length > 0) {
    const cities = profile.onsiteCities.map((c) => c.toLowerCase());
    if (cities.some((c) => c.length > 0 && location.includes(c))) {
      return true;
    }
  }

  const isRemote = REMOTE_RE.test(location);
  const isHybrid = HYBRID_RE.test(location);
  const isOnsite =
    ONSITE_RE.test(location) && !isRemote && !isHybrid;

  if (profile.remoteOk && isRemote) {
    if (profile.remoteRegions.length === 0) return true;
    if (matchesAnyRegion(location, profile.remoteRegions)) return true;
    // Remote without explicit region info → accept (Claude will judge).
    if (!hasAnyRegionMarker(location)) return true;
    return false;
  }

  if (profile.hybridOk && isHybrid) {
    if (profile.remoteRegions.length === 0) return true;
    if (matchesAnyRegion(location, profile.remoteRegions)) return true;
    return false;
  }

  if (isOnsite) {
    // No on-site city matched above and we already returned false there.
    return false;
  }

  // Location string present but doesn't match remote/hybrid/onsite-city —
  // still let Claude decide as a final fallback when remote is OK.
  if (profile.remoteOk && !ONSITE_RE.test(location)) {
    return true;
  }

  return false;
}

function matchesAnyRegion(location: string, regions: string[]): boolean {
  for (const r of regions) {
    const re = REGION_PATTERNS[r];
    if (re && re.test(location)) return true;
  }
  return false;
}

function hasAnyRegionMarker(location: string): boolean {
  for (const re of Object.values(REGION_PATTERNS)) {
    if (re.test(location)) return true;
  }
  return false;
}
