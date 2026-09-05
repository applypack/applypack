import type { Profile } from '@prisma/client';
import { prisma } from './db';
import { logger } from './logger';
import { MAX_ACTIVE_PROFILES } from './profile-guards';
import type { WorkplaceCode } from './location';
import type { RelocationCode } from './eligibility';
import { ensureSettingsRow, SETTINGS_ID } from './settings';
import type { PriorityRule } from './priority-rules';

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
  // The whole decision runs under one lock (issue #70). Counting the running
  // searches and then flipping the row in a second statement is check-then-act:
  // two tabs both read 7, both pass, and 9 searches run. A transaction alone
  // does not fix it — at Read Committed each transaction's count reads its own
  // snapshot — and locking the rows we counted cannot see a row that became
  // active while we waited. So both writers queue on the one row that stands
  // for global state, and the loser re-counts after the winner has committed.
  await ensureSettingsRow();
  const name = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM app_settings WHERE id = ${SETTINGS_ID} FOR UPDATE`;
    const profile = await tx.profile.findUnique({ where: { id } });
    if (!profile) throw new Error(`Profile ${id} not found`);
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
  // Cannot delete the primary profile — UI must switch first.
  const settings = await prisma.appSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  if (settings?.activeProfileId === id) {
    throw new Error('Cannot delete the primary profile. Make another one primary first.');
  }
  await prisma.profile.delete({ where: { id } });
}

export async function setActiveProfile(id: number): Promise<void> {
  const profile = await prisma.profile.findUnique({ where: { id } });
  if (!profile) {
    throw new Error(`Profile ${id} not found`);
  }
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { activeProfileId: id },
    create: { id: SETTINGS_ID, activeProfileId: id },
  });
  // The primary always runs: it is the fallback every page reads, so leaving
  // it switched off would show defaults from a search that scores nothing.
  await prisma.profile.update({ where: { id }, data: { active: true } });
  logger.info({ profileId: id, name: profile.name }, 'profiles: primary set');
}
