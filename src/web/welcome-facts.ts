import type { Profile } from '@prisma/client';
import { prisma } from '../db';
import { probeAiProviders, type AiProviderStatus } from '../ai-runtime';
import type { AiProviderId } from '../ai-engine';
import { getSettings, type AppSettingsView } from '../settings';
import { getActiveProfile } from '../profiles';
import { isBlankProfile } from '../profile-guards';
import type { WelcomeFacts } from './welcome-steps';

/*
 * Gathers what the wizard derives its steps from (welcome-steps.ts) — shared
 * by /welcome and the Overview's "Finish setup" chip. The engine probe is
 * cached for a minute inside probeAiProviders, so the 30 s Overview refresh
 * does not spawn CLI processes every time.
 */

export interface WelcomeContext {
  facts: WelcomeFacts;
  settings: AppSettingsView;
  statuses: Record<AiProviderId, AiProviderStatus>;
  profile: Profile | null;
}

export async function loadWelcomeContext(): Promise<WelcomeContext> {
  const [settings, statuses, profile, jobCount, scoredCount] = await Promise.all([
    getSettings(),
    probeAiProviders(),
    getActiveProfile(),
    prisma.job.count(),
    prisma.job.count({ where: { fitScore: { not: null } } }),
  ]);
  return {
    settings,
    statuses,
    profile,
    facts: {
      aiReady: Object.values(statuses).some((s) => s.ok),
      jobCount,
      profileReady: profile !== null && !isBlankProfile(profile),
      scoredCount,
      setupCompletedAt: settings.setupCompletedAt,
    },
  };
}
