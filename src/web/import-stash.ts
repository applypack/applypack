import { randomUUID } from 'node:crypto';
import type { Mapping, MappingField } from '../datasets/map';
import type { Reading } from '../datasets/read-notes';
import type { FoundRows } from '../datasets/rows';

/*
 * The rows of an uploaded file between its preview and its import
 * (ADR 0062). In memory only — nothing is written to disk — and short-lived:
 * half an hour or a restart forgets them, and the user uploads again. A
 * handful at most, so a few megabytes of rows cannot pile up.
 */

export interface ImportStash extends Pick<FoundRows, 'format' | 'rows' | 'over' | 'notRows'> {
  id: string;
  fileName: string;
  /** What of the file was lost in reading, and an encoding that had to be assumed: the preview says both. */
  reading: Reading;
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
  makeRoom();
  const stash: ImportStash = { ...fields, id: randomUUID(), createdAt: Date.now() };
  stashes.set(stash.id, stash);
  return stash;
}

/**
 * Puts a stash back for another half hour. An import can outlast the half
 * hour its upload had, and what it ends with — rows that could not be scored,
 * a fetch that was running — sends the person back to this preview for a
 * second press (#404).
 */
export function keepImport(stash: ImportStash): void {
  stashes.delete(stash.id);
  makeRoom();
  stash.createdAt = Date.now();
  stashes.set(stash.id, stash);
}

export function getImport(id: string): ImportStash | null {
  prune();
  return stashes.get(id) ?? null;
}

export function dropImport(id: string): void {
  stashes.delete(id);
}

/** Room for one more: the expired go, then the oldest — a Map keeps insertion order. */
function makeRoom(): void {
  prune();
  while (stashes.size >= MAX_STASHES) stashes.delete(stashes.keys().next().value!);
}

function prune(): void {
  const cutoff = Date.now() - STASH_TTL_MS;
  for (const [id, stash] of stashes) {
    if (stash.createdAt < cutoff) stashes.delete(id);
  }
}
