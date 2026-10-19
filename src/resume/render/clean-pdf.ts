import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import type { JsonResume } from '../json-resume';
import { planRender, type RenderPlan, type Run } from './sections';
import { BUNDLED_FAMILY, isMetricTwin, lookFor, type RenderKnobs } from './knobs';
import { t } from '../../i18n/t';

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
/** A skills table's label column when the page did not say, and the space between the two columns. */
const DEFAULT_LABEL_COLUMN_PT = 110;
const PAIR_GAP_PT = 8;

/** A link or an e-mail address in a line of text. */
const LINK = /(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+\.[\w.-]+|\b[\w-]+(?:\.[\w-]+)+\/\S*/i;
/** pdfkit rounds each piece it measures: a line measured to fit by less than this may still be broken again. */
const FIT_SLACK_PT = 0.5;

/**
 * A text that holds a link, broken into lines at its spaces only. pdfkit
 * breaks a line after any hyphen or slash, so "github.com/mkeller-example"
 * came out "github.com/mkeller-" / "example" and a parser read two words
 * (#585). A text with no link, or one that fits, comes back whole and is left
 * to pdfkit as before. A link longer than the whole line still has to break.
 */
export function linesKeepingLinks(text: string, width: number, widthOf: (s: string) => number): string[] {
  if (!LINK.test(text) || widthOf(text) <= width - FIT_SLACK_PT) return [text];
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const longer = line ? `${line} ${word}` : word;
    if (line && widthOf(longer) > width - FIT_SLACK_PT) {
      lines.push(line);
      line = word;
    } else line = longer;
  }
  return [...lines, line];
}

/**
 * pdfkit paginates for itself only when it is doing the layout. Every line and
 * bullet here is positioned by hand, so the page break is ours to make too.
 */
function fitOnPage(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

export async function renderPdf(resume: JsonResume, knobs: RenderKnobs): Promise<Buffer> {
  return drawPdf(planRender(resume, knobs), knobs);
}

/** The .pdf of a plan — the twin of clean-docx.ts's `drawDocx`. */
export async function drawPdf(plan: RenderPlan, knobs: RenderKnobs): Promise<Buffer> {
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
  const looks = knobs.looks;
  // A run in the look its kind of line has on the user's own page, when the
  // page said (pdf-layout.ts); otherwise in ours — the .docx makes the same call.
  const setRun = (r: Run, size: number) => {
    const look = lookFor(knobs, r.role);
    const bold = look ? look.bold : r.bold;
    const colour = look?.color ? `#${look.color}` : r.accent && knobs.accentHex ? accent : r.muted ? MUTED : INK;
    doc.font(bold ? 'bold' : 'body').fontSize(look?.pt ?? size).fillColor(colour);
  };
  const align = knobs.nameCentered ? 'center' : 'left';
  const bodyAlign = looks?.justify ? 'justify' : 'left';
  // A text that may hold a link, drawn a line per call so pdfkit never breaks inside one (#585).
  // pdfkit sets a call's last line flush left, so a justified paragraph that wraps a link is set flush left.
  const textKeepingLinks = (text: string, x: number, y: number | undefined, options: PDFKit.Mixins.TextOptions & { width: number }) => {
    linesKeepingLinks(text, options.width, (s) => doc.widthOfString(s)).forEach((line, i) => doc.text(line, x, i === 0 ? y : undefined, options));
  };

  if (plan.header.name) {
    setRun({ text: '', bold: true, role: 'name' }, knobs.namePt);
    doc.fontSize(knobs.namePt).text(plan.header.name, { align });
  }
  if (plan.header.label) {
    setRun({ text: '', muted: true, role: 'label' }, looks ? knobs.bodyPt : knobs.headingPt);
    doc.text(plan.header.label, { align });
  }
  if (plan.header.contact) {
    const runs = plan.header.contactRuns;
    const total = runs.reduce((w, r) => { setRun(r, knobs.bodyPt); return w + doc.widthOfString(r.text); }, 0);
    if (looks && total <= width) {
      // In runs, so a link keeps the colour the page gave it — placed by hand:
      // pdfkit's continued text overprints itself when it is centred.
      const y = doc.y;
      let x = doc.page.margins.left + (align === 'center' ? (width - total) / 2 : 0);
      for (const r of runs) {
        setRun(r, knobs.bodyPt);
        doc.text(r.text, x, y, { lineBreak: false });
        x += doc.widthOfString(r.text);
      }
      doc.x = doc.page.margins.left;
      doc.y = y + doc.currentLineHeight(true);
    } else {
      doc.font('body').fontSize(knobs.bodyPt).fillColor(MUTED);
      textKeepingLinks(plan.header.contact, doc.page.margins.left, undefined, { width, align });
    }
  }
  for (const line of plan.header.extra) {
    setRun({ text: '', muted: true, role: 'contact' }, knobs.bodyPt);
    textKeepingLinks(line, doc.page.margins.left, undefined, { width, align });
  }
  if (looks?.headerRule) {
    const y = doc.y + 3;
    doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).strokeColor(INK).lineWidth(RULE_WIDTH).stroke();
    doc.y = y + 2;
  }
  const headingRule = looks ? looks.headingRule : true;
  const headingColour = lookFor(knobs, 'heading')?.color;

  for (const block of plan.blocks) {
    switch (block.kind) {
      case 'heading': {
        doc.moveDown(0.5);
        const colour = headingColour ? `#${headingColour}` : accent;
        doc.font(lookFor(knobs, 'heading')?.bold === false ? 'body' : 'bold').fontSize(knobs.headingPt).fillColor(colour);
        // A heading alone at the foot of a page is an orphan: take the rule
        // and one line of what follows with it.
        fitOnPage(doc, doc.currentLineHeight(true) * 3);
        doc.text(block.text.toUpperCase(), doc.page.margins.left, doc.y, { width });
        if (headingRule) {
          const y = doc.y + 1;
          doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
            .strokeColor(colour).lineWidth(RULE_WIDTH).stroke();
        }
        doc.moveDown(0.3);
        doc.fillColor(INK);
        break;
      }
      case 'pair': {
        // The label right-aligned in its own column, the values wrapping in theirs, both from the same top.
        const column = looks?.labelColumnPt ?? DEFAULT_LABEL_COLUMN_PT;
        const left = doc.page.margins.left;
        setRun({ text: '', role: 'skillValues' }, knobs.bodyPt);
        fitOnPage(doc, doc.heightOfString(block.values, { width: width - column }));
        const y = doc.y;
        setRun({ text: '', bold: true, role: 'skillLabel' }, knobs.bodyPt);
        doc.text(block.label, left, y, { width: column - PAIR_GAP_PT, align: 'right' });
        const labelEnd = doc.y;
        setRun({ text: '', role: 'skillValues' }, knobs.bodyPt);
        textKeepingLinks(block.values, left + column, y, { width: width - column, align: 'left' });
        doc.x = left;
        doc.y = Math.max(labelEnd, doc.y);
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
        setRun({ text: '', role: 'body' }, knobs.bodyPt);
        fitOnPage(doc, doc.currentLineHeight(true));
        // The hanging indent pdfkit's `indent` does not give: the marker goes
        // in the gutter and the text wraps inside its own column, both drawn
        // at the SAME y — the marker's own call moves the cursor otherwise.
        const y = doc.y;
        doc.text('•', doc.page.margins.left, y, { lineBreak: false, width: BULLET_INDENT_PT });
        textKeepingLinks(block.text, doc.page.margins.left + BULLET_INDENT_PT, y, {
          width: width - BULLET_INDENT_PT,
          align: bodyAlign,
        });
        doc.x = doc.page.margins.left;
        break;
      }
      case 'paragraph':
        setRun({ text: '', role: 'body' }, knobs.bodyPt);
        textKeepingLinks(block.text, doc.page.margins.left, doc.y, { width, align: bodyAlign });
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
 * A file already set in the bundled face is told so, not compared with itself.
 */
export function typefaceNote(family: string): string {
  if (family.trim().toLowerCase() === BUNDLED_FAMILY.toLowerCase()) return t('render.typeface.bundled', { family: BUNDLED_FAMILY });
  return t(isMetricTwin(family) ? 'render.typeface.same' : 'render.typeface.close', { bundled: BUNDLED_FAMILY, family });
}
