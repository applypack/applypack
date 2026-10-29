import { choiceParam } from './params';

/** The lengths Settings → Screening offers for keeping a screening, in days. */
const RETENTION_CHOICES = [30, 60, 90, 180, 365] as const;

interface Bounds {
  min: number;
  max: number;
}

/**
 * What the retention select offers: the lengths above inside the bounds, and
 * the stored one when it is none of them — so saving the form keeps it.
 */
export function retentionChoices(stored: number, bounds: Bounds): number[] {
  const offered: number[] = RETENTION_CHOICES.filter((d) => d >= bounds.min && d <= bounds.max);
  return offered.includes(stored) ? offered : [...offered, stored].sort((a, b) => a - b);
}

/**
 * The length a save posted, when the select offers it; null for anything
 * else (#646) — an emptied field was stored as 7 days and a typed 45 as 45,
 * neither of which the page offers.
 */
export function retentionParam(raw: unknown, stored: number, bounds: Bounds): number | null {
  const picked = choiceParam(raw, retentionChoices(stored, bounds).map(String));
  return picked === null ? null : Number(picked);
}
