import type { JsonResume } from '../json-resume';
import type { LookRole } from '../pdf-layout';
import { plainLine } from '../structure-from-text';
import { drawable, undrawable } from './drawable';
import { SECTION_LABELS, type RenderKnobs, type SectionKey } from './knobs';

/*
 * The one reading of a structure that both writers follow (ADR 0039). The
 * .docx and the .pdf are drawn by different libraries, so if each decided for
 * itself what a section contains they would drift apart on the first edit —
 * and the whole promise here is that a user gets the same document twice, in
 * two formats. Pure: a structure and the knobs in, blocks out.
 */

export interface HeadingBlock {
  kind: 'heading';
  text: string;
}

/** A line of runs, some bold, some in the muted colour, laid left-to-right. */
export interface LineBlock {
  kind: 'line';
  left: Run[];
  /** Set flush right on the same line — the dates and the place of a role. */
  right: Run[];
}

export interface BulletBlock {
  kind: 'bullet';
  text: string;
}

export interface ParagraphBlock {
  kind: 'paragraph';
  text: string;
}

/** Vertical air between two sections; the writers turn it into their own spacing. */
export interface GapBlock {
  kind: 'gap';
}

/** A skills-table row: the label in its own column, the values beside it (drawn only when the file had such a table). */
export interface PairBlock {
  kind: 'pair';
  label: string;
  values: string;
}

export type RenderBlock = HeadingBlock | LineBlock | BulletBlock | ParagraphBlock | GapBlock | PairBlock;

export interface Run {
  text: string;
  bold?: boolean;
  muted?: boolean;
  /** Set in the resume's accent colour, when it has one; otherwise in the body colour. */
  accent?: boolean;
  /** Which kind of line this is, for a file whose page said how each kind looks (knobs.looks). */
  role?: LookRole;
}

export interface RenderedHeader {
  name: string | null;
  label: string | null;
  contact: string | null;
  /** The same contact line in runs, its links apart — they carry their own colour on a page that gave them one. */
  contactRuns: Run[];
  /** Header lines under the contact line, as the resume writes them. */
  extra: string[];
}

export interface RenderPlan {
  header: RenderedHeader;
  blocks: RenderBlock[];
}

function unique(parts: Array<string | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    const key = part.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out;
}

/** The separator between the parts of a contact line, and between list items. */
const DOT = ' · ';
const DASH = ' – ';

/**
 * `fold: false` is for a writer that names the user's own font rather than
 * embedding ours — the .docx: Word draws the ₴ and the ✓ the bundled face
 * cannot, and folding them there would drop them from the saved file.
 */
export interface PlanOptions {
  fold?: boolean;
}

export function planRender(resume: JsonResume, knobs: RenderKnobs, opts: PlanOptions = {}): RenderPlan {
  // Folded here, once, rather than at each of the dozen places a string is
  // put into a block: a construction site added later cannot forget it.
  const plan = rawPlan(resume, knobs);
  return opts.fold === false ? plan : fold(plan);
}

/** A line the text marks as a heading: `## Skills`, or a short line in capitals with nothing after it. */
const MD_HEADING = /^#{1,6}\s+(.+)$/;
const BULLET_LINE = /^\s*[-•*·‣▪]\s+(.*)$/;
const LINE_HEADING_MAX = 44;

function lineHeading(line: string): string | null {
  const md = MD_HEADING.exec(line);
  if (md) return md[1]!.trim();
  const t = line.trim();
  if (t.length === 0 || t.length > LINE_HEADING_MAX || /[.:;]$/.test(t) || /,.*,/.test(t)) return null;
  return /\p{Lu}/u.test(t) && !/\p{Ll}/u.test(t) ? t : null;
}

/**
 * Every line of the text as a block of its own, in order — the plan that
 * cannot lose a word. The structured plan reads a resume into sections and
 * roles, which is what makes it look like one; when that reading would drop
 * a line (a run-on table row, a heading that is really content), the clean
 * version is drawn from this instead, plainer and complete.
 */
export function planLines(text: string, opts: PlanOptions = {}): RenderPlan {
  // Plain as the structured plan is: a Markdown resume's asterisks are not words to print (#574).
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => plainLine(l).trimEnd());
  const first = lines.findIndex((l) => l.trim().length > 0);
  const name = first >= 0 ? lines[first]!.trim().replace(MD_HEADING, '$1') : null;
  const blocks: RenderBlock[] = [];
  for (const line of lines.slice(first + 1)) {
    if (line.trim().length === 0) {
      if (blocks.length > 0 && blocks[blocks.length - 1]!.kind !== 'gap') blocks.push({ kind: 'gap' });
      continue;
    }
    const heading = lineHeading(line);
    const bullet = BULLET_LINE.exec(line);
    if (heading !== null) blocks.push({ kind: 'heading', text: heading });
    else if (bullet) blocks.push({ kind: 'bullet', text: bullet[1]!.trim() });
    else blocks.push({ kind: 'paragraph', text: line.trim() });
  }
  const plan: RenderPlan = { header: { name, label: null, contact: null, contactRuns: [], extra: [] }, blocks };
  return opts.fold === false ? plan : fold(plan);
}

/**
 * What a clean render would drop, so the page can say so.
 *
 * The bundled face covers Latin and Cyrillic and no more, and `drawable`
 * quietly removes what it cannot draw — a Greek letter in a formula, a CJK
 * name, an emoji in a bullet. Quietly is the problem: the file downloads
 * looking finished. Measured off the UNFOLDED plan, so it sees exactly the
 * characters the fold is about to take out.
 */
export function droppedByRender(resume: JsonResume, knobs: RenderKnobs): string[] {
  const seen = new Set<string>();
  for (const text of planStrings(rawPlan(resume, knobs))) {
    for (const ch of undrawable(text)) seen.add(ch);
  }
  return [...seen];
}

function rawPlan(resume: JsonResume, knobs: RenderKnobs): RenderPlan {
  const b = resume.basics;
  // A model reading a one-link contact line often fills BOTH `url` and
  // `profiles` with it, and the line then says linkedin.com twice (measured on
  // the first live scan). Same link, once.
  const parts = unique([b.location, b.email, b.phone, b.url, ...b.profiles]);
  const contact = parts.join(DOT);
  const links = new Set([b.email, b.url, ...b.profiles].filter(Boolean));
  const contactRuns: Run[] = parts.flatMap((text, i) => [
    ...(i > 0 ? [{ text: DOT, role: 'contact' as const }] : []),
    { text, role: links.has(text) ? ('link' as const) : ('contact' as const) },
  ]);
  const blocks: RenderBlock[] = [];
  for (const key of knobs.sectionOrder) blocks.push(...section(key, resume, knobs));
  return {
    header: { name: b.name, label: b.label, contact: contact.length > 0 ? contact : null, contactRuns, extra: b.lines },
    blocks,
  };
}

/** Every string a plan would draw, header included. */
function planStrings(plan: RenderPlan): string[] {
  const out: string[] = [plan.header.name, plan.header.label, plan.header.contact, ...plan.header.extra].filter(
    (v): v is string => v !== null,
  );
  for (const b of plan.blocks) {
    if (b.kind === 'gap') continue;
    if (b.kind === 'line') out.push(...[...b.left, ...b.right].map((r) => r.text));
    else if (b.kind === 'pair') out.push(b.label, b.values);
    else out.push(b.text);
  }
  return out;
}

/** Every string of a plan through `drawable` (see that module for why). */
function fold(plan: RenderPlan): RenderPlan {
  const text = (v: string | null) => (v === null ? null : drawable(v));
  const runs = (rs: Run[]) => rs.map((r) => ({ ...r, text: drawable(r.text) }));
  return {
    header: {
      name: text(plan.header.name),
      label: text(plan.header.label),
      contact: text(plan.header.contact),
      contactRuns: runs(plan.header.contactRuns),
      extra: plan.header.extra.map(drawable),
    },
    blocks: plan.blocks.map((b) =>
      b.kind === 'line' ? { ...b, left: runs(b.left), right: runs(b.right) }
      : b.kind === 'gap' ? b
      : b.kind === 'pair' ? { ...b, label: drawable(b.label), values: drawable(b.values) }
      : { ...b, text: drawable(b.text) },
    ),
  };
}

function section(key: SectionKey, resume: JsonResume, knobs: RenderKnobs): RenderBlock[] {
  switch (key) {
    case 'summary':
      return resume.basics.summary ? headed(key, resume, [{ kind: 'paragraph', text: resume.basics.summary }]) : [];
    case 'skills':
      return headed(
        key,
        resume,
        resume.skills
          .map((s): RenderBlock => {
            const values = s.keywords.join(', ');
            // The file set its skills as a table: the label in a column of its own.
            if (s.name && values && knobs.looks?.labelColumnPt) return { kind: 'pair', label: `${s.name.replace(/:\s*$/, '')}:`, values };
            return {
              kind: 'line',
              left: [
                ...(s.name ? [{ text: `${s.name.replace(/:\s*$/, '')}: `, bold: true, role: 'skillLabel' as const }] : []),
                ...(values ? [{ text: values, role: 'skillValues' as const }] : []),
              ],
              right: [],
            };
          })
          .filter((b) => b.kind !== 'line' || b.left.length > 0),
      );
    case 'work':
      return headed(key, resume, resume.work.flatMap(role));
    case 'projects':
      return headed(
        key,
        resume,
        resume.projects.flatMap((p) => [
          { kind: 'line' as const, left: bolded(p.name), right: muted(p.url) },
          ...(p.description ? [{ kind: 'paragraph' as const, text: p.description }] : []),
          ...p.highlights.map((text) => ({ kind: 'bullet' as const, text })),
        ]),
      );
    case 'education':
      return headed(
        key,
        resume,
        resume.education.map((e) => ({
          kind: 'line' as const,
          left: [
            ...bolded(e.institution),
            ...(e.studyType || e.area ? [{ text: `  ${[e.studyType, e.area].filter(Boolean).join(' ')}` }] : []),
          ],
          right: muted(dates(e.startDate, e.endDate)),
        })),
      );
    case 'certificates':
      return headed(
        key,
        resume,
        resume.certificates.map((c) => ({
          kind: 'line' as const,
          left: [...bolded(c.name), ...(c.issuer ? [{ text: `  ${c.issuer}` }] : [])],
          right: muted(c.date),
        })),
      );
    case 'languages': {
      const line = resume.languages
        .map((l) => (l.fluency ? `${l.language} (${l.fluency})` : l.language))
        .filter(Boolean)
        .join(DOT);
      return line.length > 0 ? headed(key, resume, [{ kind: 'paragraph', text: line }]) : [];
    }
    case 'extras':
      return resume.extras.flatMap((x) => [
        { kind: 'heading' as const, text: x.heading },
        ...x.lines.map((text) => ({ kind: 'paragraph' as const, text })),
        { kind: 'gap' as const },
      ]);
  }
}

function role(w: JsonResume['work'][number]): RenderBlock[] {
  const out: RenderBlock[] = [];
  const dateRange = dates(w.startDate, w.endDate);
  // Company and place on the first line, title and dates on the second: the
  // shape every resume in the corpus already uses.
  if (w.name || w.location) out.push({ kind: 'line', left: as(bolded(w.name), 'company'), right: as(muted(w.location), 'place') });
  if (w.position || dateRange) out.push({ kind: 'line', left: as(bolded(w.position), 'position'), right: as(muted(dateRange), 'dates') });
  if (w.summary) out.push({ kind: 'paragraph', text: w.summary });
  for (const text of w.highlights) out.push({ kind: 'bullet', text });
  if (w.after) out.push(labelled(w.after));
  if (out.length > 0) out.push({ kind: 'gap' });
  return out;
}

/** "Technology Stack: PHP, Laravel" as its label in the accent and the list muted; a plain sentence as a paragraph. */
const LABEL = /^([^:]{2,40}:)\s+(.+)$/;
function labelled(text: string): RenderBlock {
  const m = LABEL.exec(text);
  if (!m) return { kind: 'paragraph', text };
  return {
    kind: 'line',
    left: [{ text: `${m[1]} `, accent: true, role: 'stackLabel' }, { text: m[2]!, muted: true, role: 'stackValues' }],
    right: [],
  };
}

function as(runs: Run[], role: LookRole): Run[] {
  return runs.map((r) => ({ ...r, role }));
}

/** A section is drawn only when it has something in it — no empty headings — under the resume's own heading when it has one. */
function headed(key: SectionKey, resume: JsonResume, blocks: RenderBlock[]): RenderBlock[] {
  if (blocks.length === 0) return [];
  const label = resume.headings[key] ?? SECTION_LABELS[key];
  const body: RenderBlock[] = [...blocks, { kind: 'gap' }];
  return label ? [{ kind: 'heading', text: label }, ...body] : body;
}

function bolded(text: string | null): Run[] {
  return text ? [{ text, bold: true }] : [];
}

function muted(text: string | null): Run[] {
  return text ? [{ text, muted: true }] : [];
}

function dates(start: string | null, end: string | null): string | null {
  if (start && end) return `${start}${DASH}${end}`;
  return start ?? end ?? null;
}

/**
 * What the plan reads as, plain. Used for the "what the ATS sees" preview and
 * by the tests that round-trip a rendered file back through our own readers.
 */
export function planToText(plan: RenderPlan): string {
  const lines: string[] = [];
  for (const value of [plan.header.name, plan.header.label, plan.header.contact, ...plan.header.extra]) if (value) lines.push(value);
  for (const block of plan.blocks) {
    switch (block.kind) {
      case 'heading':
        lines.push('', block.text.toUpperCase());
        break;
      case 'line': {
        const left = block.left.map((r) => r.text).join('');
        const right = block.right.map((r) => r.text).join('');
        lines.push([left, right].filter((s) => s.trim().length > 0).join('  '));
        break;
      }
      case 'bullet':
        lines.push(`• ${block.text}`);
        break;
      case 'paragraph':
        lines.push(block.text);
        break;
      case 'pair':
        lines.push(`${block.label} ${block.values}`);
        break;
      case 'gap':
        lines.push('');
        break;
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
