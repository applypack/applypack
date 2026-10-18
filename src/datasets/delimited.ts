/*
 * CSV and TSV as spreadsheets and tools really write them: CRLF or LF, a
 * quoted cell holding the delimiter, a line break or a doubled quote, and a
 * semicolon where the locale's decimal mark is a comma. Pure — tested in
 * delimited.test.ts. `src/csv.ts` is the writer; this is the reader, and
 * `rows.ts` hands it text with the byte-order mark already gone.
 */

const DELIMITERS = [',', ';', '\t'] as const;

export type Delimiter = (typeof DELIMITERS)[number];

/** How many lines the delimiter is read off. */
const SNIFF_LINES = 10;

/**
 * The delimiter of a table: the one that cuts every one of its first lines
 * into the same number of cells, and of those the one that makes the most.
 * When none is that regular, the one the first line uses most; a comma when
 * it uses none. The first line alone used to decide, a tie going to the
 * comma — so a TSV whose header holds one comma ("Title, as posted") was
 * read as a CSV of that header's two halves (#403). Quoted text is skipped.
 */
export function sniffDelimiter(text: string): Delimiter {
  const lines: Map<Delimiter, number>[] = [];
  let counts = new Map<Delimiter, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  let seen = false;
  const endLine = (): void => {
    if (seen) lines.push(counts);
    counts = new Map<Delimiter, number>(DELIMITERS.map((d) => [d, 0]));
    seen = false;
  };
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      endLine();
      if (lines.length >= SNIFF_LINES) break;
      continue;
    } else if (!quoted && counts.has(ch as Delimiter)) counts.set(ch as Delimiter, counts.get(ch as Delimiter)! + 1);
    seen = true;
  }
  if (!quoted && lines.length < SNIFF_LINES) endLine();
  const first = lines[0];
  if (!first) return ',';
  let best: Delimiter = ',';
  for (const d of DELIMITERS) if (first.get(d)! > first.get(best)!) best = d;
  // With two lines or more, a delimiter every line uses equally often outranks one the header merely contains.
  const regular = lines.length < 2 ? [] : DELIMITERS.filter((d) => first.get(d)! > 0 && lines.every((line) => line.get(d) === first.get(d)));
  if (regular.length > 0 && !regular.includes(best)) best = regular.reduce((a, b) => (first.get(b)! > first.get(a)! ? b : a));
  return best;
}

export interface Table {
  /** Every cell a string; lines with nothing in them are left out. */
  rows: string[][];
  /**
   * The line a quote opens on and never closes, counted from 1, or null. The
   * rows are then the ones that ended before that quote's row began: from
   * there on every line break and delimiter sits inside one cell, so the rest
   * of the text holds no row that can be told from another.
   */
  unclosedLine: number | null;
}

/**
 * The rows of a delimited text. A quote opens a quoted cell only at the
 * cell's start (blanks before it aside, as some tools write `a, "b, c"`);
 * text after the closing quote is kept as it is. A quote never closed is
 * reported, not read: taken as a cell it swallowed every row after it into
 * one, and the caller counted that one row as the file (#394).
 */
export function readDelimited(src: string, delimiter: Delimiter): Table {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let openedOn = 0;
  const endRow = (): void => {
    row.push(cell);
    cell = '';
    if (row.some((c) => c.length > 0)) rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    // A CRLF is one line break, counted at its LF; a bare CR is one too.
    if (ch === '\n' || (ch === '\r' && src[i + 1] !== '\n')) line++;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (src[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && cell.trim().length === 0) {
      cell = '';
      quoted = true;
      openedOn = line;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (src[i + 1] === '\n') {
        // The LF is stepped over here, so its line is counted here.
        i++;
        line++;
      }
      endRow();
    } else cell += ch;
  }
  if (quoted) return { rows, unclosedLine: openedOn };
  endRow();
  return { rows, unclosedLine: null };
}
