import { titleHasKeyword } from '../filter';
import { t } from '../i18n/t';

/*
 * "Paste the page" (TASKS N8). A careers page that draws its jobs in the
 * browser cannot be read by a fetch, so the user copies its text and pastes
 * it. This turns the text into lines, says which are new against the last
 * paste, and which look like roles a running search wants — by the filter's
 * own whole-word title match. Zero AI, and nothing is stored as a Job: a line
 * is what the page said, not a posting. Pure — tested in paste.test.ts.
 */

/** Far more than any careers page; a longer paste is cut, not refused. */
export const MAX_PASTE_CHARS = 200_000;
/** Lines kept per paste. */
const MAX_PASTE_LINES = 400;
/** Shorter is a button or a bullet; longer is a paragraph, not a role. */
const MIN_LINE_CHARS = 3;
const MAX_LINE_CHARS = 120;

/** A line's identity across pastes: case and spacing folded. */
function lineKey(line: string): string {
  return line.toLowerCase();
}

/** The page's lines as pasted: trimmed, whitespace collapsed, repeats and the too-short and too-long left out. */
export function pageLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.slice(0, MAX_PASTE_CHARS).split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line.length < MIN_LINE_CHARS || line.length > MAX_LINE_CHARS) continue;
    const key = lineKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length === MAX_PASTE_LINES) break;
  }
  return out;
}

/** Lines in `current` the previous paste did not have, in the page's order. */
export function newLines(previous: readonly string[], current: readonly string[]): string[] {
  const before = new Set(previous.map(lineKey));
  return current.filter((line) => !before.has(lineKey(line)));
}

/** A running search's title words: the stack and role words it wants, the words it excludes. */
export interface TitleWords {
  include: readonly string[];
  exclude: readonly string[];
}

/** The title words of the running searches, as the filter reads them. */
export function titleWordsOf(
  searches: readonly { stackRequired: readonly string[]; roleTypes: readonly string[]; stackExclude: readonly string[] }[],
): TitleWords[] {
  return searches.map((s) => ({ include: [...s.stackRequired, ...s.roleTypes], exclude: s.stackExclude }));
}

/** The lines some search would take by its title words — a role it wants, not an excluded one. */
export function roleLines(lines: readonly string[], searches: readonly TitleWords[]): string[] {
  return lines.filter((line) => {
    const title = line.toLowerCase();
    return searches.some(
      (s) => s.include.some((k) => titleHasKeyword(title, k)) && !s.exclude.some((k) => titleHasKeyword(title, k)),
    );
  });
}

/** How many role lines a flash names before it says "…". */
const FLASH_ROLES = 3;

/**
 * What a paste found, for the flash: the lines read, what is new since the
 * last paste (`since` is its date as the page writes one; null for the first),
 * and the role lines among them.
 */
export function pasteSummary(p: { name: string; lines: number; since: string | null; added: number; roles: readonly string[] }): string {
  // Whole sentences, each a message of its own; the lines named are the page's words.
  const head = t('watchlist.paste.read', { n: p.lines, name: p.name });
  const list = `${p.roles.slice(0, FLASH_ROLES).join('; ')}${p.roles.length > FLASH_ROLES ? '; …' : ''}`;
  const roles = p.roles.length === 0 ? [] : [t('watchlist.paste.roles', { n: p.roles.length, list })];
  if (p.since === null) return [head, ...roles, t('watchlist.paste.first')].join(' ');
  if (p.added === 0) return [head, t('watchlist.paste.nothingNew', { since: p.since })].join(' ');
  return [head, t('watchlist.paste.newSince', { n: p.added, since: p.since }), ...roles].join(' ');
}
