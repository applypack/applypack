/*
 * Maps a stored resume scan onto a profile — the "Fill from resume" flow.
 * Pure: the route renders the result into the profile editor as an unsaved
 * draft; nothing persists until the user submits the form.
 */

export const SENIORITY_LEVELS = ['junior', 'mid', 'senior', 'staff', 'lead', 'principal'] as const;

/** The only profile fields a resume can speak for. */
export interface ProfileForDraft {
  name: string;
  stackRequired: string[];
  stackNiceToHave: string[];
  roleTypes: string[];
  seniority: string[];
}

export interface ScanForDraft {
  title: string | null;
  seniority: string | null;
  skills: string[];
  primarySkills: string[];
  roleTypes: string[];
}

export interface ProfileDraft {
  changes: Partial<ProfileForDraft>;
  /** Editor-facing labels of the fields the draft replaces. */
  changed: string[];
  /** Why a field stayed as it was. */
  warnings: string[];
}

/** Only a freshly created profile gets renamed from the resume headline. */
const DEFAULT_PROFILE_NAMES = ['New profile', 'My profile'];

export function buildProfileDraft(current: ProfileForDraft, scan: ScanForDraft): ProfileDraft {
  const changes: Partial<ProfileForDraft> = {};
  const changed: string[] = [];
  const warnings: string[] = [];

  if (scan.primarySkills.length > 0) {
    if (!sameTags(scan.primarySkills, current.stackRequired)) {
      changes.stackRequired = scan.primarySkills;
      changed.push('required stack');
    }
  } else {
    warnings.push('the scan marks no primary stack, so the required stack was kept');
  }

  const required = changes.stackRequired ?? current.stackRequired;
  if (scan.skills.length > 0) {
    const nice = withoutTags(scan.skills, required);
    if (!sameTags(nice, current.stackNiceToHave)) {
      changes.stackNiceToHave = nice;
      changed.push('nice-to-have stack');
    }
  }

  if (scan.roleTypes.length > 0 && !sameTags(scan.roleTypes, current.roleTypes)) {
    changes.roleTypes = scan.roleTypes;
    changed.push('role types');
  }

  if (
    scan.seniority !== null &&
    (SENIORITY_LEVELS as readonly string[]).includes(scan.seniority) &&
    !sameTags([scan.seniority], current.seniority)
  ) {
    changes.seniority = [scan.seniority];
    changed.push('seniority');
  }

  if (DEFAULT_PROFILE_NAMES.includes(current.name) && scan.title !== null && scan.title !== current.name) {
    changes.name = scan.title;
    changed.push('name');
  }

  return { changes, changed, warnings };
}

function sameTags(a: string[], b: string[]): boolean {
  const setA = new Set(a.map(norm));
  const setB = new Set(b.map(norm));
  return setA.size === setB.size && [...setA].every((t) => setB.has(t));
}

function withoutTags(list: string[], drop: string[]): string[] {
  const dropSet = new Set(drop.map(norm));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = norm(item);
    if (dropSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}
