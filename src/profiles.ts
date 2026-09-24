import type { Profile } from '@prisma/client';
import { prisma } from './db';
import { logger } from './logger';
import { MAX_ACTIVE_PROFILES } from './profile-guards';
import type { WorkplaceCode } from './location';
import type { RelocationCode } from './eligibility';
import { SETTINGS_ID, withGlobalWriteLock } from './settings';
import type { PriorityRule } from './priority-rules';

/** A stale id: the search was deleted, most often from another tab. */
const SEARCH_GONE = 'That search no longer exists, so nothing changed — it was probably deleted in another tab.';

export interface ProfileInput {
  name: string;
  stackRequired: string[];
  roleTypes: string[];
  stackNiceToHave: string[];
  stackExclude: string[];
  notes: string | null;
  seniority: string[];
  /** ISO-2 codes and group codes (ADR 0032); both empty = anywhere. */
  countries: string[];
  regions: string[];
  /** Arrangements the search accepts; empty = any. */
  workplace: WorkplaceCode[];
  /** Where the candidate lives now (ISO-2), null = not said (ADR 0033). */
  residence: string | null;
  /** Whether they would move for a role: no | yes | sponsorship (ADR 0033). */
  relocation: RelocationCode;
  onsiteCities: string[];
  minSalaryUsd: number;
  minFitScore: number;
  notificationTargetId: number | null;
  /** The resume this search hunts with; null = pick by skill overlap. */
  resumeId: number | null;
  priorityRules: PriorityRule[];
}

/**
 * A profile with nothing said yet — what "New profile" creates, and the base
 * a resume draft is measured against so every field the scan speaks for lands
 * in the new search (src/resume/profile-draft.ts). Born inactive (issue #50).
 */
export function blankProfileInput(): ProfileInput {
  return {
    name: 'New profile',
    stackRequired: [],
    roleTypes: [],
    stackNiceToHave: [],
    stackExclude: ['junior', 'intern'],
    notes: null,
    seniority: [],
    countries: [],
    regions: [],
    workplace: ['REMOTE'],
    residence: null,
    relocation: 'no',
    onsiteCities: [],
    minSalaryUsd: 0,
    minFitScore: 70,
    notificationTargetId: null,
    resumeId: null,
    priorityRules: [],
  };
}

export async function listProfiles(): Promise<Profile[]> {
  return prisma.profile.findMany({ orderBy: { id: 'asc' } });
}

export async function getProfile(id: number): Promise<Profile | null> {
  return prisma.profile.findUnique({ where: { id } });
}

/** The searches that hunt with a given resume — shown on that resume's page. */
export async function listProfilesForResume(
  resumeId: number,
): Promise<Pick<Profile, 'id' | 'name'>[]> {
  return prisma.profile.findMany({
    where: { resumeId },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
}

/**
 * Every search that is running (ADR 0028). Ordered by id so the classifier
 * prompt is byte-stable across a tick and the score line reads the same way
 * twice. The primary is guaranteed to be in here — `setActiveProfile` marks it
 * active — so a caller that only wants defaults can still use getActiveProfile.
 */
export async function listActiveProfiles(): Promise<Profile[]> {
  return prisma.profile.findMany({ where: { active: true }, orderBy: { id: 'asc' } });
}

/**
 * Flip one search on or off. The primary cannot be switched off: it supplies
 * the defaults every page falls back to, and a primary that scores nothing is
 * a dashboard that quietly stops working.
 */
export async function setProfileActive(id: number, active: boolean): Promise<void> {
  // Counting the running searches and then flipping the row is check-then-act:
  // two tabs both read 7, both pass, and 9 searches run. `withGlobalWriteLock`
  // is why they cannot (issue #70).
  const name = await withGlobalWriteLock(async (tx) => {
    const profile = await tx.profile.findUnique({ where: { id } });
    if (!profile) throw new Error(SEARCH_GONE);
    if (active) {
      const running = await tx.profile.count({ where: { active: true, id: { not: id } } });
      if (running >= MAX_ACTIVE_PROFILES) {
        throw new Error(
          `At most ${MAX_ACTIVE_PROFILES} searches can run at once. Switch one off first.`,
        );
      }
    } else {
      const settings = await tx.appSettings.findUnique({ where: { id: SETTINGS_ID } });
      if (settings?.activeProfileId === id) {
        throw new Error('The primary search cannot be switched off. Make another one primary first.');
      }
    }
    await tx.profile.update({ where: { id }, data: { active } });
    return profile.name;
  });
  logger.info({ profileId: id, name, active }, 'profiles: active toggled');
}

export async function getActiveProfile(): Promise<Profile | null> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: SETTINGS_ID },
    include: { activeProfile: true },
  });
  return settings?.activeProfile ?? null;
}

export async function createProfile(input: ProfileInput): Promise<Profile> {
  return prisma.profile.create({ data: input });
}

export async function updateProfile(
  id: number,
  input: ProfileInput,
): Promise<Profile> {
  return prisma.profile.update({ where: { id }, data: input });
}

export async function deleteProfile(id: number): Promise<void> {
  // Cannot delete the primary profile — UI must switch first. Under the same
  // lock as the other profile writes: reading the primary and then deleting
  // let a tab that was making this search primary win the race, and the
  // dashboard lost the row every page falls back to.
  await withGlobalWriteLock(async (tx) => {
    const settings = await tx.appSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (settings?.activeProfileId === id) {
      throw new Error('Cannot delete the primary profile. Make another one primary first.');
    }
    const { count } = await tx.profile.deleteMany({ where: { id } });
    if (count === 0) throw new Error(SEARCH_GONE);
  });
}

export async function setActiveProfile(id: number): Promise<void> {
  // The other half of the same race: reading the row and then pointing the
  // settings at it let a delete land in between, and the foreign key refused
  // the write with Prisma's own text in the flash.
  const name = await withGlobalWriteLock(async (tx) => {
    const profile = await tx.profile.findUnique({ where: { id } });
    if (!profile) throw new Error(SEARCH_GONE);
    await tx.appSettings.update({ where: { id: SETTINGS_ID }, data: { activeProfileId: id } });
    // The primary always runs: it is the fallback every page reads, so leaving
    // it switched off would show defaults from a search that scores nothing.
    await tx.profile.update({ where: { id }, data: { active: true } });
    return profile.name;
  });
  logger.info({ profileId: id, name }, 'profiles: primary set');
}
