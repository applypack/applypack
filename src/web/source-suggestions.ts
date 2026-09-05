import { prisma } from '../db';
import { getSourceKeys } from '../settings';
import { unlockedSources } from '../source-keys';
import { listActiveProfiles } from '../profiles';
import { isBlankProfile } from '../profile-guards';
import { suggestSources, type SourceSuggestion } from '../starter-packs/suggest';

/**
 * The token-driven feeds the running searches call for, with their state on
 * this install — read by /companies, by the wizard's sources step and by the
 * profile-save flash (#148), so all three agree on the list.
 */
export async function currentSuggestions(): Promise<SourceSuggestion[]> {
  const [tracked, profiles, keys] = await Promise.all([
    prisma.company.findMany({ select: { id: true, atsType: true, atsToken: true, active: true } }),
    listActiveProfiles(),
    getSourceKeys(),
  ]);
  return suggestSources(profiles.filter((p) => !isBlankProfile(p)), tracked, { unlocked: unlockedSources(keys) });
}

/** The ones a single press would turn on: not tracked yet, or tracked and switched off. */
export function waitingSuggestions(suggestions: readonly SourceSuggestion[]): SourceSuggestion[] {
  return suggestions.filter((s) => s.state !== 'on');
}
