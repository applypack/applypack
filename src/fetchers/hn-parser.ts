/**
 * Pure HN comment parser. Extracts the (company, role, location, url)
 * tuple from a Who-is-hiring comment, using a small set of heuristics
 * to handle the most common formats. Returns null when no structure
 * can be found — caller skips the comment.
 *
 * Common formats observed in 2026 threads:
 *   "Company | Role | Location | salary | URL"
 *   "Company (Series X) | Role | Location | Type | $$ | URL"
 *   "Company (Remote US) — Role — Tech / Tech / Tech"
 *   "Role | Type | Remote | $X-$Y - URL"   (no company in front)
 *   "Company is hiring a Role: …"
 */

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/i;
const SEPARATOR_RE = /\s+[—|–]\s+/g;
// Case-sensitive on the company match (capital first letter) but the verbs
// are written lowercase in essentially every HN comment. No /i flag here —
// adding it would make [A-Z] match lowercase too and break "we are hiring".
// The optional "We at" / "We @" prefix lets us peel pronoun framing off
// the front so we capture the actual company name.
const HIRING_RE =
  /(?:^|\s)(?:[Ww]e\s+(?:at|@|here\s+at)\s+)?([A-Z][\w&. ]{1,50}?)\s+(?:is|are)\s+hiring\b/;

export interface HnParsedComment {
  title: string;
  companyName: string | null;
  location: string | null;
  url: string | null;
  /** Up to ~1000 chars of cleaned plaintext for downstream classification. */
  rawText: string;
}

export function parseHnComment(text: string): HnParsedComment | null {
  if (!text || typeof text !== 'string') return null;
  const cleaned = collapseWhitespace(text);
  if (cleaned.length === 0) return null;

  const firstLine = takeFirstSegment(cleaned);
  const url = extractUrl(cleaned);

  // 1. Try pipe / em-dash split — by far the most common format.
  const fields = splitFields(firstLine);
  if (fields.length >= 2) {
    const { companyName, title, location } = labelFields(fields);
    if (title.length > 0) {
      return {
        title,
        companyName,
        location,
        url,
        rawText: cleaned.slice(0, 1000),
      };
    }
  }

  // 2. Try "Company is hiring" pattern.
  const m = HIRING_RE.exec(cleaned);
  if (m && m[1]) {
    return {
      title: extractRoleAfterHiring(cleaned) ?? firstLine.slice(0, 120),
      companyName: m[1].trim(),
      location: null,
      url,
      rawText: cleaned.slice(0, 1000),
    };
  }

  // 3. No recognisable structure → bail. Caller can choose to skip.
  return null;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function takeFirstSegment(text: string): string {
  // The first sentence/paragraph usually carries the structured tuple.
  // Stop at the first sentence end or at 250 chars, whichever comes first.
  const stop = Math.min(text.length, 250);
  const slice = text.slice(0, stop);
  const dot = slice.indexOf('. ');
  return dot > 50 ? slice.slice(0, dot) : slice;
}

function splitFields(line: string): string[] {
  return line
    .split(SEPARATOR_RE)
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

function labelFields(fields: string[]): {
  companyName: string | null;
  title: string;
  location: string | null;
} {
  // Heuristics: if the first field looks like a role (contains "engineer",
  // "developer", "manager", etc.) the company is missing.
  const ROLE_HINT = /\b(engineer|developer|manager|designer|lead|director|architect|specialist|analyst|head)\b/i;
  if (ROLE_HINT.test(fields[0]!)) {
    return {
      companyName: null,
      title: fields[0]!.trim(),
      location: fields.length >= 2 ? (fields[1] ?? null) : null,
    };
  }
  return {
    companyName: fields[0]!.trim(),
    title: (fields[1] ?? '').trim(),
    location: fields.length >= 3 ? (fields[2] ?? null) : null,
  };
}

function extractUrl(text: string): string | null {
  const m = URL_RE.exec(text);
  if (!m) return null;
  // Strip trailing punctuation that often clings to a URL in prose.
  return m[0].replace(/[.,;:!?\]]+$/, '');
}

function extractRoleAfterHiring(text: string): string | null {
  // "X is hiring a Senior Engineer" → "Senior Engineer"
  const m =
    /(?:is|are)\s+hiring\s+(?:a\s+|an\s+|for\s+(?:a\s+|an\s+)?)?([^.|—–\n]{5,80})/.exec(
      text,
    );
  return m && m[1] ? m[1].trim() : null;
}
