import { findCountry } from '../countries';

/**
 * DOU.ua puts everything but the description into the item title (stage 3b,
 * verified live 2026-09-03):
 *
 *   <Title> в <Company>[, $salary][, City…][, за кордоном][, віддалено]
 *
 * "PHP Team Lead в Stape, Inc, за кордоном, віддалено" — the company itself
 * may hold a comma, so the tail is read from the END: salary, the two fixed
 * markers and places are peeled off while they are recognisable; whatever
 * is left in front of them is the company. Pure, no I/O.
 */

/** " в " — the Ukrainian "at", with the spaces DOU always puts around it. */
const AT_SEPARATOR = ' в ';
const REMOTE_MARKER = 'віддалено';
const ABROAD_MARKER = 'за кордоном';
/** "$2000–2500", "$800–1300", "€3000" — a currency sign then digits. */
const SALARY_RE = /^[$€£]\s?\d[\d\s.,–-]*$/u;
/** A segment written in Cyrillic is a place even when the gazetteer lacks it ("Чернігів"). */
const CYRILLIC_RE = /\p{Script=Cyrillic}/u;

export interface DouTitle {
  /** The role, without the " в Company…" tail. */
  title: string;
  company: string | null;
  salary: string | null;
  /** Cities as DOU wrote them ("Київ", "Лісабон (Португалія)"). */
  places: string[];
  remote: boolean;
  /** "за кордоном": the employer also hires abroad. */
  abroad: boolean;
}

export function parseDouTitle(raw: string): DouTitle {
  const text = raw.replace(/\s+/g, ' ').trim();
  const at = text.indexOf(AT_SEPARATOR);
  if (at === -1) {
    return { title: text, company: null, salary: null, places: [], remote: false, abroad: false };
  }
  const title = text.slice(0, at).trim();
  const segments = text.slice(at + AT_SEPARATOR.length).split(',').map((s) => s.trim()).filter(Boolean);

  const out: DouTitle = { title, company: null, salary: null, places: [], remote: false, abroad: false };
  // Peel the tail from the end; stop at the first segment that is none of
  // the known kinds — that one and everything before it is the company.
  while (segments.length > 1) {
    const last = segments[segments.length - 1]!;
    if (last === REMOTE_MARKER) out.remote = true;
    else if (last === ABROAD_MARKER) out.abroad = true;
    else if (SALARY_RE.test(last)) out.salary = last;
    else if (isPlace(last)) out.places.unshift(last);
    else break;
    segments.pop();
  }
  out.company = segments.join(', ') || null;
  return out;
}

function isPlace(segment: string): boolean {
  return findCountry(segment) !== null || findCountry(insideParens(segment)) !== null || CYRILLIC_RE.test(segment);
}

/** "Лісабон (Португалія)" → "Португалія"; '' when there are no parentheses. */
export function insideParens(s: string): string {
  return /\(([^)]+)\)/.exec(s)?.[1] ?? '';
}
