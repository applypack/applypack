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

/** The one list of rows inside a wrapper object, or null when it holds none or cannot say which. */
function rowsInside(value: Row, depth: number): unknown[] | null {
  for (const key of ROW_KEYS) {
    const inner = Object.hasOwn(value, key) ? value[key] : undefined;
    if (holdsRows(inner)) return inner;
    if (isRow(inner) && depth < MAX_WRAPPER_DEPTH) {
      const found = rowsInside(inner, depth + 1);
      if (found) return found;
    }
  }
  const lists = Object.values(value).filter(holdsRows);
  if (lists.length === 1) return lists[0]!;
  if (lists.length > 1 || depth >= MAX_WRAPPER_DEPTH) return null;
  const objects = Object.values(value).filter(isRow);
  return objects.length === 1 ? rowsInside(objects[0]!, depth + 1) : null;
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
  };
}

function fromJson(parsed: unknown, page: Page): RowsResult {
  if (Array.isArray(parsed)) return fromList(parsed, 'json', page);
  if (!isRow(parsed)) return noRows();
  // An object with no list inside is one row: a tool that writes a file per posting.
  return fromList(rowsInside(parsed, 1) ?? keyedRows(parsed) ?? [parsed], 'json', page);
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

/** `linesBefore`: the lines of the file above `body`, so a line is named as an editor numbers it. */
function fromDelimited(body: string, page: Page, linesBefore: number): RowsResult {
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
  if (head.length > MAX_COLUMNS) return { ok: false, error: t('datasets.rows.tooManyColumns', { n: head.length, max: MAX_COLUMNS }) };
  const names = headerNames(head);
  // A row keeps the cells it has: a short row is not padded out to the header's width.
  const rows = lines.slice(page.from, page.from + page.max).map((cells) => Object.fromEntries(cells.slice(0, names.length).map((cell, i) => [names[i]!, cell])));
  return { ok: true, format: delimiter === '\t' ? 'tsv' : 'csv', rows, over: Math.max(0, lines.length - page.from - rows.length), total: lines.length, notRows: 0, cutAt };
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
 */
export function findRows(body: string, maxRows: number = MAX_ROWS, from = 0): RowsResult {
  const page: Page = { from, max: maxRows };
  const unmarked = body.startsWith(BOM) ? body.slice(1) : body;
  const blank = LEADING_BLANK_LINES_RE.exec(unmarked)?.[0] ?? '';
  const text = unmarked.slice(blank.length).trimEnd();
  const opening = text.trimStart();
  if (opening.length === 0) return { ok: false, error: t('datasets.rows.empty') };
  // A NUL is a binary file (a spreadsheet's own format, an archive) read as text.
  if (text.includes('\u0000')) return noRows();
  const linesBefore = blank.split('\n').length - 1;
  if (opening[0] !== '[' && opening[0] !== '{') return fromDelimited(text, page, linesBefore);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not one JSON value: a line of JSON each, or a table whose first cell happens to open with a bracket.
    const lines = fromJsonLines(text, page);
    if (lines.ok) return lines;
    // JSON that stops short or is damaged is said to be that: read as a table it gave columns named `[{"title":"a"` (#394).
    if (JSON_OPENING_RE.test(opening)) return { ok: false, error: t('datasets.rows.brokenJson'), why: 'broken-json' };
    return fromDelimited(text, page, linesBefore);
  }
  return fromJson(parsed, page);
}
