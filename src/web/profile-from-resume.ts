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
import { blankProfileInput, createProfile } from '../profiles';
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

export function newProfileDraft(resume: ResumeSummary): ProfileDraft {
  return buildProfileDraft(blankProfileInput(), scanFields(resume));
}

/**
 * Born inactive, like every other new profile (issue #50): creating a search
 * must never silently switch the one the pipeline is scoring against. The
 * user activates it on /settings → Profile when they want to hunt with it.
 */
export async function createProfileFromResume(resume: ResumeSummary): Promise<Profile> {
  return createProfile({
    ...blankProfileInput(),
    ...newProfileDraft(resume).changes,
    resumeId: resume.id,
  });
}
