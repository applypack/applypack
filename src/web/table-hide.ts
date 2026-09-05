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

/** The classes on the table element that hide the same columns' body cells. */
export function hideCellsClass(hideBelow: HideBelow | undefined): string {
  return (hideBelow ?? [])
    .map((bp, i) => (bp ? `[&_td:nth-child(${i + 1})]:hidden ${bp}:[&_td:nth-child(${i + 1})]:table-cell` : ''))
    .filter(Boolean)
    .join(' ');
}
