import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import type { JsonResume } from '../json-resume';
import { planRender, type Run } from './sections';
import { BUNDLED_FAMILY, isMetricTwin, type RenderKnobs } from './knobs';

/*
 * The clean single-column .pdf (ADR 0039), the twin of clean-docx.ts: the same
 * plan, the same knobs, drawn by pdfkit instead of Word.
 *
 * Two decisions worth keeping in view:
 *
 * - The font is EMBEDDED, and it is Liberation Sans (fonts/README.md) whatever
 *   the .docx names. Measured with fontkit: identical advance widths on all 95
 *   printable ASCII codepoints against Arial, and full Cyrillic coverage —
 *   which pdfkit's built-in Helvetica does not have, and a Ukrainian name
 *   would come out as tofu without it.
 * - `Producer` and `Creator` are the empty string. pdfkit's default writes its
 *   own name into both, and ADR 0038's metadata policy says a file this
 *   product writes names the candidate, not the tool. Measured after the
 *   change: `{"Producer":"","Creator":"","Title":"…","Author":"…"}`.
 */

export const PDF_MIME = 'application/pdf';

const FONT_DIR = join(__dirname, '..', 'fonts');
const REGULAR = join(FONT_DIR, 'LiberationSans-Regular.ttf');
const BOLD = join(FONT_DIR, 'LiberationSans-Bold.ttf');
const MUTED = '#404040';
const INK = '#000000';
const INCH = 72;
/** Wrapped bullet text lines up under the first word, not under the marker. */
const BULLET_INDENT_PT = 10;
const RULE_WIDTH = 0.6;
/** Least space between the two halves of a right-aligned line. */
const GUTTER_PT = 12;

/**
 * pdfkit paginates for itself only when it is doing the layout. Every line and
 * bullet here is positioned by hand, so the page break is ours to make too.
 */
function fitOnPage(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

export async function renderPdf(resume: JsonResume, knobs: RenderKnobs): Promise<Buffer> {
  const plan = planRender(resume, knobs);
  const name = plan.header.name ?? 'Resume';
  const doc = new PDFDocument({
    size: knobs.page,
    margins: {
      top: knobs.margins.top * INCH,
      right: knobs.margins.right * INCH,
      bottom: knobs.margins.bottom * INCH,
      left: knobs.margins.left * INCH,
    },
    info: {
      Title: `${name} — Resume`,
      Author: name,
      Subject: plan.header.label ?? '',
      Producer: '',
      Creator: '',
    },
    autoFirstPage: true,
  });
  doc.registerFont('body', REGULAR);
  doc.registerFont('bold', BOLD);

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const accent = knobs.accentHex ? `#${knobs.accentHex}` : INK;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const setRun = (r: Run, size: number) => {
    doc.font(r.bold ? 'bold' : 'body').fontSize(size).fillColor(r.muted ? MUTED : INK);
  };

  if (plan.header.name) {
    doc.font('bold').fontSize(knobs.namePt).fillColor(INK)
      .text(plan.header.name, { align: knobs.nameCentered ? 'center' : 'left' });
  }
  if (plan.header.label) {
    doc.font('body').fontSize(knobs.headingPt).fillColor(MUTED)
      .text(plan.header.label, { align: knobs.nameCentered ? 'center' : 'left' });
  }
  if (plan.header.contact) {
    doc.font('body').fontSize(knobs.bodyPt).fillColor(MUTED)
      .text(plan.header.contact, { align: knobs.nameCentered ? 'center' : 'left' });
  }

  for (const block of plan.blocks) {
    switch (block.kind) {
      case 'heading': {
        doc.moveDown(0.5);
        doc.font('bold').fontSize(knobs.headingPt).fillColor(accent);
        // A heading alone at the foot of a page is an orphan: take the rule
        // and one line of what follows with it.
        fitOnPage(doc, doc.currentLineHeight(true) * 3);
        doc.text(block.text.toUpperCase());
        const y = doc.y + 1;
        doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
          .strokeColor(accent).lineWidth(RULE_WIDTH).stroke();
        doc.moveDown(0.3);
        doc.fillColor(INK);
        break;
      }
      case 'line': {
        const measure = (runs: Run[]) =>
          runs.reduce((w, r) => { setRun(r, knobs.bodyPt); return w + doc.widthOfString(r.text); }, 0);
        const leftWidth = measure(block.left);
        const rightWidth = measure(block.right);
        // One line with the right half flush right, but ONLY when both halves
        // fit: a skills line long enough to overrun the column would otherwise
        // be drawn straight over the next heading (measured, on resume 1).
        if (leftWidth + rightWidth + GUTTER_PT <= width) {
          fitOnPage(doc, doc.currentLineHeight(true));
          const startY = doc.y;
          let x = doc.page.margins.left;
          for (const r of block.left) {
            setRun(r, knobs.bodyPt);
            doc.text(r.text, x, startY, { lineBreak: false, width });
            x += doc.widthOfString(r.text);
          }
          if (block.right.length > 0) {
            const rightText = block.right.map((r) => r.text).join('');
            const first = block.right[0];
            if (first) setRun(first, knobs.bodyPt);
            doc.text(rightText, doc.page.width - doc.page.margins.right - rightWidth, startY, { lineBreak: false, width });
          }
          // Drawn with lineBreak:false, so the cursor has not moved on its own.
          doc.x = doc.page.margins.left;
          doc.y = startY + doc.currentLineHeight(true);
          break;
        }
        // Too wide: let pdfkit wrap it, chaining the runs so a bold label keeps
        // its weight and the right half follows the left instead of overlapping.
        const runs = [...block.left, ...block.right];
        doc.x = doc.page.margins.left;
        runs.forEach((r, i) => {
          setRun(r, knobs.bodyPt);
          doc.text(r.text, { width, continued: i < runs.length - 1 });
        });
        doc.x = doc.page.margins.left;
        break;
      }
      case 'bullet': {
        doc.font('body').fontSize(knobs.bodyPt).fillColor(INK);
        fitOnPage(doc, doc.currentLineHeight(true));
        // The hanging indent pdfkit's `indent` does not give: the marker goes
        // in the gutter and the text wraps inside its own column, both drawn
        // at the SAME y — the marker's own call moves the cursor otherwise.
        const y = doc.y;
        doc.text('•', doc.page.margins.left, y, { lineBreak: false, width: BULLET_INDENT_PT });
        doc.text(block.text, doc.page.margins.left + BULLET_INDENT_PT, y, {
          width: width - BULLET_INDENT_PT,
          align: 'left',
        });
        doc.x = doc.page.margins.left;
        break;
      }
      case 'paragraph':
        doc.font('body').fontSize(knobs.bodyPt).fillColor(INK).text(block.text, doc.page.margins.left, doc.y, { width });
        doc.x = doc.page.margins.left;
        break;
      case 'gap':
        doc.moveDown(0.35);
        break;
    }
  }

  doc.end();
  return done;
}

/**
 * The sentence the page shows about the typeface: the PDF cannot embed the
 * user's Arial (we do not have it and could not redistribute it), so it says
 * what it did instead — and whether that is the same width or merely close.
 */
export function typefaceNote(family: string): string {
  if (isMetricTwin(family)) {
    return `The PDF is set in ${BUNDLED_FAMILY}, which has the same letter widths as ${family} — the lines break in the same places. The .docx asks for ${family} itself.`;
  }
  return `The PDF is set in ${BUNDLED_FAMILY}; ${family} is not a font this app can embed, so the lines may break differently. The .docx asks for ${family} itself.`;
}
