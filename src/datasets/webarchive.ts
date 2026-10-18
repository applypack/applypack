/*
 * Safari's "Web Archive" (.webarchive) — what Safari saves a page as by
 * default — is a binary property list (`bplist00`): a table of objects, a
 * table of where each begins, and a 32-byte trailer that says how wide the
 * numbers in both are. The page is `WebMainResource.WebResourceData`, its
 * bytes as Safari received them, scripts included; the archive also names
 * the page's charset and the address it was saved from. Such a file was
 * listed in a folder of saved postings and set aside with the way to save
 * it instead (#399, #451).
 *
 * Read here with no dependency and nothing rendered: three keys are looked
 * up and everything else in the archive — the images, the frames — is never
 * walked. Every offset is checked against the file before it is followed.
 * Pure — tested in webarchive.test.ts on a file written in the same format.
 */

export interface WebArchivePage {
  /** The page's markup, as the bytes it is written in. */
  html: Uint8Array;
  /** The charset the archive names for the page, when it names one. */
  charset: string | null;
  /** Where Safari says the page was saved from; not checked here. */
  location: string | null;
}

const MAGIC = 'bplist00';
const TRAILER_BYTES = 32;
/** A page with every image it loads is a few thousand objects; a table claiming more is not an archive. */
const MAX_OBJECTS = 1_000_000;
/** The keys of one dictionary that are looked through for a name. */
const MAX_KEYS = 4_096;
/** A name or an address is short; a longer string is not one. */
const MAX_STRING_CHARS = 8_192;

/** Marker nibbles of the object kinds read here (the rest are skipped, never decoded). */
const INT = 0x1;
const DATA = 0x4;
const ASCII = 0x5;
const UTF16 = 0x6;
const DICT = 0xd;

export function readWebArchive(bytes: Uint8Array): WebArchivePage | null {
  if (bytes.length < MAGIC.length + TRAILER_BYTES) return null;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) return null;

  /** A big-endian whole number of `size` bytes at `at`; null when it runs off the file or past what a number holds exactly. */
  const uint = (at: number, size: number): number | null => {
    if (size < 1 || size > 8 || at < 0 || at + size > bytes.length) return null;
    let n = 0;
    for (let i = 0; i < size; i++) n = n * 256 + bytes[at + i]!;
    return Number.isSafeInteger(n) ? n : null;
  };

  const trailer = bytes.length - TRAILER_BYTES;
  const offsetSize = bytes[trailer + 6]!;
  const refSize = bytes[trailer + 7]!;
  const count = uint(trailer + 8, 8);
  const top = uint(trailer + 16, 8);
  const table = uint(trailer + 24, 8);
  if (count === null || top === null || table === null || count > MAX_OBJECTS || top >= count) return null;
  if (table < MAGIC.length || table + count * offsetSize > trailer) return null;

  /** Where object `ref` begins, or null. */
  const at = (ref: number | null): number | null => {
    if (ref === null || ref >= count) return null;
    const offset = uint(table + ref * offsetSize, offsetSize);
    return offset === null || offset < MAGIC.length || offset >= table ? null : offset;
  };
  /** An object's kind, its length, and where its content starts: the length sits in the marker, or in a whole number after it. */
  const head = (ref: number | null): { kind: number; length: number; body: number } | null => {
    const pos = at(ref);
    if (pos === null) return null;
    const marker = bytes[pos]!;
    const low = marker & 0x0f;
    if (low !== 0x0f) return { kind: marker >> 4, length: low, body: pos + 1 };
    const sized = bytes[pos + 1];
    if (sized === undefined || sized >> 4 !== INT) return null;
    const width = 1 << (sized & 0x0f);
    const length = uint(pos + 2, width);
    return length === null ? null : { kind: marker >> 4, length, body: pos + 2 + width };
  };
  const string = (ref: number | null): string | null => {
    const h = head(ref);
    if (h === null || h.length > MAX_STRING_CHARS) return null;
    if (h.kind === ASCII) return h.body + h.length > table ? null : String.fromCharCode(...bytes.subarray(h.body, h.body + h.length));
    if (h.kind !== UTF16 || h.body + h.length * 2 > table) return null;
    let text = '';
    for (let i = 0; i < h.length; i++) text += String.fromCharCode(bytes[h.body + i * 2]! * 256 + bytes[h.body + i * 2 + 1]!);
    return text;
  };
  /** The object a dictionary holds under `key`, as a reference; null when it holds none. */
  const under = (ref: number | null, key: string): number | null => {
    const h = head(ref);
    if (h === null || h.kind !== DICT || h.length > MAX_KEYS || h.body + h.length * refSize * 2 > table) return null;
    for (let i = 0; i < h.length; i++) {
      if (string(uint(h.body + i * refSize, refSize)) === key) return uint(h.body + (h.length + i) * refSize, refSize);
    }
    return null;
  };

  const main = under(top, 'WebMainResource');
  const data = head(under(main, 'WebResourceData'));
  if (data === null || data.kind !== DATA || data.length === 0 || data.body + data.length > table) return null;
  // The archive of a PDF or an image opened in Safari has a main resource too, and it is no page.
  const type = string(under(main, 'WebResourceMIMEType'));
  if (type !== null && !/html|xml/i.test(type)) return null;
  return {
    html: bytes.subarray(data.body, data.body + data.length),
    charset: string(under(main, 'WebResourceTextEncodingName')),
    location: string(under(main, 'WebResourceURL')),
  };
}
