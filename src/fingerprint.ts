/**
 * Content fingerprints for near-duplicate job descriptions (SimHash over
 * 3-token shingles). Pure — no DB, no HTTP, no config.
 *
 * Constants below were measured on our own corpus, not guessed; the evidence
 * and the failure they prevent are in ADR 0018.
 */

import { createHash } from 'node:crypto';

/**
 * A body shorter than this carries no role-specific signal. Jobicy ships
 * truncated teasers (normalized max 284 chars) that are byte-identical across
 * different roles at one company; sources with real bodies start around 550.
 */
export const MIN_NORMALIZED_CHARS = 400;

/** Shingle width. Three tokens is enough context that common phrases
 *  ("we are looking for") stop dominating the vote. */
const SHINGLE_TOKENS = 3;

/**
 * Bits that may differ before two bodies stop counting as the same posting.
 * Every cross-company match up to 7 in our corpus was a genuine cross-listing;
 * the first false positive appears at 10.
 */
export const MAX_HAMMING_DISTANCE = 7;

const HTML_TAG = /<[^>]+>/g;
const HTML_ENTITY = /&(?:#x?[0-9a-f]+|[a-z]+);/gi;
const URL_LIKE = /https?:\/\/\S+|www\.\S+/gi;
/** Letters, marks and digits in any script — never `[a-z0-9]`, which would
 *  reduce a Cyrillic or CJK body to nothing. */
const TOKEN = /[\p{L}\p{M}\p{N}]+/gu;

/**
 * JD body → comparable tokens. Markup, entities and URLs are noise that
 * differs between two copies of the same posting, so they go first.
 */
export function normalizeJdText(text: string | null | undefined): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const stripped = text
    .toLowerCase()
    .replace(HTML_TAG, ' ')
    .replace(HTML_ENTITY, ' ')
    .replace(URL_LIKE, ' ')
    .normalize('NFKC');
  return stripped.match(TOKEN) ?? [];
}

/** Length of the normalized body, counting one separator per token. */
export function normalizedLength(tokens: readonly string[]): number {
  let total = 0;
  for (const t of tokens) total += t.length + 1;
  return total;
}

/**
 * 64-bit SimHash: hash every 3-token shingle, let each shingle vote once per
 * bit, and keep the majority. Returns null when the body is too short or too
 * thin to fingerprint — a null never matches anything, which is the safe
 * direction.
 */
export function simhash64(text: string | null | undefined): bigint | null {
  const tokens = normalizeJdText(text);
  if (tokens.length < SHINGLE_TOKENS) return null;
  if (normalizedLength(tokens) < MIN_NORMALIZED_CHARS) return null;

  const votes = new Int32Array(64);
  for (let i = 0; i + SHINGLE_TOKENS <= tokens.length; i++) {
    const shingle = tokens.slice(i, i + SHINGLE_TOKENS).join(' ');
    const digest = createHash('sha1').update(shingle).digest();
    // First 8 bytes of the digest are the shingle's 64-bit hash.
    for (let bit = 0; bit < 64; bit++) {
      const byte = digest[bit >> 3] ?? 0;
      const isSet = (byte >> (bit & 7)) & 1;
      votes[bit] = (votes[bit] ?? 0) + (isSet ? 1 : -1);
    }
  }

  let hash = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if ((votes[bit] ?? 0) > 0) hash |= 1n << BigInt(bit);
  }
  return hash;
}

/** Number of differing bits between two fingerprints. */
export function hamming64(a: bigint, b: bigint): number {
  let diff = a ^ b;
  let bits = 0;
  while (diff !== 0n) {
    diff &= diff - 1n;
    bits++;
  }
  return bits;
}

/**
 * Do two fingerprints describe the same posting? A missing fingerprint is not
 * a match — "we could not tell" must never read as "duplicate".
 */
export function isNearDuplicate(
  a: bigint | null | undefined,
  b: bigint | null | undefined,
  maxDistance: number = MAX_HAMMING_DISTANCE,
): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return hamming64(a, b) <= maxDistance;
}

export interface FingerprintedJob {
  id: number;
  companyId: number;
  descriptionSimhash: bigint | null;
}

/**
 * Closest cross-company near-duplicate of `fingerprint`, or null. Same-company
 * rows are skipped by design: at this threshold a quarter of them are
 * genuinely different roles sharing a company's boilerplate, and reposts are
 * F11's problem (ADR 0018).
 */
export function findCrossListing(
  fingerprint: bigint | null,
  companyId: number,
  candidates: readonly FingerprintedJob[],
  maxDistance: number = MAX_HAMMING_DISTANCE,
): { job: FingerprintedJob; distance: number } | null {
  if (fingerprint === null) return null;

  let best: { job: FingerprintedJob; distance: number } | null = null;
  for (const candidate of candidates) {
    if (candidate.companyId === companyId) continue;
    if (candidate.descriptionSimhash === null) continue;
    const distance = hamming64(fingerprint, candidate.descriptionSimhash);
    if (distance > maxDistance) continue;
    if (best === null || distance < best.distance) {
      best = { job: candidate, distance };
    }
  }
  return best;
}
