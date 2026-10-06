import { placeName, workplaceName } from '../i18n/places';
import { isProfileWorkplace } from '../location';
import { t } from '../i18n/t';

/*
 * What a search profile hunts, in one line under its name on the Job search
 * tab — so two searches can be told apart without opening the editor. Pure.
 * The roles and the skills are the user's own words (data); the place and the
 * fit are worded here.
 */

/** How many of a list stand in the line before "+N" takes the rest. */
const SHOWN = { roles: 2, skills: 3, places: 2 } as const;

export interface ProfileLineInput {
  roleTypes: readonly string[];
  stackRequired: readonly string[];
  workplace: readonly string[];
  countries: readonly string[];
  regions: readonly string[];
  minFitScore: number;
}

export interface ProfileLine {
  /** Target roles, the user's words; null when none are set. */
  roles: string | null;
  /** Core skills, the user's words; null when none are set. */
  skills: string | null;
  /** "Remote · United States, Canada +1", or "Anywhere". */
  place: string;
  /** "min. fit 70". */
  fit: string;
}

function some(list: readonly string[], shown: number): string | null {
  if (list.length === 0) return null;
  const head = list.slice(0, shown).join(', ');
  return list.length > shown ? `${head} ${t('settings.profileLine.more', { n: list.length - shown })}` : head;
}

export function profileLine(p: ProfileLineInput): ProfileLine {
  const arrangements = p.workplace.filter(isProfileWorkplace).map(workplaceName).join(' / ');
  const where = some([...p.countries, ...p.regions].map(placeName), SHOWN.places) ?? t('settings.profileLine.anywhere');
  return {
    roles: some(p.roleTypes, SHOWN.roles),
    skills: some(p.stackRequired, SHOWN.skills),
    place: arrangements ? `${arrangements} · ${where}` : where,
    fit: t('settings.profileLine.minFit', { n: p.minFitScore }),
  };
}
