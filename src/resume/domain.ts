import type { MatchAction, PostingBrief } from './prompts';

/*
 * The employer's domain, read off the brief (ADR 0044), and whether the
 * advice is written in it.
 *
 * The brief already names the sector, the product and the audience for 118
 * of the 126 postings on the live corpus; what was not known was whether the
 * suggestions used any of it. Counted on the stored rows before the rule
 * existed: 129 of 281 high-priority actions carried a word of the employer's
 * domain — "for an international client base", "e-commerce checkout" — and
 * 152 did not. This is that count, so the prompt rule that asks for the lean
 * has a number to move, and `variance:compare` prints it per run.
 *
 * Pure. Words, not facts: a bullet that says "restaurant" about work the
 * resume did for restaurants is the lean; one that says it about work the
 * resume did not do is a claim, and the fact-check gate is where that is
 * caught, not here.
 */

/** Words every software employer's description uses, which therefore say nothing about the domain. */
const GENERIC = new Set([
  'and', 'for', 'the', 'its', 'our', 'their', 'that', 'this', 'from', 'with', 'into', 'over', 'via', 'who', 'what',
  'software', 'platform', 'platforms', 'solution', 'solutions', 'service', 'services', 'application', 'applications',
  'app', 'apps', 'web', 'mobile', 'digital', 'custom', 'development', 'product', 'products', 'company', 'companies',
  'business', 'businesses', 'client', 'clients', 'customer', 'customers', 'user', 'users', 'team', 'teams',
  'technology', 'technologies', 'tech', 'online', 'global', 'international', 'internationally', 'based', 'enabled',
  'driven', 'needing', 'across', 'unknown', 'startup', 'scale', 'enterprise', 'agency', 'house', 'stage',
  'people', 'world', 'market', 'markets', 'provider', 'providers', 'tools', 'tool', 'system', 'systems', 'data',
]);

const MIN_CHARS = 3;

/** The domain words of a brief: sector, product and audience, minus the generic ones. */
export function domainVocabulary(brief: Pick<PostingBrief, 'company'> | null | undefined): string[] {
  if (!brief) return [];
  const { industry, product, audience } = brief.company;
  const words = `${industry ?? ''} ${product ?? ''} ${audience ?? ''}`
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length >= MIN_CHARS && !GENERIC.has(w));
  return [...new Set(words)];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when the wording carries a domain word — as a whole word, plurals and inflections included. */
export function inDomain(wording: string | null | undefined, vocabulary: string[]): boolean {
  if (!wording || vocabulary.length === 0) return false;
  const text = wording.toLowerCase();
  return vocabulary.some((w) => new RegExp(`(?<![a-z0-9])${escapeRegex(w)}`).test(text));
}

export interface LeanCount {
  /** Actions with wording that carry a domain word. */
  hits: number;
  /** Actions with wording. */
  total: number;
}

export interface DomainLean {
  vocabulary: string[];
  high: LeanCount;
  all: LeanCount;
}

/** How much of the advice is written in the employer's domain, high-priority actions singled out. */
export function domainLean(actions: MatchAction[], brief: Pick<PostingBrief, 'company'> | null | undefined): DomainLean {
  const vocabulary = domainVocabulary(brief);
  const count = (rows: MatchAction[]): LeanCount => {
    const worded = rows.filter((a) => typeof a.replacement === 'string' && a.replacement.trim() !== '');
    return { hits: worded.filter((a) => inDomain(a.replacement, vocabulary)).length, total: worded.length };
  };
  return { vocabulary, high: count(actions.filter((a) => a.priority === 'high')), all: count(actions) };
}
