import type { Profile } from '@prisma/client';
import { prisma } from './db';
import { logger } from './logger';

const SETTINGS_ID = 1;

export interface ProfileInput {
  name: string;
  stackRequired: string[];
  roleTypes: string[];
  stackNiceToHave: string[];
  stackExclude: string[];
  notes: string | null;
  seniority: string[];
  remoteOk: boolean;
  remoteRegions: string[];
  onsiteCities: string[];
  hybridOk: boolean;
  minSalaryUsd: number;
  minFitScore: number;
  telegramTargetId: number | null;
}

export async function listProfiles(): Promise<Profile[]> {
  return prisma.profile.findMany({ orderBy: { id: 'asc' } });
}

export async function getProfile(id: number): Promise<Profile | null> {
  return prisma.profile.findUnique({ where: { id } });
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
  // Cannot delete the active profile — UI must switch first.
  const settings = await prisma.appSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  if (settings?.activeProfileId === id) {
    throw new Error('Cannot delete the active profile. Switch to another first.');
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
  logger.info({ profileId: id, name: profile.name }, 'profiles: active set');
}
