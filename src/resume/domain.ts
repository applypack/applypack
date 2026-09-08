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

/*
 * The candidate's sectors against the posting's (ADR 0046). "different" is
 * the one verdict that does anything: the target page says it in a sentence,
 * and both prompts are told to reframe transferable work rather than claim
 * the sector. "unknown" when either side is empty — a resume not scanned
 * since the field existed, a posting whose brief names no industry — and
 * nothing is said. An employer that serves every sector (an agency, a
 * consultancy, a software house) has no sector for the candidate to lack.
 */

export type DomainVerdict = 'match' | 'different' | 'unknown';

export interface DomainReport {
  verdict: DomainVerdict;
  /** The scan's sectors, as stored. */
  resume: string[];
  /** The brief's industry, as stored. */
  posting: string | null;
}

const SERVES_ANY_SECTOR = /\b(agenc(?:y|ies)|consultanc(?:y|ies)|consulting|software house|staffing|outsourc\w*|freelanc\w*|studio)\b/i;

/** The domain words of one side, comparable with the other's — a plural folded to its stem. */
function stems(text: string): string[] {
  return domainVocabulary({ company: { industry: text, product: null, audience: null, stage: null } }).map((w) =>
    w.replace(/s$/, ''),
  );
}

export function domainMismatch(industries: string[], brief: Pick<PostingBrief, 'company'> | null | undefined): DomainReport {
  const resume = industries.map((s) => s.trim()).filter(Boolean);
  const posting = brief?.company.industry?.trim() || null;
  if (resume.length === 0 || posting === null) return { verdict: 'unknown', resume, posting };
  if (SERVES_ANY_SECTOR.test(posting)) return { verdict: 'match', resume, posting };
  const theirs = new Set(domainVocabulary(brief).map((w) => w.replace(/s$/, '')));
  const overlap = resume.some((sector) => stems(sector).some((w) => theirs.has(w)));
  return { verdict: overlap ? 'match' : 'different', resume, posting };
}

/** The sentence the target page shows — null unless the sectors differ. */
export function domainNotice(report: DomainReport): string | null {
  if (report.verdict !== 'different' || report.posting === null) return null;
  const shown = report.resume.slice(0, 3).join(', ');
  return `This posting is in ${report.posting}; your resume shows ${shown}. The suggestions reframe transferable work in the employer's terms — they do not claim experience in ${report.posting}.`;
}
