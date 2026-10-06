import { Hono } from 'hono';
import { idParam } from '../params';
import { logger } from '../../logger';
import { getResume, getResumeOriginal } from '../../resume/store';
import { resumeStyle } from '../resume-style';
import { knobsFrom } from '../../resume/render/knobs';
import { DOCX_MIME } from '../../resume/docx-write';
import { PDF_MIME } from '../../resume/render/clean-pdf';
import {
  contentDisposition,
  documentFileName,
  draftDocx,
  draftPdf,
  type DraftInput,
} from '../../resume/draft-document';
import { t } from '../../i18n/t';

/*
 * The Tailor page's document: the draft in the editor as the file it would be
 * (src/resume/draft-document.ts), for the pane that draws it and for the two
 * downloads. Nothing is stored — every request is the text on screen, drawn
 * on the spot, which is what lets the pane follow each Apply.
 */

export const resumeDocumentRoute = new Hono();

/** The longest draft drawn — the same ceiling Save puts on a version. */
const MAX_TEXT_CHARS = 200_000;

type Want = 'preview' | 'docx' | 'pdf';

resumeDocumentRoute.post('/resumes/:id/document', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: t('http.badId') }, 400);
  const form = await c.req.parseBody();
  const text = typeof form.text === 'string' ? form.text.replace(/\r\n/g, '\n').trim() : '';
  const baseText = typeof form.baseText === 'string' ? form.baseText.replace(/\r\n/g, '\n').trim() : '';
  const want: Want = form.as === 'docx' || form.as === 'pdf' ? form.as : 'preview';
  if (text.length === 0 || text.length > MAX_TEXT_CHARS || baseText.length > MAX_TEXT_CHARS) {
    return c.json({ error: t('document.error.textSize') }, 400);
  }
  const [resume, row] = await Promise.all([getResume(id), getResumeOriginal(id)]);
  if (!resume || !row) return c.json({ error: t('http.notFound') }, 404);

  const original = Buffer.from(row.original);
  const style = await resumeStyle(resume, row);
  const input: DraftInput = {
    sourceFilename: row.sourceFilename,
    original,
    baseText: baseText || text,
    text,
    knobs: knobsFrom(style),
    layout: style.layout,
  };
  // A one-off check carries the name of the file it was (match-name.ts); the page sends it.
  const name = typeof form.name === 'string' && form.name.trim() ? form.name : resume.name;

  const started = Date.now();
  const doc = await draftDocx(input);
  logger.debug({ id, kind: doc.kind, basis: doc.basis, want, ms: Date.now() - started }, 'resume: document drawn');

  if (want === 'docx') return attachment(doc.docx, documentFileName(name, 'docx'), DOCX_MIME);
  if (want === 'pdf') {
    // The user's own .docx is theirs to print: the pane prints it as drawn.
    if (doc.kind === 'own') return c.json({ error: 'print', print: true }, 409);
    return attachment(await draftPdf(input), documentFileName(name, 'pdf'), PDF_MIME);
  }
  return c.json({
    kind: doc.kind,
    basis: doc.basis,
    notice: doc.notice,
    docx: doc.docx.toString('base64'),
    fileName: documentFileName(name, 'docx'),
    pdf: doc.kind === 'own' ? 'print' : 'render',
  });
});

function attachment(bytes: Buffer, fileName: string, mime: string): Response {
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': mime, 'Content-Disposition': contentDisposition(fileName), 'Cache-Control': 'no-store' },
  });
}
