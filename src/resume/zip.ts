import { inflateRawSync } from 'node:zlib';

/*
 * Minimal read-only zip parser — enough to pull one part out of a .docx
 * (which is a zip of XML files), or every file out of an archive of resumes
 * (screening/intake.ts). Stored and deflate entries only, no zip64, no
 * encryption. Kept in-house so the resume module adds no dependency.
 */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_MIN_LEN = 22;
const CENTRAL_MIN_LEN = 46;
const LOCAL_MIN_LEN = 30;
const MAX_COMMENT_LEN = 0xffff;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export class ZipError extends Error {}
/** An entry that would inflate past the ceiling it was given — the archive's own size field is not consulted. */
export class ZipLimitError extends ZipError {}

/** One part of a .docx; the largest document.xml in the corpus is under 2 MB. */
export const MAX_INFLATED_PART_BYTES = 64 * 1024 * 1024;
/** Everything an archive of resumes may inflate to, in total — the web process holds it all at once. */
export const MAX_INFLATED_TOTAL_BYTES = 512 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  data: Buffer;
}

interface CentralRecord {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

/**
 * Returns the decompressed bytes of `name`, or null when the archive has no
 * such entry. A part that inflates past `maxBytes` throws ZipLimitError.
 */
export function readZipEntry(zip: Buffer, name: string, maxBytes = MAX_INFLATED_PART_BYTES): Buffer | null {
  for (const record of centralDirectory(zip)) {
    if (record.name === name) return inflate(zip, record, maxBytes);
  }
  return null;
}

/**
 * Every file in the archive (directory entries skipped), in central-directory
 * order. An entry that would inflate past `maxEntryBytes`, or past what is
 * left of `maxTotalBytes`, is not read and its name comes back in `skipped`.
 * The archive's own size field is a hint that lets a cheap skip happen first;
 * the ceiling is enforced on the inflater, because that field is whatever the
 * archive's author wrote (audit 2026-09-10).
 */
export function readZipEntries(
  zip: Buffer,
  maxEntryBytes = Infinity,
  maxTotalBytes = MAX_INFLATED_TOTAL_BYTES,
): { entries: ZipEntry[]; skipped: string[] } {
  const entries: ZipEntry[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const record of centralDirectory(zip)) {
    if (record.name.endsWith('/')) continue;
    const room = Math.min(maxEntryBytes, maxTotalBytes - total);
    // zlib refuses a ceiling under one byte, so a full archive skips the rest
    // outright instead of asking the inflater for nothing.
    if (room < 1 || record.uncompressedSize > room) {
      skipped.push(record.name);
      continue;
    }
    let data: Buffer;
    try {
      data = inflate(zip, record, room);
    } catch (err) {
      if (err instanceof ZipLimitError) {
        skipped.push(record.name);
        continue;
      }
      throw err;
    }
    total += data.length;
    entries.push({ name: record.name, data });
  }
  return { entries, skipped };
}

function* centralDirectory(zip: Buffer): Generator<CentralRecord> {
  const eocd = findEndOfCentralDirectory(zip);
  const entryCount = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    if (offset + CENTRAL_MIN_LEN > zip.length || zip.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw new ZipError('corrupt central directory');
    }
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLen);
    yield { name, method, compressedSize, uncompressedSize, localOffset };
    offset += CENTRAL_MIN_LEN + nameLen + extraLen + commentLen;
  }
}

function inflate(zip: Buffer, record: CentralRecord, maxBytes: number): Buffer {
  const { localOffset, compressedSize, method } = record;
  if (localOffset + LOCAL_MIN_LEN > zip.length || zip.readUInt32LE(localOffset) !== LOCAL_SIG) {
    throw new ZipError('corrupt local header');
  }
  const dataStart =
    localOffset + LOCAL_MIN_LEN + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
  const data = zip.subarray(dataStart, dataStart + compressedSize);
  if (method === METHOD_STORED) {
    if (data.length > maxBytes) throw new ZipLimitError(`${record.name} is larger than ${maxBytes} bytes`);
    return Buffer.from(data);
  }
  if (method !== METHOD_DEFLATE) throw new ZipError(`unsupported compression method ${method}`);
  try {
    return Number.isFinite(maxBytes) ? inflateRawSync(data, { maxOutputLength: maxBytes }) : inflateRawSync(data);
  } catch (err) {
    if ((err as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new ZipLimitError(`${record.name} inflates past ${maxBytes} bytes`);
    }
    throw err;
  }
}

function findEndOfCentralDirectory(zip: Buffer): number {
  const stop = Math.max(0, zip.length - EOCD_MIN_LEN - MAX_COMMENT_LEN);
  for (let i = zip.length - EOCD_MIN_LEN; i >= stop; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new ZipError('not a zip archive');
}
