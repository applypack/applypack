/*
 * "Create a search from this resume" — shared by /resumes/:id and the wizard's
 * step 3. Stage A of the multi-resume search (docs/onboarding-plan.md §4).
 *
 * ADR 0015 still holds: the page renders the draft, and only the POST that a
 * user presses writes a row. The draft is measured against a blank profile,
 * not the active one, so a brand-new search takes everything the scan speaks
 * for instead of only what differs from the search already running.
 */
import type { Profile } from '@prisma/client';
import { blankProfileInput, createProfile, listProfiles } from '../profiles';
import { buildProfileDraft, type ProfileDraft, type ScanForDraft } from '../resume/profile-draft';
import type { ResumeSummary } from '../resume/store';

/** The scan fields a profile can be drafted from. */
export function scanFields(resume: ResumeSummary): ScanForDraft {
  return {
    title: resume.title,
    seniority: resume.seniority,
    skills: resume.skills,
    primarySkills: resume.primarySkills,
    roleTypes: resume.roleTypes,
  };
}

/** The longest name the search editor saves (routes/settings.tsx, ProfileFormSchema). */
const PROFILE_NAME_MAX = 100;

/**
 * A search's name that no other search has: the second "Senior Backend
 * Engineer" carries the resume it hunts with — "Senior Backend Engineer —
 * marta v2" — or the list tells the two apart only by "primary" (#589).
 */
export function distinctName(name: string, resumeName: string, taken: readonly string[]): string {
  if (!taken.includes(name) || name === resumeName) return name;
  return Array.from(`${name} — ${resumeName}`).slice(0, PROFILE_NAME_MAX).join('');
}

/** The draft a "create a search" button would save, beside the searches named `taken`. `changes.name` is always set. */
export function newProfileDraft(resume: ResumeSummary, taken: readonly string[]): ProfileDraft {
  const draft = buildProfileDraft(blankProfileInput(), scanFields(resume));
  // A scan with no headline leaves the base name, "New profile" — the resume's
  // own name says more, and the user renames either one in the editor.
  return { ...draft, changes: { ...draft.changes, name: distinctName(draft.changes.name ?? resume.name, resume.name, taken) } };
}

/**
 * Born inactive, like every other new profile (issue #50): creating a search
 * must never silently switch the one the pipeline is scoring against. The
 * user activates it on /settings → Searches when they want to hunt with it.
 */
export async function createProfileFromResume(resume: ResumeSummary): Promise<Profile> {
  return createProfile({
    ...blankProfileInput(),
    ...newProfileDraft(resume, (await listProfiles()).map((p) => p.name)).changes,
    resumeId: resume.id,
  });
}
