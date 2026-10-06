/*
 * Who hires (ADR 0056). A vendor board, a feed and a pasted posting ARE the
 * employer; an aggregator carries many and names each in a field of its own,
 * which its fetcher hands over as `NormalizedJob.employer`. This module turns
 * a name into the key a mute and the re-apply window compare, and makes the
 * one decision the tick asks of them. Pure — tested in employer.test.ts.
 */

import { bringsRows, sourceFamily } from './web/source-groups';

/** Longer than any company name a feed sends; a longer field is not a name. */
const MAX_EMPLOYER_CHARS = 120;

/**
 * Legal forms dropped from the END of a name, as the words they normalise to:
 * "Acme, Inc.", "ACME Inc" and "Acme" are one employer. A closed list on
 * purpose — "Acme Labs" and "Acme Group" stay other companies, because a mute
 * that swallowed a different employer would hide postings nobody asked to hide.
 */
const LEGAL_FORMS: readonly (readonly string[])[] = [
  ['inc'], ['incorporated'], ['llc'], ['llp'], ['lp'], ['ltd'], ['limited'], ['corp'], ['corporation'],
  ['co'], ['plc'], ['pte'], ['pty'], ['pvt'], ['gmbh'], ['ag'], ['kg'], ['se'], ['ug'], ['sa'], ['sas'],
  ['sarl'], ['srl'], ['spa'], ['sl'], ['bv'], ['nv'], ['oy'], ['oyj'], ['ab'], ['as'], ['asa'], ['aps'],
  ['kft'], ['zrt'], ['ou'], ['sro'], ['doo'], ['ooo'],
  ['and', 'co'], ['s', 'a'], ['s', 'l'], ['b', 'v'], ['n', 'v'], ['s', 'r', 'l'], ['s', 'p', 'a'],
  ['s', 'r', 'o'], ['d', 'o', 'o'], ['sp', 'z', 'o', 'o'], ['e', 'v'], ['ug', 'haftungsbeschrankt'],
];

/** The name as a feed field gives it, trimmed; null when it says nothing. */
export function cleanEmployer(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  return name.length > 0 && name.length <= MAX_EMPLOYER_CHARS ? name : null;
}

function endsWith(words: readonly string[], form: readonly string[]): boolean {
  return words.length > form.length && form.every((w, i) => words[words.length - form.length + i] === w);
}

/**
 * The key two spellings of one company share: accents and case folded, `&`
 * read as "and", punctuation gone, a leading "the" and the trailing legal
 * forms dropped. Null for a name with no letters or digits in it. Not fuzzy:
 * a key never merges two names that differ in a word of their own.
 */
export function employerKey(name: string): string | null {
  let words = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 0);
  if (words.length > 1 && words[0] === 'the') words = words.slice(1);
  for (;;) {
    const form = LEGAL_FORMS.filter((f) => endsWith(words, f)).sort((a, b) => b.length - a.length)[0];
    if (!form) break;
    words = words.slice(0, words.length - form.length);
  }
  return words.length > 0 ? words.join(' ') : null;
}

/** "Hiring company: Acme Inc.." — the line the aggregators' fetchers write at the top of a description. */
const HIRING_LINE = /(?:^|\s)Hiring company: (.{1,120}?)\.(?=\s|$)/;
/** HN's "Company: Acme · Location: …" head (fetchers/hn-hiring.ts:buildDescription). */
const HN_LINE = /^Company: (.{1,120}?)(?: · |\n|$)/;

/**
 * The employer a stored aggregator row named in its description, for the rows
 * written before `Job.employer` existed (init.ts fills them once). New rows
 * carry the fetcher's own field and never come through here.
 */
export function employerFromDescription(description: string): string | null {
  const head = description.slice(0, 600);
  return cleanEmployer(HIRING_LINE.exec(head)?.[1] ?? HN_LINE.exec(head)?.[1] ?? null);
}

/**
 * A vendor board, the user's own feed or careers page, a pasted posting: the
 * source IS who hires. Everything else carries many employers. MANUAL is named
 * here because `sourceFamily` files it with the aggregators, which is right for
 * the Settings grid and wrong for this question — and so are the rows the user
 * brings (ADR 0062), which sit with their own sources and hold many employers.
 */
export function sourceIsEmployer(atsType: string): boolean {
  return atsType === 'MANUAL' || (sourceFamily(atsType) !== 'aggregator' && !bringsRows(atsType));
}

/** Who hires, as a page names them: the aggregator's employer, else the source when it is the employer; null when nobody said. */
export function hiringName(employer: string | null, source: { name: string; atsType: string }): string | null {
  return employer ?? (sourceIsEmployer(source.atsType) ? source.name : null);
}

/**
 * Whose key a row carries: the aggregator's named employer, else the source
 * itself — unless the source is an aggregator that did not say, which is
 * nobody we can mute (its own name would mute the whole feed).
 */
export function hiringKey(employer: string | null | undefined, sourceName: string, aggregator: boolean): string | null {
  if (employer) return employerKey(employer);
  return aggregator ? null : employerKey(sourceName);
}

/** Why the tick turns a posting away before the AI reads it; the funnel counts each (funnel.ts). */
export const EMPLOYER_GATES = ['muted', 'applied'] as const;
export type EmployerGate = (typeof EMPLOYER_GATES)[number];

export interface EmployerRules {
  /** The keys the user muted. */
  muted: ReadonlySet<string>;
  /** Keys with an application inside the re-apply window; empty when the window is off. */
  appliedRecently: ReadonlySet<string>;
}

/**
 * A mute turns a posting away whatever else holds; the re-apply window does
 * not apply to a watched company that asked for every posting — the watch is
 * the more specific instruction (ADR 0036). A posting whose employer is
 * unknown passes: there is nothing to match.
 */
export function employerGate(key: string | null, rules: EmployerRules, everyPosting = false): EmployerGate | null {
  if (key === null) return null;
  if (rules.muted.has(key)) return 'muted';
  if (!everyPosting && rules.appliedRecently.has(key)) return 'applied';
  return null;
}

/**
 * The rows of muted companies out of a query: `employerKey IS NULL OR NOT IN
 * (…)`, because NOT IN alone drops every NULL row with them. Null when
 * nothing is muted — no clause at all.
 */
export function withoutMuted(keys: readonly string[]): { OR: ({ employerKey: null } | { employerKey: { notIn: string[] } })[] } | null {
  return keys.length > 0 ? { OR: [{ employerKey: null }, { employerKey: { notIn: [...keys] } }] } : null;
}

/** The re-apply window's choices, in days; null is off. */
export const REAPPLY_CHOICES = [30, 60, 90, 180] as const;

export function isReapplyChoice(days: number): boolean {
  return (REAPPLY_CHOICES as readonly number[]).includes(days);
}
