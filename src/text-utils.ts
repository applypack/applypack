/**
 * Pure text/parsing helpers shared across modules. Keep this file free of
 * side-effectful imports (no db, no config) so it's testable in isolation.
 */

import { createHash } from 'node:crypto';

/**
 * Stable 16-char hex id derived from any string. Used by fetchers to
 * synthesize an externalId when the upstream source does not expose one.
 */
export function hashShortId(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

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

/**
 * Maps a classifier mode to the stage-1 decision. Trivial but explicit so
 * we can unit-test the toggle semantics in isolation from the API client.
 */
export function decideStageStrategy(
  mode: 'single' | 'two_stage',
): 'skip-stage1' | 'run-stage1' {
  return mode === 'two_stage' ? 'run-stage1' : 'skip-stage1';
}
