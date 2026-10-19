import type { Profile } from '@prisma/client';
import { isCountryCode, isRegionCode, resolveCountries } from '../countries';
import { isRelocation, parseResidence } from '../eligibility';
import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';
import { isProfileWorkplace } from '../location';
import { parsePriorityRulesText } from '../priority-rules';
import type { ProfileInput } from '../profiles';
import { parseTagList, toStringArray } from '../text-utils';

/*
 * The search editor's body read back for the editor (#549): a save the route
 * refuses renders the form again with what was sent, so nothing typed is lost.
 * Pure. Every field is read leniently — a value the save would refuse is kept
 * as typed where the editor can show it, and the stored one where it cannot.
 */

/** What the editor shows for a refused save. */
export interface SentProfile {
  /** The stored search with every field the form sent laid over it. */
  profile: Profile;
  /** The countries as typed, the ones no gazetteer entry names included. */
  countries: string[];
  /** The score adjustments as typed, a line the save refused included. */
  priorityRules: string;
}

export function sentProfile(stored: Profile, form: Readonly<Record<string, unknown>>): SentProfile {
  const text = (name: string): string => toStringArray(form[name]).join('\n');
  const tags = (name: string): string[] => parseTagList(text(name));
  const countries = tags('countries');
  const priorityRules = text('priorityRules');
  // The compiler names this literal when the search gains a field: a refused save may not drop it.
  const input: ProfileInput = {
    name: text('name'),
    stackRequired: tags('stackRequired'),
    roleTypes: tags('roleTypes'),
    stackNiceToHave: tags('stackNiceToHave'),
    stackExclude: tags('stackExclude'),
    notes: text('notes'),
    seniority: toStringArray(form.seniority),
    countries: resolveCountries(countries).codes,
    regions: toStringArray(form.regions).filter(isRegionCode),
    workplace: toStringArray(form.workplace).filter(isProfileWorkplace),
    residence: parseResidence(form.residence, isCountryCode),
    relocation: isRelocation(form.relocation) ? form.relocation : 'no',
    onsiteCities: tags('onsiteCities'),
    minSalaryUsd: wholeNumber(text('minSalaryUsd')) ?? stored.minSalaryUsd,
    minFitScore: wholeNumber(text('minFitScore')) ?? stored.minFitScore,
    notificationTargetId: rowId(text('notificationTargetId')),
    resumeId: rowId(text('resumeId')),
    priorityRules: parsePriorityRulesText(priorityRules).rules,
  };
  return { profile: { ...stored, ...input }, countries, priorityRules };
}

function wholeNumber(value: string): number | null {
  const n = Number(value);
  return value.trim() !== '' && Number.isInteger(n) ? n : null;
}

/** A `<select>` of row ids: "" (its "none" option) is null. */
function rowId(value: string): number | null {
  const n = wholeNumber(value);
  return n !== null && n > 0 ? n : null;
}

/** The editor's own label for a field the save's schema can refuse; the rest keep their names. */
const FIELD_LABEL: Readonly<Record<string, MessageKey>> = {
  name: 'settings.name',
  notes: 'settings.notesForTheClassifier',
  minFitScore: 'settings.minFitScore0100',
  minSalaryUsd: 'settings.minSalaryUsdYear',
};

/** A refused field as the editor labels it ("Min fit score (0-100)"), or undefined for one it does not name. */
export function profileFieldLabel(field: string): string | undefined {
  const key = FIELD_LABEL[field];
  return key ? t(key) : undefined;
}
