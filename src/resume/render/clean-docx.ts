// First: docx reads localStorage as it loads.
import './no-web-storage';
import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableBorders,
  TableCell,
  TableLayoutType,
  TableRow,
  Tab,
  TabStopType,
  TextRun,
  WidthType,
  convertInchesToTwip,
  type IParagraphOptions,
} from 'docx';
import type { JsonResume } from '../json-resume';
import type { LookRole } from '../pdf-layout';
import { planRender, type RenderPlan, type Run } from './sections';
import { lookFor, type RenderKnobs } from './knobs';

/*
 * The clean single-column .docx (ADR 0039): one section, no tables, no text
 * boxes, no headers — the shape the patcher in ADR 0038 can edit in place
 * afterwards, which is the point. A resume that arrives here as a PDF leaves
 * as a file the rest of the product can work on.
 *
 * Metadata carries the candidate and nothing else: `docx` writes no tool name
 * of its own (measured — 0 occurrences of "docx", "dolanmiu" or "Un-named" in
 * any part of its output), so the policy holds with no scrubbing pass.
 *
 * The font is NAMED, not embedded: the reader's own Word supplies Arial. The
 * PDF twin embeds Liberation Sans, whose metrics are identical, so the two
 * files break their lines in the same places.
 */

const BULLETS = 'clean-bullets';
const MUTED = '404040';
/** The rule under a header, when the page drew one. */
const RULE = '000000';
const TWIPS_PER_INCH = 1440;
/** A skills table's label column when the page did not say, and the space between the two columns. */
const DEFAULT_LABEL_COLUMN_PT = 110;
const PAIR_GAP_PT = 8;
/** docx counts font size in half-points and spacing in twentieths of a point. */
const halfPoints = (pt: number) => Math.round(pt * 2);
const twips = (pt: number) => Math.round(pt * 20);
/** Hanging indent for a bullet: the marker sits in the gutter, the text lines up. */
const BULLET_INDENT_IN = 0.22;
const BULLET_HANG_IN = 0.15;

export async function renderDocx(resume: JsonResume, knobs: RenderKnobs): Promise<Buffer> {
  return drawDocx(planRender(resume, knobs), knobs);
}

/** The .docx of a plan — `renderDocx` for a structure, the draft's line-by-line plan when a structure would lose a line. */
export async function drawDocx(plan: RenderPlan, knobs: RenderKnobs): Promise<Buffer> {
  const font = knobs.fontFamily;
  const body = halfPoints(knobs.bodyPt);
  const accent = knobs.accentHex ?? undefined;
  const name = plan.header.name ?? 'Resume';
  const looks = knobs.looks;

  // A run in the look its kind of line has on the user's own page, when the
  // page said (a PDF, pdf-layout.ts); otherwise in ours: bold, muted, accent.
  const run = (text: string, o: Run | { bold?: boolean; muted?: boolean; accent?: boolean; role?: LookRole; size?: number; color?: string } = {}) => {
    const look = lookFor(knobs, o.role);
    const size = 'size' in o && o.size !== undefined ? o.size : look?.pt !== undefined ? halfPoints(look.pt) : body;
    return new TextRun({
      text,
      font,
      size,
      bold: look ? look.bold : o.bold,
      color: look?.color ?? ('color' in o && o.color ? o.color : o.accent && accent ? accent : o.muted ? MUTED : undefined),
    });
  };
  const para = (children: (TextRun | Table)[] | TextRun[], options: Omit<IParagraphOptions, 'children'> = {}) =>
    new Paragraph({ children: children as TextRun[], ...options });
  const justify = looks?.justify ? { alignment: AlignmentType.JUSTIFIED } : {};

  const children: (Paragraph | Table)[] = [];
  const centred = knobs.nameCentered ? { alignment: AlignmentType.CENTER } : {};
  if (plan.header.name) {
    children.push(para([run(plan.header.name, { bold: true, role: 'name', size: halfPoints(knobs.namePt) })], centred));
  }
  if (plan.header.label) {
    children.push(para([run(plan.header.label, { muted: true, role: 'label', size: looks ? undefined : halfPoints(knobs.headingPt) })], centred));
  }
  if (plan.header.contact) {
    const runs = looks ? plan.header.contactRuns.map((r) => run(r.text, r)) : [run(plan.header.contact, { muted: true })];
    children.push(para(runs, centred));
  }
  for (const line of plan.header.extra) children.push(para([run(line, { muted: true, role: 'contact' })], centred));
  // The page drew a rule under its header: so does this file, and no rule under each heading unless it drew those too.
  if (looks?.headerRule) {
    children.push(new Paragraph({ children: [], spacing: { after: twips(4) }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } } }));
  }
  const headingRule = looks ? looks.headingRule : true;
  const heading = lookFor(knobs, 'heading');

  // The right-hand run of a line sits on a right tab at the text width, which
  // is what makes a role's dates line up with the margin.
  const textWidthIn = pageWidthIn(knobs) - knobs.margins.left - knobs.margins.right;
  const rightTab = convertInchesToTwip(textWidthIn);

  for (const block of plan.blocks) {
    switch (block.kind) {
      case 'heading':
        children.push(
          para([run(block.text.toUpperCase(), { bold: true, size: halfPoints(knobs.headingPt), color: heading?.color ?? accent, role: 'heading' })], {
            spacing: { before: twips(knobs.bodyPt * 0.8), after: twips(2) },
            border: headingRule
              ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: heading?.color ?? accent ?? MUTED, space: 1 } }
              : undefined,
          }),
        );
        break;
      case 'line': {
        const runs = block.left.map((r) => run(r.text, r));
        if (block.right.length > 0) {
          // A tab element, not a tab character: Word forgives the character,
          // but a renderer and the patcher's tab groups read only the element.
          runs.push(new TextRun({ children: [new Tab()], font, size: body }));
          runs.push(...block.right.map((r) => run(r.text, r)));
        }
        children.push(
          para(runs, {
            tabStops: block.right.length > 0 ? [{ type: TabStopType.RIGHT, position: rightTab }] : undefined,
          }),
        );
        break;
      }
      case 'pair':
        children.push(pairRow(block.label, block.values));
        break;
      case 'bullet':
        children.push(para([run(block.text, { role: 'body' })], { numbering: { reference: BULLETS, level: 0 }, ...justify }));
        break;
      case 'paragraph':
        children.push(para([run(block.text, { role: 'body' })], justify));
        break;
      case 'gap':
        children.push(para([run('')], { spacing: { after: twips(knobs.bodyPt * 0.4) } }));
        break;
    }
  }

  /**
   * One skills-table row as a table of its own, two cells, no borders: the
   * label right-aligned in the column the page gave it, the values beside it.
   * One table per row keeps each row a line the patcher can write cell by cell.
   */
  function pairRow(label: string, values: string): Table {
    const labelTwips = Math.round((looks?.labelColumnPt ?? DEFAULT_LABEL_COLUMN_PT) * 20);
    const total = Math.round(textWidthIn * TWIPS_PER_INCH);
    const cell = (text: string, width: number, role: LookRole, align: IParagraphOptions['alignment']) =>
      new TableCell({
        width: { size: width, type: WidthType.DXA },
        margins: { top: 0, bottom: 0, left: role === 'skillValues' ? twips(PAIR_GAP_PT) : 0, right: 0 },
        children: [new Paragraph({ children: [run(text, { role, bold: role === 'skillLabel' })], alignment: align })],
      });
    return new Table({
      layout: TableLayoutType.FIXED,
      borders: TableBorders.NONE,
      width: { size: total, type: WidthType.DXA },
      columnWidths: [labelTwips, total - labelTwips],
      rows: [new TableRow({ children: [cell(label, labelTwips, 'skillLabel', AlignmentType.RIGHT), cell(values, total - labelTwips, 'skillValues', AlignmentType.LEFT)] })],
    });
  }

  const doc = new Document({
    title: `${name} — Resume`,
    creator: name,
    lastModifiedBy: name,
    description: plan.header.label ?? '',
    styles: { default: { document: { run: { font, size: body } } } },
    numbering: {
      config: [
        {
          reference: BULLETS,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: convertInchesToTwip(BULLET_INDENT_IN),
                    hanging: convertInchesToTwip(BULLET_HANG_IN),
                  },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: pageSize(knobs),
            margin: {
              top: convertInchesToTwip(knobs.margins.top),
              right: convertInchesToTwip(knobs.margins.right),
              bottom: convertInchesToTwip(knobs.margins.bottom),
              left: convertInchesToTwip(knobs.margins.left),
            },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc) as unknown as Promise<Buffer>;
}

function pageSize(knobs: RenderKnobs) {
  return knobs.page === 'A4'
    ? { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) }
    : { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) };
}

function pageWidthIn(knobs: RenderKnobs): number {
  return knobs.page === 'A4' ? 8.27 : 8.5;
}
