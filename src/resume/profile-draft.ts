import { t } from '../i18n/t';
import { isBornName } from '../search-names';
import { placesFromText } from '../location';
import { structureFromText } from './structure-from-text';

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
  /** Where the candidate lives, ISO-2 (ADR 0033); null = not said. */
  residence: string | null;
}

export interface ScanForDraft {
  title: string | null;
  seniority: string | null;
  skills: string[];
  primarySkills: string[];
  roleTypes: string[];
  /** The resume's own text: the place its header states is where the candidate lives. */
  text: string;
}

export interface ProfileDraft {
  changes: Partial<ProfileForDraft>;
  /** Editor-facing labels of the fields the draft replaces. */
  changed: string[];
  /** Why a field stayed as it was. */
  warnings: string[];
}


/**
 * The classifier is told to raise the score for every nice-to-have term, and
 * the draft is reviewed as chips (ADR 0015): a scan of 90 skills produced an
 * 86-chip list nobody checks and 717 characters of prompt per search (#157).
 */
export const NICE_TO_HAVE_MAX = 20;
/** Tooling every software posting can be assumed to involve — a boost for it is noise, not preference. */
const UNIVERSAL_TOOLING = new Set([
  'git', 'github', 'gitlab', 'bitbucket', 'svn', 'mercurial',
  'jira', 'confluence', 'agile', 'scrum', 'kanban', 'ci/cd', 'rest', 'restful',
]);

/**
 * Titles and role words that read as a resume from outside software
 * engineering. ApplyPack's boards, scan and scoring assume a tech stack
 * (docs/onboarding-sources.md, Decision A): a product manager's resume once
 * scanned to a required stack of `sql` — an honest reading, and a fatal one,
 * because every posting without the word then scored 35 at most. The draft
 * says so and leaves the required stack alone.
 */
const NON_ENGINEERING =
  /\b(?:product|project|program(?:me)?|delivery)\s+(?:manager|owner|lead)\b|\b(?:recruiter|talent acquisition|marketing|sales|account manager|customer success|designer|human resources|business analyst)\b/i;

/** The words that make a scan read as a non-engineering resume, or null. */
export function readsAsNonEngineering(scan: Pick<ScanForDraft, 'title' | 'roleTypes'>): string | null {
  const hit = NON_ENGINEERING.exec([scan.title ?? '', ...scan.roleTypes].join(' · '));
  return hit ? hit[0].toLowerCase() : null;
}

export function buildProfileDraft(current: ProfileForDraft, scan: ScanForDraft): ProfileDraft {
  const changes: Partial<ProfileForDraft> = {};
  const changed: string[] = [];
  const warnings: string[] = [];

  const outside = readsAsNonEngineering(scan);
  if (outside) {
    // The role is the resume's own wording, so it goes in as it was written.
    warnings.push(t('profile.draft.warn.nonEngineering', { role: outside }));
  } else if (scan.primarySkills.length > 0) {
    if (!sameTags(scan.primarySkills, current.stackRequired)) {
      changes.stackRequired = scan.primarySkills;
      changed.push(t('profile.draft.changed.requiredStack'));
    }
  } else {
    warnings.push(t('profile.draft.warn.noPrimary'));
  }

  const required = changes.stackRequired ?? current.stackRequired;
  if (scan.skills.length > 0) {
    const candidates = withoutTags(scan.skills, required).filter((s) => !UNIVERSAL_TOOLING.has(norm(s)));
    const nice = candidates.slice(0, NICE_TO_HAVE_MAX);
    if (candidates.length > nice.length) {
      warnings.push(t('profile.draft.warn.niceCapped', { n: scan.skills.length, max: NICE_TO_HAVE_MAX }));
    }
    if (!sameTags(nice, current.stackNiceToHave)) {
      changes.stackNiceToHave = nice;
      changed.push(t('profile.draft.changed.niceToHave'));
    }
  }

  const roles = titleRoleWords(scan.roleTypes);
  if (roles.length > 0 && !sameTags(roles, current.roleTypes)) {
    changes.roleTypes = roles;
    changed.push(t('profile.draft.changed.roleTypes'));
  }

  if (
    scan.seniority !== null &&
    (SENIORITY_LEVELS as readonly string[]).includes(scan.seniority) &&
    !sameTags([scan.seniority], current.seniority)
  ) {
    changes.seniority = [scan.seniority];
    changed.push(t('profile.draft.changed.seniority'));
  }

  // Only a freshly created search gets renamed from the resume headline.
  if (isBornName(current.name) && scan.title !== null && scan.title !== current.name) {
    changes.name = scan.title;
    changed.push(t('profile.draft.changed.name'));
  }

  // Only into an empty field: an "I live in" the person set outranks a header
  // line that may be a year old. Relocation is a wish no resume states.
  const lives = current.residence === null ? residenceStated(scan.text) : null;
  if (lives !== null) {
    changes.residence = lives;
    changed.push(t('profile.draft.changed.residence'));
  }

  return { changes, changed, warnings };
}

/**
 * The one country the resume's header names as where the candidate is
 * ("Lisbon, Portugal" → PT), or null: no place line, a place the gazetteer
 * does not know, or two countries, which is a choice for the person (#640).
 * Read off the text, as the parsed view reads it — never asked of a model.
 */
export function residenceStated(text: string): string | null {
  const place = structureFromText(text).basics.location;
  if (!place) return null;
  const { countries } = placesFromText(place);
  return countries.length === 1 ? countries[0]! : null;
}

/**
 * Role words as a title writes them (#555). A role word is matched against
 * titles as whole words (filter.ts:titleHasKeyword), and the scan sometimes
 * joins two with a slash — "qa/test automation" — which no title carries; each
 * half is a role word of its own.
 */
function titleRoleWords(roleTypes: string[]): string[] {
  return withoutTags(roleTypes.flatMap((role) => role.split('/').map((word) => word.trim())).filter(Boolean), []);
}

function sameTags(a: string[], b: string[]): boolean {
  const setA = new Set(a.map(norm));
  const setB = new Set(b.map(norm));
  return setA.size === setB.size && [...setA].every((tag) => setB.has(tag));
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
