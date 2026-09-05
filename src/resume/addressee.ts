/*
 * Who the cover letter greets (#162 stage 4). The verifier's `named_humans`
 * finding is prose — "Verified: Ben Davies is real Product Engineering Team
 * Lead at Hospitable" — so the name is read out of it by shape, never
 * trusted blindly: the field on the card is editable and the finding is
 * shown beside it. Pure — tested in addressee.test.ts.
 */

/** Capitalised words that are roles, vendors or verifier vocabulary, never a person. */
const NOT_A_NAME = new Set(
  [
    'hiring', 'manager', 'managers', 'recruiter', 'recruiters', 'talent', 'acquisition', 'team', 'lead', 'head', 'director',
    'engineering', 'engineer', 'product', 'staff', 'senior', 'junior', 'principal', 'chief', 'officer', 'founder', 'ceo',
    'cto', 'coo', 'vp', 'the', 'org', 'linkedin', 'apollo', 'glassdoor', 'indeed', 'google', 'crunchbase', 'github',
    'verified', 'confirmed', 'references', 'named', 'human', 'humans', 'people', 'person', 'company', 'inc', 'ltd', 'llc',
    'gmbh', 'no', 'none', 'not', 'unnamed', 'anonymous', 'posting', 'job', 'role', 'careers', 'page', 'profile', 'however',
    'work', 'with', 'contact', 'reach', 'hospitality', 'software', 'platform', 'remote',
  ],
);

/** A two- or three-part capitalised name, hyphens allowed, no all-caps acronyms. */
const NAME_RUN = /\b([A-Z][a-z]+(?:-[A-Z][a-z]+)?(?: [A-Z][a-z]+(?:-[A-Z][a-z]+)?){1,2})\b/g;

/**
 * The first person named in a verifier finding, or null — a role phrase
 * ("Hiring Manager"), the company's own name and verifier vocabulary do not
 * count, and a name has at least two parts.
 */
export function addresseeFromFinding(finding: string, companyName: string): string | null {
  const company = new Set(companyName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  for (const m of finding.matchAll(NAME_RUN)) {
    const parts = m[1]!.split(' ');
    const words = parts.map((p) => p.toLowerCase());
    if (words.some((w) => NOT_A_NAME.has(w) || company.has(w))) continue;
    return parts.join(' ');
  }
  return null;
}

/** The name a stored letter greets — "Hi Ben Davies," → "Ben Davies" — so a regenerate keeps it; null for the team greeting. */
export function greetingOf(letterText: string): string | null {
  const m = /^\s*(?:Hi|Dear|Hello)\s+([^,\n]{2,80}?)\s*,/i.exec(letterText);
  if (!m) return null;
  const name = m[1]!.trim();
  return /\bteam\b/i.test(name) || /hiring/i.test(name) ? null : name;
}
