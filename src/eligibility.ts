import { countriesOf, groupsOf, placeLabel } from './countries';

/*
 * "Can I apply from where I live" (stage 4, ADR 0033). A search says where
 * it HUNTS (countries / regions — a wish) and, since this stage, where the
 * candidate LIVES (`residence`) and whether they would move (`relocation`).
 * Pure: the vocabulary, the labels, and the one question the stored columns
 * can answer on their own — is this posting open to the place the candidate
 * lives in. Whether a permit, a relocation package or an employer of record
 * changes that is the model's call: it read the posting, we did not.
 */

export const RELOCATION_CODES = ['no', 'yes', 'sponsorship'] as const;

export type RelocationCode = (typeof RELOCATION_CODES)[number];

/** What each choice says, in the words the editor and the prompt use. */
export const RELOCATION_LABEL: Readonly<Record<RelocationCode, string>> = {
  no: 'I stay where I am',
  yes: 'I would relocate',
  sponsorship: 'I would relocate and need visa sponsorship',
};

/** For the prompt — the same three choices, said to the model. */
export const RELOCATION_PROMPT: Readonly<Record<RelocationCode, string>> = {
  no: 'will not relocate',
  yes: 'would relocate, no sponsorship needed',
  sponsorship: 'would relocate but needs visa sponsorship',
};

export function isRelocation(value: unknown): value is RelocationCode {
  return typeof value === 'string' && (RELOCATION_CODES as readonly string[]).includes(value);
}

/** The residence a form field carries: an ISO-2 code, or null when unset. */
export function parseResidence(value: unknown, isCountry: (code: string) => boolean): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return code.length > 0 && isCountry(code) ? code : null;
}

/**
 * Is a posting open to the country the candidate lives in? A posting that
 * names no place at all is open to everyone here — silence is not a refusal,
 * and the model weighs the wording. WORLDWIDE is likewise open.
 */
export function residenceCovered(
  job: { countries: readonly string[]; regions: readonly string[] },
  residence: string | null,
): boolean {
  if (!residence) return true;
  if (job.countries.length === 0 && job.regions.length === 0) return true;
  if (job.regions.includes('WORLDWIDE')) return true;
  if (job.countries.includes(residence)) return true;
  if (job.regions.some((r) => countriesOf(r).includes(residence))) return true;
  // A posting open to a group the residence belongs to (UA ∈ EUROPE, CEE).
  return groupsOf(residence).some((g) => job.regions.includes(g));
}

/** "European Union", "Poland, Germany" — the places a posting names, in words. */
export function placeNames(codes: readonly string[]): string {
  return codes.map(placeLabel).join(', ');
}
