/*
 * Finds the rows in a body the user brought (ADR 0062): a JSON array, an
 * object wrapping one, JSON Lines, CSV or TSV. The format is read off the
 * text, never off a file name. Pure — tested in rows.test.ts.
 */

import { t } from '../i18n/t';
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
}

export type RowsResult = ({ ok: true } & FoundRows) | { ok: false; error: string };

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
  };
}

function fromJson(parsed: unknown, page: Page): RowsResult {
  if (Array.isArray(parsed)) return fromList(parsed, 'json', page);
  if (!isRow(parsed)) return noRows();
  // An object with no list inside is one row: a tool that writes a file per posting.
  return fromList(rowsInside(parsed, 1) ?? [parsed], 'json', page);
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

function fromDelimited(body: string, page: Page): RowsResult {
  const hint = SEPARATOR_LINE_RE.exec(body);
  const text = hint ? body.slice(hint[0].length) : body;
  const delimiter = (hint?.[1] as Delimiter | undefined) ?? sniffDelimiter(text);
  const [head, ...lines] = readDelimited(text, delimiter);
  // One column and no delimiter anywhere is prose, not a table.
  if (!head || head.length < 2 || lines.length === 0) return noRows();
  if (head.length > MAX_COLUMNS) return { ok: false, error: t('datasets.rows.tooManyColumns', { n: head.length, max: MAX_COLUMNS }) };
  const names = headerNames(head);
  // A row keeps the cells it has: a short row is not padded out to the header's width.
  const rows = lines.slice(page.from, page.from + page.max).map((cells) => Object.fromEntries(cells.slice(0, names.length).map((cell, i) => [names[i]!, cell])));
  return { ok: true, format: delimiter === '\t' ? 'tsv' : 'csv', rows, over: Math.max(0, lines.length - page.from - rows.length), total: lines.length, notRows: 0 };
}

/** A file's bytes as text: UTF-8, or UTF-16 when its byte-order mark says so (a spreadsheet's "Unicode text"). */
export function decodeBody(bytes: Uint8Array): string {
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : null;
  return new TextDecoder(utf16 ?? 'utf-8').decode(bytes);
}

/**
 * The rows of a body: at most `maxRows` of them, starting at row `from` — a
 * folder's long file is read a look's worth at a time (folder-scan.ts).
 */
export function findRows(body: string, maxRows: number = MAX_ROWS, from = 0): RowsResult {
  const page: Page = { from, max: maxRows };
  const text = (body.startsWith(BOM) ? body.slice(1) : body).trim();
  if (text.length === 0) return { ok: false, error: t('datasets.rows.empty') };
  // A NUL is a binary file (a spreadsheet's own format, an archive) read as text.
  if (text.includes('\u0000')) return noRows();
  if (text[0] !== '[' && text[0] !== '{') return fromDelimited(text, page);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not one JSON value: a line of JSON each, or a table whose first cell happens to open with a bracket.
    const lines = fromJsonLines(text, page);
    return lines.ok ? lines : fromDelimited(text, page);
  }
  return fromJson(parsed, page);
}
