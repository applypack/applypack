/*
 * A column that leaves the table below a breakpoint — the header and every
 * cell, declared once on <Table> (#77). The `th` gets its own responsive
 * class; the cells are reached from the table element through an arbitrary
 * variant, so a page never repeats the class on each `Td` and the two can
 * no longer disagree. Pure — tested in table-hide.test.ts.
 */

export type Breakpoint = 'sm' | 'md' | 'lg' | 'xl';

/** One entry per column, '' for a column that always shows. */
export type HideBelow = readonly (Breakpoint | '')[];

/** The class for column `i`'s header cell. */
export function hideHeaderClass(hideBelow: HideBelow | undefined, i: number): string {
  const bp = hideBelow?.[i];
  return bp ? `hidden ${bp}:table-cell` : '';
}

const ORDER: readonly (Breakpoint | '')[] = ['', 'sm', 'md', 'lg', 'xl'];

/** A CSS pixel per rem: Tailwind's `w-[5rem]` at the browser's default font size. */
const REM_PX = 16;

/**
 * A fixed-layout table's columns at a screen width from `at` up to the next
 * breakpoint, in px for a table `box` wide; null for a hidden column. As the
 * browser lays out `table-layout: fixed`: a `w-[Nrem]` column is that wide, a
 * `w-[N%]` one takes its share of the table, and a column given no width ('')
 * takes what the others leave (#612). With no such column, the percentages
 * share what the rem columns leave, as a hidden column's share goes to the
 * rest (#537). What a test holds a column to when a control in it has a width
 * of its own.
 */
export function columnWidths(widths: readonly string[], hideBelow: HideBelow | undefined, at: Breakpoint | '', box: number): (number | null)[] {
  const cols = widths.map((w, i) => {
    if (ORDER.indexOf(at) < ORDER.indexOf(hideBelow?.[i] ?? '')) return null;
    if (w === '') return { kind: 'auto' as const, n: 0 };
    const m = /^w-\[(\d+(?:\.\d+)?)(rem|%)\]$/.exec(w);
    if (!m) throw new Error(`a column width table-hide.ts cannot read: ${w}`);
    return m[2] === 'rem' ? { kind: 'rem' as const, n: Number(m[1]) * REM_PX } : { kind: 'pct' as const, n: Number(m[1]) };
  });
  const shown = cols.filter((c) => c !== null);
  const total = (kind: 'rem' | 'pct') => shown.reduce((s, c) => s + (c.kind === kind ? c.n : 0), 0);
  const autos = shown.filter((c) => c.kind === 'auto').length;
  const left = box - total('rem');
  return cols.map((c) => {
    if (c === null) return null;
    if (c.kind === 'rem') return c.n;
    if (autos === 0) return (c.n / total('pct')) * left;
    return c.kind === 'pct' ? (c.n / 100) * box : (left - (total('pct') / 100) * box) / autos;
  });
}

/** The classes on the table element that hide the same columns' body cells. */
export function hideCellsClass(hideBelow: HideBelow | undefined): string {
  return (hideBelow ?? [])
    .map((bp, i) => (bp ? `[&_td:nth-child(${i + 1})]:hidden ${bp}:[&_td:nth-child(${i + 1})]:table-cell` : ''))
    .filter(Boolean)
    .join(' ');
}
