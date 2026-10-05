/*
 * Finds the rows in a body the user brought (ADR 0061): a JSON array, an
 * object wrapping one, JSON Lines, CSV or TSV. The format is read off the
 * text, never off a file name. Pure — tested in rows.test.ts.
 */

import { readDelimited, sniffDelimiter } from './delimited';

export type Row = Record<string, unknown>;
export type RowFormat = 'json' | 'jsonl' | 'csv' | 'tsv';

/** The largest body read as rows: a file past it is refused whole, never read in part. */
export const MAX_BODY_MB = 5;

/** The most rows one body gives: every row past the base filter is an AI call, and the whole list waits in memory for its preview. */
export const MAX_ROWS = 2000;

export interface FoundRows {
  format: RowFormat;
  rows: Row[];
  /** Rows the body holds past `MAX_ROWS`: counted and said, never read. */
  over: number;
  /** Entries that are not rows: a bare value in the array, a line that is not JSON. */
  notRows: number;
}

export type RowsResult = ({ ok: true } & FoundRows) | { ok: false; error: string };

/** Where exports keep their rows, most common first. */
const ROW_KEYS = ['data', 'items', 'results', 'records', 'jobs'];
/** How deep a wrapper is followed: `{ result: { lists: { Jobs: [...] } } }` and no further. */
const MAX_WRAPPER_DEPTH = 3;
/** What a record carries around its `fields` object in a table export. */
const RECORD_KEYS = new Set(['id', 'createdTime', 'fields']);
const BOM = '﻿';

export const NOT_ROWS = 'This file holds no rows ApplyPack can read. It takes a JSON array of objects, JSON Lines, CSV or TSV.';

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

function fromList(list: readonly unknown[], format: RowFormat, maxRows: number): RowsResult {
  const rows = list.filter(isRow);
  if (rows.length === 0) return { ok: false, error: NOT_ROWS };
  return {
    ok: true,
    format,
    rows: rows.slice(0, maxRows).map(unwrapRecord),
    over: Math.max(0, rows.length - maxRows),
    notRows: list.length - rows.length,
  };
}

function fromJson(parsed: unknown, maxRows: number): RowsResult {
  if (Array.isArray(parsed)) return fromList(parsed, 'json', maxRows);
  if (!isRow(parsed)) return { ok: false, error: NOT_ROWS };
  // An object with no list inside is one row: a tool that writes a file per posting.
  return fromList(rowsInside(parsed, 1) ?? [parsed], 'json', maxRows);
}

function fromJsonLines(text: string, maxRows: number): RowsResult {
  const parsed: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    try {
      parsed.push(JSON.parse(line));
    } catch {
      parsed.push(null);
    }
  }
  return fromList(parsed, 'jsonl', maxRows);
}

/** Header names as the selects show them: trimmed, an empty one numbered, a repeat told apart. */
function headerNames(cells: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return cells.map((cell, i) => {
    const name = cell.trim() || `Column ${i + 1}`;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name} (${n})`;
  });
}

function fromDelimited(text: string, maxRows: number): RowsResult {
  const delimiter = sniffDelimiter(text);
  const [head, ...lines] = readDelimited(text, delimiter);
  // One column and no delimiter anywhere is prose, not a table.
  if (!head || head.length < 2 || lines.length === 0) return { ok: false, error: NOT_ROWS };
  const names = headerNames(head);
  const rows = lines.slice(0, maxRows).map((cells) => Object.fromEntries(names.map((name, i) => [name, cells[i] ?? ''])));
  return { ok: true, format: delimiter === '\t' ? 'tsv' : 'csv', rows, over: Math.max(0, lines.length - maxRows), notRows: 0 };
}

/** A file's bytes as text: UTF-8, or UTF-16 when its byte-order mark says so (a spreadsheet's "Unicode text"). */
export function decodeBody(bytes: Uint8Array): string {
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : null;
  return new TextDecoder(utf16 ?? 'utf-8').decode(bytes);
}

export function findRows(body: string, maxRows: number = MAX_ROWS): RowsResult {
  const text = (body.startsWith(BOM) ? body.slice(1) : body).trim();
  if (text.length === 0) return { ok: false, error: 'This file is empty.' };
  // A NUL is a binary file (a spreadsheet's own format, an archive) read as text.
  if (text.includes('\u0000')) return { ok: false, error: NOT_ROWS };
  if (text[0] !== '[' && text[0] !== '{') return fromDelimited(text, maxRows);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fromJsonLines(text, maxRows);
  }
  return fromJson(parsed, maxRows);
}
