/*
 * What a reader should be told about how a file of rows was read (#394): the
 * part that was lost, and an encoding nobody named. One wording for the
 * import's preview, a folder's Check page and the folder's ledger. Pure —
 * tested in read-notes.test.ts.
 */

import { t } from '../i18n/t';
import type { Decoded } from './decode';

export interface Reading {
  /** The line a quote opens on and never closes: nothing from there on was read (rows.ts). */
  cutAt: number | null;
  /** Characters that could not be read and stand as U+FFFD (decode.ts). */
  unreadable: number;
  /** The encoding a file that is not UTF-8, and says nothing else, was read as; null when the bytes or the page said. */
  assumed: string | null;
}

export function readingOf(decoded: Pick<Decoded, 'encoding' | 'how' | 'unreadable'>, cutAt: number | null): Reading {
  return { cutAt, unreadable: decoded.unreadable, assumed: decoded.how === 'assumed' ? decoded.encoding : null };
}

/** What of the file was not read, a sentence each: a file with one of these was never read whole. */
export function lossNotes(reading: Pick<Reading, 'cutAt' | 'unreadable'>): string[] {
  const notes: string[] = [];
  if (reading.cutAt !== null) notes.push(t('datasets.read.cut', { line: reading.cutAt }));
  if (reading.unreadable > 0) notes.push(t('datasets.read.unreadable', { n: reading.unreadable }));
  return notes;
}

/** The sentence for an encoding that had to be assumed, or null: nothing was lost, and a name may still read wrong. */
export function assumedNote(reading: Pick<Reading, 'assumed'>): string | null {
  if (reading.assumed === null) return null;
  return t('datasets.read.assumed', { encoding: reading.assumed === 'windows-1251' ? 'cyrillic' : 'western' });
}
