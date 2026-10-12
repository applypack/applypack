/*
 * Finds the rows in a body the user brought (ADR 0062): a JSON array, an
 * object wrapping one, JSON Lines, CSV or TSV. The format is read off the
 * text, never off a file name. Pure — tested in rows.test.ts.
 */

import { t } from '../i18n/t';
import { decodeText } from './decode';
import { readDelimited, sniffDelimiter, type Delimiter } from './delimited';

export type Row = Record<string, unknown>;
export type RowFormat = 'json' | 'jsonl' | 'csv' | 'tsv';

/** The largest body read as rows: a file past it is refused whole, never read in part. */
export const MAX_BODY_MB = 5;

/** The most rows an imported file gives: every row past the base filter is an AI call, and the whole list waits in memory for its preview. A folder's file is read past it, a look's worth at a time (folder-scan.ts). */
export const MAX_ROWS = 2000;

export interface FoundRows {
  format: RowFormat;
  rows: Row[];
  /** Rows the body holds past the ones given: counted and said, never read. */
  over: number;
  /** Every row the body holds: the ones before `from`, the ones given and the ones past them. */
  total: number;
  /** Entries that are not rows: a bare value in the array, a line that is not JSON. */
  notRows: number;
  /**
   * The line of the body a quote opens on and never closes, or null. From
   * that line on nothing could be read, and `total` counts only the rows
   * before it: the caller says so, and never calls such a file read whole.
   */
  cutAt: number | null;
  /**
   * A table whose last row is not ended by a line break. Nothing about a
   * whole file — many tools write none — but in a file still being written
   * that row may be cut short, and read as it is it would be stored with
   * half a title and no link (#396). Never set for JSON: a line of JSON cut
   * short is not a row.
   */
  openRow: boolean;
  /**
   * The body is one JSON object taken as one row: a file per posting. Also
   * what a stats file or a manifest looks like, which is why a caller that
   * judges a folder's files asks (#395).
   */
  single: boolean;
}

/**
 * `why` names a refusal that is about damage, not about what the file is:
 * `broken-json` — the body set out as JSON and is cut off or not valid;
 * `unclosed-quote` — a table whose first row already opens a quote it never
 * closes. A folder says these in its own words (a file still being written).
 */
export type RowsResult = ({ ok: true } & FoundRows) | { ok: false; error: string; why?: 'broken-json' | 'unclosed-quote' };

/**
 * The widest table read. A row is built from the cells it has, so memory
 * follows the file; without a ceiling on the header, a few kilobytes of
 * commas made every short row carry thousands of keys.
 */
export const MAX_COLUMNS = 200;
/**
 * A header wider than this is refused whole: it is not a table of jobs, and
 * every cell of it would still be read. Between the two, the columns kept
 * are the ones a caller says it wants and then the first of the rest — a
 * flattened export of nested tool output runs to hundreds of columns with
 * the title among them, and refusing it left the person to cut the file by
 * hand (#403).
 */
const MAX_HEADER_CELLS = 5_000;

/** Which columns of a table too wide to keep whole a caller reads first: `map.ts` brings the names of a job's fields. */
export type WantedColumn = (name: string) => boolean;

/** The positions kept of a header of `names`: all of them when they fit; else the wanted ones, then the first others, in the file's order. */
export function keptColumns(names: readonly string[], wanted: WantedColumn, max: number = MAX_COLUMNS): number[] {
  if (names.length <= max) return names.map((_, i) => i);
  const picked = new Set<number>();
  for (let i = 0; i < names.length && picked.size < max; i++) if (wanted(names[i]!)) picked.add(i);
  for (let i = 0; i < names.length && picked.size < max; i++) picked.add(i);
  return [...picked].sort((a, b) => a - b);
}

/** Where exports keep their rows, most common first. */
const ROW_KEYS = ['data', 'items', 'results', 'records', 'jobs'];
/** How deep a wrapper is followed: `{ result: { lists: { Jobs: [...] } } }` and no further. */
const MAX_WRAPPER_DEPTH = 3;
/** What a record carries around its `fields` object in a table export. */
const RECORD_KEYS = new Set(['id', 'createdTime', 'fields']);
const BOM = '\uFEFF';

/** The sentence for a file that holds no rows, in English: what the tests compare. `findRows` words it in the language of the moment. */
export const NOT_ROWS = t('datasets.rows.notRows');
const noRows = (): RowsResult => ({ ok: false, error: t('datasets.rows.notRows') });

export function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function holdsRows(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.some(isRow);
}

/**
 * How much of a posting an object names — its title, link, text, company,
 * place, date — and 0 when it names no title. The mapper's to say
 * (map.ts:postingFields): this module knows shapes, not what a job's fields
 * are called.
 */
export type PostingFields = (row: Row) => number;

/** A title and one more thing: less than that is no posting. */
const POSTING_AT_LEAST = 2;
/** How much more of a posting an object must name than its list's entries do, for the list to be its own when the entries read as postings too. */
const RICHER_BY = 2;

/**
 * Whether a list inside an object is that object's own — a posting's places,
 * its skills, its benefits — and not the rows it wraps. A posting is a row in
 * itself, and its list was taken for the rows: a `JobPosting` with two places
 * read as two rows of `@type, address` (#395). The list is the object's own
 * when the object names a posting and the entries do not, or name much less
 * of one (a place with a name and an address). An object that names little
 * more than its entries is their wrapper, whatever title and link it carries.
 */
function ownsItsList(holder: Row, list: readonly unknown[], reads: PostingFields): boolean {
  const own = reads(holder);
  if (own < POSTING_AT_LEAST) return false;
  const most = list.reduce<number>((best, entry) => (isRow(entry) ? Math.max(best, reads(entry)) : best), 0);
  return most < POSTING_AT_LEAST || own >= most + RICHER_BY;
}

/** The one list of rows inside a wrapper object, or null when it holds none or cannot say which. */
function rowsInside(value: Row, depth: number, reads: PostingFields): unknown[] | null {
  // A key that says "rows" is believed: a feed's own title and text sit beside its `items`.
  for (const key of ROW_KEYS) {
    const inner = Object.hasOwn(value, key) ? value[key] : undefined;
    if (holdsRows(inner)) return inner;
    if (isRow(inner) && depth < MAX_WRAPPER_DEPTH) {
      const found = rowsInside(inner, depth + 1, reads);
      if (found) return found;
    }
  }
  const lists = Object.values(value).filter(holdsRows);
  if (lists.length === 1) return ownsItsList(value, lists[0]!, reads) ? null : lists[0]!;
  if (lists.length > 1 || depth >= MAX_WRAPPER_DEPTH) return null;
  const objects = Object.values(value).filter(isRow);
  const found = objects.length === 1 ? rowsInside(objects[0]!, depth + 1, reads) : null;
  // A posting's company is an object too, and may hold a list of its own (its offices).
  return found !== null && ownsItsList(value, found, reads) ? null : found;
}

/**
 * The rows of an object that holds them by key and not in a list —
 * `{ "a1": {…}, "a2": {…} }`, as some stores export — or null. Told from one
 * posting made of parts (`{ "job": {…}, "company": {…} }`) by the rows being
 * alike: the keys every one of them has are at least half of the widest's.
 */
function keyedRows(value: Row): Row[] | null {
  const rows = Object.values(value);
  if (rows.length < 2 || !rows.every(isRow)) return null;
  const shared = rows.reduce<string[]>((keys, row) => keys.filter((key) => Object.hasOwn(row, key)), Object.keys(rows[0]!));
  const widest = rows.reduce((most, row) => Math.max(most, Object.keys(row).length), 0);
  return shared.length > 0 && shared.length * 2 >= widest ? rows : null;
}

/** `{ id, createdTime, fields: {…} }` → the fields, with the record's id unless they bring their own. */
function unwrapRecord(row: Row): Row {
  const { fields } = row;
  if (!isRow(fields) || !Object.keys(row).every((k) => RECORD_KEYS.has(k))) return row;
  return row.id === undefined ? fields : { id: row.id, ...fields };
}

/** Which rows of a body are given: `max` of them, starting at row `from`. */
interface Page {
  from: number;
  max: number;
}

function fromList(list: readonly unknown[], format: RowFormat, page: Page): RowsResult {
  const rows = list.filter(isRow);
  if (rows.length === 0) return noRows();
  const given = rows.slice(page.from, page.from + page.max);
  return {
    ok: true,
    format,
    rows: given.map(unwrapRecord),
    over: Math.max(0, rows.length - page.from - given.length),
    total: rows.length,
    notRows: list.length - rows.length,
    cutAt: null,
    openRow: false,
    single: false,
  };
}

function fromJson(parsed: unknown, page: Page, reads: PostingFields): RowsResult {
  if (Array.isArray(parsed)) return fromList(parsed, 'json', page);
  if (!isRow(parsed)) return noRows();
  const rows = rowsInside(parsed, 1, reads) ?? keyedRows(parsed);
  if (rows !== null) return fromList(rows, 'json', page);
  // An object with no list of rows inside is one row: a tool that writes a file per posting.
  const one = fromList([parsed], 'json', page);
  return one.ok ? { ...one, single: true } : one;
}

function fromJsonLines(text: string, page: Page): RowsResult {
  const parsed: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    try {
      parsed.push(JSON.parse(line));
    } catch {
      parsed.push(null);
    }
  }
  return fromList(parsed, 'jsonl', page);
}

/** Header names as the selects show them: trimmed, an empty one numbered, a repeat told apart. */
function headerNames(cells: readonly string[]): string[] {
  const taken = new Set<string>();
  return cells.map((cell, i) => {
    const base = cell.trim() || `Column ${i + 1}`;
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
    taken.add(name);
    return name;
  });
}

/** `sep=;` on a line of its own: how a spreadsheet says which delimiter the file uses. */
const SEPARATOR_LINE_RE = /^sep=([,;\t])\r?\n/i;

/** `linesBefore`: the lines of the file above `body`, so a line is named as an editor numbers it. `ended`: the file's last line ends in a line break. */
function fromDelimited(body: string, page: Page, linesBefore: number, ended: boolean, wanted: WantedColumn): RowsResult {
  const hint = SEPARATOR_LINE_RE.exec(body);
  const text = hint ? body.slice(hint[0].length) : body;
  const delimiter = (hint?.[1] as Delimiter | undefined) ?? sniffDelimiter(text);
  const table = readDelimited(text, delimiter);
  const [head, ...lines] = table.rows;
  const cutAt = table.unclosedLine === null ? null : table.unclosedLine + linesBefore + (hint ? 1 : 0);
  // A quote left open in the header or in the first row: no row is sound, and that is the reason to give.
  if (cutAt !== null && lines.length === 0 && (!head || head.length >= 2)) return { ok: false, error: t('datasets.rows.unclosedQuote', { line: cutAt }), why: 'unclosed-quote' };
  // One column and no delimiter anywhere is prose, not a table.
  if (!head || head.length < 2 || lines.length === 0) return noRows();
  if (head.length > MAX_HEADER_CELLS) return { ok: false, error: t('datasets.rows.tooManyColumns', { n: head.length, max: MAX_HEADER_CELLS }) };
  const names = headerNames(head);
  const kept = keptColumns(names, wanted);
  // A row keeps the cells it has: a short row is not padded out to the header's width.
  const rows = lines.slice(page.from, page.from + page.max).map((cells) => Object.fromEntries(kept.filter((i) => i < cells.length).map((i) => [names[i]!, cells[i]!])));
  // A row with a quote left open is gone already; what is left of the table ends where its rows do.
  const openRow = !ended && cutAt === null;
  return { ok: true, format: delimiter === '\t' ? 'tsv' : 'csv', rows, over: Math.max(0, lines.length - page.from - rows.length), total: lines.length, notRows: 0, cutAt, openRow, single: false };
}

/** A file's bytes as text (decode.ts): UTF-8, UTF-16 behind its mark, or the one-byte encoding a file that is neither is likeliest in. */
export function decodeBody(bytes: Uint8Array): string {
  return decodeText(bytes).text;
}

/** Blank lines above the first row. Not `trim()`: a tab that opens the first line is an empty first header, and losing it moved every column one to the left (#394). */
const LEADING_BLANK_LINES_RE = /^(?:[ \t]*\r?\n)+/;
/** A body that is not JSON but set out to be — `[{`, `{"`, a bracket on a line of its own — as against a table whose first header opens with a bracket (`[ref],title`). */
const JSON_OPENING_RE = /^[[{]\s*(?:[[{"\]}]|$)/;

/**
 * The rows of a body: at most `maxRows` of them, starting at row `from` — a
 * folder's long file is read a look's worth at a time (folder-scan.ts).
 * `reads` tells a posting that holds a list from a wrapper around rows; with
 * none, any one list of objects is the rows. Callers that read jobs go
 * through `map.ts:findJobRows`, which brings it.
 */
export function findRows(body: string, maxRows: number = MAX_ROWS, from = 0, reads: PostingFields = () => 0, wanted: WantedColumn = () => false): RowsResult {
  const page: Page = { from, max: maxRows };
  const unmarked = body.startsWith(BOM) ? body.slice(1) : body;
  const blank = LEADING_BLANK_LINES_RE.exec(unmarked)?.[0] ?? '';
  const text = unmarked.slice(blank.length).trimEnd();
  const opening = text.trimStart();
  if (opening.length === 0) return { ok: false, error: t('datasets.rows.empty') };
  // A NUL is a binary file (a spreadsheet's own format, an archive) read as text.
  if (text.includes('\u0000')) return noRows();
  const linesBefore = blank.split('\n').length - 1;
  // Blanks after the last line break are no line of their own.
  const ended = /[\r\n][ \t]*$/.test(unmarked);
  if (opening[0] !== '[' && opening[0] !== '{') return fromDelimited(text, page, linesBefore, ended, wanted);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not one JSON value: a line of JSON each, or a table whose first cell happens to open with a bracket.
    const lines = fromJsonLines(text, page);
    if (lines.ok) return lines;
    // JSON that stops short or is damaged is said to be that: read as a table it gave columns named `[{"title":"a"` (#394).
    if (JSON_OPENING_RE.test(opening)) return { ok: false, error: t('datasets.rows.brokenJson'), why: 'broken-json' };
    return fromDelimited(text, page, linesBefore, ended, wanted);
  }
  return fromJson(parsed, page, reads);
}
