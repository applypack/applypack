import type { Profile } from '@prisma/client';
import { isCountryCode, isRegionCode, resolveCountries } from '../countries';
import { isRelocation, parseResidence } from '../eligibility';
import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';
import { isProfileWorkplace } from '../location';
import { parsePriorityRulesText } from '../priority-rules';
import { isBlankProfile, type GuardableProfile } from '../profile-guards';
import type { ProfileInput } from '../profiles';
import { parseLineList, parseTagList, toStringArray } from '../text-utils';
import { SENIORITY_LEVELS } from '../resume/profile-draft';
import { z } from 'zod';

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
    onsiteCities: parseLineList(text('onsiteCities')),
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
  roleTypes: 'settings.roleTypes',
  seniority: 'settings.seniority',
  stackRequired: 'settings.techStackRequired',
  stackNiceToHave: 'settings.stackNiceToHave',
  notes: 'settings.notesForTheClassifier',
  onsiteCities: 'settings.onSiteCitiesOkTo',
  minFitScore: 'settings.minFitScore0100',
  minSalaryUsd: 'settings.minSalaryUsdYear',
  stackExclude: 'settings.stackExcludeAutoRejectIn',
};

/** A refused field as the editor labels it ("Minimum fit score (0–100)"), or undefined for one it does not name. */
export function profileFieldLabel(field: string): string | undefined {
  const key = FIELD_LABEL[field];
  return key ? t(key) : undefined;
}

/**
 * What "Save & re-classify" asks before it spends anything (#562): how many
 * jobs it reads again, then what a call costs on the engine that answers
 * (`web/cost-hint.ts:spendHint`) — nothing about cost when there is no job.
 */
export function reclassifyQuestion(jobs: number, cost: string): string {
  return jobs > 0 && cost ? `${t('settings.reclassifyConfirm', { n: jobs })} ${cost}` : t('settings.reclassifyConfirm', { n: jobs });
}

/** A search's fit threshold when the form leaves the field out. */
const DEFAULT_MIN_FIT = 70;

/**
 * "Minimum fit score" as the save reads it (#682): emptied is refused, never
 * read as 0 — 0 let every scored posting through the alert floor. A form
 * without the field (the wizard's) still gets the default.
 */
export const minFitField = z.preprocess(
  (v) => v ?? String(DEFAULT_MIN_FIT),
  z.string().trim().min(1, { error: () => t('flash.issue.required') }).transform(Number).pipe(z.number().int().min(0).max(100)),
);

/** The highest minimum salary the editor takes, in USD a year: past it nothing is filtered, and the column is a 32-bit integer (#646). */
export const MAX_MIN_SALARY_USD = 10_000_000;

/** "Minimum salary" as the save reads it: whole dollars, emptied is 0 (no filter), past the ceiling refused — never a 500. */
export const minSalaryField = z.coerce.number().int().min(0).max(MAX_MIN_SALARY_USD).default(0);

/** The seniority pills: the levels the editor offers and no other, so nothing reaches the prompt that the editor cannot show (#646). */
export const seniorityField = z.preprocess(
  (v) => toStringArray(v),
  z.array(z.enum(SENIORITY_LEVELS)).transform((levels) => [...new Set(levels)]),
);

/** Entries in one list of a search, and characters in one entry: the classifier's prompt reads every one (#646). */
const MAX_TAGS = 50;
const MAX_TAG_CHARS = 80;

/** One entry per term, whatever its case: the first spelling is kept. */
function uniqueTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const listField = (split: (text: string) => string[]) =>
  z
    .string()
    .optional()
    .default('')
    .transform((text) => uniqueTags(split(text)))
    .pipe(z.array(z.string().max(MAX_TAG_CHARS)).max(MAX_TAGS));

/** A tag list (core skills, preferred skills, title words) as the save reads it: a repeat dropped, past the limits refused rather than cut. */
export const tagListField = listField(parseTagList);

/** The commute cities, one a line, under the same limits. */
export const lineListField = listField(parseLineList);

/**
 * The search "+ New search" opens instead of making another (#646): a paused
 * one with nothing to match on — it cannot run until it is filled in, so a
 * second press, a resubmit or an old tab gets the same blank, never a pile of
 * them. Null when there is none.
 */
export function blankSearchToReuse(searches: readonly (GuardableProfile & { id: number; active: boolean })[]): number | null {
  return searches.find((search) => !search.active && isBlankProfile(search))?.id ?? null;
}
