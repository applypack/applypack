import { cleanEmployer, employerKey } from '../employer';
import { isDouSalary } from '../fetchers/dou-title';
import { splitGolangTitle } from '../fetchers/golangprojects';
import { mapHnJobHit } from '../fetchers/hn-jobs';
import { repairUtf8 } from '../fetchers/remoteok';
import { decodeHtmlEntities, stripHtml } from '../http';

/**
 * What the fetchers write now, applied to a posting stored before (#659,
 * #662): the repair `scripts/backfill-descriptions.ts` runs. Pure.
 *
 * It reads stored TEXT, never markup: the entities a feed's text carried
 * and stripHtml left undecoded are decoded once, a line at a time, and a
 * line nothing changed stays byte for byte — a markdown body keeps its
 * indentation. Running stripHtml over its own output again would flatten
 * the lines and eat a "<b>" the text now spells (gotcha 12), so only a body
 * that still holds a block tag AND its closer goes through it, as the first
 * repair of 2026-08 did.
 *
 * A space an inline tag left before punctuation ("robot fleets .") is not
 * repaired here: in stored text it cannot be told from one the posting
 * wrote, and French writes one before "!", "?", ":" and ";".
 *
 * Only for rows a feed wrote. A pasted job and the rows the user brings were
 * decoded once when they came in; a second pass would read their own
 * "&lt;" as a "<" the user never typed.
 */

export interface StoredText {
  atsType: string;
  title: string;
  description: string;
  location: string;
  employer: string | null;
}

/** The columns that change, and only those. */
export interface TextRepair {
  title?: string;
  description?: string;
  location?: string;
  employer?: string | null;
  employerKey?: string | null;
}

const LEFTOVER_OPENER_RE = /<(?:p|div|ul|ol|li|br|h[1-6]|table)[\s>/]/i;
const LEFTOVER_CLOSER_RE = /<\/(?:p|div|ul|ol|li|h[1-6]|table)\s*>/i;

export function repairStoredText(row: StoredText): TextRepair {
  const utf8 = row.atsType === 'REMOTEOK' ? storedUtf8 : (text: string) => text;
  const fix = (text: string) => decodeHtmlEntities(utf8(text));
  let title = oneLine(fix(row.title));
  let employer = row.employer === null ? null : (cleanEmployer(fix(row.employer)) ?? row.employer);
  let description = repairBody(row.description, utf8);
  let location = oneLine(fix(row.location));

  if (row.atsType === 'GOLANGPROJECTS' && employer === null) ({ title, employer } = splitGolangTitle(title));
  // An HN posting's place is read off its title alone, so it is read again.
  if (row.atsType === 'HN_JOBS') location = mapHnJobHit({ objectID: '', title }, 0).location;
  if (row.atsType === 'FOURDAYWEEK') location = eachPlaceOnce(location);
  if (row.atsType === 'DOU') ({ location, description } = salaryOutOfPlace(location, description));

  const out: TextRepair = {};
  if (title !== row.title && title.length > 0) out.title = title;
  if (description !== row.description) out.description = description;
  if (location !== row.location) out.location = location;
  if (employer !== row.employer) {
    out.employer = employer;
    out.employerKey = employer === null ? null : employerKey(employer);
  }
  return out;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function repairBody(text: string, utf8: (text: string) => string): string {
  if (LEFTOVER_OPENER_RE.test(text) && LEFTOVER_CLOSER_RE.test(text)) return stripHtml(utf8(text));
  let changed = false;
  const lines = text.split('\n').map((line) => {
    const fixed = decodeHtmlEntities(utf8(line));
    if (fixed === line) return line;
    changed = true;
    const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
    return indent + fixed.slice(indent.length).replace(/\s+/g, ' ').trim();
  });
  return changed ? lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() : text;
}

/**
 * `repairUtf8` over text stripHtml already read: the no-break space of a
 * "\u00c2\u00a0" (itself a no-break space) or a "\u00c3\u00a0" (à) was read
 * as a space then, which leaves the letter before it alone. RemoteOK writes
 * nothing past ASCII but as such runs, so a lead letter before a space is
 * what is left of one.
 */
function storedUtf8(text: string): string {
  return repairUtf8(text).replace(/\u00c2(?=\s|$)/g, '').replace(/\u00c3(?=\s)/g, '\u00e0');
}

/** 4dayweek's "Remote · United States / United States / Canada", each place once. */
function eachPlaceOnce(location: string): string {
  const at = location.indexOf(' · ');
  const head = at === -1 ? '' : location.slice(0, at + ' · '.length);
  const places = location.slice(head.length).split(' / ');
  return head + places.filter((place, i) => places.indexOf(place) === i).join(' / ');
}

/**
 * DOU's "від $5000, Київ": the pay read as a place before the bound was
 * known. Out of the location, and into the header line the mapper writes
 * ("Hiring company: X. Salary: від $5000.") unless that already says it.
 */
function salaryOutOfPlace(location: string, description: string): { location: string; description: string } {
  const segments = location.split(', ');
  const salary = segments.find(isDouSalary);
  if (salary === undefined) return { location, description };
  const kept = segments.filter((s) => !isDouSalary(s)).join(', ');
  const [head = '', ...rest] = description.split('\n');
  if (/\bSalary: /.test(head)) return { location: kept, description };
  const line = `Salary: ${salary}.`;
  if (head.startsWith('Hiring company: ')) return { location: kept, description: [`${head} ${line}`, ...rest].join('\n') };
  return { location: kept, description: description.length > 0 ? `${line}\n\n${description}` : line };
}
