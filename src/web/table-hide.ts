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

/**
 * A fixed-layout table's columns at a screen width from `at` up to the next
 * breakpoint, as fractions of the table: the percentage width of each column
 * shown, scaled over the shown ones, as the browser gives a hidden column's share
 * to the rest. Null for a hidden column. What a test holds a column to when
 * a control in it has a width of its own (#537).
 */
export function shownShares(widths: readonly string[], hideBelow: HideBelow | undefined, at: Breakpoint | ''): (number | null)[] {
  const shown = widths.map((w, i) => {
    const bp = hideBelow?.[i] ?? '';
    return ORDER.indexOf(at) >= ORDER.indexOf(bp) ? Number(/^w-\[(\d+(?:\.\d+)?)%\]$/.exec(w)?.[1] ?? NaN) : null;
  });
  const total = shown.reduce<number>((sum, w) => sum + (w ?? 0), 0);
  return shown.map((w) => (w === null ? null : w / total));
}

/** The classes on the table element that hide the same columns' body cells. */
export function hideCellsClass(hideBelow: HideBelow | undefined): string {
  return (hideBelow ?? [])
    .map((bp, i) => (bp ? `[&_td:nth-child(${i + 1})]:hidden ${bp}:[&_td:nth-child(${i + 1})]:table-cell` : ''))
    .filter(Boolean)
    .join(' ');
}
