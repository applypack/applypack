import type { MatchAction, PostingBrief } from './prompts';
import { sectorGroups } from '../sectors';
import { t } from '../i18n/t';

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
 * since the field existed, a posting whose brief names no sector — and
 * nothing is said. An employer that serves every sector (an agency, a
 * consultancy, a software house) has no sector for the candidate to lack.
 *
 * Two sides meet on a shared word or on a sector of the vocabulary the
 * screening reads too (`src/sectors.ts`, #207): "healthcare" and "healthtech",
 * "banking" and "fintech" are one sector spelled twice.
 */

export type DomainVerdict = 'match' | 'different' | 'unknown';

export interface DomainReport {
  verdict: DomainVerdict;
  /** The scan's sectors, as stored. */
  resume: string[];
  /** The brief's industry as stored, or its product when that is where the sector is named. */
  posting: string | null;
}

const SERVES_ANY_SECTOR = /\b(agenc(?:y|ies)|consultanc(?:y|ies)|consulting|software house|staffing|outsourc\w*|freelanc\w*|studio)\b/i;

/**
 * Sectors the vocabulary keeps apart on purpose — the screening's criterion
 * asks for one of them — that this verdict reads as one: an e-commerce resume
 * is not in another sector from a retailer's posting.
 */
const SAME_SECTOR_HERE: Record<string, string> = { retail: 'e-commerce' };

/** The vocabulary's sectors named anywhere in the texts. */
function sectorsIn(texts: (string | null | undefined)[]): Set<string> {
  return new Set(texts.flatMap((text) => sectorGroups(text)).map((g) => SAME_SECTOR_HERE[g] ?? g));
}

/** The domain words of one side, comparable with the other's — a plural folded to its stem. */
function stems(text: string): string[] {
  return domainVocabulary({ company: { industry: text, product: null, audience: null, stage: null } }).map((w) =>
    w.replace(/s$/, ''),
  );
}

/**
 * Where the brief names the posting's sector: its industry, or, when that is
 * empty, its product — but only a product the vocabulary finds a sector in.
 * "AI order taking for restaurants" names one; "an analytics dashboard" names
 * none, and a guess there would put a wrong sentence on the page.
 */
function postingSector(company: PostingBrief['company'] | undefined): string | null {
  const industry = company?.industry?.trim();
  if (industry) return industry;
  const product = company?.product?.trim();
  return product && sectorGroups(product).length > 0 ? product : null;
}

export function domainMismatch(industries: string[], brief: Pick<PostingBrief, 'company'> | null | undefined): DomainReport {
  const resume = industries.map((s) => s.trim()).filter(Boolean);
  const company = brief?.company;
  const posting = postingSector(company);
  if (resume.length === 0 || !company || posting === null) return { verdict: 'unknown', resume, posting };
  if (SERVES_ANY_SECTOR.test(posting)) return { verdict: 'match', resume, posting };
  const theirWords = new Set(domainVocabulary(brief).map((w) => w.replace(/s$/, '')));
  const theirSectors = sectorsIn([company.industry, company.product, company.audience]);
  const shared = (sector: string) =>
    stems(sector).some((w) => theirWords.has(w)) || [...sectorsIn([sector])].some((g) => theirSectors.has(g));
  return { verdict: resume.some(shared) ? 'match' : 'different', resume, posting };
}

/** A sentence of ours with the sectors the models named inside it, in `<en>` (ADR 0061). */
export interface DomainNotice {
  key: 'target.domain.notice';
  params: { posting: string; shown: string };
}

/** The sentence the target page shows, as its message — null unless the sectors differ. */
export function domainNoticeMessage(report: DomainReport): DomainNotice | null {
  if (report.verdict !== 'different' || report.posting === null) return null;
  // The scan's order, most recent first. "Closest to the posting first" would
  // reorder nothing: a sector that shares a word or a sector with the posting's
  // makes the verdict `match`, and then there is no sentence at all (#207).
  const shown = report.resume.slice(0, 3).join(', ');
  return { key: 'target.domain.notice', params: { posting: report.posting, shown } };
}

/** The same sentence as text. */
export function domainNotice(report: DomainReport): string | null {
  const message = domainNoticeMessage(report);
  return message && t(message.key, message.params);
}
