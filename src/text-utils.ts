/**
 * Pure text/parsing helpers shared across modules. Keep this file free of
 * side-effectful imports (no db, no config) so it's testable in isolation.
 */

/**
 * Parses a textarea value into a list of trimmed tags. Accepts both newline
 * and comma separators. Empty entries are dropped.
 */
export function parseTagList(input: string): string[] {
  return input
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Form fields that may arrive as undefined / single string / string[] —
 * normalise to a string[].
 */
export function toStringArray(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string') return v.length > 0 ? [v] : [];
  return [];
}

/**
 * Mask a Telegram bot token (or any secret-ish string) for display:
 * "12345678***xyz9". Tokens shorter than 12 chars are fully redacted.
 */
export function maskToken(token: string): string {
  if (token.length <= 12) return '***';
  return `${token.slice(0, 8)}***${token.slice(-4)}`;
}

/**
 * Best-effort JSON extraction from text that may have leading/trailing
 * commentary. Finds the first '{' and last '}' and tries JSON.parse on the
 * substring. Returns null on any parse failure.
 */
export function extractJson(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
