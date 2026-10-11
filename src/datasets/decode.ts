/*
 * A file's bytes as text (ADR 0062). Tools write UTF-8, and a spreadsheet's
 * "Unicode text" is UTF-16 behind a byte-order mark. A file that is neither —
 * Excel's plain "CSV" on Windows, a page saved off an older board — is in the
 * one-byte encoding of its language, which nothing in a table says and a page
 * says in its head. Read as UTF-8 anyway, every letter past ASCII came out as
 * U+FFFD and the posting was stored unreadable (#394). Pure — tested in
 * decode.test.ts.
 */

export interface Decoded {
  text: string;
  /** What the bytes were read as, by its WHATWG name. */
  encoding: string;
  /**
   * How that was known: `bytes` — they are UTF-8, or carry a mark; `declared`
   * — a page names its charset; `assumed` — neither, so the likelier of the
   * two encodings told apart here, which a reader should be told.
   */
  how: 'bytes' | 'declared' | 'assumed';
  /** Characters that could not be read, and stand in the text as U+FFFD. */
  unreadable: number;
}

const REPLACEMENT = '\uFFFD';
/** Where a page names its charset: inside the first kilobytes, by the HTML standard's own prescan. */
const DECLARATION_BYTES = 4096;
/** How much of a file is weighed when its encoding has to be assumed. */
const SAMPLE_BYTES = 64 * 1024;
/** A UTF-8 character is at most four bytes, so a file cut inside one loses at most three. */
const MAX_CUT_BYTES = 3;
/** Where the letters of both one-byte encodings told apart here begin; below it sit quotes, dashes and signs. */
const FIRST_LETTER_BYTE = 0xc0;
/** The Cyrillic letters windows-1251 keeps below that: Ukrainian і ї є ґ, Belarusian ў, Russian ё, and their capitals. */
const CYRILLIC_BELOW = new Set([0xa1, 0xa2, 0xa5, 0xa8, 0xaa, 0xaf, 0xb2, 0xb3, 0xb4, 0xb8, 0xba, 0xbf]);
/** Letters past ASCII side by side that make a word. A Western word holds one, now and then two ("créée"). */
const WORD_LETTERS = 3;
/**
 * How many times more of a text's characters past ASCII must read as UTF-8
 * than do not, for it to be UTF-8 with damage. A one-byte text holds a valid
 * UTF-8 pair by chance now and then ("Ві" is one), and in three letters that
 * can be one of two; a damaged UTF-8 file has hundreds to each bad byte.
 */
const UTF8_MAJORITY = 2;

type Decoder = InstanceType<typeof TextDecoder>;

const PAST_ASCII_RE = /[^\u0000-\u007F]/;

const count = (text: string, ch: string): number => text.split(ch).length - 1;

function strict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** A decoder for a charset somebody named, or null when this runtime has none by that name. */
function decoderFor(label: string): Decoder | null {
  try {
    return new TextDecoder(label);
  } catch {
    return null;
  }
}

/** The charset a page (or an XML document) says it is in, when it says one other than UTF-8. */
function declaredCharset(bytes: Uint8Array): Decoder | null {
  // latin1 keeps every byte a character, so the markup is readable whatever the letters are.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, DECLARATION_BYTES));
  const label = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1] ?? /<\?xml[^>]*\sencoding\s*=\s*["']([\w.:-]+)/i.exec(head)?.[1];
  const decoder = label ? decoderFor(label) : null;
  // A page that says UTF-8 and is not: its word is worth nothing, so the bytes are weighed instead.
  return decoder && decoder.encoding !== 'utf-8' && !decoder.encoding.startsWith('utf-16') ? decoder : null;
}

const isLetterByte = (byte: number): boolean => byte >= FIRST_LETTER_BYTE || CYRILLIC_BELOW.has(byte);

/**
 * Cyrillic or Western European, for bytes that name no encoding. In a Western
 * text a letter past ASCII stands among ASCII ones ("Zürich", "Café"); in a
 * Cyrillic one whole words are made of them. So: are more of the letters past
 * ASCII in a run of three or more than stand alone; two together say nothing.
 * Letters only — a Spanish `“¿` and a French `é »` are high bytes side by side
 * and no word. Measured on the interface's own sentences (3,883 Ukrainian,
 * 4,227 Spanish and French): no Western one is taken for Cyrillic, and the
 * Ukrainian ones that are missed hold no word longer than two letters
 * ("за {n} с"), which no file of postings is.
 */
function looksCyrillic(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, SAMPLE_BYTES);
  let alone = 0;
  let inWords = 0;
  for (let i = 0; i < sample.length; ) {
    if (!isLetterByte(sample[i]!)) {
      i++;
      continue;
    }
    let end = i;
    while (end < sample.length && isLetterByte(sample[end]!)) end++;
    if (end - i >= WORD_LETTERS) inWords += end - i;
    else if (end - i === 1) alone++;
    i = end;
  }
  return inWords > alone;
}

/** Whether these bytes open a UTF-8 character and stop before its end: a lead byte and the continuation bytes it got. */
function startsCharacter(tail: Uint8Array): boolean {
  const lead = tail[0]!;
  const length = lead > 0xf4 ? 0 : lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc2 ? 2 : 0;
  return tail.length < length && tail.subarray(1).every((b) => b >= 0x80 && b <= 0xbf);
}

/**
 * The text of a file. `page` says the bytes are markup that may name its own
 * charset (a saved page): asked only when they are not UTF-8.
 */
export function decodeText(bytes: Uint8Array, opts: { page?: boolean } = {}): Decoded {
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : null;
  if (utf16) return { text: new TextDecoder(utf16).decode(bytes), encoding: utf16, how: 'bytes', unreadable: 0 };
  const whole = strict(bytes);
  if (whole !== null) return { text: whole, encoding: 'utf-8', how: 'bytes', unreadable: 0 };

  // UTF-8 cut inside its last character (a file still being written, a download that stopped): the rest is
  // sound. Only when the rest shows it is UTF-8: after plain ASCII the same byte is a one-byte encoding's last
  // letter ("Activé"), which is the likelier file.
  for (let cut = 1; cut <= Math.min(MAX_CUT_BYTES, bytes.length); cut++) {
    if (!startsCharacter(bytes.subarray(bytes.length - cut))) continue;
    const head = strict(bytes.subarray(0, bytes.length - cut));
    if (head !== null && PAST_ASCII_RE.test(head)) return { text: head + REPLACEMENT, encoding: 'utf-8', how: 'bytes', unreadable: 1 };
  }
  // UTF-8 with a few bytes damaged: far more of what is past ASCII reads than does not, so it is kept as it is.
  const loose = new TextDecoder('utf-8').decode(bytes);
  const unreadable = count(loose, REPLACEMENT);
  let read = 0;
  for (const ch of loose) if (ch > '\u007F' && ch !== REPLACEMENT) read++;
  if (read > unreadable * UTF8_MAJORITY) return { text: loose, encoding: 'utf-8', how: 'bytes', unreadable };

  const declared = opts.page ? declaredCharset(bytes) : null;
  const decoder = declared ?? decoderFor(looksCyrillic(bytes) ? 'windows-1251' : 'windows-1252');
  // A runtime built without these tables has only the Unicode decoders: the marks stay, and are counted.
  if (!decoder) return { text: loose, encoding: 'utf-8', how: 'bytes', unreadable };
  const text = decoder.decode(bytes);
  return { text, encoding: decoder.encoding, how: declared ? 'declared' : 'assumed', unreadable: count(text, REPLACEMENT) };
}
