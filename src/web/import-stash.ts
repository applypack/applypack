import { randomUUID } from 'node:crypto';
import type { Mapping, MappingField } from '../datasets/map';
import type { FoundRows } from '../datasets/rows';

/*
 * The rows of an uploaded file between its preview and its import
 * (ADR 0062). In memory only — nothing is written to disk — and short-lived:
 * half an hour or a restart forgets them, and the user uploads again. A
 * handful at most, so a few megabytes of rows cannot pile up.
 */

export interface ImportStash extends FoundRows {
  id: string;
  fileName: string;
  /** Where the rows go: an import source that exists (`id`), or the name of one to create. */
  source: { id: number | null; name: string };
  mapping: Mapping;
  /** Fields the mapping read off the values rather than the names — the preview marks them. */
  guessed: MappingField[];
  createdAt: number;
}

const STASH_TTL_MS = 30 * 60_000;
const MAX_STASHES = 4;
const stashes = new Map<string, ImportStash>();

export function stashImport(fields: Omit<ImportStash, 'id' | 'createdAt'>): ImportStash {
  prune();
  // The oldest goes first: a Map keeps insertion order.
  while (stashes.size >= MAX_STASHES) stashes.delete(stashes.keys().next().value!);
  const stash: ImportStash = { ...fields, id: randomUUID(), createdAt: Date.now() };
  stashes.set(stash.id, stash);
  return stash;
}

export function getImport(id: string): ImportStash | null {
  prune();
  return stashes.get(id) ?? null;
}

export function dropImport(id: string): void {
  stashes.delete(id);
}

function prune(): void {
  const cutoff = Date.now() - STASH_TTL_MS;
  for (const [id, stash] of stashes) {
    if (stash.createdAt < cutoff) stashes.delete(id);
  }
}
