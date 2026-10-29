/*
 * A vendor's structured pay folded into the posting's text, the way the
 * classifier reads it (F2 decision: no salary columns from a fetcher —
 * the model reports `salary_min/max/currency/period` off the text).
 */

/** "60000-80000", "from 60000", "up to 80000" or "60000"; null when neither bound is a positive number. */
export function rangeText(min: number | null | undefined, max: number | null | undefined): string | null {
  const low = typeof min === 'number' && Number.isFinite(min) && min > 0 ? min : null;
  const high = typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : null;
  if (low !== null && high !== null) return low === high ? `${low}` : `${low}-${high}`;
  if (low !== null) return `from ${low}`;
  return high !== null ? `up to ${high}` : null;
}

/** "Salary: 60000-80000 EUR (year)."; null when the range says nothing. */
export function salaryLine(
  min: number | null | undefined,
  max: number | null | undefined,
  currency?: string | null,
  period?: string | null,
): string | null {
  const range = rangeText(min, max);
  if (range === null) return null;
  const cur = currency?.trim();
  const per = period?.trim();
  return `Salary: ${range}${cur ? ` ${cur}` : ''}${per ? ` (${per})` : ''}.`;
}
