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

/** Returns the decompressed bytes of `name`, or null when the archive has no such entry. */
export function readZipEntry(zip: Buffer, name: string): Buffer | null {
  for (const record of centralDirectory(zip)) {
    if (record.name === name) return inflate(zip, record);
  }
  return null;
}

/**
 * Every file in the archive (directory entries skipped), in central-directory
 * order. An entry that would inflate past `maxEntryBytes` is not read — the
 * archive's own size says nothing about what a deflate stream expands to —
 * and its name comes back in `skipped`.
 */
export function readZipEntries(zip: Buffer, maxEntryBytes = Infinity): { entries: ZipEntry[]; skipped: string[] } {
  const entries: ZipEntry[] = [];
  const skipped: string[] = [];
  for (const record of centralDirectory(zip)) {
    if (record.name.endsWith('/')) continue;
    if (record.uncompressedSize > maxEntryBytes) {
      skipped.push(record.name);
      continue;
    }
    entries.push({ name: record.name, data: inflate(zip, record) });
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

function inflate(zip: Buffer, record: CentralRecord): Buffer {
  const { localOffset, compressedSize, method } = record;
  if (localOffset + LOCAL_MIN_LEN > zip.length || zip.readUInt32LE(localOffset) !== LOCAL_SIG) {
    throw new ZipError('corrupt local header');
  }
  const dataStart =
    localOffset + LOCAL_MIN_LEN + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
  const data = zip.subarray(dataStart, dataStart + compressedSize);
  if (method === METHOD_STORED) return Buffer.from(data);
  if (method === METHOD_DEFLATE) return inflateRawSync(data);
  throw new ZipError(`unsupported compression method ${method}`);
}

function findEndOfCentralDirectory(zip: Buffer): number {
  const stop = Math.max(0, zip.length - EOCD_MIN_LEN - MAX_COMMENT_LEN);
  for (let i = zip.length - EOCD_MIN_LEN; i >= stop; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new ZipError('not a zip archive');
}
