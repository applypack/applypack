/*
 * CSV and TSV as spreadsheets and tools really write them: CRLF or LF, a BOM,
 * a quoted cell holding the delimiter, a line break or a doubled quote, and a
 * semicolon where the locale's decimal mark is a comma. Pure — tested in
 * delimited.test.ts. `src/csv.ts` is the writer; this is the reader.
 */

const BOM = '﻿';
const DELIMITERS = [',', ';', '\t'] as const;

export type Delimiter = (typeof DELIMITERS)[number];

/** The delimiter the first line uses most outside quotes; a comma when it uses none. */
export function sniffDelimiter(text: string): Delimiter {
  const counts = new Map<Delimiter, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (const ch of text.startsWith(BOM) ? text.slice(1) : text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && counts.has(ch as Delimiter)) counts.set(ch as Delimiter, counts.get(ch as Delimiter)! + 1);
  }
  let best: Delimiter = ',';
  for (const d of DELIMITERS) if (counts.get(d)! > counts.get(best)!) best = d;
  return best;
}

/**
 * The rows of a delimited text, every cell a string. A quote opens a quoted
 * cell only at the cell's start; text after the closing quote is kept as it
 * is, and a quote never closed runs to the end — a damaged file loses a row's
 * shape, never its text. Lines with nothing in them are left out.
 */
export function readDelimited(text: string, delimiter: Delimiter): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = (): void => {
    row.push(cell);
    cell = '';
    if (row.some((c) => c.length > 0)) rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (src[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && cell.length === 0) quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (src[i + 1] === '\n') i++;
      endRow();
    } else cell += ch;
  }
  endRow();
  return rows;
}
