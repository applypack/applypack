import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
  convertInchesToTwip,
  type IParagraphOptions,
} from 'docx';
import type { JsonResume } from '../json-resume';
import { DOCX_MIME } from '../docx-write';
import { planRender, type RenderBlock, type Run } from './sections';
import type { RenderKnobs } from './knobs';

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

export { DOCX_MIME };

const BULLETS = 'clean-bullets';
const MUTED = '404040';
/** docx counts font size in half-points and spacing in twentieths of a point. */
const halfPoints = (pt: number) => Math.round(pt * 2);
const twips = (pt: number) => Math.round(pt * 20);
/** Hanging indent for a bullet: the marker sits in the gutter, the text lines up. */
const BULLET_INDENT_IN = 0.22;
const BULLET_HANG_IN = 0.15;

export async function renderDocx(resume: JsonResume, knobs: RenderKnobs): Promise<Buffer> {
  const plan = planRender(resume, knobs);
  const font = knobs.fontFamily;
  const body = halfPoints(knobs.bodyPt);
  const accent = knobs.accentHex ?? undefined;
  const name = plan.header.name ?? 'Resume';

  const run = (text: string, o: { bold?: boolean; muted?: boolean; size?: number; color?: string } = {}) =>
    new TextRun({
      text,
      font,
      size: o.size ?? body,
      bold: o.bold,
      color: o.color ?? (o.muted ? MUTED : undefined),
    });
  const para = (children: TextRun[], options: Omit<IParagraphOptions, 'children'> = {}) =>
    new Paragraph({ children, ...options });

  const children: Paragraph[] = [];
  const centred = knobs.nameCentered ? { alignment: AlignmentType.CENTER } : {};
  if (plan.header.name) {
    children.push(para([run(plan.header.name, { bold: true, size: halfPoints(knobs.namePt) })], centred));
  }
  if (plan.header.label) {
    children.push(para([run(plan.header.label, { size: halfPoints(knobs.headingPt), muted: true })], centred));
  }
  if (plan.header.contact) children.push(para([run(plan.header.contact, { muted: true })], centred));

  // The right-hand run of a line sits on a right tab at the text width, which
  // is what makes a role's dates line up with the margin.
  const rightTab = convertInchesToTwip(pageWidthIn(knobs) - knobs.margins.left - knobs.margins.right);

  for (const block of plan.blocks) {
    switch (block.kind) {
      case 'heading':
        children.push(
          para([run(block.text.toUpperCase(), { bold: true, size: halfPoints(knobs.headingPt), color: accent })], {
            spacing: { before: twips(knobs.bodyPt * 0.8), after: twips(2) },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 4, color: accent ?? MUTED, space: 1 },
            },
          }),
        );
        break;
      case 'line': {
        const runs = block.left.map((r) => run(r.text, r));
        if (block.right.length > 0) {
          runs.push(new TextRun({ text: '\t', font, size: body }));
          runs.push(...block.right.map((r) => run(r.text, r)));
        }
        children.push(
          para(runs, {
            tabStops: block.right.length > 0 ? [{ type: TabStopType.RIGHT, position: rightTab }] : undefined,
          }),
        );
        break;
      }
      case 'bullet':
        children.push(para([run(block.text)], { numbering: { reference: BULLETS, level: 0 } }));
        break;
      case 'paragraph':
        children.push(para([run(block.text)]));
        break;
      case 'gap':
        children.push(para([run('')], { spacing: { after: twips(knobs.bodyPt * 0.4) } }));
        break;
    }
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

export function pageWidthIn(knobs: RenderKnobs): number {
  return knobs.page === 'A4' ? 8.27 : 8.5;
}

/** Blocks a caller may want to count without rendering (the page's summary line). */
export function blockCounts(blocks: RenderBlock[]): { headings: number; bullets: number; lines: number } {
  return {
    headings: blocks.filter((b) => b.kind === 'heading').length,
    bullets: blocks.filter((b) => b.kind === 'bullet').length,
    lines: blocks.filter((b) => b.kind === 'line' || b.kind === 'paragraph').length,
  };
}

export type { Run };
