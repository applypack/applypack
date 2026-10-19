import { emptyResume, JsonResumeSchema, type JsonResume } from './json-resume';
import type { PdfLayout } from './pdf-layout';

/** What a PDF's own page says about its lines (pdf-layout.ts) — the only hints the reader takes. */
export type TextLayout = Pick<PdfLayout, 'columns' | 'pairs'>;

/*
 * The structure a resume has before any model has read it (ADR 0039): headings,
 * roles and bullets recovered from the extracted text alone. Pure — text in,
 * a JsonResume out.
 *
 * Used when the scan has not run, failed, or had everything dropped by the
 * anchor guard, so the render page always has something to draw. It is a
 * FLOOR, not a rival to the scan: it can split a resume into sections and
 * pull bullets out of a role, and it deliberately cannot do the one thing
 * only a model can — re-pair the label column of a skills table with its
 * value column, which both readers hand us as two stacks of lines.
 *
 * Both heading dialects the corpus produces are recognised: `## KEY SKILLS`
 * (docx-text.ts renders Word heading styles that way) and a bare `KEY SKILLS`
 * (what a PDF's text layer gives). Measured on the three stored resumes. A third
 * is read by its words alone: "Experience" in ordinary case, a whole line that is
 * one of HEADING_PHRASES (a plain-text resume, a PDF with no capitals).
 */

/** A bare line is a heading only if it is short — a shouted sentence is not a section. */
const MAX_HEADING_CHARS = 44;
/** A heading the text marks itself ("## Skills") may be longer than a shouted one, but not a paragraph. */
const MAX_MD_HEADING_CHARS = 80;
/** Two commas make a line a list: no section heading the corpus writes carries them. */
const LIST_LIKE = /,.*,/;
/** "Austin, Texas, 78758" or "Kyiv, Ukraine (open to relocation)": a place is a few short words either side of a comma. */
const MAX_PLACE_CHARS = 60;
const MAX_PLACE_WORDS = 4;
const BULLET = /^\s*[-•*·‣▪]\s+/;
const MD_HEADING = /^\s*#{1,6}\s+(.+?)\s*$/;
/** The reader's mark for a Title-styled paragraph (docx-text.ts): one "#", not a section's "##". */
const TITLE_MARK = /^\s*#\s+/;
/** Contact-ish separators the corpus uses between the parts of one line. */
const SEPARATORS = /\s*[∙·|•]\s*/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?:\+\d[\d\s().-]{7,})|(?:\(\d{3}\)\s*\d{3}[\s.-]?\d{4})/;
const URL = /(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|dev|io|net|org|me|co)\/\S+/i;
/** A dash between two dates, in any of the shapes the corpus writes it. */
const DATE_RANGE =
  /((?:\w{3,9}\.?\s*)?\d{4}|Present|Current)\s*[–—-]\s*((?:\w{3,9}\.?\s*)?\d{4}|Present|Current)/i;

type SectionKind = 'summary' | 'skills' | 'work' | 'education' | 'languages' | 'certificates' | 'projects' | 'other';

const SECTION_WORDS: Array<[SectionKind, RegExp]> = [
  ['summary', /\b(summary|profile|objective|about)\b/i],
  ['skills', /\b(skills|technolog|stack|competenc|expertise)\b/i],
  ['work', /\b(experience|employment|work history|career)\b/i],
  ['education', /\b(education|academic)\b/i],
  ['languages', /\blanguages?\b/i],
  ['certificates', /\b(certificat|licens|course)\b/i],
  ['projects', /\bprojects?\b/i],
];

/**
 * The section headings a resume writes in ordinary case, whole-line and lower-cased
 * ("&" read as "and"). A bare "Experience" is no shout, so `headingOf` needs the
 * phrase itself; the kind still comes from SECTION_WORDS.
 */
const HEADING_PHRASES = new Set([
  'summary', 'professional summary', 'career summary', 'executive summary', 'profile', 'professional profile',
  'personal profile', 'profile summary', 'about', 'about me', 'objective', 'career objective',
  'experience', 'work experience', 'professional experience', 'relevant experience', 'employment',
  'employment history', 'work history', 'career history', 'career',
  'education', 'education and training', 'academic background',
  'skills', 'technical skills', 'key skills', 'core skills', 'skills and tools', 'core competencies',
  'competencies', 'technologies', 'tech stack', 'expertise', 'areas of expertise',
  'languages', 'certifications', 'certificates', 'licenses and certifications', 'courses',
  'projects', 'personal projects', 'selected projects', 'side projects',
  'awards', 'honors', 'achievements', 'publications', 'volunteering', 'interests', 'references',
]);

/** Where a section's heading is kept: the render's section key. `other` sections carry their own. */
const HEADING_KEY: Record<SectionKind, string | null> = {
  summary: 'summary',
  skills: 'skills',
  work: 'work',
  education: 'education',
  languages: 'languages',
  certificates: 'certificates',
  projects: 'projects',
  other: null,
};

interface Section {
  heading: string;
  kind: SectionKind;
  lines: string[];
}

export function structureFromText(text: string, layout: TextLayout | null = null): JsonResume {
  const all = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd());
  const { header, sections } = split(all);
  const out = emptyResume();
  out.basics = basicsFrom(header);

  for (const section of sections) {
    const lines = section.lines.filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    // The resume's own words for the section, not ours ("KEY SKILLS", not "Skills").
    const key = HEADING_KEY[section.kind];
    if (key && out.headings[key] === undefined) out.headings[key] = section.heading;
    switch (section.kind) {
      case 'summary':
        out.basics.summary = joinWrapped(lines).join(' ') || null;
        break;
      case 'skills':
        out.skills.push(...skillsFrom(lines, layout));
        break;
      case 'work':
        out.work.push(...rolesFrom(lines, layout));
        break;
      case 'education':
        out.education.push(...educationFrom(lines));
        break;
      case 'languages':
        out.languages.push(...languagesFrom(lines));
        break;
      case 'certificates':
        out.certificates.push(...joinWrapped(lines).map((name) => ({ name, issuer: null, date: null })));
        break;
      case 'projects':
        out.projects.push(
          ...joinWrapped(lines).map((name) => ({ name, description: null, url: null, highlights: [] })),
        );
        break;
      default:
        out.extras.push({ heading: section.heading, lines: joinWrapped(lines) });
    }
  }
  // Back through the schema so the fallback and the model's reply are the same
  // shape by construction, caps and all.
  return JsonResumeSchema.parse(out);
}

/* ---------- splitting ---------- */

function split(lines: string[]): { header: string[]; sections: Section[] } {
  const header: string[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const raw of lines) {
    // The title a resume opens with is its owner's name: the header, not a
    // section — read as one, the name, the headline and the contacts were lost (#591).
    const opensResume = sections.length === 0 && header.every((l) => l.trim() === '');
    const heading = opensResume && TITLE_MARK.test(raw) ? null : headingOf(raw);
    if (heading !== null) {
      current = { heading, kind: kindOf(heading), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(raw);
    else header.push(raw);
  }
  return { header, sections };
}

function headingOf(line: string): string | null {
  const md = MD_HEADING.exec(line);
  // A Word heading style on a whole table row (the fixture's run-on line) is
  // styled content, and the section it would open would swallow it.
  if (md) return (md[1] ?? '').length <= MAX_MD_HEADING_CHARS && !LIST_LIKE.test(md[1] ?? '') ? (md[1] ?? null) : null;
  const t = line.trim();
  if (t.length === 0 || t.length > MAX_HEADING_CHARS) return null;
  if (BULLET.test(line) || EMAIL.test(t) || URL.test(t)) return null;
  // "AWS, S3, EC2, SQS, RDS, OWASP" is shouting too, and it is a list, not a section.
  if (LIST_LIKE.test(t)) return null;
  // "Experience" or "Work experience:" as the whole line: the heading a plain-text
  // or PDF resume writes in ordinary case. Only the whole phrase counts, so a
  // wrapped line of prose that opens with "Experience in …" stays content.
  if (HEADING_PHRASES.has(t.toLowerCase().replace(/\s*:$/, '').replace(/\s*&\s*/g, ' and ').replace(/\s+/g, ' '))) {
    return t.replace(/\s*:$/, '');
  }
  // All-caps with no lower-case letter, and at least one letter to shout with.
  if (!/\p{Lu}/u.test(t) || /\p{Ll}/u.test(t)) return null;
  if (/[.:;]$/.test(t)) return null;
  return t;
}

function kindOf(heading: string): SectionKind {
  for (const [kind, re] of SECTION_WORDS) if (re.test(heading)) return kind;
  return 'other';
}

/* ---------- the header block ---------- */

function basicsFrom(header: string[]): JsonResume['basics'] {
  const lines = header.filter((l) => l.trim().length > 0);
  const basics = emptyResume().basics;
  if (lines.length === 0) return basics;
  basics.name = (lines[0] ?? '').replace(TITLE_MARK, '').trim();
  const rest = lines.slice(1);
  // The label is the line after the name, unless that line is already contact
  // details — a resume that opens straight into an email has no label.
  const labelAt = rest.findIndex((l) => !EMAIL.test(l) && !PHONE.test(l) && !URL.test(l));
  if (labelAt >= 0) basics.label = rest[labelAt]!.trim();
  for (const [i, line] of rest.entries()) {
    // The label is read whole. Split on its own "|" ("Engineer | Roadmap
    // Ownership") it came back as a header line too, and the clean version
    // printed the title twice (reported 2026-09-30).
    if (i === labelAt) continue;
    const unread: string[] = [];
    for (const [j, part] of line.split(SEPARATORS).map((p) => p.trim()).filter(Boolean).entries()) {
      if (readContactPart(basics, part)) continue;
      // "Senior Developer | dana@example.com | Lisbon": with no line of its own,
      // the title is what opens the contact line.
      if (j === 0 && basics.label === null) basics.label = part;
      else unread.push(part);
    }
    if (unread.length === 0) continue;
    // What no field reads — "Fully Work Authorized ∙ No Visa Sponsorship
    // Required" — stays as the resume writes it: dropping it lost a line of
    // the owner's own header, and a renderer cannot put back what it never got.
    basics.lines.push(unread.length === line.split(SEPARATORS).filter((p) => p.trim()).length ? line.trim() : unread.join(' · '));
  }
  return basics;
}

/** Put one part of a contact line where it belongs; false when nothing reads it. */
function readContactPart(basics: JsonResume['basics'], part: string): boolean {
  const email = EMAIL.exec(part);
  if (email && !basics.email) { basics.email = email[0]; return true; }
  const phone = PHONE.exec(part);
  if (phone && !basics.phone) { basics.phone = phone[0].trim(); return true; }
  const url = URL.exec(part);
  if (url) { if (!basics.url) basics.url = url[0]; else basics.profiles.push(url[0]); return true; }
  if (part === basics.label || part === basics.name) return true;
  // A comma-joined place is the likeliest remaining part of a contact line.
  if (!basics.location && looksLikePlace(part)) { basics.location = part; return true; }
  return false;
}

/** Not a sentence: a resume with no headings is all header, and its prose has commas too. */
function looksLikePlace(part: string): boolean {
  // A full stop ends a sentence, except after a lone capital: "Washington, D.C.".
  if (part.length > MAX_PLACE_CHARS || /%|[;:!?]$|(?<!\b\p{Lu})\.$/u.test(part)) return false;
  const pieces = part.split(',').map((p) => p.trim());
  return pieces.length > 1 && pieces.every((p) => p.length > 0 && p.split(/\s+/).length <= MAX_PLACE_WORDS);
}

/* ---------- sections ---------- */

/**
 * A skills section as a list of groups. `Label: a, b, c` on one line is the
 * shape this can read; the two-stack shape a table extracts to is left as one
 * group per line, because pairing them is a guess and a wrong pairing reads
 * as a lie about the candidate.
 */
function skillsFrom(lines: string[], layout: TextLayout | null): JsonResume['skills'] {
  const joined = joinWrapped(lines);
  const table = layout ? pairedByPage(joined, layout.pairs) : null;
  if (table) return table;
  const out: JsonResume['skills'] = [];
  for (const line of joined) {
    const colon = line.indexOf(':');
    if (colon > 0 && colon < line.length - 1) {
      const name = line.slice(0, colon).trim();
      const values = splitList(line.slice(colon + 1));
      if (name.length > 0 && values.length > 0) { out.push({ name, keywords: values }); continue; }
    }
    if (colon > 0 && colon === line.length - 1) { out.push({ name: line.slice(0, colon).trim(), keywords: [] }); continue; }
    const values = splitList(line);
    if (values.length > 0) out.push({ name: null, keywords: values });
  }
  return out;
}

function splitList(text: string): string[] {
  return text.split(/\s*[,;·•]\s*/).map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Roles from an experience section. A role starts at the first non-bullet line
 * after a bullet block (or at the top); the line carrying a date range is the
 * position line, the one before it the company. Everything bulleted is a
 * highlight, and an unbulleted line inside a role is its summary.
 */
/**
 * A skills table whose labels and values the text gives apart — eight labels
 * above eight value lines — paired row by row, but only on the page's own
 * word: its table (pdf-layout.ts) holds exactly these labels, in this order,
 * and the text has one value line for each. The values are the TEXT's, so an
 * edit to one is kept; anything that does not line up stays unpaired.
 */
function pairedByPage(lines: string[], pairs: TextLayout['pairs']): JsonResume['skills'] | null {
  if (pairs.length === 0) return null;
  const labels = lines.filter((l) => /:$/.test(l.trim()));
  const values = lines.filter((l) => !/:$/.test(l.trim()));
  if (labels.length !== pairs.length || values.length !== labels.length) return null;
  if (labels.some((l, i) => wordsKey(l) !== wordsKey(pairs[i]!.label))) return null;
  return labels.map((l, i) => ({ name: l.trim().replace(/:$/, '').trim(), keywords: splitList(values[i]!) }));
}

/** The words of a line, case and punctuation aside — how a line of the text is matched to one on the page. */
export function wordsKey(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * A company line the page sets in two places — the company, and its place
 * flush right — split where the page split it, in the text's own characters.
 * Any other line, or one edited since, is split on its separator as before.
 */
function splitCompany(line: string, layout: TextLayout | null): [string, string] {
  const key = wordsKey(line);
  const hit = layout?.columns.find(([left, right]) => wordsKey(`${left} ${right}`) === key);
  if (hit) {
    const want = wordsKey(hit[0]);
    for (let i = line.indexOf(' '); i !== -1; i = line.indexOf(' ', i + 1)) {
      if (wordsKey(line.slice(0, i)) === want) return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }
  }
  return splitTail(line);
}

function rolesFrom(lines: string[], layout: TextLayout | null): JsonResume['work'] {
  const out: JsonResume['work'] = [];
  let current: JsonResume['work'][number] | null = null;
  let seenBullet = false;
  const heads: string[] = [];

  const flushHeads = () => {
    if (heads.length === 0) return;
    const dated = heads.findIndex((h) => DATE_RANGE.test(h));
    // The dated line is the position; the company sits above it. With no date
    // at all, the first head line is the company and the last the position.
    const positionAt = dated >= 0 ? dated : heads.length - 1;
    const companyAt = positionAt > 0 ? positionAt - 1 : -1;
    // Anything above the company line closed the PREVIOUS role — the
    // "Technology Stack: …" tail every resume in the corpus writes after its
    // bullets, and where it stays when the role is drawn again.
    const before = heads.slice(0, Math.max(companyAt, 0));
    const previous = out[out.length - 1];
    if (before.length > 0 && previous) previous.after = [previous.after, ...before].filter(Boolean).join(' ');

    const { text: position, start, end } = withDates(heads[positionAt] ?? '');
    const [name, location] = companyAt >= 0 ? splitCompany(heads[companyAt] ?? '', layout) : ['', ''];
    const after = heads.slice(positionAt + 1);
    current = {
      name: name || null,
      position: position || null,
      location: location || null,
      startDate: start,
      endDate: end,
      summary: [...(before.length > 0 && !previous ? before : []), ...after].join(' ') || null,
      highlights: [],
      after: null,
    };
    out.push(current);
    heads.length = 0;
  };

  for (const line of joinWrapped(lines)) {
    if (BULLET.test(line)) {
      flushHeads();
      seenBullet = true;
      // Bullets before any role line belong to a role we could not name.
      if (!current) {
        current = { name: null, position: null, location: null, startDate: null, endDate: null, summary: null, highlights: [], after: null };
        out.push(current);
      }
      current.highlights.push(line.replace(BULLET, '').trim());
      continue;
    }
    if (seenBullet) { current = null; seenBullet = false; }
    if (current) { current.summary = [current.summary, line].filter(Boolean).join(' '); continue; }
    heads.push(line);
  }
  flushHeads();
  return settle(out);
}

/**
 * A trailing line of a role — "Technology Stack: …" in every resume of the
 * corpus — arrives after the bullets, so the walk above opens a role for it.
 * A role with no dates and no bullets is not a role: it belongs to the one
 * before it, and with nothing before it, it is dropped.
 */
function settle(roles: JsonResume['work']): JsonResume['work'] {
  const out: JsonResume['work'] = [];
  for (const role of roles) {
    const empty = role.startDate === null && role.endDate === null && role.highlights.length === 0;
    const previous = out[out.length - 1];
    if (empty && previous) {
      const tail = [role.name, role.position, role.summary].filter(Boolean).join(' ');
      previous.after = [previous.after, tail].filter(Boolean).join(' ') || null;
      continue;
    }
    if (empty && role.name === null && role.position === null) continue;
    out.push(role);
  }
  return out;
}

/** Splits a `Company | Location` / `Company  Location` line on its separator only. */
function splitTail(line: string): [string, string] {
  const parts = line.split(SEPARATORS).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return [line.trim(), ''];
  return [parts[0] ?? '', parts.slice(1).join(' · ')];
}

function withDates(line: string): { text: string; start: string | null; end: string | null } {
  const m = DATE_RANGE.exec(line);
  if (!m) return { text: line.trim(), start: null, end: null };
  // What held the dates to the rest goes with them: "Harborline (remote), 2022-present" is not a company ending in a comma.
  const text = (line.slice(0, m.index) + line.slice(m.index + m[0].length))
    .replace(SEPARATORS, ' ')
    .replace(/^[\s,;–—-]+|[\s,;–—-]+$/g, '');
  return { text, start: m[1]?.trim() ?? null, end: m[2]?.trim() ?? null };
}

function educationFrom(lines: string[]): JsonResume['education'] {
  return joinWrapped(lines).map((line) => {
    const { text, start, end } = withDates(line);
    const [institution, area] = splitTail(text);
    return { institution: institution || null, area: area || null, studyType: null, startDate: start, endDate: end, score: null };
  });
}

function languagesFrom(lines: string[]): JsonResume['languages'] {
  const out: JsonResume['languages'] = [];
  for (const line of joinWrapped(lines)) {
    for (const item of line.split(SEPARATORS).map((s) => s.trim()).filter(Boolean)) {
      const paren = /^(.+?)\s*\(([^)]+)\)$/.exec(item);
      if (paren) out.push({ language: paren[1]?.trim() ?? item, fluency: paren[2]?.trim() ?? null });
      else {
        const colon = item.indexOf(':');
        if (colon > 0) out.push({ language: item.slice(0, colon).trim(), fluency: item.slice(colon + 1).trim() || null });
        else out.push({ language: item, fluency: null });
      }
    }
  }
  return out;
}

/* ---------- wrapping ---------- */

/**
 * A PDF's text layer breaks a bullet across lines at the page width, so a
 * continuation line is one that does not start a new item and follows a line
 * that did not end a sentence. Joining them back is what makes a bullet a
 * bullet again (measured on resumes 5 and 8).
 */
export function joinWrapped(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const previous = out[out.length - 1];
    if (previous !== undefined && isContinuation(previous, line)) {
      out[out.length - 1] = `${previous} ${line}`;
      continue;
    }
    out.push(line);
  }
  return out;
}

function isContinuation(previous: string, line: string): boolean {
  if (BULLET.test(line)) return false;
  // A line that opens a new thought — capitalised after a finished sentence —
  // is a new item, not a wrap.
  if (/[.:;!?]$/.test(previous)) return false;
  if (DATE_RANGE.test(line)) return false;
  return /^[\p{Ll}\p{N}(]/u.test(line) || previous.endsWith(',');
}
