/*
 * A page saved as one file — "Webpage, Single File" in Chrome and Edge
 * (.mhtml), the older .mht — is a MIME message (RFC 2557): a head, then the
 * page and everything it loads, a part each. The page is the first text/html
 * part. Such a file sat in a folder of saved postings and was passed over as
 * "another file" (#399). Read here with no dependency and nothing rendered:
 * the part's bytes become the markup `saved-page.ts` reads.
 *
 * What a browser leaves out matters more than the format: Blink drops every
 * `<script>`, the structured-data block among them, so such a file gives a
 * posting's text and its address and not its title or its company.
 * Pure — tested in mhtml.test.ts on a file a real browser wrote.
 */

export interface MhtmlPage {
  /** The page's markup, as the bytes the page is written in. */
  html: Uint8Array;
  /** The charset the part names, when it names one (an .mht does; Blink says it in the markup instead). */
  charset: string | null;
  /** Where the browser says the page was saved from; not checked here. */
  location: string | null;
}

/** The parts looked through for the page: it is the first, and a page with its images runs to hundreds. */
const MAX_PARTS = 40;
/** A head is a few lines; one that runs longer is not a head. */
const MAX_HEAD_CHARS = 16 * 1024;

interface Head {
  fields: Map<string, string>;
  /** Where the body starts. */
  bodyAt: number;
}

/** The header lines from `from` to the first empty line, folded lines joined, names lower-cased; null when there is none. */
function headAt(text: string, from: number, to: number): Head | null {
  const window = text.slice(from, Math.min(to, from + MAX_HEAD_CHARS));
  const end = /\r?\n\r?\n/.exec(window);
  if (!end) return null;
  const fields = new Map<string, string>();
  // A line that opens with a blank continues the one above.
  for (const line of window.slice(0, end.index).replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) fields.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return { fields, bodyAt: from + end.index + end[0].length };
}

/** A part's body as bytes. `body` holds one character a byte (latin1), so what is not encoded is already itself. */
function decodePart(body: string, encoding: string | undefined): Uint8Array {
  const how = (encoding ?? '').toLowerCase();
  if (how === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64');
  if (how !== 'quoted-printable') return Buffer.from(body, 'latin1');
  // "=" at a line's end joins it to the next; "=C3" is one byte.
  const joined = body.replace(/=[ \t]*\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return Buffer.from(joined, 'latin1');
}

const isHtml = (type: string | undefined): boolean => /^text\/html\b/i.test(type ?? '');
const charsetOf = (type: string | undefined): string | null => /charset\s*=\s*"?([\w.:-]+)/i.exec(type ?? '')?.[1] ?? null;

/** The page inside a single-file save, or null when the bytes are no such file or hold no page. */
export function readMhtml(bytes: Uint8Array): MhtmlPage | null {
  // One character a byte: nothing is lost before the part is decoded, and the head is plain ASCII either way.
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const top = headAt(text, 0, text.length);
  if (!top) return null;
  const type = top.fields.get('content-type');
  const savedFrom = top.fields.get('snapshot-content-location') ?? top.fields.get('content-location') ?? null;
  // The older single-part form: the message is the page.
  if (isHtml(type)) {
    return { html: decodePart(text.slice(top.bodyAt), top.fields.get('content-transfer-encoding')), charset: charsetOf(type), location: savedFrom };
  }
  const boundary = /boundary\s*=\s*(?:"([^"]+)"|([^\s;]+))/i.exec(type ?? '');
  if (!/^multipart\//i.test(type ?? '') || !boundary) return null;
  const marker = `--${boundary[1] ?? boundary[2]}`;
  let at = text.indexOf(marker, top.bodyAt);
  for (let n = 0; at !== -1 && n < MAX_PARTS; n++) {
    const lineEnd = text.indexOf('\n', at);
    if (lineEnd === -1) break;
    const next = text.indexOf(`\n${marker}`, lineEnd);
    const end = next === -1 ? text.length : next;
    const head = headAt(text, lineEnd + 1, end);
    if (head && isHtml(head.fields.get('content-type'))) {
      // The line break before the next marker belongs to the marker, not to the page.
      const body = text.slice(head.bodyAt, end).replace(/\r$/, '');
      return {
        html: decodePart(body, head.fields.get('content-transfer-encoding')),
        charset: charsetOf(head.fields.get('content-type')),
        location: head.fields.get('content-location') ?? savedFrom,
      };
    }
    if (next === -1) break;
    at = next + 1;
  }
  return null;
}
