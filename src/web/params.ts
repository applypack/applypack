/*
 * Ids and numbers off the request. Prisma throws on a NaN in a where clause
 * and on a fraction in an Int column alike, and `Number.isFinite(Number(x))`
 * lets `1.5`, `1e2` and ` 12 ` through — 500s where a 400 or a 404 belongs
 * (audit 2026-09-10, ROUTE-2). Every route reads ids through here.
 */

/** A path, form or query id: a positive integer of at most nine digits, else NaN. */
export function idParam(raw: unknown): number {
  return typeof raw === 'string' && /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
}

/** An optional integer off the query string (a score floor), or null when absent or not one. */
export function intQuery(raw: unknown): number | null {
  return typeof raw === 'string' && /^-?\d{1,9}$/.test(raw) ? Number(raw) : null;
}
