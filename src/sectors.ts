/*
 * The sectors a screening reads (TASKS E6, issue #217). The model writes a
 * role's sector in its own words, and one resume read three times gave
 * "e-commerce/fitness", "fitness/e-commerce" and "e-commerce / fitness" —
 * while the industry criterion "payments technology / fintech" swung between
 * 6.3 years and none on the same text. The words go through one vocabulary:
 * a sector belongs to a group when any of the group's names is in it, so the
 * criterion and the career line read one meaning however a run spelled it.
 * Membership means the same sector named differently — payments and banking
 * are fintech — never a neighbour. A sector the vocabulary does not know
 * keeps its own words. Pure.
 *
 * Shared with the resume side, which reads it for whether a posting's sector
 * is one the resume shows (`resume/domain.ts`, #207) — so it lives outside
 * `src/screening/`, which the worker never imports.
 */

export interface SectorGroup {
  label: string;
  /** Lowercase names, matched as whole words; a trailing plural "s" is ignored on both sides. */
  names: string[];
}

export const SECTORS: readonly SectorGroup[] = [
  { label: 'fintech', names: ['fintech', 'financial technology', 'financial services', 'finance', 'payment', 'banking', 'bank', 'neobank', 'lending', 'credit', 'wealth management', 'investment', 'trading', 'brokerage'] },
  { label: 'insurance', names: ['insurance', 'insurtech'] },
  { label: 'crypto', names: ['crypto', 'cryptocurrency', 'blockchain', 'web3', 'defi'] },
  { label: 'e-commerce', names: ['e-commerce', 'ecommerce', 'online retail', 'marketplace', 'online shop', 'online store', 'd2c', 'direct to consumer'] },
  { label: 'retail', names: ['retail'] },
  { label: 'healthcare', names: ['healthcare', 'health care', 'health tech', 'healthtech', 'health', 'medtech', 'medical', 'clinical', 'hospital', 'telemedicine', 'telehealth', 'digital health'] },
  { label: 'life sciences', names: ['pharma', 'pharmaceutical', 'biotech', 'biotechnology', 'life science'] },
  { label: 'media', names: ['media', 'entertainment', 'publishing', 'news', 'streaming', 'broadcasting', 'music', 'film'] },
  { label: 'gaming', names: ['gaming', 'game', 'video game', 'game development', 'esport'] },
  { label: 'gambling', names: ['gambling', 'igaming', 'betting', 'casino'] },
  { label: 'education', names: ['education', 'edtech', 'e-learning', 'elearning', 'online learning'] },
  { label: 'travel', names: ['travel', 'tourism', 'hospitality', 'airline', 'hotel'] },
  { label: 'logistics', names: ['logistics', 'supply chain', 'shipping', 'delivery', 'freight', 'transportation', 'courier'] },
  { label: 'automotive', names: ['automotive', 'mobility'] },
  { label: 'telecom', names: ['telecom', 'telecommunication', 'telco'] },
  { label: 'advertising', names: ['advertising', 'adtech', 'ad tech', 'marketing', 'martech', 'marketing technology'] },
  { label: 'real estate', names: ['real estate', 'proptech', 'property management'] },
  { label: 'energy', names: ['energy', 'utilities', 'cleantech', 'climate', 'renewable', 'oil and gas'] },
  { label: 'public sector', names: ['government', 'public sector', 'govtech', 'civic'] },
  { label: 'security', names: ['cybersecurity', 'cyber security', 'infosec', 'information security'] },
  { label: 'HR tech', names: ['hr tech', 'hrtech', 'human resources', 'recruiting', 'recruitment', 'staffing'] },
  { label: 'IT services', names: ['it services', 'it service', 'software services', 'software consultancy', 'software consulting', 'software development services', 'outsourcing', 'outstaffing'] },
  { label: 'SaaS', names: ['saas', 'b2b software', 'enterprise software', 'crm', 'erp'] },
  { label: 'manufacturing', names: ['manufacturing', 'industrial'] },
  { label: 'food', names: ['food', 'foodtech', 'restaurant', 'food delivery'] },
  { label: 'fitness', names: ['fitness', 'wellness', 'sports tech'] },
  { label: 'agriculture', names: ['agriculture', 'agritech', 'agtech', 'farming'] },
  { label: 'legal', names: ['legal', 'legaltech', 'law'] },
  { label: 'non-profit', names: ['non-profit', 'nonprofit', 'ngo', 'charity'] },
];

/** Words that name no sector on their own — "software services" and "financial services" share nothing. */
const GENERIC = new Set(['service', 'software', 'technology', 'tech', 'solution', 'system', 'platform', 'product', 'company', 'industry', 'digital', 'online', 'and', 'the', 'for', 'other']);

/** Lowercase words, a trailing plural "s" off each, joined by single spaces with a space either side. */
function words(text: string): string {
  const out = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    // "news", "gas", "business" are not plurals.
    .map((w) => (w.length > 3 && !/(?:ss|us|is|ws)$/.test(w) ? w.replace(/s$/, '') : w));
  return ` ${out.join(' ')} `;
}

const GROUPS = SECTORS.map((g) => ({ label: g.label, names: g.names.map(words) }));

/** The vocabulary's groups a sector names, in the order they appear in it. */
export function sectorGroups(text: string | null | undefined): string[] {
  if (!text) return [];
  const hay = words(text);
  return GROUPS.map((g) => ({ label: g.label, at: Math.min(...g.names.map((n) => (hay.includes(n) ? hay.indexOf(n) : Infinity))) }))
    .filter((g) => g.at !== Infinity)
    .sort((a, b) => a.at - b.at)
    .map((g) => g.label);
}

/** Every name in the vocabulary, longest first: "financial services" is taken out before "service" could be. */
const NAMES = GROUPS.flatMap((g) => g.names).sort((a, b) => b.length - a.length);

/** Words around a sector that name no other thing: "the payments domain", "fintech experience". */
const FRAME = new Set(['the', 'a', 'an', 'or', 'in', 'of', 'domain', 'sector', 'space', 'experience', 'knowledge', 'background']);

/**
 * Is this a sector and nothing else — "payments", "fintech or banking", "the
 * payments domain" — rather than a skill that happens to name one ("payment
 * gateway integration")? The screening draft asks it of a posting's keywords,
 * so the sector is one criterion, not three (#645).
 */
export function isSectorName(text: string): boolean {
  let rest = words(text);
  let named = false;
  for (const name of NAMES) {
    while (rest.includes(name)) {
      rest = rest.replace(name, ' ');
      named = true;
    }
  }
  return named && rest.trim().split(' ').every((w) => w === '' || GENERIC.has(w) || FRAME.has(w));
}

/** How the career line names a role's sector: the vocabulary's labels, or the words as written when it knows none. */
export function sectorLabels(text: string | null | undefined): string[] {
  const groups = sectorGroups(text);
  if (groups.length > 0) return groups;
  const own = text?.trim();
  return own ? [own] : [];
}

/**
 * Whether a role's sector is one the industry criterion asks for. An item the
 * vocabulary knows matches by meaning — a role in "banking" counts for
 * "payments"; an item it does not know matches a shared word, generic ones
 * ("services", "software") aside.
 */
export function sectorMatches(sector: string | null, items: string[]): boolean {
  if (!sector) return false;
  const have = new Set(sectorGroups(sector));
  const own = new Set(words(sector).trim().split(' ').filter((w) => w.length > 2 && !GENERIC.has(w)));
  return items.some((item) => {
    const wanted = sectorGroups(item);
    if (wanted.length > 0) return wanted.some((g) => have.has(g));
    return words(item).trim().split(' ').some((w) => own.has(w));
  });
}
