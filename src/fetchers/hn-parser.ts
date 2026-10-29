/**
 * Pure HN comment parser. Extracts the (company, role, location, url)
 * tuple from a Who-is-hiring comment. Returns null when no structure
 * can be found — caller skips the comment.
 *
 * Most comments open with a header line of fields, in no fixed order
 * (#660). Formats in the October 2026 thread:
 *   "Company | Role | Location | Type | $$ | URL"
 *   "Company | Location | Type | Role"
 *   "Company ( https://… ) | Type | Location"   (the roles listed below)
 *   "Company (Remote US) — Role — Tech / Tech / Tech"
 *   "Role | Type | Remote | $X-$Y - URL"   (no company in front)
 *   "Company is hiring a Role: …"
 * Read by position, 65 of its 240 titles were a place or "Full Time". So
 * the first field is the company, and every other field is recognised by
 * what it is: a link, pay, a role, a place, a count of roles, a line of
 * work — in that order, read outside its brackets and without its
 * employment-type words, because a role may carry its pay or name a city
 * ("Engineering Manager (NYC, Hybrid)") and "Full-time / Remote" is a place.
 */

import { parseLocation } from '../location';
import { titleHasKeyword } from '../filter';

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/i;
const URLS_RE = new RegExp(URL_RE.source, 'gi');
/** A field that is a bare address or a mail address: "tahoma.io", "startuphakk.com/jobs", "galen@typify.dev". */
const ADDRESS_RE = /^(?:[\w.+-]+@)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?$/i;
// Pipes and em-dashes with or without spaces — HN comments routinely write
// "Foo|Bar". An en-dash only between spaces: bare, it is the range sign of
// the salaries these comments carry ("$120–160k"), and splitting on it put
// half a salary in the title or the location (audit FETCH-5).
const SEPARATOR_RE = /\s*[—|]\s*|\s+–\s+/g;
// Case-sensitive on the company match (capital first letter) but the verbs
// are written lowercase in essentially every HN comment. No /i flag here —
// adding it would make [A-Z] match lowercase too and break "we are hiring".
// The optional "We at" / "We @" prefix peels pronoun framing off the front.
// Period is allowed (for "Acme Inc.") but the length cap is tight (30) so
// runaway matches across sentence boundaries are rejected on length alone.
const HIRING_RE =
  /(?:^|\s)(?:[Ww]e\s+(?:at|@|here\s+at)\s+)?([A-Z][\w&. ]{1,30}?)\s+(?:is|are)\s+hiring\b/;
// If the regex still picks up a bare pronoun via a later anchor, we drop it.
const PRONOUN_BLOCKLIST = new Set([
  'We',
  'I',
  'Our',
  'They',
  'Us',
  'My',
  'The',
  'This',
  'That',
]);

/**
 * The header is the comment's first line. A poster who wrote no line break
 * ran it into the prose: it stops at the first sentence end past 50 chars,
 * or at 250.
 */
const HEADER_MAX_CHARS = 250;
const HEADER_MIN_CHARS = 50;
/** "world. We", "SF. We": a word, its full stop, a capital. Not "U.S. Eastern", "equity... SF" or "Sr. Engineer". */
const SENTENCE_END_RE = /(?<![\p{L}\p{N}.])([\p{L}\p{N}]{2,})[.!?]\s+(?=\p{Lu})/gu;
const ABBREVIATIONS: ReadonlySet<string> = new Set(['sr', 'jr', 'inc', 'co', 'corp', 'ltd', 'st', 'dr', 'mr', 'ms', 'mrs', 'vs', 'etc', 'no']);

/**
 * Words that make a field a job title, matched as `filter.ts` matches a
 * search's keywords: whole words, plurals and "Leader" included. Words
 * ending in "-ing" are taken out first, since that matcher also reads
 * "engineer" in "Engineering" and "lead" in "a leading firm" — a line of
 * work, not a role. The first field is the company unless it names one of
 * these: "Software Engineer — Remote — US Only".
 */
const ROLE_NOUNS = [
  'engineer', 'eng', 'developer', 'dev', 'programmer', 'architect', 'designer', 'scientist', 'researcher', 'analyst',
  'manager', 'director', 'head of', 'lead', 'president', 'vp', 'chief', 'officer', 'ceo', 'coo', 'cfo', 'cto',
  'specialist', 'consultant', 'expert', 'recruiter', 'writer', 'editor',
  'technologist', 'technician', 'administrator', 'advocate', 'executive', 'representative', 'coordinator',
  'strategist', 'marketer', 'trainer', 'instructor', 'intern', 'phd', 'swe', 'sre', 'sdet', 'mts', 'fde',
  'technical staff',
] as const;
/** A level names a role in a header field ("Senior PHP"); in a line of prose it does not ("Senior candidates welcome"). */
const HEADER_ROLE_WORDS = [...ROLE_NOUNS, 'senior', 'junior', 'staff', 'principal'];
/** Below the header the CTO is who writes ("Formerly co-founder & CTO @ StrongDM"), not a role. */
const BODY_ROLE_NOUNS = ROLE_NOUNS.filter((k) => k !== 'cto');
const ING_WORD_RE = /\p{L}+ing(?!\p{L})/giu;
/** A name with a dot inside is an address or a product, never a role: "Typify.dev", "Node.js". */
const DOTTED_RE = /[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;

/** "Multiple Roles", "Multiple positions": a title only when nothing names the role itself. */
const ROLE_COUNTS = ['roles', 'positions', 'openings', 'vacancies'] as const;

/**
 * A line of work ("design, engineering, GTM, sales", "Software
 * Engineering"): the title of last resort. It never takes the company's
 * place — "Shield AI" and "Product Hunt" are companies.
 */
const ROLE_AREAS = [
  'engineering', 'design', 'product', 'research', 'sales', 'marketing', 'growth', 'operations', 'gtm',
  'go-to-market', 'infrastructure', 'infra', 'devops', 'security', 'machine learning', 'ml', 'ai',
  'data science', 'full-stack', 'frontend', 'backend', 'mobile', 'qa', 'support', 'customer success',
] as const;

/**
 * A sentence, not a field: "Sumble is the newco from…", "…and we sponsor
 * visas". "us" and a bare "I" are left out: "Remote (US)", "Software Engineer I".
 */
const PROSE_RE =
  /(?<![\p{L}'’])(?:we|we're|we’re|we've|we’ve|our|you|you'll|you’ll|your|i'm|i’m|my|is|are|was|were|has|have|had)(?![\p{L}'’])/iu;

/** What a poster pays: a currency sign or code beside a figure, "k", an hourly rate, the words for it. */
const PAY_RE =
  /[$€£¥₹]\s?\d|\d\s?[$€£]|\b\d+(?:[.,]\d+)?\s?k\b|\b(?:usd|eur|gbp|chf|cad|pln|sek|nok|dkk|aud|inr)\b|\/\s?(?:hr|hour|h|month|mo|year|yr)\b|\b(?:salary|salaries|compensation|comp|ote|bonus|stipend|commission)\b/i;

/**
 * Employment types: "Full-time", "FT", "Contract", "B2B", "interns/co-ops".
 * Taken out before the role words are read, so "Full time, interns/co-ops"
 * is a type and "Part-time B2B Sales Lead" a role.
 */
const TYPE_RE =
  /(?<![\p{L}\p{N}])(?:full[- ]?time|part[- ]?time|ft|pt|contract(?:or|s)?|freelance(?:r)?|permanent|perm|temporary|internships?|interns|co-?ops?|b2b|1099|w-?2|cdi|cdd|employment|employee)(?![\p{L}\p{N}])/giu;

/** How the prose a poster ran the header into opens: "We…", "I'm Alex…", "At Shepherd…". */
const PROSE_OPENERS = "(?:My|We|We're|We’re|We've|We’ve|I|I'm|I’m|Our|Hi|Hello|At)\\s";
/** A note in brackets. What a field is, it says outside them. */
const BRACKETED_RE = /\([^()]*\)|\[[^[\]]*\]/g;

/** "Role: Head of Robotics", "Location: Berlin" — the label is not the value. */
const LABEL_RE = /^(?:roles?|positions?|title|locations?)\s*:\s*/i;

/** An employment type, a stack, a note ("VISA", "Series A") is 'other': none of them is read. */
type FieldKind = 'address' | 'role' | 'pay' | 'place' | 'count' | 'area' | 'other';

/**
 * A header that names no role often lists them below, one a line: "-
 * Senior DevSecOps Engineer - https://…", "* Sr Software Engineer,
 * Full-Stack: https://…", "[1]Customer Support Engineer • Poland". A line
 * gives one: the first stretch before a link, a colon, a bracket or a dash
 * that is short, names a role and is no sentence.
 */
const BODY_LINES = 30;
const BODY_ROLES_MAX = 5;
const BODY_ROLE_MAX_WORDS = 8;
const BULLET_RE = /^(?:[-*•·]|\d{1,2}[.)\]]|\[\d{1,2}\])\s*/u;
const PIECE_SPLIT_RE = new RegExp(`${URL_RE.source}|\\s[*•]\\s`, 'gi');
const ROLE_NAME_END_RE = /\s*[:|([]\s*|\s+[-–—]+>?\s+|\s(?=[$€£])|(?<=\p{Ll}{2})[.!?]\s+(?=\p{Lu})/u;
/** Punctuation around a name: "--> ", "). ", a trailing comma. "C++" and "C#" keep theirs. */
const EDGE_RE = /^[^\p{L}\p{N}]+|(?<![+#])[^\p{L}\p{N}+#]+$/gu;

export interface HnParsedComment {
  title: string;
  companyName: string | null;
  location: string | null;
  url: string | null;
  /** Up to ~1000 chars of cleaned plaintext for downstream classification. */
  rawText: string;
}

/** `text` is `stripHtml` output: the header is its first line. */
export function parseHnComment(text: string): HnParsedComment | null {
  if (!text || typeof text !== 'string') return null;
  const cleaned = collapseWhitespace(text);
  if (cleaned.length === 0) return null;

  const header = takeHeader(text);
  const url = extractUrl(cleaned);
  const rawText = cleaned.slice(0, 1000);

  // 1. Fields split on pipes / em-dashes — by far the most common format.
  const fields = splitFields(header);
  if (fields.length >= 2) {
    const labelled = labelFields(fields, text);
    if (labelled) return { ...labelled, url, rawText };
  }

  // 2. Try "Company is hiring" pattern.
  const m = HIRING_RE.exec(cleaned);
  if (m && m[1]) {
    const company = m[1].trim();
    const spansSentence = /\.\s/.test(company); // "Kaggle. We" → reject
    if (!PRONOUN_BLOCKLIST.has(company) && !spansSentence) {
      return {
        title: extractRoleAfterHiring(cleaned) ?? header.slice(0, 120),
        companyName: company,
        location: null,
        url,
        rawText,
      };
    }
  }

  // 3. No recognisable structure → bail. Caller can choose to skip.
  return null;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function takeHeader(text: string): string {
  const line = collapseWhitespace(text.split('\n').find((l) => l.trim().length > 0) ?? '');
  const slice = line.slice(0, HEADER_MAX_CHARS);
  const end = [...slice.matchAll(SENTENCE_END_RE)].find(
    (m) => m.index! > HEADER_MIN_CHARS && !ABBREVIATIONS.has(m[1]!.toLowerCase()),
  );
  return end ? slice.slice(0, end.index! + end[1]!.length + 1) : slice;
}

function splitFields(line: string): string[] {
  return line
    .split(SEPARATOR_RE)
    .map((f) => f.trim().replace(LABEL_RE, ''))
    .filter((f) => f.length > 0);
}

function labelFields(fields: string[], text: string): Omit<HnParsedComment, 'url' | 'rawText'> | null {
  const first = fields[0]!;
  const leadsWithRole = kindOf(first) === 'role';
  const company = leadsWithRole || PROSE_RE.test(first) ? null : companyOf(first);
  const rest = leadsWithRole ? [...fields] : fields.slice(1);
  if (rest.length > 0) rest.push(cutRunOn(rest.pop()!, company?.name ?? null));
  const kinds = rest.map(kindOf);
  // A link is never a title (#541), and neither is a place, a type or pay (#660).
  const titled = (kind: FieldKind): string[] => rest.filter((f, i) => kinds[i] === kind && !URL_RE.test(f));

  let titles = titled('role');
  if (titles.length === 0) titles = rolesInBody(text);
  if (titles.length === 0) titles = [...titled('count'), ...titled('area')].slice(0, 1);
  if (titles.length === 0) return null;

  const places = rest.filter((_, i) => kinds[i] === 'place').map(withoutLinks);
  const location = places.length > 0 ? places.join(' · ') : (company?.place ?? null);
  return { companyName: company?.name ?? null, title: titles.join(' · '), location };
}

function kindOf(field: string): FieldKind {
  const words = withoutLinks(field);
  if (!/\p{L}/u.test(words) || ADDRESS_RE.test(words)) return 'address';
  // What a field is, it says outside its brackets: "AI Engineer (£30/hr)" is
  // a role, "REMOTE (US+INTL for eng)" a place, "FOUNDER-LEVEL EQUITY" pay.
  const unbracketed = words.replace(BRACKETED_RE, ' ');
  const outside = /\p{L}/u.test(unbracketed) ? unbracketed : words;
  if (PAY_RE.test(outside)) return 'pay';
  if (namesRole(outside, HEADER_ROLE_WORDS)) return 'role';
  if (parseLocation(words).source !== null) return 'place';
  if (hasAny(words, ROLE_COUNTS)) return 'count';
  return hasAny(words.replace(TYPE_RE, ' '), ROLE_AREAS) ? 'area' : 'other';
}

function namesRole(words: string, nouns: readonly string[]): boolean {
  if (PROSE_RE.test(words)) return false;
  return hasAny(words.replace(DOTTED_RE, ' ').replace(TYPE_RE, ' ').replace(ING_WORD_RE, ' '), nouns);
}

function hasAny(text: string, words: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((k) => titleHasKeyword(lower, k));
}

function withoutLinks(field: string): string {
  return field.replace(URLS_RE, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The last field of a header the poster ran on into the prose, without the
 * prose — which opens with "We", "I", "At…", or the company's own name:
 * "PDT Partners | NYC, Hybrid PDT was a pioneer…".
 */
function cutRunOn(field: string, company: string | null): string {
  const lead = company?.split(' ')[0] ?? '';
  const name = lead.length >= 3 ? `|${escapeRegExp(lead)}(?![\\p{L}\\p{N}])` : '';
  const at = field.search(new RegExp(`(?<=\\s)(?:${PROSE_OPENERS}${name})`, 'u'));
  return at > 0 ? field.slice(0, at).trim() : field;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The roles a comment lists below its header, one per line or bullet. */
function rolesInBody(text: string): string[] {
  const roles: string[] = [];
  for (const line of text.split('\n').filter((l) => l.trim().length > 0).slice(1, BODY_LINES)) {
    for (const piece of line.split(PIECE_SPLIT_RE)) {
      const name = piece
        .replace(/\s*\([^()]*\)/g, '')
        .split(ROLE_NAME_END_RE)
        .map((part) => part.trim().replace(BULLET_RE, '').replace(/\s+/g, ' ').replace(EDGE_RE, ''))
        .find((part) => part.split(' ').length <= BODY_ROLE_MAX_WORDS && namesRole(part, BODY_ROLE_NOUNS));
      if (name === undefined || roles.includes(name)) continue;
      roles.push(name);
      if (roles.length === BODY_ROLES_MAX) return roles;
    }
  }
  return roles;
}

/**
 * The company as the poster named it, without the link or the note in
 * brackets: "Smarkets ( https://www.smarkets.com )", "Thunder Compute (YC
 * S24)". A note that is a place ("PrairieLearn (Remote US)") is kept as the
 * location for a header that names none of its own.
 */
function companyOf(field: string): { name: string | null; place: string | null } {
  let place: string | null = null;
  const name = withoutLinks(field)
    .replace(/\(([^()]*)\)/g, (_, note: string) => {
      const inside = note.trim();
      if (place === null && inside.length > 0 && kindOf(inside) === 'place') place = inside;
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '');
  return { name: name.length > 0 ? name : null, place };
}

function extractUrl(text: string): string | null {
  const m = URL_RE.exec(text);
  if (!m) return null;
  // Strip trailing punctuation that often clings to a URL in prose.
  return m[0].replace(/[.,;:!?\]]+$/, '');
}

function extractRoleAfterHiring(text: string): string | null {
  // "X is hiring a Senior Engineer" → "Senior Engineer"
  const m =
    /(?:is|are)\s+hiring\s+(?:a\s+|an\s+|for\s+(?:a\s+|an\s+)?)?([^.|—–\n]{5,80})/.exec(
      text,
    );
  return m && m[1] ? m[1].trim() : null;
}
