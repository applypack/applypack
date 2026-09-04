import type { JsonResume } from '../json-resume';
import { drawable } from './drawable';
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

export type RenderBlock = HeadingBlock | LineBlock | BulletBlock | ParagraphBlock | GapBlock;

export interface Run {
  text: string;
  bold?: boolean;
  muted?: boolean;
}

export interface RenderedHeader {
  name: string | null;
  label: string | null;
  contact: string | null;
}

export interface RenderPlan {
  header: RenderedHeader;
  blocks: RenderBlock[];
}

/** The separator between the parts of a contact line, and between list items. */
const DOT = ' · ';
const DASH = ' – ';

export function planRender(resume: JsonResume, knobs: RenderKnobs): RenderPlan {
  const b = resume.basics;
  const contact = [b.location, b.email, b.phone, b.url, ...b.profiles].filter(Boolean).join(DOT);
  const blocks: RenderBlock[] = [];
  for (const key of knobs.sectionOrder) blocks.push(...section(key, resume));
  // Folded here, once, rather than at each of the dozen places a string is
  // put into a block: a construction site added later cannot forget it.
  return fold({
    header: { name: b.name, label: b.label, contact: contact.length > 0 ? contact : null },
    blocks,
  });
}

/** Every string of a plan through `drawable` (see that module for why). */
function fold(plan: RenderPlan): RenderPlan {
  const text = (v: string | null) => (v === null ? null : drawable(v));
  const runs = (rs: Run[]) => rs.map((r) => ({ ...r, text: drawable(r.text) }));
  return {
    header: { name: text(plan.header.name), label: text(plan.header.label), contact: text(plan.header.contact) },
    blocks: plan.blocks.map((b) =>
      b.kind === 'line' ? { ...b, left: runs(b.left), right: runs(b.right) }
      : b.kind === 'gap' ? b
      : { ...b, text: drawable(b.text) },
    ),
  };
}

function section(key: SectionKey, resume: JsonResume): RenderBlock[] {
  switch (key) {
    case 'summary':
      return resume.basics.summary ? headed(key, [{ kind: 'paragraph', text: resume.basics.summary }]) : [];
    case 'skills':
      return headed(
        key,
        resume.skills.map((s) => ({
          kind: 'line' as const,
          left: [
            ...(s.name ? [{ text: `${s.name.replace(/:\s*$/, '')}: `, bold: true }] : []),
            ...(s.keywords.length > 0 ? [{ text: s.keywords.join(', ') }] : []),
          ],
          right: [],
        })).filter((l) => l.left.length > 0),
      );
    case 'work':
      return headed(key, resume.work.flatMap(role));
    case 'projects':
      return headed(
        key,
        resume.projects.flatMap((p) => [
          { kind: 'line' as const, left: bolded(p.name), right: muted(p.url) },
          ...(p.description ? [{ kind: 'paragraph' as const, text: p.description }] : []),
          ...p.highlights.map((text) => ({ kind: 'bullet' as const, text })),
        ]),
      );
    case 'education':
      return headed(
        key,
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
      return line.length > 0 ? headed(key, [{ kind: 'paragraph', text: line }]) : [];
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
  if (w.name || w.location) out.push({ kind: 'line', left: bolded(w.name), right: muted(w.location) });
  if (w.position || dateRange) out.push({ kind: 'line', left: bolded(w.position), right: muted(dateRange) });
  if (w.summary) out.push({ kind: 'paragraph', text: w.summary });
  for (const text of w.highlights) out.push({ kind: 'bullet', text });
  if (out.length > 0) out.push({ kind: 'gap' });
  return out;
}

/** A section is drawn only when it has something in it — no empty headings. */
function headed(key: SectionKey, blocks: RenderBlock[]): RenderBlock[] {
  if (blocks.length === 0) return [];
  const label = SECTION_LABELS[key];
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
  for (const value of [plan.header.name, plan.header.label, plan.header.contact]) if (value) lines.push(value);
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
      case 'gap':
        lines.push('');
        break;
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
